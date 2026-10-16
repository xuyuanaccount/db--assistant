import {AppFault,type DataRow} from '../../../shared/contracts.js';
import type {DatabaseEndpoint} from '../../../shared/migrations.js';
import type {TableStructure} from '../../../shared/structure.js';
import {unsupportedTypes} from '../../mysql/values.js';
import {quoteIdentifier as q} from '../structure/validation.js';
export function checkEndpoints(source:DatabaseEndpoint,target:DatabaseEndpoint,sourceServer:string,targetServer:string,caseInsensitive:boolean):void {
 const norm=(s:string)=>caseInsensitive?s.toLowerCase():s;
 if(['mysql','sys','information_schema','performance_schema'].some(s=>s===source.schema.toLowerCase()||s===target.schema.toLowerCase()))throw new AppFault('SYSTEM_SCHEMA','不能迁移或同步系统数据库');
 if(sourceServer===targetServer&&norm(source.schema)===norm(target.schema))throw new AppFault('SAME_DATABASE','源与目标是同一实例的同一数据库，请选择不同目标');
}
export function checkTable(s:TableStructure,triggers:number):void {
 if(s.kind!=='table'||s.engine?.toLowerCase()!=='innodb')throw new AppFault('UNSUPPORTED_TABLE','首版仅支持普通 InnoDB 表');
 if(s.foreignKeys.length)throw new AppFault('FOREIGN_KEYS','首版不支持有外键依赖的表，请先单独规划外键迁移');
 if(triggers)throw new AppFault('TRIGGERS','首版不支持带触发器的表，避免遗漏或产生额外写入');
 if(s.partitionDefinitions.length||s.tableOptions)throw new AppFault('TABLE_OPTIONS','首版不支持分区或高级表选项');
 if(s.columns.some(c=>unsupportedTypes.has(c.dataType)))throw new AppFault('UNSUPPORTED_TYPE','空间或向量字段暂不支持保真迁移');
}
export function checkCompatible(source:TableStructure,target:TableStructure,keys:string[]):void {
 if(!keys.length)throw new AppFault('PRIMARY_KEY_REQUIRED','数据同步要求源表有完整主键');
 if(source.fingerprint!==target.fingerprint)throw new AppFault('STRUCTURE_MISMATCH','两端表结构不一致，请先人工对齐结构');
}
export function copyCreateSql(sql:string,table:string,targetSchema:string):string {
 const prefix=`CREATE TABLE ${q(table)} `;
 if(!sql.startsWith(prefix))throw new AppFault('CREATE_SQL','无法识别服务端建表定义，已停止迁移');
 return `CREATE TABLE ${q(targetSchema)}.${q(table)} ${sql.slice(prefix.length)}`;
}
export function rowDecision(columns:string[],source:DataRow,target:DataRow|undefined):'insert'|'update'|'unchanged' {
 if(!target)return 'insert';
 return columns.every(c=>JSON.stringify(source[c])===JSON.stringify(target[c]))?'unchanged':'update';
}
