import mysql,{type ConnectionOptions,type Pool,type PoolConnection,type RowDataPacket} from 'mysql2/promise';
import mysqlCore,{type FieldPacket} from 'mysql2';
import {randomUUID} from 'node:crypto';
import {AppFault,type ColumnMeta} from '../../shared/contracts.js';
import type {CapabilitySet,CompiledStatement,NormalizedRow,NormalizedTableMeta,ValueKind} from '../../shared/database.js';
import {LIMITS} from '../../shared/limits.js';
import {connectionDraftSchema,type ConnectionDraft,type ConnectionProfile,type MysqlConnectionInput} from '../features/connections/types.js';
import {bindCell,decodeCell,textTypeCast} from '../mysql/values.js';
import {coreConnection} from '../features/sql/service.js';
import type {ConnectionRuntime,DbSession,DriverFactory,StatementCursor,CommandCompletion} from './contracts.js';
export function mysqlOptions(draft:MysqlConnectionInput,password:string,database?:string):ConnectionOptions{return {host:draft.host,port:draft.port,user:draft.username,password,database:database||undefined,ssl:draft.tls?{rejectUnauthorized:true,verifyIdentity:true}:undefined,connectTimeout:LIMITS.connectionTimeoutMs,multipleStatements:false,timezone:'Z',dateStrings:true,supportBigNumbers:true,bigNumberStrings:true,decimalNumbers:false,jsonStrings:true};}
export function mysqlValueKind(type:string):ValueKind{if(/^(tinyint|smallint|mediumint|int|integer|bigint|year|tiny|short|long|longlong|int24)$/i.test(type))return 'integer';if(/decimal|numeric/i.test(type))return 'decimal';if(/^(float|double|real)$/i.test(type))return 'real';if(/date|time/i.test(type))return 'temporal';if(type.toLowerCase()==='json')return 'json';if(/binary|blob|^bit$/i.test(type))return 'binary';return 'text';}
export function mysqlCapabilities():CapabilitySet {const yes=()=>({enabled:true,reasons:[]});return {browse:yes(),insert:yes(),update:yes(),delete:yes(),import:yes(),exportCsv:yes(),exportXlsx:yes(),exportSql:yes(),structureEdit:yes(),migration:yes()};}
// mysql2 text queries escape strings. Validated numeric SQL tokens avoid quotes without JS-number rounding.
export function mysqlBindParameters(command:CompiledStatement){return command.params.map(p=>{
 const value=p.column?bindCell(p.column,p.value):p.value&&typeof p.value==='object'?Buffer.from(p.value.binaryHex,'hex'):p.value;
 if(value===null)return null;
 if(p.kind==='integer'||p.kind==='decimal'||p.kind==='real'){
  const pattern=p.kind==='integer'?/^[+-]?\d+$/:p.kind==='decimal'?/^[+-]?\d+(?:\.\d+)?$/:/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;
  if(typeof value!=='string'||!pattern.test(value)||(p.kind==='real'&&!Number.isFinite(Number(value))))throw new AppFault('INVALID_VALUE','数值绑定需要有效的数值文本');
  return mysql.raw(value);
 }
 return value;
});}
function resultValueKind(field:FieldPacket,dataType:string):ValueKind{
 // BLOB-family protocol codes also describe TEXT; binary CHAR/VARCHAR use string-family codes.
 if([15,247,248,249,250,251,252,253,254].includes(field.columnType||0))return field.characterSet===63?'binary':'text';
 if(field.columnType===6)return 'null';
 return mysqlValueKind(dataType);
}
export class MysqlSession implements DbSession {
 private closed=false;private discarded=false;private cursor:StatementCursor|undefined;
 constructor(private conn:PoolConnection,private onClose:()=>void=()=>{}){}
 async openStatement(command:CompiledStatement):Promise<StatementCursor>{
  if(this.closed||this.cursor)throw new AppFault('SESSION_BUSY','会话已关闭或仍有未消费结果',409);
  const query=coreConnection(this.conn).query({sql:command.sql,values:mysqlBindParameters(command),rowsAsArray:true,typeCast:textTypeCast,timeout:LIMITS.queryTimeoutMs});
  const stream=query.stream({highWaterMark:1});const columns:StatementCursor['columns']=[];let finished=false,failed:Error|undefined;let completion:CommandCompletion={affectedRows:0,warnings:[]};let sets=0;
  const ready=new Promise<void>((resolve,reject)=>{
   query.on('fields',(fields:FieldPacket[]|undefined)=>{if(++sets>1){const e=new AppFault('MULTIPLE_RESULT_SETS','一次只支持一个结果集');stream.destroy(e);return;}for(const f of fields||[]){const dataType=String((mysqlCore.Types as unknown as Record<number,string>)[f.columnType||0]||f.columnType);columns.push({name:f.name,dataType,valueKind:resultValueKind(f,dataType)});}resolve();});
   stream.once('readable',resolve);stream.once('end',resolve);stream.once('error',reject);
  });
  stream.on('error',(error:Error)=>{failed=error;this.discarded=true;});
  const iterator=stream[Symbol.asyncIterator]();await ready;
  const cursor:StatementCursor={columns,read:async(maxRows,maxBytes)=>{if(!Number.isInteger(maxRows)||maxRows<1||!Number.isFinite(maxBytes)||maxBytes<1)throw new AppFault('INVALID_BUDGET','结果块预算必须为正数');if(failed)throw failed;const rows:NormalizedRow[]=[];let bytes=0;while(!finished&&rows.length<maxRows&&bytes<maxBytes){const next=await iterator.next();if(next.done){finished=true;this.cursor=undefined;break;}const raw=next.value;if(!Array.isArray(raw)){completion={affectedRows:Number(raw.affectedRows||0),warnings:raw.warningStatus?['MySQL 返回警告，请核对结果']:[]};continue;}const values=raw.map((v,i)=>decodeCell({dataType:columns[i]?.dataType} as ColumnMeta,v));rows.push({values,valueKinds:values.map((v,i)=>v===null?'null':typeof v==='object'?'binary':columns[i].valueKind)});bytes+=Buffer.byteLength(JSON.stringify(rows[rows.length-1]));}return {rows,done:finished,...(finished?{completion}:{})};},close:async()=>{if(!finished){finished=true;this.discarded=true;stream.destroy();this.conn.destroy();}this.cursor=undefined;}};
  this.cursor=cursor;return cursor;
 }
 async execute(command:CompiledStatement):Promise<CommandCompletion>{const cursor=await this.openStatement(command);try{for(;;){const part=await cursor.read(100,1024*1024);if(part.done)return part.completion||{affectedRows:0,warnings:[]};}}finally{await cursor.close();}}
 async begin(mode:'write'|'snapshot'|'sql'):Promise<void>{if(mode==='snapshot'){await this.conn.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ');await this.conn.query('START TRANSACTION WITH CONSISTENT SNAPSHOT');}else await this.conn.beginTransaction();}
 async lockTable(meta:NormalizedTableMeta):Promise<void>{await this.conn.query(`SELECT * FROM ${mysql.escapeId(meta.schema,true)}.${mysql.escapeId(meta.name,true)} LIMIT 0 FOR UPDATE`);}
 async commit(){await this.conn.commit();}async rollback(){await this.conn.rollback();}
 async cancel(){this.discarded=true;this.conn.destroy();}
 async close(disposition:'reuse'|'discard'){if(this.closed)return;this.closed=true;try{await this.cursor?.close();if(disposition==='discard'||this.discarded)this.conn.destroy();else this.conn.release();}finally{this.onClose();}}
}
export interface MysqlRuntime extends ConnectionRuntime {kind:'mysql';pool:Pool}
export class MysqlDriverFactory implements DriverFactory {
 private versions=new Map<string,string>();
 async validate(draft:ConnectionDraft){const parsed=connectionDraftSchema.parse(draft);if(parsed.kind!=='mysql')throw new AppFault('DATABASE_KIND_UNSUPPORTED','需要 MySQL 连接');return {draft:parsed};}
 async test(profile:ConnectionDraft,password:string){if(profile.kind!=='mysql')throw new AppFault('DATABASE_KIND_UNSUPPORTED','需要 MySQL 连接');const conn=await mysql.createConnection(mysqlOptions(profile,password));try{await conn.ping();const [rows]=await conn.query<RowDataPacket[]>('SELECT VERSION() AS version');this.versions.set(JSON.stringify(profile),String(rows[0].version));}finally{conn.destroy();}}
 async create(profile:ConnectionProfile,password:string):Promise<MysqlRuntime>{if(profile.kind!=='mysql')throw new AppFault('DATABASE_KIND_UNSUPPORTED','需要 MySQL 连接');const pool=mysql.createPool({...mysqlOptions(profile,password),connectionLimit:4,waitForConnections:true,queueLimit:16});let closed=false;const live=new Set<MysqlSession>();return {kind:'mysql',pool,context:{kind:'mysql',version:this.versions.get(JSON.stringify(connectionDraftSchema.parse(profile)))||'',namespaceLabel:'database',defaultNamespace:profile.defaultDatabase||'',endpoint:`${profile.host}:${profile.port}`,resourceIdentity:randomUUID(),capabilities:mysqlCapabilities()},acquire:async(namespace,_purpose,signal)=>{if(closed||signal?.aborted)throw new AppFault('CANCELLED','连接已关闭');const conn=await pool.getConnection();if(closed||signal?.aborted){conn.destroy();throw new AppFault('CANCELLED','连接已关闭');}try{await conn.query("SET time_zone = '+00:00', SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION'");if(namespace)await conn.query(`USE ${mysql.escapeId(namespace,true)}`);if(closed||signal?.aborted)throw new AppFault('CANCELLED','连接已关闭');let session:MysqlSession;const abort=()=>{void session.cancel();};session=new MysqlSession(conn,()=>{live.delete(session);signal?.removeEventListener('abort',abort);});live.add(session);signal?.addEventListener('abort',abort,{once:true});return session;}catch(error){conn.destroy();throw error;}},close:async()=>{if(closed)return;closed=true;await Promise.allSettled([...live].map(s=>s.close('discard')));await pool.end();}};}
}
