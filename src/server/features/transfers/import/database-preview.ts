import {AppFault,errorInfo,type AppError,type DataRow,type TableTarget} from '../../../../shared/contracts.js';
import type {NormalizedTableMeta} from '../../../../shared/database.js';
import type {DatabaseRegistry} from '../../../database/registry.js';
import {normalizeWriteValues} from '../../../database/values.js';
import type {FileStore} from '../files.js';
import {readSource,listSheets} from './codec.js';
import type {ColumnMapping,ImportOptions,ParsedSourceRow} from './types.js';
export interface ImportPreview {columns:string[];sheets:string[];rows:ParsedSourceRow[];errors:AppError[];meta:NormalizedTableMeta;warnings:string[]}
export function validateDatabaseMapping(meta:NormalizedTableMeta,mappings:ColumnMapping[]){
 if(!meta.capabilities?.import?.enabled)throw new AppFault('IMPORT_TABLE',meta.capabilities?.import?.reasons.join('；')||'此表不允许导入');
 const seen=new Set<string>();for(const mapping of mappings){const c=meta.columns.find(c=>c.name===mapping.targetColumn);if(!c)throw new AppFault('UNKNOWN_COLUMN',`字段不存在：${mapping.targetColumn}`);if(seen.has(c.name))throw new AppFault('DUPLICATE_MAPPING',`重复映射：${c.name}`);seen.add(c.name);if(!c.importable?.enabled||c.generated||c.identity==='always'||/BLOB|BINARY|RAW|BYTEA/i.test(c.dataType))throw new AppFault('IMPORT_TYPE',`${c.name}：请忽略不可导入、生成或二进制字段`);}
 for(const c of meta.columns)if(!c.nullable&&!c.hasDefault&&!c.autoIncrement&&!c.generated&&c.identity==='none'&&!seen.has(c.name))throw new AppFault('REQUIRED_COLUMN',`缺少必填字段：${c.name}`);
}
export function databaseImportRow(registry:DatabaseRegistry,target:TableTarget,row:ParsedSourceRow,mappings:ColumnMapping[],meta:NormalizedTableMeta){
 const mapped:DataRow={};for(const m of mappings){if(m.sourceIndex>=row.cells.length)throw new AppFault('MISSING_CELL',`源记录 ${row.sourceRow} 缺少第 ${m.sourceIndex+1} 列`);const value=row.cells[m.sourceIndex];if(value!==null&&typeof value==='object')throw new AppFault('IMPORT_TYPE','二进制值只供展示，不直接导入');mapped[m.targetColumn]=value;}
 try{const {values,kinds}=normalizeWriteValues(meta,mapped);return registry.get(target.connectionId).dialect.compileInsert(meta,values,kinds,'import');}catch(error){throw new AppFault('IMPORT_VALUE',`源记录 ${row.sourceRow}：${(error as Error).message}`);}
}
export async function previewDatabaseImport(files:FileStore,registry:DatabaseRegistry,uploadId:string,target:TableTarget,options:ImportOptions,mappings:ColumnMapping[]):Promise<ImportPreview>{
 const file=files.get(uploadId);if(file.kind!=='upload'||!file.completed||file.format!==options.format)throw new AppFault('INVALID_UPLOAD','上传格式不匹配');const meta=await registry.get(target.connectionId).describeTable(target),errors:AppError[]=[],rows:ParsedSourceRow[]=[];let columns:string[]=[],first=true;
 if(mappings.length)try{validateDatabaseMapping(meta,mappings);}catch(error){errors.push(errorInfo(error));}
 try{for await(const row of readSource(file.path,options)){if(first){first=false;columns=row.cells.map((c,i)=>options.hasHeader?String(c??`列 ${i+1}`):`列 ${i+1}`);if(options.hasHeader)continue;}if(mappings.length&&!errors.length)try{databaseImportRow(registry,target,row,mappings,meta);}catch(error){errors.push(errorInfo(error));}rows.push(row);if(rows.length>=20)break;}}catch(error){errors.push(errorInfo(error));}
 const warnings=meta.databaseKind==='sqlite'?['SQLite 按目标列亲和性转换值；NUMERIC/REAL 不保证任意精度小数，超过64位整数会拒绝。']:meta.databaseKind==='oracle'?['Oracle 空字符串写入时归一为 NULL；非空列拒绝空字符串。']:[];
 return {columns,sheets:options.format==='xlsx'?await listSheets(file.path):[],rows,errors,meta,warnings};
}
