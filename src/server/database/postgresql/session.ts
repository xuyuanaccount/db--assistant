import Cursor from 'pg-cursor';
import type {PoolClient,QueryResult} from 'pg';
import {AppFault} from '../../../shared/contracts.js';
import type {CompiledStatement,NormalizedRow,NormalizedTableMeta,ResultColumn} from '../../../shared/database.js';
import type {DbSession,StatementCursor} from '../contracts.js';
import {pgBind,pgRow,pgTextTypes,pgValueKind,pgTypeName} from './values.js';
import {postgresqlDialect} from './dialect.js';
export class PostgresqlSession implements DbSession {
 private closed=false;private timer:ReturnType<typeof setTimeout>;private abort:()=>void;
 constructor(private client:PoolClient,private release:()=>void,private signal?:AbortSignal){this.abort=()=>{void this.cancel();};this.timer=setTimeout(this.abort,60000);signal?.addEventListener('abort',this.abort,{once:true});if(signal?.aborted)this.abort();client.on('error',this.abort);}
 private check(){if(this.closed)throw new AppFault('SESSION_CLOSED','PostgreSQL 执行单元已关闭');}
 async command(sql:string,values:unknown[]=[]){this.check();return this.client.query({text:sql,values,types:pgTextTypes});}
 async openStatement(command:CompiledStatement):Promise<StatementCursor>{
  this.check();const cursor=this.client.query(new Cursor<unknown[]>(command.sql,pgBind(command.params),{rowMode:'array',types:pgTextTypes}));let totalRead=0;let ended=false,completion={affectedRows:0,warnings:[] as string[]},closed=false,result:QueryResult|undefined;
  cursor.on('end',(r:QueryResult)=>{ended=true;completion={affectedRows:['INSERT','UPDATE','DELETE','MERGE'].includes(r.command)?r.rowCount??0:0,warnings:[]};});
  const read=()=>new Promise<unknown[][]>((resolve,reject)=>cursor.read(100,(error,rows,r)=>{if(error)reject(error);else{if(r)result=r;totalRead+=rows.length;resolve(rows);}}));
  let pending=await read();const fields=result?.fields??[];const columns:ResultColumn[]=fields.map(f=>({name:f.name,dataType:pgTypeName(f.dataTypeID),valueKind:pgValueKind(f.dataTypeID)}));
  return {columns,read:async(maxRows,maxBytes)=>{this.check();if(closed)throw new AppFault('CURSOR_CLOSED','结果已关闭');const rows:NormalizedRow[]=[];let bytes=0,omittedRows=0;while(rows.length<maxRows){if(!pending.length){if(ended)break;pending=await read();if(!pending.length&&ended)break;continue;}const row=pgRow(pending[0],fields.map(f=>f.dataTypeID)),size=Buffer.byteLength(JSON.stringify(row));if(size>maxBytes){pending.shift();omittedRows++;continue;}if(rows.length&&bytes+size>maxBytes)break;pending.shift();bytes+=size;rows.push(row);}return {rows,done:ended&&!pending.length,omittedRows,completion:ended&&!pending.length?{...completion,affectedRows:fields.length&&result&&['INSERT','UPDATE','DELETE','MERGE'].includes(result.command)?totalRead:completion.affectedRows}:undefined};},close:async()=>{if(closed)return;closed=true;if(!this.closed)await cursor.close();}};
 }
 async execute(command:CompiledStatement){const c=await this.openStatement(command);try{for(;;){const part=await c.read(100,1024*1024);if(part.done)return part.completion??{affectedRows:0,warnings:[]};}}finally{await c.close();}}
 async begin(mode:'write'|'snapshot'|'sql'){await this.command(mode==='snapshot'?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN');}
 async lockTable(meta:NormalizedTableMeta){await this.command(`LOCK TABLE ${postgresqlDialect.qualifiedTable({connectionId:'',schema:meta.schema,table:meta.name})} IN ROW EXCLUSIVE MODE`);}
 async commit(){await this.command('COMMIT');}async rollback(){await this.command('ROLLBACK');}
 async cancel(){await this.close('discard');}
 async close(_disposition:'reuse'|'discard'){if(this.closed)return;this.closed=true;clearTimeout(this.timer);this.signal?.removeEventListener('abort',this.abort);this.client.removeListener('error',this.abort);this.client.release(true);this.release();}
}
