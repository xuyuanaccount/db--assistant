import {createHash} from 'node:crypto';
import type {Connection,RowDataPacket} from 'mysql2/promise';
import {AppFault,type TableTarget} from '../../../shared/contracts.js';
import {FIELD_KINDS,type FieldKind,type FieldType,type ExistingDefault,type StructureColumn,type TableStructure,type SchemaInfo,type StructureForeignKey,type StructureIndex} from '../../../shared/structure.js';
import type {MysqlAdapter} from '../../mysql/adapter.js';
import {quoteIdentifier as q} from './validation.js';
async function rows(conn:Connection,sql:string,params:string[]=[]):Promise<RowDataPacket[]>{return (await conn.execute<RowDataPacket[]>(sql,params))[0];}
export async function readSchemaInfo(conn:Connection,schema:string):Promise<SchemaInfo>{
 const r=await rows(conn,'SELECT DEFAULT_CHARACTER_SET_NAME,DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME=?',[schema]);
 if(!r.length)throw new AppFault('SCHEMA_NOT_FOUND','数据库不存在或无访问权限',404);
 const characterSet=String(r[0].DEFAULT_CHARACTER_SET_NAME),collation=String(r[0].DEFAULT_COLLATION_NAME);
 const defaults=await rows(conn,"SELECT DEFAULT_COLLATE_NAME FROM information_schema.CHARACTER_SETS WHERE CHARACTER_SET_NAME='utf8mb4'");
 return {name:schema,characterSet,collation,newTableCollation:characterSet==='utf8mb4'?collation:String(defaults[0].DEFAULT_COLLATE_NAME)};
}
function fieldType(raw:string):FieldType|null{
 const m=/^(tinyint|smallint|int|bigint|decimal|double|char|varchar|text|longtext|date|time|datetime|timestamp|json)(?:\((\d+)(?:,(\d+))?\))?( unsigned)?$/i.exec(raw);if(!m)return null;
 const kind=m[1].toUpperCase() as FieldKind;if(!FIELD_KINDS.includes(kind))return null;
 const t:FieldType={kind};if(m[4])t.unsigned=true;
 if(kind==='CHAR'||kind==='VARCHAR')t.length=Number(m[2]);
 if(kind==='DECIMAL'){t.precision=Number(m[2]);t.scale=Number(m[3]||0);}
 if(['TIME','DATETIME','TIMESTAMP'].includes(kind))t.fsp=Number(m[2]||0);
 if(kind==='TINYINT'&&m[2]==='1')t.booleanDisplay=true;
 // Legacy integer display widths do not change storage; other unsupported forms are read-only.
 return t;
}
function column(c:RowDataPacket):StructureColumn{
 const nullable=c.IS_NULLABLE==='YES',extra=String(c.EXTRA||''),rawDefault=c.COLUMN_DEFAULT;
 let def:ExistingDefault;
 if(rawDefault===null)def={kind:nullable?'null':'none'};
 else if(extra.includes('DEFAULT_GENERATED'))def=/^current_timestamp(?:\(\d*\))?$/i.test(String(rawDefault))?{kind:'current_timestamp'}:{kind:'expression',sql:String(rawDefault)};
 else def={kind:'literal',value:String(rawDefault)};
 const type=fieldType(String(c.COLUMN_TYPE));const blockedReasons:string[]=[];
 if(!type)blockedReasons.push('此字段类型暂不支持修改');
 if(extra.replace(/DEFAULT_GENERATED|auto_increment/gi,'').trim()||c.GENERATION_EXPRESSION||c.SRS_ID!==null)blockedReasons.push('含 ON UPDATE、生成列或其他未支持属性');
 if(def.kind==='expression')blockedReasons.push('含未支持的默认表达式');
 return {name:c.COLUMN_NAME,ordinal:Number(c.ORDINAL_POSITION),columnType:c.COLUMN_TYPE,dataType:c.DATA_TYPE,nullable,default:def,comment:String(c.COLUMN_COMMENT||''),characterSet:c.CHARACTER_SET_NAME,collation:c.COLLATION_NAME,extra,generationExpression:String(c.GENERATION_EXPRESSION||''),srsId:c.SRS_ID===null?null:Number(c.SRS_ID),blockedReasons,
 editableDefinition:type&&!blockedReasons.length&&def.kind!=='expression'?{name:c.COLUMN_NAME,type,nullable,default:def,comment:String(c.COLUMN_COMMENT||''),autoIncrement:extra.includes('auto_increment')}:null};
}
export function structureFingerprint(s:TableStructure):string{
 const data={kind:s.kind,engine:s.engine,characterSet:s.characterSet,collation:s.collation,comment:s.comment,columns:s.columns.map(({editableDefinition,blockedReasons,...c})=>c),indexes:s.indexes.map(({blockedReasons,...i})=>i),foreignKeys:s.foreignKeys,checks:s.checks,partitionDefinitions:s.partitionDefinitions,tableOptions:s.tableOptions};
 return createHash('sha256').update(JSON.stringify(data)).digest('hex');
}
export async function readTableStructure(conn:Connection,target:TableTarget):Promise<TableStructure>{
 const params=[target.schema,target.table];
 const tables=await rows(conn,'SELECT TABLE_TYPE,ENGINE,TABLE_COLLATION,TABLE_COMMENT,CREATE_OPTIONS FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',params);
 if(!tables.length)throw new AppFault('TABLE_NOT_FOUND','表不存在或无访问权限',404);
 const t=tables[0];const kind=t.TABLE_TYPE==='VIEW'?'view':'table';
 const cols=await rows(conn,'SELECT COLUMN_NAME,ORDINAL_POSITION,COLUMN_TYPE,DATA_TYPE,IS_NULLABLE,COLUMN_DEFAULT,COLUMN_COMMENT,CHARACTER_SET_NAME,COLLATION_NAME,EXTRA,GENERATION_EXPRESSION,SRS_ID FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',params);
 const idx=await rows(conn,'SELECT INDEX_NAME,NON_UNIQUE,INDEX_TYPE,IS_VISIBLE,COLUMN_NAME,EXPRESSION,SUB_PART,COLLATION FROM information_schema.STATISTICS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY INDEX_NAME,SEQ_IN_INDEX',params);
 const indexes:StructureIndex[]=[];
 for(const i of idx){let out=indexes.find(x=>x.name===i.INDEX_NAME);if(!out){out={name:i.INDEX_NAME,unique:!i.NON_UNIQUE,type:i.INDEX_TYPE,visible:i.IS_VISIBLE==='YES',columns:[],blockedReasons:[]};indexes.push(out);}out.columns.push({name:i.COLUMN_NAME,expression:i.EXPRESSION,prefixLength:i.SUB_PART===null?null:Number(i.SUB_PART),direction:i.COLLATION==='A'?'asc':i.COLLATION==='D'?'desc':null});}
 for(const i of indexes){if(i.name==='PRIMARY')i.blockedReasons.push('现有主键只读');if(i.type!=='BTREE'||!i.visible||i.columns.some(c=>c.expression))i.blockedReasons.push('高级索引只读');}
 const refs=await rows(conn,`SELECT k.CONSTRAINT_SCHEMA,k.TABLE_NAME,k.CONSTRAINT_NAME,k.COLUMN_NAME,k.REFERENCED_TABLE_SCHEMA,k.REFERENCED_TABLE_NAME,k.REFERENCED_COLUMN_NAME,r.UPDATE_RULE,r.DELETE_RULE,r.UNIQUE_CONSTRAINT_NAME FROM information_schema.KEY_COLUMN_USAGE k JOIN information_schema.REFERENTIAL_CONSTRAINTS r ON r.CONSTRAINT_SCHEMA=k.CONSTRAINT_SCHEMA AND r.TABLE_NAME=k.TABLE_NAME AND r.CONSTRAINT_NAME=k.CONSTRAINT_NAME WHERE (k.TABLE_SCHEMA=? AND k.TABLE_NAME=?) OR (k.REFERENCED_TABLE_SCHEMA=? AND k.REFERENCED_TABLE_NAME=?) ORDER BY k.CONSTRAINT_SCHEMA,k.TABLE_NAME,k.CONSTRAINT_NAME,k.ORDINAL_POSITION`,[...params,...params]);
 const foreignKeys:StructureForeignKey[]=[];
 for(const r of refs){const directions:('incoming'|'outgoing')[]=[];if(r.CONSTRAINT_SCHEMA===target.schema&&r.TABLE_NAME===target.table)directions.push('outgoing');if(r.REFERENCED_TABLE_SCHEMA===target.schema&&r.REFERENCED_TABLE_NAME===target.table)directions.push('incoming');for(const direction of directions){let fk=foreignKeys.find(x=>x.direction===direction&&x.schema===r.CONSTRAINT_SCHEMA&&x.table===r.TABLE_NAME&&x.name===r.CONSTRAINT_NAME);if(!fk){fk={direction,schema:r.CONSTRAINT_SCHEMA,table:r.TABLE_NAME,name:r.CONSTRAINT_NAME,columns:[],referencedSchema:r.REFERENCED_TABLE_SCHEMA,referencedTable:r.REFERENCED_TABLE_NAME,referencedColumns:[],updateRule:r.UPDATE_RULE,deleteRule:r.DELETE_RULE,referencedIndex:r.UNIQUE_CONSTRAINT_NAME};foreignKeys.push(fk);}fk.columns.push(r.COLUMN_NAME);fk.referencedColumns.push(r.REFERENCED_COLUMN_NAME);}}
 const checks=await rows(conn,`SELECT c.CONSTRAINT_NAME,c.CHECK_CLAUSE,t.ENFORCED FROM information_schema.CHECK_CONSTRAINTS c JOIN information_schema.TABLE_CONSTRAINTS t ON t.CONSTRAINT_SCHEMA=c.CONSTRAINT_SCHEMA AND t.CONSTRAINT_NAME=c.CONSTRAINT_NAME WHERE t.TABLE_SCHEMA=? AND t.TABLE_NAME=? ORDER BY c.CONSTRAINT_NAME`,params);
 const parts=await rows(conn,'SELECT PARTITION_NAME,PARTITION_METHOD,PARTITION_EXPRESSION,PARTITION_DESCRIPTION,SUBPARTITION_NAME,SUBPARTITION_METHOD,SUBPARTITION_EXPRESSION FROM information_schema.PARTITIONS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND PARTITION_NAME IS NOT NULL ORDER BY PARTITION_ORDINAL_POSITION,SUBPARTITION_ORDINAL_POSITION',params);
 const [create]=await conn.query<RowDataPacket[]>(`SHOW CREATE ${kind==='view'?'VIEW':'TABLE'} ${q(target.schema)}.${q(target.table)}`);
 const charset=t.TABLE_COLLATION?(await rows(conn,'SELECT CHARACTER_SET_NAME FROM information_schema.COLLATIONS WHERE COLLATION_NAME=?',[t.TABLE_COLLATION]))[0]?.CHARACTER_SET_NAME:null;
 const readOnlyReasons:string[]=[];if(kind==='view')readOnlyReasons.push('视图只读');else if(t.ENGINE!=='InnoDB')readOnlyReasons.push('仅支持 InnoDB 表结构变更');if(t.CREATE_OPTIONS)readOnlyReasons.push('表含高级选项，本轮只读');
 const s:TableStructure={target,kind,engine:t.ENGINE,characterSet:charset||null,collation:t.TABLE_COLLATION,comment:String(t.TABLE_COMMENT||''),columns:cols.map(column),indexes,foreignKeys,checks:checks.map(c=>({name:c.CONSTRAINT_NAME,clause:c.CHECK_CLAUSE,enforced:c.ENFORCED==='YES'})),partitionDefinitions:parts.map(p=>Object.fromEntries(Object.entries(p).map(([k,v])=>[k,v===null?null:String(v)]))),tableOptions:String(t.CREATE_OPTIONS||''),createSql:String(create[0][kind==='view'?'Create View':'Create Table']),fingerprint:'',readOnlyReasons};
 s.fingerprint=structureFingerprint(s);return s;
}
export async function describeStructure(adapter:MysqlAdapter,target:TableTarget){return adapter.withConnection(target.connectionId,undefined,conn=>readTableStructure(conn,target));}
