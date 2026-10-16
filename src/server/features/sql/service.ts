import mysql2,{type Connection as CoreConnection,type FieldPacket} from 'mysql2';
import type {Readable} from 'node:stream';
import {AppFault,errorInfo,type DbCell} from '../../../shared/contracts.js';
import {LIMITS} from '../../../shared/limits.js';
import {decodeCell,textTypeCast} from '../../mysql/values.js';
import type {MysqlAdapter} from '../../mysql/adapter.js';
import type {OperationStore} from '../../local/operations.js';
import type {SqlResult} from './types.js';
export function validateSql(sql:string) {
 if(!sql.trim())throw new AppFault('EMPTY_SQL','请填写 SQL');if(Buffer.byteLength(sql)>LIMITS.sqlBytes)throw new AppFault('SQL_TOO_LARGE','SQL 超出 256 KiB 上限');
 let quote='';let comment='';let ended=false;
 for(let i=0;i<sql.length;i++) {
  const c=sql[i],n=sql[i+1];
  if(comment==='line'){if(c==='\n')comment='';continue;}if(comment==='block'){if(c==='*'&&n==='/'){comment='';i++;}continue;}
  if(quote){if(c==='\\'){i++;continue;}if(c===quote){if(n===quote)i++;else quote='';}continue;}
  if(c==='#'||(c==='-'&&n==='-'&&/\s/.test(sql[i+2]||' '))){comment='line';if(c==='-')i++;continue;}
  if(c==='/'&&n==='*'){comment='block';i++;continue;}if(/\s/.test(c))continue;
  if(ended)throw new AppFault('MULTIPLE_STATEMENTS','一次只支持一条 SQL');if(c===';'){ended=true;continue;}if(c==='\''||c==='"'||c==='`')quote=c;
 }
}
export function coreConnection(conn:unknown):CoreConnection {return (conn as {connection:CoreConnection}).connection;}
export async function collectSqlStream(stream:Readable,onStop:()=>void,fields:FieldPacket[],maxRows:number=LIMITS.resultRows,maxBytes:number=LIMITS.resultBytes) {
 const rows:DbCell[][]=[];let bytes=0;let truncated=false;let affectedRows=0;
 for await(const raw of stream) {
  if(!Array.isArray(raw)){if(typeof raw.affectedRows==='number')affectedRows=raw.affectedRows;continue;}
  const row=raw.map((value,index)=>decodeCell({dataType:String(fields[index]?.columnType)} as never,value));
  const size=Buffer.byteLength(JSON.stringify(row));if(rows.length>=maxRows||bytes+size>maxBytes){truncated=true;onStop();break;}bytes+=size;rows.push(row);
 }
 return {rows,truncated,affectedRows};
}
export async function executeSingleSql(adapter:MysqlAdapter,operations:OperationStore,connectionId:string,database:string,sql:string,maxRows:number=LIMITS.defaultResultRows):Promise<SqlResult> {
 validateSql(sql);const release=adapter.connections.retain(connectionId);const started=Date.now();let operationId:string;
 try{operationId=operations.begin({type:'sql',connectionId,connectionName:adapter.connections.store.get(connectionId).name,schema:database,sql});}catch(e){release();throw e;}
 let conn:Awaited<ReturnType<MysqlAdapter['createDedicated']>>|undefined;let timer:ReturnType<typeof setTimeout>|undefined;let executed=false;
 try {
  conn=await adapter.createDedicated(connectionId,database);const core=coreConnection(conn);const fields:FieldPacket[]=[];let sets=0;
  const query=core.query({sql,rowsAsArray:true,typeCast:textTypeCast});const stream=query.stream({highWaterMark:16});
  query.on('fields',(value:FieldPacket[]|undefined)=>{sets++;if(sets>1){stream.destroy(new AppFault('MULTIPLE_RESULT_SETS','此 SQL 返回多个结果集，首版暂不支持'));core.destroy();}else if(value)fields.push(...value);});
  timer=setTimeout(()=>{stream.destroy(new AppFault('SQL_TIMEOUT','SQL 执行超过 60 秒，连接已关闭'));core.destroy();},LIMITS.queryTimeoutMs);
  executed=true;const result=await collectSqlStream(stream,()=>core.destroy(),fields,maxRows);clearTimeout(timer);
  const durationMs=Date.now()-started;operations.finish(operationId,{status:result.truncated?'needs_review':'completed',durationMs,affectedRows:result.affectedRows});
  return {operationId,columns:fields.map(f=>({name:f.name,dataType:String((mysql2.Types as unknown as Record<number,string>)[f.columnType||0]||f.columnType)})),...result,durationMs,needsReview:result.truncated,maxRows};
 }catch(error){
  const code=(error as {code?:string}).code||'';const unknown=executed&&(!code.startsWith('ER_')||/^\s*CALL\b/i.test(sql));
  const info=unknown?{code:'RESULT_UNKNOWN',message:'执行结果待核对，请检查数据与日志，勿直接重试',operationId}: {...errorInfo(error),operationId};
  try{operations.finish(operationId,{status:unknown?'needs_review':'failed',durationMs:Date.now()-started,error:info});}catch{}
  if(unknown)throw new AppFault(info.code,info.message,409,operationId);throw Object.assign(error as Error,{operationId});
 }finally{if(timer)clearTimeout(timer);conn?.destroy();release();}
}
