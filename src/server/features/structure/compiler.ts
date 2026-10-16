import mysql from 'mysql2/promise';
import type {FieldDefinition,FieldType,StructureAction,SchemaInfo,TableStructure} from '../../../shared/structure.js';
import {bindCell} from '../../mysql/values.js';
import {actionSchema,definitionSchema,quoteIdentifier as q} from './validation.js';
import {reject,validateStructureAction} from './policy.js';
export {quoteIdentifier} from './validation.js';
function renderType(t:FieldType):string{
 const allowed=new Set(['kind']);const int=['TINYINT','SMALLINT','INT','BIGINT'].includes(t.kind);
 if(int)allowed.add('unsigned');if(t.kind==='TINYINT')allowed.add('booleanDisplay');
 const bounded=(n:number|undefined,min:number,max:number)=>{if(n===undefined||!Number.isInteger(n)||n<min||n>max)reject('类型参数超出范围');return n;};
 let sql:string=t.kind;
 if(t.kind==='CHAR'||t.kind==='VARCHAR'){allowed.add('length');sql+=`(${bounded(t.length,1,t.kind==='CHAR'?255:16383)})`;}
 if(t.kind==='DECIMAL'){allowed.add('precision');allowed.add('scale');const p=bounded(t.precision,1,65),scale=bounded(t.scale,0,30);if(scale>p)reject('小数位不能超过精度');sql+=`(${p},${scale})`;}
 if(['TIME','DATETIME','TIMESTAMP'].includes(t.kind)){allowed.add('fsp');const f=bounded(t.fsp??0,0,6);if(f)sql+=`(${f})`;}
 if(t.booleanDisplay)sql+='(1)';if(t.unsigned)sql+=' UNSIGNED';
 for(const key of Object.keys(t))if(!allowed.has(key))reject('类型含不适用参数');return sql;
}
function renderField(input:FieldDefinition,hidden?:{characterSet:string|null;collation:string|null}):string{
 const f=definitionSchema.parse(input);const typeSql=renderType(f.type);const d=f.default;
 if(!f.nullable&&d.kind==='null')reject('NOT NULL 字段不能 DEFAULT NULL');
 if(f.autoIncrement&&(!['INT','BIGINT'].includes(f.type.kind)||f.nullable||d.kind!=='none'))reject('自增需要 INT/BIGINT、NOT NULL、无默认值');
 let sql=`${q(f.name)} ${typeSql}`;
 if(['CHAR','VARCHAR','TEXT','LONGTEXT'].includes(f.type.kind)&&hidden?.characterSet){sql+=` CHARACTER SET ${q(hidden.characterSet)}`;if(hidden.collation)sql+=` COLLATE ${q(hidden.collation)}`;}
 sql+=f.nullable?' NULL':' NOT NULL';
 if(d.kind==='null')sql+=' DEFAULT NULL';
 if(d.kind==='current_timestamp'){if(!['DATETIME','TIMESTAMP'].includes(f.type.kind))reject('CURRENT_TIMESTAMP 仅支持 DATETIME/TIMESTAMP');sql+=` DEFAULT CURRENT_TIMESTAMP${f.type.fsp?`(${f.type.fsp})`:''}`;}
 if(d.kind==='literal'){
 if(['TEXT','LONGTEXT','JSON'].includes(f.type.kind))reject('此类型不支持非 NULL 默认值');
 bindCell({name:f.name,columnType:typeSql.toLowerCase(),dataType:f.type.kind.toLowerCase(),nullable:f.nullable,hasDefault:true,generated:false,autoIncrement:false,ordinal:1},d.value);
 if(f.type.kind==='TIME'){const m=/^-?(\d{1,3}):(\d{2}):(\d{2})(?:\.(\d+))?$/.exec(d.value);if(!m||Number(m[1])>838||Number(m[2])>59||Number(m[3])>59||(m[4]?.length||0)>(f.type.fsp||0))reject('TIME 默认值超出范围或精度');}
 if(['CHAR','VARCHAR'].includes(f.type.kind)&&[...d.value].length>(f.type.length||0))reject('默认值超过字段长度');sql+=` DEFAULT ${mysql.escape(d.value)}`;
 }
 if(f.autoIncrement)sql+=' AUTO_INCREMENT';return sql+` COMMENT ${mysql.escape(f.comment)}`;
}
export function compileDdl(input:StructureAction,context:{schema:SchemaInfo;structure:TableStructure|null;hasRows:boolean}):{sql:string;warnings:string[];confirmationTableName:string|null}{
 const action=actionSchema.parse(input);validateStructureAction(action,context);const target=`${q(action.target.schema)}.${q(action.target.table)}`;let sql='';const warnings=['MySQL DDL 会隐式提交，可能等待锁或重建表，不能跨操作回滚。'];let confirmationTableName:string|null=null;
 if(action.kind==='create_table'){
 if(new Set(action.columns.map(c=>c.name.toLowerCase())).size!==action.columns.length)reject('字段名称重复');
 if(new Set(action.primaryKey).size!==action.primaryKey.length||action.primaryKey.some(n=>!action.columns.some(c=>c.name===n)))reject('主键字段重复或不存在');
 if(action.primaryKey.some(n=>action.columns.find(c=>c.name===n)?.nullable))reject('主键字段必须 NOT NULL');
 const auto=action.columns.filter(c=>c.autoIncrement);if(auto.length>1||(auto.length&&action.primaryKey[0]!==auto[0].name))reject('仅一个自增字段且必须是主键首列');
 if(!context.schema.newTableCollation.startsWith('utf8mb4_'))reject('排序规则与 utf8mb4 不兼容');
 const fields=action.columns.map(c=>renderField(c));if(action.primaryKey.length)fields.push(`PRIMARY KEY (${action.primaryKey.map(q).join(', ')})`);
 sql=`CREATE TABLE ${target} (${fields.join(', ')}) ENGINE=InnoDB DEFAULT CHARACTER SET utf8mb4 COLLATE ${q(context.schema.newTableCollation)} COMMENT ${mysql.escape(action.comment)}`;
 }else{
 const prefix=`ALTER TABLE ${target} `;const s=context.structure!;
 switch(action.kind){
 case 'add_column':sql=prefix+`ADD COLUMN ${renderField(action.definition)}`;break;
 case 'modify_column':{const col=s.columns.find(c=>c.name===action.column)!;if(!col.editableDefinition)reject('此字段只读');sql=prefix+`MODIFY COLUMN ${renderField({...col.editableDefinition,...action.patch},col)}`;if(action.patch.type)warnings.push('类型变更可能转换或截断已有值，请先核对数据。');break;}
 case 'rename_column':sql=prefix+`RENAME COLUMN ${q(action.column)} TO ${q(action.newName)}`;break;
 case 'drop_column':sql=prefix+`DROP COLUMN ${q(action.column)}`;confirmationTableName=action.target.table;warnings.push(`删除字段 ${action.column} 将永久丢失该列数据。`);break;
 case 'add_index':sql=prefix+`ADD ${action.unique?'UNIQUE ':''}INDEX ${q(action.name)} (${action.columns.map(c=>q(c.name)+(c.prefixLength?`(${c.prefixLength})`:'')).join(', ')}) USING BTREE`;break;
 case 'drop_index':sql=prefix+`DROP INDEX ${q(action.name)}`;break;
 }
 }
 if(Buffer.byteLength(sql)>256*1024)reject('DDL 超过 256 KiB');return {sql,warnings,confirmationTableName};
}
