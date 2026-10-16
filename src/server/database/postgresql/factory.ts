import {Pool,type PoolClient} from 'pg';
import {randomUUID} from 'node:crypto';
import {isIP} from 'node:net';
import {AppFault} from '../../../shared/contracts.js';
import type {ConnectionDraft,ConnectionProfile} from '../../features/connections/types.js';
import type {ConnectionRuntime,DriverFactory,SessionPurpose} from '../contracts.js';
import {PostgresqlSession} from './session.js';
import {pgCapabilities} from './metadata.js';
const pg=(p:ConnectionDraft)=>{if(p.kind!=='postgresql')throw new AppFault('DRIVER_KIND_MISMATCH','需要 PostgreSQL 配置');return p;};
export function postgresqlOptions(input:ConnectionDraft,password:string){const p=pg(input);if(!p.host||p.host.includes('/')||p.host.includes('\0'))throw new AppFault('INVALID_HOST','需要 PostgreSQL 主机名或 IP');return {host:p.host,port:p.port,user:p.username,password,database:p.database,ssl:p.tls?{rejectUnauthorized:true,...(!isIP(p.host)?{servername:p.host}:{})}:false as false,connectionTimeoutMillis:10000,max:4,application_name:'db-assistant'};}
export class PostgresqlDriverFactory implements DriverFactory {
 async validate(draft:ConnectionDraft){pg(draft);postgresqlOptions(draft,'');return {draft};}
 async test(draft:ConnectionDraft,password:string){const runtime=await this.create(draft as ConnectionProfile,password);await runtime.close();}
 async create(input:ConnectionProfile,password:string):Promise<ConnectionRuntime>{const p=pg(input),pool=new Pool(postgresqlOptions(p,password));pool.on('error',()=>{});try{const result=await pool.query<{version:string}>('SHOW server_version');return new PostgresqlRuntime(pool,p,result.rows[0].version??String(Object.values(result.rows[0])[0]));}catch(error){await pool.end();throw error;}}
}
class PostgresqlRuntime implements ConnectionRuntime {
 readonly kind='postgresql' as const;readonly context;private closed=false;private sessions=new Set<PostgresqlSession>();
 constructor(private pool:Pool,private profile:Extract<ConnectionDraft,{kind:'postgresql'}>,version:string){this.context={kind:this.kind,version,namespaceLabel:'schema',defaultNamespace:profile.defaultSchema,endpoint:`${profile.host}:${profile.port}/${profile.database}`,resourceIdentity:randomUUID(),capabilities:pgCapabilities(true)};}
 async acquire(namespace:string,_purpose:SessionPurpose,signal?:AbortSignal){if(this.closed)throw new AppFault('SESSION_CLOSED','PostgreSQL 连接已关闭');if(signal?.aborted)throw new AppFault('CANCELLED','操作已取消');if(this.pool.waitingCount>=16)throw new AppFault('CONNECTION_BUSY','等待 PostgreSQL 连接过多',429);let session:PostgresqlSession|undefined,client:PoolClient|undefined;try{client=await this.pool.connect();if(this.closed||signal?.aborted){client.release(true);throw new AppFault('CANCELLED','操作已取消');}session=new PostgresqlSession(client,()=>this.sessions.delete(session!),signal);this.sessions.add(session);await session.command("SELECT set_config('search_path',quote_ident($1)||', pg_catalog',false), set_config('TimeZone','UTC',false),set_config('DateStyle','ISO, YMD',false),set_config('standard_conforming_strings','on',false),set_config('statement_timeout','60000',false),set_config('lock_timeout','10000',false),set_config('bytea_output','hex',false)",[namespace]);return session;}catch(error){if(session)await session.close('discard');throw error;}}
 async close(){if(this.closed)return;this.closed=true;await Promise.allSettled([...this.sessions].map(s=>s.close('discard')));await this.pool.end();}
}
