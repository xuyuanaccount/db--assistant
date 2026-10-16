import {spawn,type ChildProcess} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {AppFault} from '../../../shared/contracts.js';
import {LIMITS} from '../../../shared/limits.js';
import type {CompiledStatement,NormalizedTableMeta} from '../../../shared/database.js';
import type {CommandCompletion,DbSession,StatementCursor} from '../contracts.js';
import type {Chunk,Prepared,WorkerOperation,WorkerResponse} from './protocol.js';
import {readSqliteMetadata,sqliteRows} from './metadata.js';

/** Each lease owns one process containing one Worker; all SQL state is discarded on close. */
export class SqliteSession implements DbSession {
 private host:ChildProcess;
 private exited:Promise<void>;
 private sessionId=randomUUID();
 private pending=new Map<string,{resolve:(value:unknown)=>void;reject:(error:unknown)=>void;commit:boolean}>();
 private stopped=false;
 private termination?:Promise<void>;
 private timer?:ReturnType<typeof setTimeout>;
 private executionStarted=false;
 private transaction:'write'|'snapshot'|'sql'|false=false;
 private closing?:Promise<void>;
 private abort:()=>void;
 constructor(private readOnly:boolean,private release:()=>void,private signal?:AbortSignal){
  const source=import.meta.url.endsWith('.ts');
  const entry=new URL(source?'./worker.ts':'./worker.js',import.meta.url);
  // SQLite's synchronous native calls cannot be interrupted by Worker.terminate().
  // A disposable process contains the Worker and provides the hard-stop boundary.
  const workerCode=source?`import(${JSON.stringify(import.meta.resolve('tsx/esm/api'))}).then(({register})=>{register();return import(${JSON.stringify(entry.href)})})`:undefined;
  const bootstrap=`
   import {Worker} from 'node:worker_threads';
   const worker=new Worker(${source?JSON.stringify(workerCode):`new URL(${JSON.stringify(entry.href)})`},{execArgv:[],eval:${source}});
   const stop=()=>process.kill(process.pid,'SIGKILL');
   process.on('disconnect',stop);
   process.on('message',message=>{try{worker.postMessage(message)}catch{stop()}});
   worker.on('message',message=>{if(!process.connected)return stop();process.send(message,error=>{if(error)stop()})});
   worker.on('error',stop);worker.on('exit',stop);
  `;
  this.host=spawn(process.execPath,['--input-type=module','--eval',bootstrap],{stdio:['ignore','ignore','ignore','ipc'],serialization:'advanced'});
  this.exited=new Promise(resolve=>{this.host.once('exit',()=>resolve());this.host.once('error',()=>{if(!this.host.pid)resolve();});});
  this.host.on('message',(response:WorkerResponse)=>{if(!response||response.sessionId!==this.sessionId)return;const request=this.pending.get(response.requestId);if(!request)return;if(response.type!=='result'&&response.type!=='error')return;this.pending.delete(response.requestId);if(response.type==='result')request.resolve(response.value);else {const fault=Object.assign(new AppFault(response.error.code,response.error.message),response.error);request.reject(request.commit?this.unknown():fault);}});
  const failed=()=>{void this.stop(new AppFault('WORKER_EXITED','SQLite 执行单元异常退出'));};
  this.host.on('error',failed);this.host.on('exit',failed);this.host.on('disconnect',failed);
  this.abort=()=>{void this.stop(new AppFault('CANCELLED','操作已取消'));};signal?.addEventListener('abort',this.abort,{once:true});if(signal?.aborted)this.abort();
 }
 private unknown(){return new AppFault('RESULT_UNKNOWN','SQLite 提交已发送但未确认，请核对结果',409);}
 private startDeadline(){if(this.executionStarted)return;this.executionStarted=true;if(this.timer)clearTimeout(this.timer);this.timer=setTimeout(()=>{void this.stop(new AppFault('QUERY_TIMEOUT','SQLite 执行超过 60 秒',408));},LIMITS.queryTimeoutMs);}
 private request<T>(operation:WorkerOperation):Promise<T>{
  if(this.stopped)return Promise.reject(new AppFault('SESSION_CLOSED','SQLite 会话已关闭'));
  if(operation.op!=='open')this.startDeadline();
  const requestId=randomUUID();return new Promise<T>((resolve,reject)=>{this.pending.set(requestId,{resolve:resolve as (v:unknown)=>void,reject,commit:operation.op==='commit'});try{this.host.send({...operation,requestId,sessionId:this.sessionId},error=>{if(error)void this.stop(new AppFault('WORKER_EXITED','SQLite 执行单元通信失败'));});}catch(error){this.pending.delete(requestId);reject(error);}});
 }
 async open(filePath:string,ownDatabasePath:string,identity:string){this.timer=setTimeout(()=>{void this.stop(new AppFault('CONNECTION_TIMEOUT','SQLite 打开超过 10 秒'));},LIMITS.connectionTimeoutMs);try{return await this.request<{version:string}>({op:'open',filePath,ownDatabasePath,identity,readOnly:this.readOnly});}finally{if(this.timer)clearTimeout(this.timer);this.timer=undefined;}}
 async openStatement(command:CompiledStatement):Promise<StatementCursor>{const prepared=await this.request<Prepared>({op:'prepare',command});let closed=false;return {columns:prepared.columns,read:(maxRows,maxBytes)=>{if(closed)return Promise.reject(new AppFault('CURSOR_CLOSED','结果游标已关闭'));return this.request<Chunk>({op:'fetch',cursorId:prepared.cursorId,maxRows,maxBytes});},close:async()=>{if(closed||this.stopped)return;closed=true;await this.request({op:'close',cursorId:prepared.cursorId});}};}
 execute(command:CompiledStatement){return this.request<CommandCompletion>({op:'execute',command});}
 async begin(mode:'write'|'snapshot'|'sql'){await this.request({op:'begin',mode});this.transaction=mode;}
 async lockTable(meta:NormalizedTableMeta){if(this.transaction!=='write')throw new AppFault('TRANSACTION_REQUIRED','需要先开启写事务');await sqliteRows(this,'PRAGMA main.schema_version');const current=await readSqliteMetadata(this,{connectionId:'',schema:meta.schema,table:meta.name},this.readOnly);if(current.meta.definitionFingerprint!==meta.definitionFingerprint)throw new AppFault('TABLE_CHANGED','表定义已变化，请重新预览',409);}
 async commit(){await this.request({op:'commit'});this.transaction=false;}
 async rollback(){await this.request({op:'rollback'});this.transaction=false;}
 async cancel(){await this.stop(new AppFault('CANCELLED','操作已取消'));}
 private stop(error:AppFault):Promise<void>{
  if(this.termination)return this.termination;
  this.stopped=true;error.databaseKind='sqlite';
  if(this.timer)clearTimeout(this.timer);
  this.signal?.removeEventListener('abort',this.abort);
  for(const pending of this.pending.values())pending.reject(pending.commit?Object.assign(this.unknown(),{databaseKind:'sqlite'}):error);
  this.pending.clear();
  this.termination=this.exited.then(()=>this.release());
  if(this.host.pid&&this.host.exitCode===null&&this.host.signalCode===null)this.host.kill('SIGKILL');
  return this.termination;
 }
 close(_disposition:'reuse'|'discard'):Promise<void>{return this.closing??=this.finishClose();}
 private async finishClose(){try{if(!this.stopped)await this.request({op:'close'});}finally{await this.stop(new AppFault('SESSION_CLOSED','SQLite 会话已关闭'));}}
}
