import {AppFault,type DataRow} from '../../../shared/contracts.js';
import type {NormalizedTableMeta,ValueKind} from '../../../shared/database.js';
import {LIMITS} from '../../../shared/limits.js';
import type {DatabaseRegistry} from '../../database/registry.js';
import type {BrowseRequest} from './types.js';
export interface DatabaseBrowseResult {meta:NormalizedTableMeta;generation:number;rows:DataRow[];rowKinds:Record<string,ValueKind>[];hasNext:boolean;querySql:string|null;queryTemplate:string;queryParameters:import('../../../shared/contracts.js').DbCell[];querySqlReason?:string}
export async function browseDatabase(registry:DatabaseRegistry,input:BrowseRequest):Promise<DatabaseBrowseResult>{
 const adapter=registry.get(input.target.connectionId),controller=new AbortController();
 const timer=setTimeout(()=>controller.abort(),LIMITS.queryTimeoutMs);
 const session=await adapter.openSession(input.target.connectionId,input.target.schema,'browse',controller.signal).catch(e=>{clearTimeout(timer);throw e;});
 const generation=registry.context(input.target.connectionId).generation;
 try{
  await session.begin('snapshot');const meta=await adapter.describeTable(input.target,session);
  if(!meta.capabilities.browse.enabled)throw new AppFault('READ_ONLY_TABLE',meta.capabilities.browse.reasons.join('；'));
  const command=adapter.dialect.compileBrowse(meta,input,'page'),cursor=await session.openStatement(command);
  const rows:DataRow[]=[],rowKinds:Record<string,ValueKind>[]=[];let bytes=2;
  try{for(;;){const part=await cursor.read(100,LIMITS.resultBytes);if(part.omittedRows)throw new AppFault('RESULT_TOO_LARGE','表数据页含超出结果预算的单行，请使用 SQL 查询选择字段');for(const row of part.rows){bytes+=Buffer.byteLength(JSON.stringify(row));if(bytes>LIMITS.resultBytes)throw new AppFault('RESULT_TOO_LARGE','表数据页超过 10 MiB，请减少列或使用 SQL 查询');rows.push(Object.fromEntries(meta.columns.map((c,i)=>[c.name,row.values[i]])));rowKinds.push(Object.fromEntries(meta.columns.map((c,i)=>[c.name,row.valueKinds[i]])));}if(part.done)break;}}finally{await cursor.close();}
  await session.commit();const shown=adapter.dialect.render(command);
  return {meta,generation,rows:rows.slice(0,input.pageSize),rowKinds:rowKinds.slice(0,input.pageSize),hasNext:rows.length>input.pageSize,querySql:shown.sql,queryTemplate:shown.template,queryParameters:shown.parameters,...(shown.reason?{querySqlReason:shown.reason}:{})};
 }finally{clearTimeout(timer);await session.close('discard');}
}
