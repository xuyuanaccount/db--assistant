import type {TableTarget} from '../../../shared/contracts.js';
import type {ConnectionService} from '../../features/connections/service.js';
import type {DatabaseAdapter,DbSession,SessionPurpose} from '../contracts.js';
import {sqliteDialect} from './dialect.js';
import {assertSqliteNamespace,readSqliteMetadata,sqliteRows} from './metadata.js';
export class SqliteDatabaseAdapter implements DatabaseAdapter {
 readonly kind='sqlite' as const;readonly dialect=sqliteDialect;
 constructor(private connections:ConnectionService){}
 openSession(id:string,namespace:string,purpose:SessionPurpose,signal?:AbortSignal){return this.connections.openSession(id,namespace,purpose,signal);}
 private readOnly(id:string){const profile=this.connections.store.get(id);return profile.kind==='sqlite'&&profile.readOnly;}
 private async metadata<T>(id:string,namespace:string,run:(session:DbSession)=>Promise<T>){assertSqliteNamespace(namespace);const session=await this.openSession(id,namespace,'metadata');try{await session.begin('snapshot');const result=await run(session);await session.commit();return result;}finally{await session.close('reuse');}}
 async listNamespaces(id:string){return this.metadata(id,'main',async()=>['main']);}
 listTables(id:string,namespace:string){return this.metadata(id,namespace,async session=>(await sqliteRows(session,"SELECT name,type FROM main.sqlite_schema WHERE type IN ('table','view') AND substr(name,1,7) <> 'sqlite_' ORDER BY name")).map(r=>({name:String(r.name),kind:r.type==='view'?'view' as const:'table' as const})));}
 describeTable(target:TableTarget,session?:DbSession){const run=async(s:DbSession)=>(await readSqliteMetadata(s,target,this.readOnly(target.connectionId))).meta;return session?run(session):this.metadata(target.connectionId,target.schema,run);}
 describeStructure(target:TableTarget){return this.metadata(target.connectionId,target.schema,async s=>(await readSqliteMetadata(s,target,this.readOnly(target.connectionId))).structure);}
 loadCompletions(id:string,namespace:string){return this.metadata(id,namespace,async session=>{const names=await sqliteRows(session,"SELECT name FROM main.sqlite_schema WHERE type IN ('table','view') AND substr(name,1,7) <> 'sqlite_' ORDER BY name");const tables:{name:string;columns:string[]}[]=[];let count=0,truncated=false;for(const row of names){const name=String(row.name),remaining=5000-count,columns=await sqliteRows(session,"SELECT name FROM pragma_table_xinfo(?, 'main') WHERE hidden<>1 ORDER BY cid LIMIT ?",[{value:name,kind:'text'},{value:String(remaining+1),kind:'integer'}]);if(columns.length>remaining){tables.push({name,columns:columns.slice(0,remaining).map(c=>String(c.name))});truncated=true;break;}tables.push({name,columns:columns.map(c=>String(c.name))});count+=columns.length;}return {tables,truncated};});}
}
