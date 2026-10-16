import mysql from 'mysql2/promise';
import {createHash} from 'node:crypto';
import {AppFault,type ColumnMeta,type DataRow,type TableMeta,type TableTarget} from '../../shared/contracts.js';
import type {BoundValue,DatabaseStructure,NormalizedColumnMeta,NormalizedTableMeta} from '../../shared/database.js';
import type {MysqlAdapter} from '../mysql/adapter.js';
import {bindCell,binaryTypes,unsupportedTypes} from '../mysql/values.js';
import {compileTableQuery} from '../features/data/query.js';
import {loadSqlCompletions} from '../features/sql/completions.js';
import {sqlCell} from '../features/transfers/export/codec.js';
import {readTableStructure} from '../features/structure/metadata.js';
import {mysqlBindParameters,mysqlCapabilities,mysqlValueKind} from './mysql-factory.js';
import {lexSql} from './statements.js';
import {LIMITS} from '../../shared/limits.js';
import type {DatabaseAdapter,DbSession,SessionPurpose} from './contracts.js';
import type {SqlDialect} from './dialect.js';
const q=(name:string)=>mysql.escapeId(name,true);
const table=(meta:TableMeta)=>`${q(meta.schema)}.${q(meta.name)}`;
const capability=(enabled:boolean,reason:string)=>({enabled,reasons:enabled?[]:[reason]});
export function normalizeMysqlColumn(column:ColumnMeta):NormalizedColumnMeta {const supported=!unsupportedTypes.has(column.dataType);return {...column,valueKind:mysqlValueKind(column.dataType),identity:column.autoIncrement?'by-default':'none',editable:capability(!column.generated&&supported&&!binaryTypes.has(column.dataType)&&column.dataType!=='json','此字段暂不支持表格编辑'),importable:capability(!column.generated&&supported&&!binaryTypes.has(column.dataType),'此字段暂不支持导入'),comparable:supported};}
export function normalizeMysqlTable(meta:TableMeta):NormalizedTableMeta {const columns=meta.columns.map(normalizeMysqlColumn),capabilities=mysqlCapabilities();const writable=meta.kind==='table'&&meta.engine?.toLowerCase()==='innodb',editable=writable&&meta.primaryKey.length>0&&columns.every(c=>c.comparable);capabilities.insert=capability(editable,'表格编辑需要带可靠主键的 InnoDB 普通表');capabilities.update=capabilities.delete=capabilities.insert;capabilities.import=capability(writable,'导入需要 InnoDB 普通表');capabilities.structureEdit=capabilities.migration=capability(writable,'此对象不支持结构修改或迁移');capabilities.exportSql=capability(columns.every(c=>c.comparable),'存在不支持导出的字段类型');return {...meta,columns,databaseKind:'mysql',capabilities,definitionFingerprint:createHash('sha256').update(JSON.stringify(meta)).digest('hex')};}
function bind(meta:NormalizedTableMeta,name:string,value:DataRow[string]):BoundValue {const column=meta.columns.find(c=>c.name===name);if(!column)throw new AppFault('UNKNOWN_COLUMN',`字段不存在：${name}`);bindCell(column,value);return {value,kind:value===null?'null':column.valueKind,column};}
function keys(meta:NormalizedTableMeta,original:DataRow){if(!meta.primaryKey.length)throw new AppFault('READ_ONLY_TABLE','更新和删除需要主键');return {sql:meta.primaryKey.map(name=>`${q(name)} <=> ?`).join(' AND '),params:meta.primaryKey.map(name=>{if(!Object.hasOwn(original,name))throw new AppFault('INVALID_SNAPSHOT','原始主键不完整');return bind(meta,name,original[name]);})};}
function writeValues(meta:NormalizedTableMeta,values:DataRow){return Object.entries(values).map(([name,value])=>{const param=bind(meta,name,value);if(param.column?.generated)throw new AppFault('READ_ONLY_COLUMN','生成列不可写入');return param;});}
function renderMysql(command:import('../../shared/database.js').CompiledStatement){
 const parameters=command.params.map(p=>p.value),fallback=(reason:string)=>({sql:null,template:command.sql,parameters,reason});
 try{
  const values=mysqlBindParameters(command),{mask}=lexSql('mysql',command.sql);let sql='',start=0,index=0;
  for(let i=0;i<command.sql.length;i++)if(command.sql[i]==='?'&&mask[i]){
   if(index>=values.length)return fallback('占位符与参数数量不匹配');
   sql+=command.sql.slice(start,i)+mysql.escape(values[index++]);start=i+1;
  }
  if(index!==values.length)return fallback('占位符与参数数量不匹配');
  sql+=command.sql.slice(start);
  if(Buffer.byteLength(sql,'utf8')>LIMITS.sqlBytes)return fallback('可复制 SQL 超过 256 KiB');
  return {sql,template:command.sql,parameters};
 }catch(error){return fallback(error instanceof Error?error.message:'值无法可靠渲染');}
}
export const mysqlDialect:SqlDialect={
 quoteIdentifier:q,qualifiedTable:target=>`${q(target.schema)}.${q(target.table)}`,placeholder:()=> '?',
 compileBrowse:(meta,input,scope)=>{const command=compileTableQuery(meta,input,scope);return {sql:command.sql,params:command.params.map(value=>({value:Buffer.isBuffer(value)?{binaryHex:value.toString('hex')}:typeof value==='number'?String(value):value,kind:value===null?'null':Buffer.isBuffer(value)?'binary':typeof value==='number'?'integer':'text'}))};},
 compileInsert:(meta,values)=>{const params=writeValues(meta,values),names=Object.keys(values);return {sql:names.length?`INSERT INTO ${table(meta)} (${names.map(q).join(',')}) VALUES (${names.map(()=>'?').join(',')})`:`INSERT INTO ${table(meta)} () VALUES ()`,params};},
 compileUpdate:(meta,values,original)=>{const params=writeValues(meta,values),names=Object.keys(values),key=keys(meta,original);if(!names.length)throw new AppFault('EMPTY_UPDATE','没有需要更新的字段');return {sql:`UPDATE ${table(meta)} SET ${names.map(name=>`${q(name)}=?`).join(',')} WHERE ${key.sql}`,params:[...params,...key.params]};},
 compileDelete:(meta,original)=>{const key=keys(meta,original);return {sql:`DELETE FROM ${table(meta)} WHERE ${key.sql}`,params:key.params};},
 compileLockRow:(meta,original)=>{const key=keys(meta,original);return {sql:`SELECT * FROM ${table(meta)} WHERE ${key.sql} FOR UPDATE`,params:key.params};},
 render:renderMysql,
 exportPreamble:()=>"SET time_zone = '+00:00';\n",
 exportInsert:(meta,row)=>{const entries=meta.columns.map((c,i)=>({c,value:row.values[i]})).filter(({c})=>!c.generated);return `INSERT INTO ${table(meta)} (${entries.map(({c})=>q(c.name)).join(',')}) VALUES (${entries.map(({c,value})=>sqlCell(c,value)).join(',')});\n`;},
};
export class MysqlDatabaseAdapter implements DatabaseAdapter {
 readonly kind='mysql' as const;readonly dialect=mysqlDialect;
 constructor(readonly legacy:MysqlAdapter){}
 openSession(id:string,namespace:string,purpose:SessionPurpose,signal?:AbortSignal){return this.legacy.connections.openSession(id,namespace,purpose,signal);}
 listNamespaces(id:string){return this.legacy.listSchemas(id);}
 listTables(id:string,namespace:string){return this.legacy.listTables(id,namespace);}
 async describeTable(target:TableTarget,session?:DbSession):Promise<NormalizedTableMeta>{
  if(!session)return normalizeMysqlTable(await this.legacy.describeTable(target));
  const rows=async(sql:string)=>{const cursor=await session.openStatement({sql,params:[{value:target.schema,kind:'text'},{value:target.table,kind:'text'}]});const result:DataRow[]=[];try{for(;;){const part=await cursor.read(100,1024*1024);for(const row of part.rows)result.push(Object.fromEntries(cursor.columns.map((c,i)=>[c.name,row.values[i]])));if(part.done)return result;}}finally{await cursor.close();}};
  const tables=await rows('SELECT TABLE_TYPE,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?');if(!tables.length)throw new AppFault('TABLE_NOT_FOUND','找不到此表或没有访问权限',404);
  const columns=await rows('SELECT COLUMN_NAME,DATA_TYPE,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,ORDINAL_POSITION,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION');
  const pk=await rows("SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND CONSTRAINT_NAME='PRIMARY' ORDER BY ORDINAL_POSITION");
  return normalizeMysqlTable({schema:target.schema,name:target.table,kind:tables[0].TABLE_TYPE==='VIEW'?'view':'table',engine:tables[0].ENGINE===null?null:String(tables[0].ENGINE),columns:columns.map(c=>({name:String(c.COLUMN_NAME),dataType:String(c.DATA_TYPE),columnType:String(c.COLUMN_TYPE),nullable:c.IS_NULLABLE==='YES',hasDefault:c.COLUMN_DEFAULT!==null,generated:!!c.GENERATION_EXPRESSION,autoIncrement:String(c.EXTRA).includes('auto_increment'),ordinal:Number(c.ORDINAL_POSITION)})),primaryKey:pk.map(c=>String(c.COLUMN_NAME))});
 }
 async describeStructure(target:TableTarget):Promise<DatabaseStructure>{const s=await this.legacy.withConnection(target.connectionId,undefined,conn=>readTableStructure(conn,target));return {target,databaseKind:'mysql',objectKind:s.kind,columns:s.columns.map(c=>({...normalizeMysqlColumn({name:c.name,dataType:c.dataType,columnType:c.columnType,nullable:c.nullable,hasDefault:c.default.kind!=='none',generated:!!c.generationExpression,autoIncrement:c.extra.includes('auto_increment'),ordinal:c.ordinal}),defaultSql:c.default.kind==='none'?null:c.default.kind==='null'?'NULL':c.default.kind==='current_timestamp'?'CURRENT_TIMESTAMP':c.default.kind==='expression'?c.default.sql:c.default.kind==='literal'?mysql.escape(c.default.value):null,comment:c.comment})),primaryKey:s.indexes.find(i=>i.name==='PRIMARY')?.columns.flatMap(c=>c.name?[c.name]:[])||[],indexes:s.indexes.map(i=>({name:i.name,unique:i.unique,method:i.type,columns:i.columns.map(c=>({name:c.name,expression:c.expression,direction:c.direction})),predicate:null})),foreignKeys:s.foreignKeys.map(f=>({name:f.name,definition:`FOREIGN KEY (${f.columns.map(q).join(', ')}) REFERENCES ${q(f.referencedSchema)}.${q(f.referencedTable)} (${f.referencedColumns.map(q).join(', ')}) ON UPDATE ${f.updateRule} ON DELETE ${f.deleteRule}`})),checks:s.checks.map(c=>({name:c.name,definition:`CHECK (${c.clause})${c.enforced?'':' NOT ENFORCED'}`})),definition:{kind:'native',text:s.createSql},unavailableReasons:[]};}
 loadCompletions(id:string,namespace:string){return loadSqlCompletions(this.legacy,id,namespace);}
}
