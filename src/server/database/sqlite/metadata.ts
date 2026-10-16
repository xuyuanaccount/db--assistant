import {createHash} from 'node:crypto';
import {AppFault,type DataRow,type TableTarget} from '../../../shared/contracts.js';
import type {BoundValue,CapabilitySet,DatabaseStructure,NormalizedColumnMeta,NormalizedTableMeta} from '../../../shared/database.js';
import type {DbSession} from '../contracts.js';
import {sqliteAffinity} from './values.js';
const cap=(enabled:boolean,reason='此对象不支持此操作')=>({enabled,reasons:enabled?[]:[reason]});
export function sqliteCapabilities(writable:boolean):CapabilitySet{return {browse:cap(true),insert:cap(writable),update:cap(writable),delete:cap(writable),import:cap(writable),exportCsv:cap(true),exportXlsx:cap(true),exportSql:cap(true),structureEdit:cap(false,'SQLite 首版仅支持查看结构'),migration:cap(false,'SQLite 不支持同步迁移')};}
export function assertSqliteNamespace(namespace:string){if(namespace!=='main')throw new AppFault('INVALID_NAMESPACE','SQLite 仅支持 main');}
export {databaseRows as sqliteRows} from '../rows.js';
import {databaseRows as sqliteRows} from '../rows.js';
const text=(value:string):BoundValue=>({value,kind:'text'});
const quote=(s:string)=>'"'+s.replaceAll('"','""')+'"';
export async function readSqliteMetadata(session:DbSession,target:TableTarget,readOnly:boolean):Promise<{meta:NormalizedTableMeta;structure:DatabaseStructure}>{
 assertSqliteNamespace(target.schema);
 const [object]=await sqliteRows(session,"SELECT type,sql FROM main.sqlite_schema WHERE name=? AND type IN ('table','view')",[text(target.table)]);
 if(!object||target.table.startsWith('sqlite_'))throw new AppFault('TABLE_NOT_FOUND','找不到此表或没有访问权限',404);
 const [classification]=await sqliteRows(session,"SELECT type,wr,strict FROM pragma_table_list WHERE schema='main' AND name=?",[text(target.table)]);
 const fields=await sqliteRows(session,"SELECT * FROM pragma_table_xinfo(?, 'main') ORDER BY cid",[text(target.table)]);
 const indices=await sqliteRows(session,"SELECT * FROM pragma_index_list(?, 'main') ORDER BY seq",[text(target.table)]);
 const keys=fields.filter(c=>Number(c.pk)>0).sort((a,b)=>Number(a.pk)-Number(b.pk));
 const alias=keys.length===1&&String(keys[0].type).toUpperCase()==='INTEGER'&&classification?.wr==='0'&&!indices.some(i=>i.origin==='pk');
 const reliable=keys.length>0&&(alias||keys.every(c=>c.notnull==='1')||classification?.strict==='1'||classification?.wr==='1');
 const writable=!readOnly&&classification?.type==='table';
 const columns:NormalizedColumnMeta[]=fields.filter(c=>c.hidden!=='1').map(c=>{const generated=c.hidden==='2'||c.hidden==='3',autoIncrement=alias&&c.pk==='1';return {name:String(c.name),dataType:String(c.type),columnType:String(c.type),nullable:c.notnull!=='1'&&!autoIncrement,hasDefault:c.dflt_value!==null||autoIncrement,generated,autoIncrement,ordinal:Number(c.cid)+1,valueKind:sqliteAffinity(String(c.type)),identity:autoIncrement?'by-default':'none',editable:cap(writable&&!generated,generated?'生成列不可写入':'此对象为只读'),importable:cap(writable&&!generated,generated?'生成列不可导入':'此对象为只读'),comparable:true};});
 const capabilities=sqliteCapabilities(writable);capabilities.update=cap(writable&&reliable,'更新需要非空且唯一的可靠主键');capabilities.delete=capabilities.update;
 const indexDetails=[];const unavailableReasons:string[]=[];
 for(const index of indices){const members=await sqliteRows(session,"SELECT * FROM pragma_index_xinfo(?, 'main') ORDER BY seqno",[text(String(index.name))]);const [definition]=await sqliteRows(session,"SELECT sql FROM main.sqlite_schema WHERE type='index' AND name=?",[text(String(index.name))]);indexDetails.push({index,members,sql:definition?.sql??null});}
 const foreign=await sqliteRows(session,"SELECT * FROM pragma_foreign_key_list(?, 'main') ORDER BY id,seq",[text(target.table)]);
 const rawDefinition=object.sql===null?null:String(object.sql);
 const fingerprint=createHash('sha256').update(JSON.stringify({object,classification,fields,indexDetails,foreign})).digest('hex');
 const meta:NormalizedTableMeta={schema:'main',name:target.table,kind:object.type==='view'?'view':'table',engine:null,columns,primaryKey:keys.map(c=>String(c.name)),databaseKind:'sqlite',capabilities,definitionFingerprint:fingerprint};
 if(rawDefinition&&/\bCHECK\s*\(/i.test(rawDefinition))unavailableReasons.push('CHECK 约束未进行结构化拆解，请查看原始定义');
 const indexes:DatabaseStructure['indexes']=indexDetails.map(({index,members,sql})=>{if(members.some(m=>m.key==='1'&&m.cid==='-2'))unavailableReasons.push(`索引 ${String(index.name)} 含表达式，结构化表达式不可用；原始索引定义：${String(sql??'不可用')}`);if(index.partial==='1')unavailableReasons.push(`索引 ${String(index.name)} 的 WHERE 条件未拆解；原始索引定义：${String(sql??'不可用')}`);return {name:String(index.name),unique:index.unique==='1',method:null,columns:members.filter(m=>m.key==='1').map(m=>({name:m.name===null?null:String(m.name),expression:null,direction:m.desc==='1'?'desc' as const:'asc' as const})),predicate:null};});
 const foreignKeys:DatabaseStructure['foreignKeys']=[];for(const id of new Set(foreign.map(f=>String(f.id)))){const parts=foreign.filter(f=>String(f.id)===id),first=parts[0];foreignKeys.push({name:`foreign_key_${id}`,definition:`FOREIGN KEY (${parts.map(f=>quote(String(f.from))).join(', ')}) REFERENCES ${quote(String(first.table))}${parts.every(f=>f.to!==null)?` (${parts.map(f=>quote(String(f.to))).join(', ')})`:''} ON UPDATE ${String(first.on_update)} ON DELETE ${String(first.on_delete)}`});}
 const structure:DatabaseStructure={target,databaseKind:'sqlite',objectKind:meta.kind,columns:columns.map(c=>({...c,defaultSql:fields.find(f=>f.name===c.name)?.dflt_value as string|null,comment:''})),primaryKey:meta.primaryKey,indexes,foreignKeys,checks:[],definition:{kind:rawDefinition?'native':'unavailable',text:rawDefinition,...(!rawDefinition?{reason:'SQLite 未提供原始定义'}:{})},unavailableReasons};
 return {meta,structure};
}
