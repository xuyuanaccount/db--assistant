import {AppFault,errorInfo,type TableTarget,type DataRow} from '../../../shared/contracts.js';
import type {NormalizedTableMeta,NormalizedRow,ValueKind} from '../../../shared/database.js';
import type {DatabaseRegistry} from '../../database/registry.js';
import {normalizeWriteValues} from '../../database/values.js';
import {runTransaction} from '../../database/transaction.js';
import type {OperationStore} from '../../local/operations.js';
import type {RowChange} from './types.js';
const conflict=()=>new AppFault('ROW_CONFLICT','记录已被修改或删除，请刷新后重新编辑',409);
function validate(meta:NormalizedTableMeta,changes:RowChange[]){
 for(const change of changes){const ability=meta.capabilities[change.kind==='insert'?'insert':change.kind==='update'?'update':'delete'];if(!ability?.enabled)throw new AppFault('READ_ONLY_TABLE',ability?.reasons.join('；')||'此表不支持此操作');
  if(change.kind!=='insert'){
   if(meta.columns.some(c=>!Object.hasOwn(change.original,c.name))||Object.keys(change.original).some(name=>!meta.columns.some(c=>c.name===name)))throw new AppFault('INVALID_SNAPSHOT','原始记录字段不完整或已变化');
   if(meta.columns.some(c=>!c.comparable))throw new AppFault('READ_ONLY_TABLE','原始记录包含不可可靠比较的字段');
   if(meta.databaseKind==='sqlite'&&(!change.originalKinds||meta.columns.some(c=>!Object.hasOwn(change.originalKinds!,c.name))))throw new AppFault('INVALID_SNAPSHOT','SQLite 原始记录必须包含全部实际值类别');
  }
  if(change.kind!=='delete')for(const [name,value] of Object.entries(change.values)){
   const column=meta.columns.find(c=>c.name===name);if(!column)throw new AppFault('UNKNOWN_COLUMN',`字段不存在：${name}`);
   if(!column.editable?.enabled||column.generated||column.identity==='always'||value!==null&&typeof value==='object')throw new AppFault('READ_ONLY_COLUMN',`字段不可通过表格写入：${name}`);
  }
 }
}
export async function applyDatabaseEdits(registry:DatabaseRegistry,operations:OperationStore,target:TableTarget,changes:RowChange[],expectedFingerprint:string,generation:number):Promise<{operationId:string;affectedRows:number}>{
 const adapter=registry.get(target.connectionId);
 if(!expectedFingerprint||!Number.isInteger(generation))throw new AppFault('EXPECTED_CONTEXT','请刷新后使用连接代次和表定义指纹提交');
 if(registry.context(target.connectionId).generation!==generation)throw new AppFault('CONNECTION_CHANGED','连接已改变，请重新预览',409);
 const before=await adapter.describeTable(target);if(before.definitionFingerprint!==expectedFingerprint)throw new AppFault('SCHEMA_CHANGED','表定义已改变，请重新预览',409);validate(before,changes);
 const operationId=operations.begin({type:'data_edit',connectionId:target.connectionId,schema:target.schema,table:target.table,sql:'事务数据编辑（参数化 INSERT / UPDATE / DELETE）'}),started=Date.now();
 let committed=false;const session=await adapter.openSession(target.connectionId,target.schema,'edit').catch(error=>{try{operations.finish(operationId,{status:'failed',durationMs:Date.now()-started,error:errorInfo(error)});}catch{}throw error;});
 try{
  if(registry.context(target.connectionId).generation!==generation)throw new AppFault('CONNECTION_CHANGED','连接已改变，请重新预览',409);
  const affectedRows=await runTransaction(session,'write',async()=>{
   await session.lockTable(before);const meta=await adapter.describeTable(target,session);if(meta.definitionFingerprint!==expectedFingerprint)throw new AppFault('SCHEMA_CHANGED','事务内表定义已改变，请重新预览',409);validate(meta,changes);let affected=0;
   for(const change of changes){
    if(change.kind!=='insert'){
     const cursor=await session.openStatement(adapter.dialect.compileLockRow(meta,change.original,change.originalKinds));
     const found:NormalizedRow[]=[];try{for(;;){const part=await cursor.read(2,10*1024*1024);if(part.omittedRows)throw conflict();found.push(...part.rows);if(found.length>1)throw conflict();if(part.done)break;}}finally{await cursor.close();}
     if(found.length!==1||meta.columns.some((c,i)=>JSON.stringify(found[0].values[i])!==JSON.stringify(change.original[c.name])||change.originalKinds&&found[0].valueKinds[i]!==change.originalKinds[c.name]))throw conflict();
    }
    if(change.kind==='delete')affected+=(await session.execute(adapter.dialect.compileDelete(meta,change.original,change.originalKinds))).affectedRows;
    else{const {values,kinds}=normalizeWriteValues(meta,change.values,change.valueKinds,change.kind==='update'?change.originalKinds:undefined);if(change.kind==='update'&&!Object.keys(values).length)continue;
     const command=change.kind==='insert'?adapter.dialect.compileInsert(meta,values,kinds):adapter.dialect.compileUpdate(meta,values,change.original,kinds,change.originalKinds);
     affected+=(await session.execute(command)).affectedRows;
    }
   }
   return affected;
  });committed=true;
  operations.finish(operationId,{status:'completed',durationMs:Date.now()-started,affectedRows});return {operationId,affectedRows};
 }catch(error){const unknown=committed||(error as {code?:string}).code==='RESULT_UNKNOWN';const info=unknown?{code:'RESULT_UNKNOWN',message:'提交或回滚未确认，请核对数据库与操作记录',operationId,databaseKind:adapter.kind}:{...errorInfo(error),operationId,databaseKind:adapter.kind};try{operations.finish(operationId,{status:unknown?'needs_review':'failed',durationMs:Date.now()-started,error:info});}catch{}
  if(unknown)throw Object.assign(new AppFault(info.code,info.message,409,operationId),{databaseKind:adapter.kind});throw Object.assign(error as Error,{operationId,databaseKind:adapter.kind});
 }finally{await session.close('discard');}
}
