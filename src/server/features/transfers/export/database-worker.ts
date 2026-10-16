import {AppFault,type DataRow,type JsonObject} from '../../../../shared/contracts.js';
import type {NormalizedTableMeta,NormalizedRow,ValueKind} from '../../../../shared/database.js';
import type {DatabaseRegistry} from '../../../database/registry.js';
import type {DbSession} from '../../../database/contracts.js';
import {runTransaction} from '../../../database/transaction.js';
import type {FileStore} from '../files.js';
import type {TransferQueue} from '../queue.js';
import type {TaskRecord,TransferContext} from '../types.js';
import type {BrowseRequest} from '../../data/types.js';
import {exportRequestSchema} from './types.js';
import {writeExport} from './codec.js';
export interface PageSnapshot {meta:NormalizedTableMeta;rows:DataRow[];rowKinds:Record<string,ValueKind>[];generation:number}
function allowed(meta:NormalizedTableMeta,format:'csv'|'xlsx'|'sql'){const cap=meta.capabilities[format==='csv'?'exportCsv':format==='xlsx'?'exportXlsx':'exportSql'];if(!cap?.enabled)throw new AppFault('EXPORT_TYPE',cap?.reasons.join('；')||'此表不支持该导出格式');}
function checkContext(registry:DatabaseRegistry,task:TaskRecord){let context;try{context=registry.context(task.target.connectionId);}catch{throw new AppFault('CONNECTION_CHANGED','原连接已不可用',409);}if(context.kind!==task.details.databaseKind||context.generation!==task.details.generation||context.resourceIdentity!==task.details.resourceIdentity)throw new AppFault('CONNECTION_CHANGED','连接已改变，请重新发起导出',409);}
export async function startDatabaseExport(queue:TransferQueue,registry:DatabaseRegistry,pageCache:Map<string,PageSnapshot>,input:unknown):Promise<TaskRecord>{
 const b=exportRequestSchema.parse(input),adapter=registry.get(b.request.target.connectionId);let meta:NormalizedTableMeta,generation:number,resourceIdentity='';
 if(b.scope==='page'){
  if(!b.meta||!b.rows||!b.rowKinds||b.generation===undefined)throw new AppFault('PAGE_ROWS','请先重新加载含值类别的当前页快照');
  meta=b.meta;generation=b.generation;if(meta.databaseKind!==adapter.kind||meta.schema!==b.request.target.schema||meta.name!==b.request.target.table)throw new AppFault('PAGE_COLUMNS','当前页来源与目标不一致');
  if(new Set(meta.columns.map(c=>c.name)).size!==meta.columns.length||b.rows.length!==b.rowKinds.length||b.rows.some((row,i)=>meta.columns.some(c=>!Object.hasOwn(row,c.name)||!Object.hasOwn(b.rowKinds![i],c.name))))throw new AppFault('PAGE_COLUMNS','当前页字段或值类别不完整');
  if(Buffer.byteLength(JSON.stringify([b.rows,b.rowKinds]))>10*1024*1024)throw new AppFault('RESULT_TOO_LARGE','当前页超过10MiB预算');if(pageCache.size>=4)throw new AppFault('PAGE_EXPORT_BUSY','已有4个页面快照等待导出',409);
 }else{const context=registry.context(b.request.target.connectionId);generation=context.generation;resourceIdentity=context.resourceIdentity;meta=await adapter.describeTable(b.request.target);if(registry.context(b.request.target.connectionId).generation!==generation)throw new AppFault('CONNECTION_CHANGED','连接已改变',409);adapter.dialect.compileBrowse(meta,b.request,b.scope);}
 allowed(meta,b.format);const task=queue.enqueue({direction:'export',target:b.request.target,format:b.format,details:{request:b.request,scope:b.scope,databaseKind:adapter.kind,generation,resourceIdentity,definitionFingerprint:meta.definitionFingerprint} as unknown as JsonObject});
 if(b.scope==='page')pageCache.set(task.id,structuredClone({meta,rows:b.rows!,rowKinds:b.rowKinds!,generation}));return task;
}
export async function runDatabaseExport(registry:DatabaseRegistry,files:FileStore,pageCache:Map<string,PageSnapshot>,task:TaskRecord,ctx:TransferContext):Promise<void>{
 let file:ReturnType<FileStore['create']>|undefined,session:DbSession|undefined;
 try{
  const adapter=registry.get(task.target.connectionId),scope=task.details.scope as 'page'|'filtered'|'all';
  const write=async(meta:NormalizedTableMeta,source:AsyncIterable<NormalizedRow>)=>{
   allowed(meta,task.format);file=files.create('export',`${meta.name}.${task.format}`,task.format);const kinds=new WeakMap<DataRow,ValueKind[]>();
   async function* records(){for await(const row of source){if(row.values.length!==meta.columns.length||row.valueKinds.length!==meta.columns.length)throw new AppFault('EXPORT_COLUMNS','记录与快照列数不一致');const record=Object.fromEntries(meta.columns.map((c,i)=>[c.name,row.values[i]]));kinds.set(record,row.valueKinds);yield record;}}
   await writeExport(file.path,task.format,meta,records(),(exportedRows,bytes)=>ctx.progress({exportedRows,readRows:exportedRows,bytes}),ctx.signal,undefined,undefined,{preamble:'-- Data INSERT only; no schema or identity/sequence calibration.\n'+adapter.dialect.exportPreamble(meta),row:record=>{try{return adapter.dialect.exportInsert(meta,{values:meta.columns.map(c=>record[c.name]),valueKinds:kinds.get(record)!});}catch(error){throw new AppFault('EXPORT_TYPE',`无法安全生成 SQL：${(error as Error).message}`);}}});
  };
  if(scope==='page'){
   const snapshot=pageCache.get(task.id);if(!snapshot)throw new AppFault('PAGE_EXPIRED','当前页快照已失效');
   await write(snapshot.meta,(async function*(){for(let i=0;i<snapshot.rows.length;i++)yield {values:snapshot.meta.columns.map(c=>snapshot.rows[i][c.name]),valueKinds:snapshot.meta.columns.map(c=>snapshot.rowKinds[i][c.name])};})());
  }else{
   checkContext(registry,task);session=await adapter.openSession(task.target.connectionId,task.target.schema,'export',ctx.signal);checkContext(registry,task);
   await runTransaction(session,'snapshot',async()=>{
    const meta=await adapter.describeTable(task.target,session);if(meta.definitionFingerprint!==task.details.definitionFingerprint)throw new AppFault('SCHEMA_CHANGED','表定义已变化',409);
    const cursor=await session!.openStatement(adapter.dialect.compileBrowse(meta,task.details.request as unknown as BrowseRequest,scope));
    if(cursor.columns.length!==meta.columns.length||cursor.columns.some((c,i)=>c.name!==meta.columns[i].name||c.dataType.toUpperCase()!==meta.columns[i].dataType.toUpperCase())){await cursor.close();throw new AppFault('EXPORT_COLUMNS','读取列与快照结构不一致');}
    async function* source(){try{for(;;){const part=await cursor.read(100,32*1024*1024);if(part.omittedRows)throw new AppFault('EXPORT_TYPE','单行超过32MiB导出块预算');yield* part.rows;if(part.done)break;}}finally{await cursor.close();}}
    await write(meta,source());if((await adapter.describeTable(task.target,session)).definitionFingerprint!==meta.definitionFingerprint)throw new AppFault('SCHEMA_CHANGED','快照中表定义已变化',409);
   });await session.close('discard');session=undefined;
   checkContext(registry,task);if((await adapter.describeTable(task.target)).definitionFingerprint!==task.details.definitionFingerprint)throw new AppFault('SCHEMA_CHANGED','完成前表定义已改变',409);
  }
  if(ctx.signal.aborted)throw new AppFault('CANCELLED','导出已取消');files.complete(file!.id);ctx.setOutputFile(file!.id);
 }catch(error){if(file)await files.remove(file.id).catch(()=>{});throw error;}finally{pageCache.delete(task.id);await session?.close('discard');}
}
