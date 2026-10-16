import type {Pool} from 'mysql2/promise';
import {AppFault,errorInfo} from '../../../shared/contracts.js';
import type {DatabaseContext,DatabaseKind} from '../../../shared/database.js';
import {LIMITS} from '../../../shared/limits.js';
import type {OperationStore} from '../../local/operations.js';
import type {ConnectionRuntime,DbSession,DriverFactory,SessionPurpose} from '../../database/contracts.js';
import {MysqlDriverFactory,type MysqlRuntime} from '../../database/mysql-factory.js';
import {ConnectionStore} from './store.js';
import {connectionDraftSchema,type ConnectionInput,type ConnectionProfile,type MysqlConnectionInput} from './types.js';
export {mysqlOptions} from '../../database/mysql-factory.js';
export function assertMysqlProfile(profile:{kind?:DatabaseKind}):void {if(profile.kind&&profile.kind!=='mysql')throw new AppFault('DATABASE_KIND_UNSUPPORTED','此操作仅支持 MySQL',400);}
function driverFailure(error:unknown,kind:DatabaseKind):AppFault {if(error instanceof AppFault)return error;const failure=new AppFault('CONNECTION_FAILED','数据库操作失败，请检查配置与服务状态',400);failure.databaseKind=kind;const code=(error as {code?:unknown})?.code;if(typeof code==='string'&&/^[A-Z0-9_]{1,64}$/.test(code))failure.driverCode=code;return failure;}
interface Capacity {used:number;waiters:(()=>void)[]}
export class ConnectionService {
 private sessions=new Map<string,{password:string;runtime:ConnectionRuntime}>();
 private factories=new Map<DatabaseKind,DriverFactory>();
 private active=new Map<string,number>();private exclusive=new Set<string>();private revisions=new Map<string,number>();
 private capacities=new Map<string,Capacity>();private closing=false;private shutdown=new AbortController();
 constructor(readonly store:ConnectionStore,private operations:OperationStore,factories:Partial<Record<DatabaseKind,DriverFactory>>={}){this.registerFactory('mysql',new MysqlDriverFactory());for(const [kind,factory] of Object.entries(factories))if(factory)this.registerFactory(kind as DatabaseKind,factory);}
 registerFactory(kind:DatabaseKind,factory:DriverFactory):void {this.factories.set(kind,factory);}
 private factory(kind:DatabaseKind):DriverFactory {const f=this.factories.get(kind);if(!f)throw new AppFault('DRIVER_UNAVAILABLE','此数据库驱动尚未安装或注册',409);return f;}
 private open(){if(this.closing)throw new AppFault('SERVICE_CLOSING','服务正在关闭',503);}
 list(){return this.store.list().map(profile=>({...profile,connected:this.sessions.has(profile.id),generation:this.generation(profile.id)}));}
 create(input:MysqlConnectionInput):Extract<ConnectionProfile,{kind:'mysql'}> {this.open();const draft=connectionDraftSchema.parse(input);assertMysqlProfile(draft);return this.store.save(draft) as Extract<ConnectionProfile,{kind:'mysql'}>;}
 private changed():AppFault{return new AppFault('CONNECTION_CHANGED','连接配置在操作期间已变化，请重试',409);}
 private checkRevision(id:string,revision:number):void{if(this.closing||revision!==this.revisions.get(id))throw this.changed();}
 // Reserve before any await: every mutation owns its original token, even while an old runtime closes.
 private beginMutation(id:string):{revision:number;closing:Promise<void>}{
  this.open();this.store.get(id);
  if(this.active.get(id))throw new AppFault('CONNECTION_BUSY','此连接有操作正在执行，请等待完成或取消任务',409);
  const revision=(this.revisions.get(id)||0)+1;this.revisions.set(id,revision);
  const session=this.sessions.get(id);this.sessions.delete(id);
  return {revision,closing:session?session.runtime.close():Promise.resolve()};
 }
 async saveProfile(input:ConnectionInput,id?:string):Promise<ConnectionProfile>{
  this.open();const draft=connectionDraftSchema.parse(input);const mutation=id?this.beginMutation(id):undefined;
  if(mutation){await mutation.closing;this.checkRevision(id!,mutation.revision);}
  const validated=await this.factory(draft.kind).validate(draft).catch(error=>{if(mutation)this.checkRevision(id!,mutation.revision);throw driverFailure(error,draft.kind);});
  if(mutation)this.checkRevision(id!,mutation.revision);else this.open();
  const checked=connectionDraftSchema.parse(validated.draft);if(checked.kind!==draft.kind)throw new AppFault('DRIVER_KIND_MISMATCH','驱动返回了错误的连接类型',500);
  return this.store.save(checked,id,validated.fileIdentity);
 }
 async update(id:string,input:ConnectionInput):Promise<ConnectionProfile>{return this.saveProfile(input,id);}
 async remove(id:string){const mutation=this.beginMutation(id);await mutation.closing;this.checkRevision(id,mutation.revision);this.store.remove(id);}
 async test(input:ConnectionInput,password:string):Promise<void>{this.open();const draft=connectionDraftSchema.parse(input);const started=Date.now(),operationId=this.operations.begin({type:'connection_test',connectionName:draft.name});try{const factory=this.factory(draft.kind);const validated=await factory.validate(draft);await factory.test(validated.draft,password);this.open();this.operations.finish(operationId,{status:'completed',durationMs:Date.now()-started});}catch(error){if(this.closing)throw new AppFault('SERVICE_CLOSING','服务正在关闭',503);const failure=new AppFault(error instanceof AppFault?error.code:'CONNECTION_FAILED','数据库连接测试失败，请检查配置与服务状态',400);failure.databaseKind=draft.kind;const code=(error as {code?:unknown})?.code;if(typeof code==='string'&&/^[A-Z0-9_]{1,64}$/.test(code))failure.driverCode=code;this.operations.finish(operationId,{status:'failed',durationMs:Date.now()-started,error:errorInfo(failure)});throw failure;}}
 async connect(id:string,password:string):Promise<void>{
  this.open();const profile=this.store.get(id);const mutation=this.beginMutation(id);
  await mutation.closing;this.checkRevision(id,mutation.revision);
  const unchanged=()=>!this.closing&&mutation.revision===this.revisions.get(id)&&JSON.stringify(this.store.get(id))===JSON.stringify(profile);
  try{await this.test(profile,password);}catch(error){if(!unchanged())throw this.changed();throw error;}
  if(!unchanged())throw this.changed();
  const runtime=await this.factory(profile.kind).create(profile,password).catch(error=>{if(!unchanged())throw this.changed();throw driverFailure(error,profile.kind);});
  let valid=false;try{valid=unchanged()&&runtime.kind===profile.kind;}catch{}
  if(!valid){await runtime.close();throw this.changed();}
  this.sessions.set(id,{password,runtime});
 }
 async disconnect(id:string):Promise<void>{const mutation=this.beginMutation(id);await mutation.closing;}
 runtime(id:string):ConnectionRuntime {this.open();this.store.get(id);const session=this.sessions.get(id);if(!session)throw new AppFault('NOT_CONNECTED','请先连接数据库',409);return session.runtime;}
 session(id:string):{password:string;pool:Pool}{assertMysqlProfile(this.store.get(id));const runtime=this.runtime(id) as MysqlRuntime;return {password:this.sessions.get(id)!.password,pool:runtime.pool};}
 context(id:string):DatabaseContext{return {...this.runtime(id).context,generation:this.generation(id)};}
 generation(id:string):number{this.store.get(id);return this.revisions.get(id)||0;}
 retain(id:string):()=>void{this.runtime(id);if(this.exclusive.has(id))throw new AppFault('CONNECTION_BUSY','此连接正在执行结构变更',409);this.active.set(id,(this.active.get(id)||0)+1);let released=false;return()=>{if(released)return;released=true;this.active.set(id,Math.max(0,(this.active.get(id)||1)-1));};}
 retainExclusive(id:string):()=>void{this.runtime(id);if(this.active.get(id)||this.exclusive.has(id))throw new AppFault('CONNECTION_BUSY','此连接有操作正在执行，请等待完成后重试',409);this.exclusive.add(id);this.active.set(id,1);let released=false;return()=>{if(released)return;released=true;this.exclusive.delete(id);this.active.delete(id);};}
 async openSession(id:string,namespace:string,purpose:SessionPurpose,signal?:AbortSignal):Promise<DbSession>{
  const release=this.retain(id),runtime=this.runtime(id);let capacity=this.capacities.get(id);if(!capacity){capacity={used:0,waiters:[]};this.capacities.set(id,capacity);}const cap=capacity;
  let acquired=false,finished=false,waiting:(()=>void)|undefined,timer:ReturnType<typeof setTimeout>|undefined;
  const controller=new AbortController();const abort=()=>controller.abort();signal?.addEventListener('abort',abort,{once:true});this.shutdown.signal.addEventListener('abort',abort,{once:true});if(signal?.aborted||this.shutdown.signal.aborted)abort();
  const cleanup=()=>{if(finished)return;finished=true;if(timer)clearTimeout(timer);signal?.removeEventListener('abort',abort);this.shutdown.signal.removeEventListener('abort',abort);if(waiting){const i=cap.waiters.indexOf(waiting);if(i>=0)cap.waiters.splice(i,1);}if(acquired){cap.used--;cap.waiters.shift()?.();}release();};
  let expired=false;
  const deadline=new Promise<never>((_,reject)=>{timer=setTimeout(()=>{expired=true;controller.abort();reject(new AppFault('CONNECTION_TIMEOUT','获取数据库连接超过 10 秒',409));},LIMITS.connectionTimeoutMs);const cancelled=()=>reject(new AppFault(expired?'CONNECTION_TIMEOUT':'CANCELLED',expired?'获取数据库连接超过 10 秒':'操作已取消',409));controller.signal.addEventListener('abort',cancelled,{once:true});if(controller.signal.aborted)cancelled();});
  try{
   const slot=cap.used<4?(cap.used++,acquired=true,Promise.resolve()):cap.waiters.length>=16?Promise.reject(new AppFault('CONNECTION_BUSY','等待连接的操作过多',429)):new Promise<void>(resolve=>{waiting=()=>{waiting=undefined;acquired=true;cap.used++;resolve();};cap.waiters.push(waiting);});
   await Promise.race([slot,deadline]);if(controller.signal.aborted)throw new AppFault('CANCELLED','操作已取消',409);
   const creating=runtime.acquire(namespace,purpose,controller.signal);void creating.then(session=>{if(finished||controller.signal.aborted)void session.close('discard').catch(()=>{});},()=>{});
   const session=await Promise.race([creating,deadline]);if(timer)clearTimeout(timer);
   let closed=false;return new Proxy(session,{get(target,key){if(key==='close')return async(disposition:'reuse'|'discard')=>{if(closed)return;closed=true;try{await target.close(disposition);}finally{cleanup();}};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});
  }catch(error){cleanup();throw driverFailure(error,runtime.kind);}
 }
 async close():Promise<void>{this.closing=true;this.shutdown.abort();for(const id of this.revisions.keys())this.revisions.set(id,(this.revisions.get(id)||0)+1);const sessions=[...this.sessions.values()];this.sessions.clear();await Promise.allSettled(sessions.map(s=>s.runtime.close()));}
}
