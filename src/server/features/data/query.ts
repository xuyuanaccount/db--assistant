import mysql, { type RowDataPacket } from 'mysql2/promise';
import { AppFault, type TableMeta, type DataRow } from '../../../shared/contracts.js';
import { bindCell, decodeCell, textTypeCast } from '../../mysql/values.js';
import type { MysqlAdapter } from '../../mysql/adapter.js';
import { browseSchema, type BrowseRequest } from './types.js';
export function compileTableQuery(meta:TableMeta,input:BrowseRequest,scope:'page'|'filtered'|'all'):{sql:string;params:(string|number|Buffer|null)[]} {
  const request=browseSchema.parse(input);const params:(string|number|Buffer|null)[]=[];
  const column=(name:string)=>{const col=meta.columns.find(col=>col.name===name);if(!col)throw new AppFault('UNKNOWN_COLUMN',`字段不存在：${name}`);return col;};
  const where=scope==='all'?[]:request.filters.map(filter=>{
    const col=column(filter.column);const id=mysql.escapeId(col.name,true);
    if(filter.op==='is-null'||filter.op==='is-not-null') return `${id} IS ${filter.op==='is-not-null'?'NOT ':''}NULL`;
    if(filter.op==='is-empty'||filter.op==='is-not-empty') {
      if(!['char','varchar','tinytext','text','mediumtext','longtext','enum','set'].includes(col.dataType))throw new AppFault('FILTER_VALUE','空字符串条件需要文本字段');
      return `${id} ${filter.op==='is-empty'?'=':'<>'} ''`;
    }
    if(filter.op==='in'||filter.op==='not-in') {
      if(!filter.values?.length||filter.values.some(value=>value===null))throw new AppFault('FILTER_VALUE','列表需要 1–100 个非 NULL 值，NULL 请使用专用条件');
      params.push(...filter.values.map(value=>bindCell(col,value)));
      return `${id} ${filter.op==='in'?'IN':'NOT IN'} (${filter.values.map(()=>'?').join(', ')})`;
    }
    if(filter.value===undefined)throw new AppFault('FILTER_VALUE','请填写筛选值');
    if(filter.value===null)throw new AppFault('FILTER_VALUE','请使用 NULL / 非 NULL 筛选');
    if(filter.op==='between'||filter.op==='not-between') {
      if(filter.valueTo===undefined||filter.valueTo===null)throw new AppFault('FILTER_VALUE','请填写范围的上下限');
      params.push(bindCell(col,filter.value),bindCell(col,filter.valueTo));return `${id} ${filter.op==='between'?'BETWEEN':'NOT BETWEEN'} ? AND ?`;
    }
    if(['contains','not-contains','starts-with','ends-with','like','not-like'].includes(filter.op)) {
      if(typeof filter.value!=='string')throw new AppFault('FILTER_VALUE','文本匹配需要文本值');
      let pattern=filter.value;
      if(filter.op!=='like'&&filter.op!=='not-like'){
        pattern=pattern.replace(/[\\%_]/g,'\\$&');
        if(filter.op!=='starts-with')pattern='%'+pattern;
        if(filter.op!=='ends-with')pattern+='%';
      }
      params.push(pattern);return `${id} ${filter.op==='not-contains'||filter.op==='not-like'?'NOT LIKE':'LIKE'} ? ESCAPE '\\\\'`;
    }
    params.push(bindCell(col,filter.value));const operators:Record<string,string>={eq:'=',ne:'<>',gt:'>',gte:'>=',lt:'<',lte:'<='};return `${id} ${operators[filter.op]} ?`;
  });
  const sort=request.sort.map(item=>{column(item.column);return item;});
  const ordered=[...sort,...meta.primaryKey.filter(key=>!sort.some(s=>s.column===key)).map(column=>({column,direction:'asc' as const}))];
  let sql=`SELECT ${meta.columns.map(col=>mysql.escapeId(col.name,true)).join(', ')} FROM ${mysql.escapeId(meta.schema,true)}.${mysql.escapeId(meta.name,true)}`;
  if(where.length)sql+=` WHERE ${where.join(request.filterMatch==='any'?' OR ':' AND ')}`;
  if(ordered.length)sql+=` ORDER BY ${ordered.map(item=>`${mysql.escapeId(item.column,true)} ${item.direction.toUpperCase()}`).join(', ')}`;
  if(scope==='page'){sql+=' LIMIT ? OFFSET ?';params.push(request.pageSize+1,(request.page-1)*request.pageSize);}
  return {sql,params};
}
export async function browse(adapter:MysqlAdapter,request:BrowseRequest):Promise<{meta:TableMeta;rows:DataRow[];hasNext:boolean;querySql:string}> {
  const meta=await adapter.describeTable(request.target);const compiled=compileTableQuery(meta,request,'page');
  const rows=await adapter.withConnection(request.target.connectionId,request.target.schema,async conn=>{
    const [rows]=await conn.query<RowDataPacket[]>({sql:compiled.sql,timeout:60_000,typeCast:textTypeCast},compiled.params);return rows;
  });
  return {meta,querySql:mysql.format(compiled.sql,compiled.params),hasNext:rows.length>request.pageSize,rows:rows.slice(0,request.pageSize).map(row=>Object.fromEntries(meta.columns.map(col=>[col.name,decodeCell(col,row[col.name])])))};
}
