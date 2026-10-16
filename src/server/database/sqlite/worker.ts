import {parentPort} from 'node:worker_threads';
import {DatabaseSync,type StatementSync} from 'node:sqlite';
import {randomUUID} from 'node:crypto';
import {AppFault,errorInfo} from '../../../shared/contracts.js';
import {LIMITS} from '../../../shared/limits.js';
import {lexSql} from '../statements.js';
import {validateSqliteFile} from './file.js';
import {normalizeSqliteRow,sqliteAffinity,sqliteBind} from './values.js';
import type {Chunk,WorkerRequest,WorkerResponse} from './protocol.js';
import type {NormalizedRow} from '../../../shared/database.js';
let db:DatabaseSync|undefined,sessionId:string|undefined;
let cursor:{id:string;iterator:Iterator<unknown[]>;pending?:NormalizedRow;before:bigint}|undefined;
function database(){if(!db)throw new AppFault('SESSION_CLOSED','SQLite 会话已关闭');return db;}
function changeCounts(){const statement=database().prepare('SELECT total_changes() AS total, changes() AS direct');statement.setReadBigInts(true);return statement.get() as {total:bigint;direct:bigint};}
function completedChanges(before:bigint){const counts=changeCounts();return counts.total===before?0:Number(counts.direct);}
function prepare(sql:string):StatementSync {if(Buffer.byteLength(sql)>LIMITS.sqlBytes)throw new AppFault('SQL_TOO_LARGE','SQL 超过 256 KiB');const {mask}=lexSql('sqlite',sql);const visible=sql.split('').map((c,i)=>mask[i]?c:' ').join('');if(/\b(?:ATTACH|DETACH|load_extension)\b/i.test(visible))throw new AppFault('SQL_UNSUPPORTED','SQLite 不支持 ATTACH、DETACH 或扩展');const statement=database().prepare(sql);statement.setReadBigInts(true);statement.setReturnArrays(true);return statement;}
async function handle(r:WorkerRequest):Promise<unknown>{
 if(r.op==='open'){if(db)throw new AppFault('SESSION_BUSY','SQLite 已打开');const file=await validateSqliteFile(r.filePath,r.ownDatabasePath);if(file.identity!==r.identity)throw new AppFault('CONNECTION_CHANGED','SQLite 文件已替换，请重新保存并连接',409);db=new DatabaseSync(file.realPath,{readOnly:r.readOnly,allowExtension:false});try{const after=await validateSqliteFile(r.filePath,r.ownDatabasePath);if(after.identity!==r.identity)throw new AppFault('CONNECTION_CHANGED','SQLite 文件已变化',409);db.exec('PRAGMA foreign_keys=ON; PRAGMA busy_timeout=5000;');sessionId=r.sessionId;return {version:String(db.prepare('SELECT sqlite_version() AS version').get()!.version)};}catch(e){db.close();db=undefined;throw e;}}
 if(sessionId!==r.sessionId)throw new AppFault('SESSION_CLOSED','SQLite 会话标识不匹配');
 if(r.op==='close'){if(r.cursorId){if(cursor?.id===r.cursorId){cursor.iterator.return?.();cursor=undefined;}return null;}cursor?.iterator.return?.();cursor=undefined;if(db){if(db.isTransaction)db.exec('ROLLBACK');db.close();db=undefined;}return null;}
 if(r.op==='fetch'){if(!cursor||cursor.id!==r.cursorId)throw new AppFault('CURSOR_CLOSED','结果游标已关闭');if(!Number.isInteger(r.maxRows)||r.maxRows<1||!Number.isFinite(r.maxBytes)||r.maxBytes<1)throw new AppFault('INVALID_BUDGET','结果块预算必须为正数');const result:Chunk={rows:[],done:false};let bytes=2;while(result.rows.length<Math.min(r.maxRows,100)){let row=cursor.pending;cursor.pending=undefined;if(!row){const next=cursor.iterator.next();if(next.done){result.done=true;result.completion={affectedRows:completedChanges(cursor.before),warnings:[]};cursor=undefined;break;}row=normalizeSqliteRow(next.value);}const size=Buffer.byteLength(JSON.stringify(row));if(size+2>r.maxBytes){result.omittedRows=1;break;}if(bytes+size+(result.rows.length?1:0)>r.maxBytes){cursor.pending=row;break;}bytes+=size+(result.rows.length?1:0);result.rows.push(row);}return result;}
 if(cursor)throw new AppFault('SESSION_BUSY','请先关闭当前结果游标',409);
 if(r.op==='begin'){database().exec(r.mode==='write'?'BEGIN IMMEDIATE':'BEGIN');return null;}
 if(r.op==='commit'||r.op==='rollback'){database().exec(r.op.toUpperCase());return null;}
 const statement=prepare(r.command.sql),params=sqliteBind(r.command.params);
 if(r.op==='execute'){const result=statement.run(...params);return {affectedRows:Number(result.changes),warnings:[]};}
 const columns=statement.columns().map(c=>({name:c.name,dataType:c.type||'',valueKind:sqliteAffinity(c.type||'')}));const before=changeCounts().total;const iterator=statement.iterate(...params) as unknown as Iterator<unknown[]>;cursor={id:randomUUID(),iterator,before};return {cursorId:cursor.id,columns};
}
// The queue also serializes asynchronous file validation before subsequent operations.
let queue=Promise.resolve();parentPort!.on('message',(r:WorkerRequest)=>{queue=queue.then(async()=>{let response:WorkerResponse;try{response={requestId:r.requestId,sessionId:r.sessionId,type:'result',value:await handle(r)};}catch(e){const info=errorInfo(e);response={requestId:r.requestId,sessionId:r.sessionId,type:'error',error:{code:e instanceof AppFault?e.code:'SQLITE_ERROR',message:e instanceof AppFault?e.message:'SQLite 操作失败',databaseKind:'sqlite',driverCode:info.code}};}parentPort!.postMessage(response);});});
