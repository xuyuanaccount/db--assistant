import type {Connection,RowDataPacket} from 'mysql2/promise';
import {AppFault,type ColumnMeta,type TableMeta} from '../../../shared/contracts.js';
import type {MigrationPlan,MigrationRequest} from '../../../shared/migrations.js';
import type {TableStructure} from '../../../shared/structure.js';
import type {MysqlAdapter} from '../../mysql/adapter.js';
import {readSchemaInfo,readTableStructure} from '../structure/metadata.js';
import {quoteIdentifier as q} from '../structure/validation.js';
import {checkEndpoints,checkTable,checkCompatible,copyCreateSql} from './policy.js';
export function tableMeta(s:TableStructure):TableMeta {
 const columns:ColumnMeta[]=s.columns.map(c=>({name:c.name,dataType:c.dataType,columnType:c.columnType,nullable:c.nullable,hasDefault:c.default.kind!=='none',generated:!!c.generationExpression,autoIncrement:c.extra.includes('auto_increment'),ordinal:c.ordinal}));
 return {schema:s.target.schema,name:s.target.table,kind:s.kind,engine:s.engine,columns,primaryKey:s.indexes.find(i=>i.name==='PRIMARY')?.columns.map(c=>c.name!)||[]};
}
export async function prepareSession(conn:Connection):Promise<void>{await conn.query("SET time_zone='+00:00', SESSION sql_mode='STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION', SESSION sql_quote_show_create=1, SESSION lock_wait_timeout=10, SESSION innodb_lock_wait_timeout=10");}
export async function serverIdentity(conn:Connection):Promise<{uuid:string;caseInsensitive:boolean}>{
 const [r]=await conn.query<RowDataPacket[]>('SELECT @@server_uuid AS uuid, @@lower_case_table_names AS caseMode');
 if(!r[0]?.uuid)throw new AppFault('SERVER_IDENTITY','无法验证 MySQL 实例身份');
 return {uuid:String(r[0].uuid),caseInsensitive:Number(r[0].caseMode)!==0};
}
export async function inspectTable(conn:Connection,connectionId:string,schema:string,table:string):Promise<TableStructure>{
 // MySQL hides trigger metadata without TRIGGER privilege. Require a direct
 // grant so an empty metadata result cannot silently omit invisible triggers.
 const [grants]=await conn.query<RowDataPacket[]>('SHOW GRANTS FOR CURRENT_USER');
 const visible=grants.some(row=>{const grant=String(Object.values(row)[0]);const m=/^GRANT (.+) ON (\*|`(?:``|[^`])*`)\.(\*|`(?:``|[^`])*`) TO /.exec(grant);return !!m&&(m[1]==='ALL PRIVILEGES'||m[1].split(', ').includes('TRIGGER'))&&(m[2]==='*'||m[2]===q(schema))&&(m[3]==='*'||m[3]===q(table));});
 if(!visible)throw new AppFault('TRIGGER_METADATA_PERMISSION','预检需要直接授予所选表或数据库的 TRIGGER 权限，以确认不存在不可见触发器；仅角色授权暂不支持');
 const s=await readTableStructure(conn,{connectionId,schema,table});
 const [triggers]=await conn.execute<RowDataPacket[]>('SELECT TRIGGER_NAME FROM information_schema.TRIGGERS WHERE EVENT_OBJECT_SCHEMA=? AND EVENT_OBJECT_TABLE=?',[schema,table]);
 checkTable(s,triggers.length);return s;
}
export async function createPlan(adapter:MysqlAdapter,request:MigrationRequest,source:Connection,target:Connection):Promise<MigrationPlan>{
 const a=await serverIdentity(source),b=await serverIdentity(target);
 checkEndpoints(request.source,request.target,a.uuid,b.uuid,a.caseInsensitive||b.caseInsensitive);
 await readSchemaInfo(source,request.source.schema);await readSchemaInfo(target,request.target.schema);
 const [existing]=await target.execute<RowDataPacket[]>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=?',[request.target.schema]);
 const names=existing.map(t=>String(t.TABLE_NAME));
 if((a.caseInsensitive||b.caseInsensitive)&&new Set(request.tables.map(t=>t.toLowerCase())).size!==request.tables.length)throw new AppFault('TABLE_CASE_COLLISION','所选表名称在目标实例大小写规则下重复');
 const plan:MigrationPlan={request,sourceServer:a.uuid,targetServer:b.uuid,sourceGeneration:adapter.connections.generation(request.source.connectionId),targetGeneration:adapter.connections.generation(request.target.connectionId),sourceName:adapter.connections.store.get(request.source.connectionId).name,targetName:adapter.connections.store.get(request.target.connectionId).name,tables:[],warnings:['源端只读快照；目标逐批提交，整个任务不能整体回滚。','取消或失败会保留已创建的表和已提交批次；不会自动重试。','请在无并发结构变更的窗口执行，并核对目标库及备份。','首版不迁移外键、触发器、视图、存储过程、事件、账户或授权。']};
 for(const name of request.tables){
  try {
   const s=await inspectTable(source,request.source.connectionId,request.source.schema,name);const meta=tableMeta(s);
   const present=names.some(n=>b.caseInsensitive?n.toLowerCase()===name.toLowerCase():n===name);
   let targetFingerprint:string|null=null;let createSql:string|null=null;
   if(request.mode==='migrate'){if(present)throw new AppFault('TARGET_EXISTS','目标表已存在；迁移不会覆盖，请改用同步或选择空目标库');createSql=copyCreateSql(s.createSql,name,request.target.schema);}
   else {if(!present)throw new AppFault('TARGET_MISSING','目标表不存在；请先迁移表结构和数据');const t=await inspectTable(target,request.target.connectionId,request.target.schema,name);checkCompatible(s,t,meta.primaryKey);targetFingerprint=t.fingerprint;}
   const writeColumns=meta.columns.filter(c=>!c.generated).map(c=>c.name);if(!writeColumns.length)throw new AppFault('NO_WRITE_COLUMNS','没有可复制的非生成字段');
   plan.tables.push({name,sourceFingerprint:s.fingerprint,targetFingerprint,createSql,writeColumns,primaryKey:meta.primaryKey});
  }catch(e){if(e instanceof AppFault)throw new AppFault(e.code,`${name}：${e.message}`,e.statusCode);throw e;}
 }
 if(request.mode==='sync')plan.warnings.push('源行按主键覆盖目标对应字段；目标多余记录保留，其他唯一键冲突会停止任务。');
 return plan;
}
export function samePlan(a:MigrationPlan,b:MigrationPlan):void {
 if(a.sourceServer!==b.sourceServer||a.targetServer!==b.targetServer||a.sourceGeneration!==b.sourceGeneration||a.targetGeneration!==b.targetGeneration||JSON.stringify(a.tables)!==JSON.stringify(b.tables))throw new AppFault('PLAN_CHANGED','连接或表结构已改变，请重新预检；任务尚未写入数据',409);
}
export function qualified(schema:string,table:string):string{return `${q(schema)}.${q(table)}`;}
