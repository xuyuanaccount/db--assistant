import {z} from 'zod';
import {identifier128,valueKindSchema} from '../../data/types.js';
import {AppFault,type DataRow,type OperationRecord,type TableMeta} from '../../../../shared/contracts.js';
import {LIMITS} from '../../../../shared/limits.js';
import type {QueryResultSnapshot} from '../../../../shared/query-export.js';
import type {OperationStore} from '../../../local/operations.js';
import type {FileStore} from '../files.js';
import type {TransferQueue} from '../queue.js';
import type {TaskRecord,TransferContext} from '../types.js';
import {encodeText,writeExport} from './codec.js';

const cell=z.union([z.null(),z.string(),z.object({binaryHex:z.string().regex(/^(?:[a-f\d]{2})*$/i)}).strict()]);
const requestSchema=z.object({
  source:z.object({operationId:z.string().uuid(),connectionId:z.string().min(1).max(100),connectionName:z.string().max(100),database:identifier128.or(z.literal(''))}).strict(),
  columns:z.array(z.object({name:z.string(),dataType:z.string().max(100)}).strict()).min(1).max(65535),
  rows:z.array(z.array(cell)).max(LIMITS.resultRows),
  truncated:z.boolean(),needsReview:z.boolean(),valueKinds:z.array(z.array(valueKindSchema)).optional(),executionState:z.enum(['completed','needs_review']).optional(),format:z.enum(['csv','xlsx']),acknowledgeIncomplete:z.boolean(),
}).strict();
export type QueryResultCache=Map<string,QueryResultSnapshot>;

export function startQueryResultExport(queue:TransferQueue,operations:OperationStore,cache:QueryResultCache,input:unknown):TaskRecord {
  const b=requestSchema.parse(input);
  if(b.valueKinds&&(b.valueKinds.length!==b.rows.length||b.valueKinds.some(row=>row.length!==b.columns.length)))throw new AppFault('RESULT_COLUMNS','值类别矩阵维度不一致');
  if(b.rows.some(row=>row.length!==b.columns.length))throw new AppFault('RESULT_COLUMNS','查询结果行与列数不一致');
  if(Buffer.byteLength(JSON.stringify([b.rows,b.valueKinds??[]]))>LIMITS.resultBytes)throw new AppFault('RESULT_TOO_LARGE','查询结果超过 10 MiB 上限');
  if(b.format==='xlsx'){
    if(b.columns.length>16384)throw new AppFault('XLSX_COLUMN_LIMIT','XLSX 最多 16,384 列，请改用 CSV');
    if([...b.columns.map(c=>c.name),...b.rows.flat()].some(value=>encodeText(value,'xlsx').length>32767))throw new AppFault('XLSX_CELL_LIMIT','XLSX 单元格编码后超过 32,767 字符，请改用 CSV');
  }
  let original:OperationRecord|undefined;
  try{original=operations.get(b.source.operationId);}catch(error){if((error as {statusCode?:number}).statusCode!==404)throw error;}
  if(original&&(original.type!=='sql'||original.connectionId!==b.source.connectionId||!['completed','needs_review'].includes(original.status)))throw new AppFault('RESULT_SOURCE','查询结果来源与操作记录不一致');
  const partial=b.truncated||(b.executionState?b.executionState==='needs_review':b.needsReview)||original?.status==='needs_review';
  if(partial&&!b.acknowledgeIncomplete)throw new AppFault('INCOMPLETE_RESULT','结果可能不完整，请确认只导出当前已显示的部分结果');
  // Up to four bounded snapshots; row values stay in memory and never enter task/log storage.
  if(cache.size>=4)throw new AppFault('QUERY_EXPORT_BUSY','已有 4 个查询结果等待导出，请完成或取消后重试',409);
  const task=queue.enqueue({direction:'export',format:b.format,
    target:{connectionId:original?.connectionId||b.source.connectionId,schema:original?.schema??b.source.database,table:'查询结果'},
    details:{scope:'query_result',sourceOperationId:b.source.operationId,connectionName:original?.connectionName??b.source.connectionName,partial,sourceLogMissing:!original},
  });
  cache.set(task.id,{columns:b.columns,rows:b.rows,truncated:b.truncated,needsReview:partial,...(b.valueKinds?{valueKinds:b.valueKinds}:{}),...(b.executionState?{executionState:b.executionState}:{})});
  return task;
}

export async function runQueryResultExport(files:FileStore,cache:QueryResultCache,task:TaskRecord,ctx:TransferContext):Promise<void> {
  let file:ReturnType<FileStore['create']>|undefined;
  try{
    const snapshot=cache.get(task.id);
    if(!snapshot)throw new AppFault('RESULT_EXPIRED','页面查询结果快照已失效，请从仍显示结果的页面重新导出');
    if(task.format==='sql')throw new AppFault('RESULT_FORMAT','查询结果只支持 CSV / XLSX');
    if(ctx.signal.aborted)throw new AppFault('CANCELLED','导出已取消');
    // Unique internal keys preserve every positional column, including duplicate or empty aliases.
    const meta:TableMeta={schema:'',name:'查询结果',kind:'table',engine:null,primaryKey:[],columns:snapshot.columns.map((_,i)=>({name:String(i),dataType:'varchar',columnType:'text',nullable:true,hasDefault:false,generated:false,autoIncrement:false,ordinal:i+1}))};
    async function* rows():AsyncIterable<DataRow>{for(const row of snapshot!.rows)yield Object.fromEntries(row.map((value,i)=>[String(i),value]));}
    const name=`query-result-${String(task.details.sourceOperationId).slice(0,8)}${task.details.partial?'-partial':''}.${task.format}`;
    file=files.create('export',name,task.format);
    await writeExport(file.path,task.format,meta,rows(),(exportedRows,bytes)=>ctx.progress({readRows:exportedRows,exportedRows,bytes}),ctx.signal,LIMITS.xlsxRows,snapshot.columns.map(c=>c.name));
    if(ctx.signal.aborted)throw new AppFault('CANCELLED','导出已取消');
    files.complete(file.id);ctx.setOutputFile(file.id);
  }catch(error){if(file)await files.remove(file.id).catch(()=>{});throw error;}
  finally{cache.delete(task.id);}
}
