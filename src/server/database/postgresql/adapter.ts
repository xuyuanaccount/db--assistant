import type {TableTarget} from '../../../shared/contracts.js';
import type {ConnectionService} from '../../features/connections/service.js';
import type {DatabaseAdapter,DbSession,SessionPurpose} from '../contracts.js';
import {postgresqlDialect} from './dialect.js';
import {readPostgresqlMetadata} from './metadata.js';
import {databaseRows as rows} from '../rows.js';
export class PostgresqlDatabaseAdapter implements DatabaseAdapter {
 readonly kind='postgresql' as const;readonly dialect=postgresqlDialect;
 constructor(private connections:ConnectionService){}
 openSession(id:string,namespace:string,purpose:SessionPurpose,signal?:AbortSignal){return this.connections.openSession(id,namespace,purpose,signal);}
 private async metadata<T>(id:string,namespace:string,run:(session:DbSession)=>Promise<T>){const s=await this.openSession(id,namespace,'metadata');try{await s.begin('snapshot');const result=await run(s);await s.commit();return result;}finally{await s.close('discard');}}
 listNamespaces(id:string){return this.metadata(id,this.connections.context(id).defaultNamespace,async s=>(await rows(s,"SELECT nspname FROM pg_namespace WHERE nspname NOT LIKE 'pg_%' AND nspname <> 'information_schema' AND has_schema_privilege(oid,'USAGE') ORDER BY nspname")).map(r=>String(r.nspname)));}
 listTables(id:string,namespace:string){return this.metadata(id,namespace,async s=>(await rows(s,"SELECT c.relname,c.relkind FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname=$1 AND c.relkind IN ('r','p','v','m','f') AND has_schema_privilege(n.oid,'USAGE') AND has_table_privilege(c.oid,'SELECT') ORDER BY c.relname",[{value:namespace,kind:'text'}])).map(r=>({name:String(r.relname),kind:['v','m'].includes(String(r.relkind))?'view' as const:'table' as const})));}
 describeTable(target:TableTarget,session?:DbSession){const run=async(s:DbSession)=>(await readPostgresqlMetadata(s,target)).meta;return session?run(session):this.metadata(target.connectionId,target.schema,run);}
 describeStructure(target:TableTarget){return this.metadata(target.connectionId,target.schema,async s=>(await readPostgresqlMetadata(s,target)).structure);}
 loadCompletions(id:string,namespace:string){return this.metadata(id,namespace,async s=>{const fields=await rows(s,"SELECT c.relname,a.attname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace JOIN pg_attribute a ON a.attrelid=c.oid WHERE n.nspname=$1 AND c.relkind IN ('r','p','v','m','f') AND a.attnum>0 AND NOT a.attisdropped AND has_schema_privilege(n.oid,'USAGE') AND has_table_privilege(c.oid,'SELECT') ORDER BY c.relname,a.attnum LIMIT 5001",[{value:namespace,kind:'text'}]);const tables=new Map<string,string[]>();for(const r of fields.slice(0,5000)){const name=String(r.relname);if(!tables.has(name))tables.set(name,[]);tables.get(name)!.push(String(r.attname));}return {tables:[...tables].map(([name,columns])=>({name,columns})),truncated:fields.length>5000};});}
}
