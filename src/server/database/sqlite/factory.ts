import {AppFault} from '../../../shared/contracts.js';
import {LIMITS} from '../../../shared/limits.js';
import type {ConnectionDraft,ConnectionProfile} from '../../features/connections/types.js';
import type {ConnectionRuntime,DbSession,DriverFactory,SessionPurpose} from '../contracts.js';
import {SqliteSession} from './client.js';
import {validateSqliteFile} from './file.js';
import {sqliteCapabilities} from './metadata.js';
function sqlite<T extends ConnectionDraft>(draft:T):Extract<T,{kind:'sqlite'}>{if(draft.kind!=='sqlite')throw new AppFault('DRIVER_KIND_MISMATCH','需要 SQLite 配置');return draft as Extract<T,{kind:'sqlite'}>;}
export class SqliteDriverFactory implements DriverFactory {
 constructor(private ownDatabasePath:string){}
 async validate(input:ConnectionDraft){const draft=sqlite(input),file=await validateSqliteFile(draft.filePath,this.ownDatabasePath);return {draft,fileIdentity:file.identity};}
 async test(input:ConnectionDraft,_password:string){const draft=sqlite(input),file=await validateSqliteFile(draft.filePath,this.ownDatabasePath);const session=new SqliteSession(true,()=>{});try{await session.open(draft.filePath,this.ownDatabasePath,file.identity);}finally{await session.close('discard');}}
 async create(input:ConnectionProfile,_password:string):Promise<ConnectionRuntime>{const profile=sqlite(input),file=await validateSqliteFile(profile.filePath,this.ownDatabasePath);if(!profile.fileIdentity||profile.fileIdentity!==file.identity)throw new AppFault('CONNECTION_CHANGED','SQLite 文件已变化，请重新保存并连接',409);const probe=new SqliteSession(true,()=>{});let version:string;try{version=(await probe.open(profile.filePath,this.ownDatabasePath,file.identity)).version;}finally{await probe.close('discard');}return new SqliteRuntime(profile,this.ownDatabasePath,file.identity,version);}
}
class SqliteRuntime implements ConnectionRuntime {
 readonly kind='sqlite' as const;readonly context;
 private clients=new Set<SqliteSession>();private used=0;private closed=false;
 private waiters:{admit:()=>void;reject:(e:unknown)=>void}[]=[];
 constructor(private profile:Extract<ConnectionProfile,{kind:'sqlite'}>,private ownPath:string,private identity:string,version:string){this.context={kind:this.kind,version,namespaceLabel:'命名空间',defaultNamespace:'main',endpoint:profile.filePath,resourceIdentity:identity,capabilities:sqliteCapabilities(!profile.readOnly)};}
 async acquire(namespace:string,_purpose:SessionPurpose,signal?:AbortSignal):Promise<DbSession>{
  if(namespace!=='main')throw new AppFault('INVALID_NAMESPACE','SQLite 仅支持 main');
  if(this.closed)throw new AppFault('SESSION_CLOSED','SQLite 连接已关闭');
  if(signal?.aborted)throw new AppFault('CANCELLED','操作已取消');
  if(this.used>=4){if(this.waiters.length>=16)throw new AppFault('CONNECTION_BUSY','等待 SQLite 连接过多',429);await new Promise<void>((resolve,reject)=>{const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);const i=this.waiters.indexOf(waiter);if(i>=0)this.waiters.splice(i,1);};const waiter={admit:()=>{cleanup();this.used++;resolve();},reject:(e:unknown)=>{cleanup();reject(e);}};const abort=()=>waiter.reject(new AppFault('CANCELLED','操作已取消'));const timer=setTimeout(()=>waiter.reject(new AppFault('CONNECTION_TIMEOUT','等待 SQLite 连接超时')),LIMITS.connectionTimeoutMs);signal?.addEventListener('abort',abort,{once:true});this.waiters.push(waiter);});}else this.used++;
  let released=false;let client:SqliteSession|undefined;const release=()=>{if(released)return;released=true;if(client)this.clients.delete(client);this.used--;if(!this.closed)this.waiters[0]?.admit();};
  try{const file=await validateSqliteFile(this.profile.filePath,this.ownPath);if(file.identity!==this.identity)throw new AppFault('CONNECTION_CHANGED','SQLite 文件已替换，请重新保存并连接',409);if(this.closed||signal?.aborted)throw new AppFault('CANCELLED','操作已取消');client=new SqliteSession(this.profile.readOnly,release,signal);this.clients.add(client);await client.open(this.profile.filePath,this.ownPath,this.identity);return client;}catch(error){if(client)await client.close('discard');release();throw error;}
 }
 async close(){if(this.closed)return;this.closed=true;for(const waiter of [...this.waiters])waiter.reject(new AppFault('SESSION_CLOSED','SQLite 连接已关闭'));await Promise.allSettled([...this.clients].map(c=>c.cancel()));}
}
