import type {ConnectionDraft,ConnectionProfileInput} from '../../../server/features/connections/types';
import type {DatabaseKind} from '../../../shared/database';
export const supportedDatabaseKinds:DatabaseKind[]=['mysql','postgresql','sqlite'];
export const databaseLabels:Record<DatabaseKind,string>={mysql:'MySQL',postgresql:'PostgreSQL',oracle:'Oracle',sqlite:'SQLite'};
export function connectionKind(profile?:ConnectionProfileInput):DatabaseKind{return profile&&'kind' in profile?profile.kind:'mysql';}
export function connectionDefaults(kind:DatabaseKind):ConnectionDraft{
 const network={name:`本机 ${databaseLabels[kind]}`,host:'127.0.0.1',username:'',tls:false};
 switch(kind){case 'mysql':return {...network,kind,port:3306,username:'root'};case 'postgresql':return {...network,kind,port:5432,username:'postgres',database:'',defaultSchema:'public'};case 'oracle':return {...network,kind,port:1521,serviceName:''};case 'sqlite':return {kind,name:'本机 SQLite',filePath:'',readOnly:false};}
}
export function connectionEndpoint(profile:ConnectionProfileInput):string{
 if('kind' in profile&&profile.kind==='sqlite')return profile.filePath;
 if('host' in profile){const address=`${profile.host}:${profile.port}`;return 'kind' in profile&&profile.kind==='postgresql'?`${address}/${profile.database}`:'kind' in profile&&profile.kind==='oracle'?`${address}/${profile.serviceName}`:address;}return '';
}
export function namespaceLabel(kind:DatabaseKind){return kind==='mysql'?'数据库':kind==='postgresql'?'schema':kind==='oracle'?'owner':'命名空间';}
export function sqlExample(kind:DatabaseKind){return kind==='mysql'?'SELECT VERSION() AS version, NOW() AS utc_time;':kind==='postgresql'?'SELECT version(), current_timestamp;':kind==='oracle'?'SELECT SYSTIMESTAMP AS current_time FROM DUAL;':'SELECT sqlite_version() AS version, datetime(\'now\') AS utc_time;';}
