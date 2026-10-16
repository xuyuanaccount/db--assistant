import {AppFault,type JsonObject} from '../../../../shared/contracts.js';
import type {DatabaseRegistry} from '../../../database/registry.js';
import {runTransaction} from '../../../database/transaction.js';
import type {FileStore} from '../files.js';
import type {TransferQueue} from '../queue.js';
import type {TaskRecord,TransferContext} from '../types.js';
import {importRequestSchema} from './types.js';
import {readSource} from './codec.js';
import {makeBatches} from './batches.js';
import {databaseImportRow,validateDatabaseMapping} from './database-preview.js';
function checkContext(registry:DatabaseRegistry,task:TaskRecord){let c;try{c=registry.context(task.target.connectionId);}catch{throw new AppFault('CONNECTION_CHANGED','原连接已不可用，请重新发起',409);}if(c.kind!==task.details.databaseKind||c.generation!==task.details.generation||c.resourceIdentity!==task.details.resourceIdentity)throw new AppFault('CONNECTION_CHANGED','排队期间连接或文件已改变，请重新发起',409);}
export async function startDatabaseImport(queue:TransferQueue,files:FileStore,registry:DatabaseRegistry,input:unknown):Promise<TaskRecord>{
 const b=importRequestSchema.parse(input),file=files.get(b.uploadId);if(file.kind!=='upload'||!file.completed||file.format!==b.options.format)throw new AppFault('INVALID_UPLOAD','上传文件格式不匹配');
 const context=registry.context(b.target.connectionId),meta=await registry.get(b.target.connectionId).describeTable(b.target);validateDatabaseMapping(meta,b.mappings);
 if(registry.context(b.target.connectionId).generation!==context.generation)throw new AppFault('CONNECTION_CHANGED','连接已改变，请重新预览',409);
 return queue.enqueue({direction:'import',target:b.target,format:b.options.format,details:{...b,databaseKind:context.kind,generation:context.generation,resourceIdentity:context.resourceIdentity,definitionFingerprint:meta.definitionFingerprint} as unknown as JsonObject});
}
export async function runDatabaseImport(registry:DatabaseRegistry,files:FileStore,task:TaskRecord,ctx:TransferContext):Promise<void>{
 const b=importRequestSchema.parse(task.details);checkContext(registry,task);const adapter=registry.get(task.target.connectionId),meta=await adapter.describeTable(task.target);if(meta.definitionFingerprint!==task.details.definitionFingerprint)throw new AppFault('SCHEMA_CHANGED','排队期间表定义已改变',409);validateDatabaseMapping(meta,b.mappings);const file=files.get(b.uploadId);
 async function* source(){let first=true,readRows=0;try{for await(const row of readSource(file.path,b.options)){if(first){first=false;if(b.options.hasHeader)continue;}if(ctx.signal.aborted)return;readRows++;if(readRows%50===0)ctx.progress({readRows});yield row;}}finally{ctx.progress({readRows});}}
 for await(const batch of makeBatches(source(),16*1024*1024)){
  if(ctx.signal.aborted)break;checkContext(registry,task);
  // Cancellation is observed between batches; it cannot kill a batch halfway through COMMIT.
  const session=await adapter.openSession(task.target.connectionId,task.target.schema,'import');
  try{checkContext(registry,task);ctx.beginBatch({firstRow:batch[0].sourceRow,lastRow:batch[batch.length-1].sourceRow});
   try{await runTransaction(session,'write',async()=>{
    await session.lockTable(meta);const current=await adapter.describeTable(task.target,session);if(current.definitionFingerprint!==task.details.definitionFingerprint)throw new AppFault('SCHEMA_CHANGED','批次写入前表定义已改变',409);validateDatabaseMapping(current,b.mappings);
    for(const row of batch){const completion=await session.execute(databaseImportRow(registry,task.target,row,b.mappings,current));if(completion.warnings.length)throw new AppFault('DATA_WARNING',completion.warnings.join('；'));}
   });}catch(error){if((error as {code?:string}).code!=='RESULT_UNKNOWN')ctx.rollbackBatch();throw error;}
   try{ctx.confirmBatch(batch.length);}catch{throw new AppFault('RESULT_UNKNOWN','批次已提交，但本地确认失败，请核对后再操作',409);}
  }finally{await session.close('discard');}
 }
}
