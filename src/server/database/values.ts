import {AppFault,type DataRow} from '../../shared/contracts.js';
import type {NormalizedTableMeta,ValueKind} from '../../shared/database.js';
export function normalizeWriteValues(meta:NormalizedTableMeta,input:DataRow,valueKinds?:Record<string,ValueKind>,originalKinds?:Record<string,ValueKind>):{values:DataRow;kinds:Record<string,ValueKind>}{
 const values:DataRow={},kinds:Record<string,ValueKind>={};
 for(const [name,value] of Object.entries(input)){const column=meta.columns.find(c=>c.name===name)!;if(meta.databaseKind==='sqlite'&&['integer','decimal','real'].includes(column.valueKind)&&typeof value==='string'&&/^[+-]?\d+$/.test(value)&&(BigInt(value)<-9223372036854775808n||BigInt(value)>9223372036854775807n))throw new AppFault('INVALID_VALUE','SQLite 整数超出64位范围');values[name]=meta.databaseKind==='oracle'&&value===''?null:value;
  const originalKind=originalKinds?.[name];
  kinds[name]=values[name]===null?'null':valueKinds?.[name]??(meta.databaseKind==='sqlite'&&originalKind&&originalKind!=='null'?originalKind:meta.databaseKind==='sqlite'&&column.valueKind==='binary'?'text':column.valueKind);
 }
 return {values,kinds};
}
