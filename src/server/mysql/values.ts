import type { ConnectionOptions } from 'mysql2';
import { AppFault, type ColumnMeta, type DbCell } from '../../shared/contracts.js';
export const binaryTypes = new Set(['binary','varbinary','tinyblob','blob','mediumblob','longblob','bit']);
export const unsupportedTypes = new Set(['geometry','point','linestring','polygon','multipoint','multilinestring','multipolygon','geometrycollection','vector']);
export const numericTypes = new Set(['tinyint','smallint','mediumint','int','integer','bigint','decimal','numeric','float','double','real','year']);
export const textTypeCast: ConnectionOptions['typeCast'] = (field,next) => {
  if (['TINY','SHORT','LONG','LONGLONG','INT24','NEWDECIMAL','DECIMAL','FLOAT','DOUBLE','YEAR'].includes(field.type)) return field.string();
  return next();
};
export function decodeCell(_column: ColumnMeta, raw: unknown): DbCell {
  if(raw===null||raw===undefined) return null;
  if(Buffer.isBuffer(raw)) return {binaryHex:raw.toString('hex')};
  if(typeof raw==='object') throw new AppFault('UNSUPPORTED_TYPE','此字段类型暂不支持保真读取');
  return String(raw);
}
export function bindCell(column: ColumnMeta, cell: DbCell): string|Buffer|null {
  const fail=(reason:string):never=>{throw new AppFault('INVALID_VALUE',`${column.name}：${reason}`);};
  if(cell===null) {if(!column.nullable) fail('不允许 NULL');return null;}
  if(unsupportedTypes.has(column.dataType)) fail('暂不支持此类型');
  if(typeof cell==='object') {
    if(!binaryTypes.has(column.dataType)||!/^([a-f\d]{2})*$/i.test(cell.binaryHex)) fail('无效的二进制值');
    return Buffer.from(cell.binaryHex,'hex');
  }
  if(binaryTypes.has(column.dataType)) fail('二进制字段需要十六进制值');
  if(['tinyint','smallint','mediumint','int','integer','bigint'].includes(column.dataType)) {
    if(!/^[+-]?\d+$/.test(cell)) fail('需要整数文本');
    const bits=({tinyint:8,smallint:16,mediumint:24,int:32,integer:32,bigint:64} as Record<string,number>)[column.dataType];
    const unsigned=column.columnType.includes('unsigned'); const value=BigInt(cell);
    if(value<(unsigned?0n:-(1n<<BigInt(bits-1)))||value>(unsigned?(1n<<BigInt(bits))-1n:(1n<<BigInt(bits-1))-1n)) fail('超出整数范围');
  } else if(['decimal','numeric'].includes(column.dataType)) {
    if(!/^[+-]?\d+(?:\.\d+)?$/.test(cell)) fail('需要精确小数文本');
    const limits=column.columnType.match(/\((\d+),(\d+)\)/);
    const [whole,fraction='']=cell.replace(/^[+-]/,'').split('.');
    if(limits&&(whole.replace(/^0+/,'').length>Number(limits[1])-Number(limits[2])||fraction.length>Number(limits[2]))) fail('超出小数精度或小数位数');
    if(column.columnType.includes('unsigned')&&cell.startsWith('-')) fail('不允许负数');
  } else if(['float','double','real'].includes(column.dataType)) {
    if(!/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i.test(cell)||!Number.isFinite(Number(cell))) fail('需要有限数值');
  } else if(column.dataType==='json') {try{JSON.parse(cell);}catch{fail('无效的 JSON 文本');}}
  else if(['date','datetime','timestamp'].includes(column.dataType)) {
    const pattern=column.dataType==='date'?/^\d{4}-\d{2}-\d{2}$/:/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d{1,6})?$/;
    if(!pattern.test(cell)) fail('日期格式应为 YYYY-MM-DD，时间使用 HH:mm:ss[.微秒]');
    const date=cell.slice(0,10);const check=new Date(`${date}T00:00:00Z`);
    if(!Number.isFinite(check.getTime())||check.toISOString().slice(0,10)!==date) fail('无效日期');
    if(column.dataType!=='date'&&(Number(cell.slice(11,13))>23||Number(cell.slice(14,16))>59||Number(cell.slice(17,19))>59)) fail('无效时间');
    const precision=Number(column.columnType.match(/\((\d)\)/)?.[1]||0);
    if((cell.split('.')[1]||'').length>precision&&column.dataType!=='date') fail('超出时间小数精度');
  } else if(column.dataType==='time'&&!/^-?\d{1,3}:\d{2}:\d{2}(?:\.\d{1,6})?$/.test(cell)) fail('无效的 TIME 文本');
  return cell;
}
