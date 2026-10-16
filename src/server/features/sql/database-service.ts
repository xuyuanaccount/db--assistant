import {AppFault,errorInfo,type DbCell} from '../../../shared/contracts.js';
import {LIMITS} from '../../../shared/limits.js';
import type {ValueKind} from '../../../shared/database.js';
import type {DbSession} from '../../database/contracts.js';
import type {DatabaseRegistry} from '../../database/registry.js';
import {assertSingleSql} from '../../database/statements.js';
import type {OperationStore} from '../../local/operations.js';
import type {SqlRequest,SqlResult} from './types.js';
export async function executeDatabaseSql(registry:DatabaseRegistry,operations:OperationStore,input:SqlRequest):Promise<SqlResult>{
 const adapter=registry.get(input.connectionId),context=registry.context(input.connectionId);
 const {text,category}=assertSingleSql(adapter.kind,input.sql),started=Date.now();
 // A durable operation must exist before any user SQL can be dispatched.
 const operationId=operations.begin({type:'sql',connectionId:input.connectionId,schema:input.database,sql:input.sql});
 const controller=new AbortController();let timedOut=false;
 const timer=setTimeout(()=>{timedOut=true;controller.abort();},LIMITS.queryTimeoutMs);
 let session:DbSession|undefined,transaction=false,dispatched=false,commitStarted=false,confirmed=false;
 try{
  session=await adapter.openSession(input.connectionId,input.database,'sql',controller.signal);
  if(registry.context(input.connectionId).generation!==context.generation)throw new AppFault('CONNECTION_CHANGED','连接已改变，请重新执行',409);
  if(adapter.kind!=='oracle'||category!=='ddl'){transaction=true;await session.begin('sql');}
  dispatched=true;const cursor=await session.openStatement({sql:text,params:[]});
  const columns=cursor.columns.map(c=>({name:c.name,dataType:c.dataType})),rows:DbCell[][]=[],valueKinds:ValueKind[][]=[];
  let bytes=2,truncated=false,affectedRows=0;
  try{for(;;){const part=await cursor.read(100,LIMITS.resultBytes);for(const row of part.rows){const size=Buffer.byteLength(JSON.stringify(row))+(rows.length?1:0);if(truncated||rows.length>=input.maxRows||bytes+size>LIMITS.resultBytes){truncated=true;continue;}rows.push(row.values);valueKinds.push(row.valueKinds);bytes+=size;}if(part.omittedRows)truncated=true;if(part.done){affectedRows=part.completion?.affectedRows??0;break;}}}finally{await cursor.close();}
  if(transaction){commitStarted=true;await session.commit();transaction=false;}confirmed=true;
  const durationMs=Date.now()-started;operations.finish(operationId,{status:'completed',durationMs,affectedRows});
  return {operationId,columns,rows,valueKinds,affectedRows,durationMs,truncated,executionState:'completed',needsReview:false,maxRows:input.maxRows};
 }catch(error){
  let unknown=commitStarted||confirmed||adapter.kind==='oracle'&&category==='ddl'&&dispatched;
  if(transaction&&!commitStarted){try{await session!.rollback();transaction=false;}catch{unknown=true;}}
  const info=unknown?{code:'RESULT_UNKNOWN',message:'执行结果待核对，请检查数据与日志，勿直接重试',operationId,databaseKind:adapter.kind}: {...errorInfo(timedOut?new AppFault('SQL_TIMEOUT','SQL 执行超过 60 秒',408):error),operationId,databaseKind:adapter.kind};
  try{operations.finish(operationId,{status:unknown?'needs_review':'failed',durationMs:Date.now()-started,error:info});}catch{/* Running entry remains recoverable if local confirmation is unavailable. */}
  if(unknown)throw Object.assign(new AppFault(info.code,info.message,409,operationId),{databaseKind:adapter.kind});
  throw Object.assign(timedOut?new AppFault('SQL_TIMEOUT','SQL 执行超过 60 秒',408):error instanceof Error?error:new AppFault(info.code,info.message),{operationId,databaseKind:adapter.kind});
 }finally{clearTimeout(timer);await session?.close('discard');}
}
