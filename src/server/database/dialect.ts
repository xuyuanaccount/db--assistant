import type {DataRow,DbCell,TableTarget} from '../../shared/contracts.js';
import type {CompiledStatement,NormalizedRow,NormalizedTableMeta,ValueKind} from '../../shared/database.js';
import type {BrowseRequest} from '../features/data/types.js';
import {AppFault} from '../../shared/contracts.js';
import type {DatabaseKind,BoundValue,NormalizedColumnMeta} from '../../shared/database.js';
import {LIMITS} from '../../shared/limits.js';
import {lexSql} from './statements.js';
import {temporalSqlLiteral} from './literals.js';
export interface SqlDialect {
 quoteIdentifier(name:string):string;qualifiedTable(target:TableTarget):string;placeholder(index:number):string;
 compileBrowse(meta:NormalizedTableMeta,input:BrowseRequest,scope:'page'|'filtered'|'all'):CompiledStatement;
 compileInsert(meta:NormalizedTableMeta,values:DataRow,kinds?:Record<string,ValueKind>,mode?:'edit'|'import'|'restore'):CompiledStatement;
 compileUpdate(meta:NormalizedTableMeta,values:DataRow,original:DataRow,kinds?:Record<string,ValueKind>,originalKinds?:Record<string,ValueKind>):CompiledStatement;
 compileDelete(meta:NormalizedTableMeta,original:DataRow,kinds?:Record<string,ValueKind>):CompiledStatement;
 compileLockRow(meta:NormalizedTableMeta,original:DataRow,kinds?:Record<string,ValueKind>):CompiledStatement;
 render(command:CompiledStatement):{sql:string|null;template:string;parameters:DbCell[];reason?:string};
 exportPreamble(meta:NormalizedTableMeta):string;exportInsert(meta:NormalizedTableMeta,row:NormalizedRow):string;
}

type NewKind=Exclude<DatabaseKind,'mysql'>;
const fail=(code:string,message:string):never=>{throw new AppFault(code,message);};
export interface SqlDialectOptions {oracleIdentifierBytes?:30|128}
function validName(kind:NewKind,name:string,options:SqlDialectOptions):string {
 const bytes=Buffer.byteLength(name,'utf8');const max=kind==='postgresql'?63:kind==='oracle'?options.oracleIdentifierBytes??30:512;
 if(!name||[...name].length>128||bytes>max||name.includes('\0'))fail('INVALID_IDENTIFIER','标识符超出数据库限制或包含 NUL');
 return `"${name.replaceAll('"','""')}"`;
}
function numeric(kind:string,value:string){const pattern=kind==='integer'?/^[+-]?\d+$/:kind==='decimal'?/^[+-]?\d+(?:\.\d+)?$/:/^[+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?$/i;return pattern.test(value)&&(kind!=='real'||Number.isFinite(Number(value)));}
function bind(column:NormalizedColumnMeta,value:DbCell,kind:NewKind,override?:ValueKind):BoundValue {
 const valueKind=value===null?'null':override||column.valueKind;
 if(value===null&&!column.nullable)fail('INVALID_VALUE',`${column.name} 不允许 NULL`);
 if(kind==='oracle'&&value===''&&!column.nullable)fail('INVALID_VALUE',`${column.name} 在 Oracle 中空字符串等同 NULL`);
 if(value!==null&&typeof value==='object'){
  if(valueKind!=='binary'||!/^([a-f\d]{2})*$/i.test(value.binaryHex))fail('INVALID_VALUE',`${column.name} 的二进制值无效`);
 }else if(value!==null){
  if(valueKind==='binary'||['integer','decimal','real'].includes(valueKind)&&!numeric(valueKind,value))fail('INVALID_VALUE',`${column.name} 的数值无效`);
  if(kind==='sqlite'&&valueKind==='integer'&&(BigInt(value)<-(1n<<63n)||BigInt(value)>(1n<<63n)-1n))fail('INVALID_VALUE',`${column.name} 超出 SQLite 64 位整数范围`);
 }
 return {value,kind:valueKind,column};
}
function literal(kind:NewKind,param:BoundValue):string {
 const {value}=param;if(value===null)return 'NULL';
 if(typeof value==='object'){
  const hex=value.binaryHex;if(!/^([a-f\d]{2})*$/i.test(hex))fail('INVALID_VALUE','二进制值无效');
  if(kind==='oracle'&&hex.length/2>1000)fail('UNRENDERABLE_SQL','Oracle 二进制值超过 SQL 字面量限制');
  return kind==='postgresql'?`decode('${hex}','hex')`:kind==='oracle'?`HEXTORAW('${hex}')`:`X'${hex}'`;
 }
 if(['integer','decimal','real'].includes(param.kind)){if(!numeric(param.kind,value))fail('INVALID_VALUE','数值文本无效');return kind==='sqlite'&&param.kind==='real'&&/^[+-]?\d+$/.test(value)?`${value}.0`:value;}
 if(value.includes('\0'))fail('UNRENDERABLE_SQL','NUL 无法可靠地渲染为 SQL 字面量');
 if(kind==='oracle'&&Buffer.byteLength(value,'utf8')>2000)fail('UNRENDERABLE_SQL','Oracle 字符值超过 SQL 字面量限制');
 if(param.kind==='temporal')return temporalSqlLiteral(kind,param);
 if(kind==='postgresql'&&value.includes('\\'))return `E'${value.replaceAll('\\','\\\\').replaceAll("'","''")}'`;
 return `'${value.replaceAll("'","''")}'`;
}
function renderSql(kind:NewKind,command:CompiledStatement):{sql:string|null;template:string;parameters:DbCell[];reason?:string}{
 const parameters=command.params.map(p=>p.value),fallback=(reason:string)=>({sql:null,template:command.sql,parameters,reason});
 try{
  const {mask}=lexSql(kind,command.sql);let sql='',last=0,count=0;const used=new Set<number>();
  const re=kind==='postgresql'?/\$([1-9]\d*)/g:kind==='oracle'?/:p([1-9]\d*)/gi:/\?/g;
  for(const match of command.sql.matchAll(re)){
   const at=match.index;if(!mask[at])continue;
   const index=kind==='sqlite'?count++:Number(match[1])-1;
   if(index<0||index>=command.params.length)return fallback('占位符与参数数量不匹配');
   used.add(index);
   sql+=command.sql.slice(last,at)+literal(kind,command.params[index]);last=at+match[0].length;
  }
  sql+=command.sql.slice(last);
  if(used.size!==command.params.length||kind==='sqlite'&&count!==command.params.length)return fallback('占位符与参数数量不匹配');
  if(Buffer.byteLength(sql,'utf8')>LIMITS.sqlBytes)return fallback('可复制 SQL 超过 256 KiB');
  return {sql,template:command.sql,parameters};
 }catch(error){return fallback(error instanceof Error?error.message:'值无法可靠渲染');}
}
export function createSqlDialect(kind:NewKind,options:SqlDialectOptions={}):SqlDialect {
 const q=(name:string)=>validName(kind,name,options),p=(index:number)=>kind==='postgresql'?`$${index}`:kind==='oracle'?`:p${index}`:'?';
 const table=(target:TableTarget)=>`${q(target.schema)}.${q(target.table)}`;
 const col=(meta:NormalizedTableMeta,name:string)=>meta.columns.find(c=>c.name===name)||fail('UNKNOWN_COLUMN',`字段不存在：${name}`);
 const add=(params:BoundValue[],column:NormalizedColumnMeta,value:DbCell,override?:ValueKind)=>{params.push(bind(column,value,kind,override));return p(params.length);};
 const keyColumns=(meta:NormalizedTableMeta,original:DataRow)=>{if(!meta.primaryKey.length)fail('READ_ONLY_TABLE','更新和删除需要主键');return meta.primaryKey.map(name=>{if(!Object.hasOwn(original,name))fail('INVALID_SNAPSHOT','原始主键不完整');return col(meta,name);});};
 const compare=(column:NormalizedColumnMeta,placeholder:string)=>kind==='postgresql'?`${q(column.name)} IS NOT DISTINCT FROM ${placeholder}`:kind==='sqlite'?`${q(column.name)} IS ${placeholder}`:`(${q(column.name)} = ${placeholder} OR (${q(column.name)} IS NULL AND ${placeholder} IS NULL))`;
 const where=(meta:NormalizedTableMeta,original:DataRow,params:BoundValue[],full:boolean,kinds?:Record<string,ValueKind>)=>{
  const keys=keyColumns(meta,original);const columns=full?meta.columns:keys;
  if(full&&columns.some(c=>!c.comparable))fail('READ_ONLY_TABLE','存在无法比较的字段');
  return columns.map(c=>{if(!Object.hasOwn(original,c.name))fail('INVALID_SNAPSHOT',`原始字段不完整：${c.name}`);return compare(c,add(params,c,original[c.name],kinds?.[c.name]));}).join(' AND ');
 };
 return {
  quoteIdentifier:q,qualifiedTable:table,placeholder:p,
  compileBrowse:(meta,input,scope)=>{
   if(input.target.schema!==meta.schema||input.target.table!==meta.name)fail('INVALID_TARGET','目标表与元数据不一致');
   const params:BoundValue[]=[];const conditions=scope==='all'?[]:input.filters.map(f=>{
    const column=col(meta,f.column),id=q(column.name);
    if(f.op==='is-null'||f.op==='is-not-null')return `${id} IS ${f.op==='is-not-null'?'NOT ':''}NULL`;
    if(f.op==='is-empty'||f.op==='is-not-empty'){
     if(kind==='oracle')fail('FILTER_VALUE','Oracle 空字符串视为 NULL');
     if(!['text','json'].includes(column.valueKind))fail('FILTER_VALUE','空字符串条件需要文本字段');
     return `${id} ${f.op==='is-empty'?'=':'<>'} ''`;
    }
    if(f.op==='in'||f.op==='not-in'){
     if(!f.values?.length||f.values.some(v=>v===null))fail('FILTER_VALUE','列表需要非 NULL 值');
     return `${id} ${f.op==='in'?'IN':'NOT IN'} (${f.values!.map(v=>add(params,column,v)).join(', ')})`;
    }
    if(f.value===undefined||f.value===null)fail('FILTER_VALUE','筛选值缺失或需要 NULL 条件');
    if(f.op==='between'||f.op==='not-between'){
     if(f.valueTo===undefined||f.valueTo===null)fail('FILTER_VALUE','范围上限缺失');
     return `${id} ${f.op==='between'?'BETWEEN':'NOT BETWEEN'} ${add(params,column,f.value as DbCell)} AND ${add(params,column,f.valueTo as DbCell)}`;
    }
    if(['contains','not-contains','starts-with','ends-with','like','not-like'].includes(f.op)){
     if(typeof f.value!=='string'||!['text','json'].includes(column.valueKind))fail('FILTER_VALUE','文本匹配需要文本值');
     let pattern=f.value as string;
     if(f.op!=='like'&&f.op!=='not-like'){
      pattern=pattern.replace(/[\\%_]/g,'\\$&');if(f.op!=='starts-with')pattern='%'+pattern;if(f.op!=='ends-with')pattern+='%';
     }
     const operator=f.op==='not-contains'||f.op==='not-like'?'NOT LIKE':'LIKE';
     return `${id} ${operator} ${add(params,column,pattern,'text')} ESCAPE '\\'`;
    }
    const op=({eq:'=',ne:'<>',gt:'>',gte:'>=',lt:'<',lte:'<='} as Record<string,string>)[f.op];
    if(!op)fail('FILTER_VALUE','不支持的筛选运算符');
    return `${id} ${op} ${add(params,column,f.value as DbCell)}`;
   });
   const ordered=[...input.sort,...meta.primaryKey.filter(key=>!input.sort.some(item=>item.column===key)).map(column=>({column,direction:'asc' as const}))];
   let sql=`SELECT ${meta.columns.map(c=>q(c.name)).join(', ')} FROM ${table({connectionId:input.target.connectionId,schema:meta.schema,table:meta.name})}`;
   if(conditions.length)sql+=` WHERE ${conditions.join(input.filterMatch==='any'?' OR ':' AND ')}`;
   if(ordered.length)sql+=` ORDER BY ${ordered.map(item=>`${q(col(meta,item.column).name)} ${item.direction==='desc'?'DESC':'ASC'}`).join(', ')}`;
   if(scope==='page'){
    const count=String(input.pageSize+1),offset=String((input.page-1)*input.pageSize);
    if(!Number.isSafeInteger(Number(offset))||input.page<1||![100,200,500].includes(input.pageSize))fail('INVALID_PAGE','分页参数无效');
    const limitParam=add(params,{...meta.columns[0],name:'limit',nullable:false,valueKind:'integer'},count,'integer');
    const offsetParam=add(params,{...meta.columns[0],name:'offset',nullable:false,valueKind:'integer'},offset,'integer');
    sql+=kind==='oracle'?` OFFSET ${offsetParam} ROWS FETCH NEXT ${limitParam} ROWS ONLY`:` LIMIT ${limitParam} OFFSET ${offsetParam}`;
    params[params.length-2]={value:count,kind:'integer'};params[params.length-1]={value:offset,kind:'integer'};
   }
   return {sql,params};
  },
  compileInsert:(meta,values,kinds,mode='edit')=>{
   const names=Object.keys(values),params:BoundValue[]=[];
   if(!names.length){if(kind==='oracle')fail('EMPTY_INSERT','Oracle 新增行需要至少一个可填写字段');return {sql:`INSERT INTO ${table({connectionId:'',schema:meta.schema,table:meta.name})} DEFAULT VALUES`,params};}
   const restoringAlways=mode==='restore'&&kind==='postgresql'&&names.some(name=>col(meta,name).identity==='always');
   const placeholders=names.map(name=>{const c=col(meta,name);const identityRestore=restoringAlways&&c.identity==='always';if(c.generated||c.identity==='always'&&!identityRestore||(mode==='import'?c.importable:c.editable)&&!(mode==='import'?c.importable:c.editable).enabled&&!identityRestore)fail('READ_ONLY_COLUMN',`字段不可写入：${name}`);return add(params,c,values[name],kinds?.[name]);});
   return {sql:`INSERT INTO ${table({connectionId:'',schema:meta.schema,table:meta.name})} (${names.map(q).join(', ')})${restoringAlways?' OVERRIDING SYSTEM VALUE':''} VALUES (${placeholders.join(', ')})`,params};
  },
  compileUpdate:(meta,values,original,kinds,originalKinds)=>{
   const names=Object.keys(values),params:BoundValue[]=[];if(!names.length)fail('EMPTY_UPDATE','没有需要更新的字段');
   const set=names.map(name=>{const c=col(meta,name);if(c.generated||c.identity==='always'||c.editable&&!c.editable.enabled)fail('READ_ONLY_COLUMN',`字段不可写入：${name}`);return `${q(name)} = ${add(params,c,values[name],kinds?.[name])}`;});
   return {sql:`UPDATE ${table({connectionId:'',schema:meta.schema,table:meta.name})} SET ${set.join(', ')} WHERE ${where(meta,original,params,true,originalKinds??kinds)}`,params};
  },
  compileDelete:(meta,original,kinds)=>{const params:BoundValue[]=[];return {sql:`DELETE FROM ${table({connectionId:'',schema:meta.schema,table:meta.name})} WHERE ${where(meta,original,params,true,kinds)}`,params};},
  compileLockRow:(meta,original,kinds)=>{const params:BoundValue[]=[];const sql=`SELECT ${meta.columns.map(c=>q(c.name)).join(', ')} FROM ${table({connectionId:'',schema:meta.schema,table:meta.name})} WHERE ${where(meta,original,params,false,kinds)}`;return {sql:kind==='postgresql'?sql+' FOR UPDATE':kind==='oracle'?sql+' FOR UPDATE WAIT 10':sql,params};},
  render:command=>renderSql(kind,command),
  exportPreamble:()=>kind==='postgresql'?"SET TIME ZONE 'UTC';\n":kind==='oracle'?"ALTER SESSION SET TIME_ZONE = '+00:00';\n":'',
  exportInsert:(meta,row)=>{
   const columns=meta.columns.filter(c=>!c.generated);
   if(kind!=='postgresql'&&columns.some(c=>c.identity==='always'))fail('UNRENDERABLE_SQL','此数据库无法准确恢复 GENERATED ALWAYS identity');
   const params=columns.map(c=>{const index=meta.columns.indexOf(c);return bind(c,row.values[index],kind,row.valueKinds[index]);});
   if(!columns.length){if(kind==='oracle')fail('EMPTY_INSERT','Oracle 无法导出空字段 INSERT');return `INSERT INTO ${table({connectionId:'',schema:meta.schema,table:meta.name})} DEFAULT VALUES;\n`;}
   const values=params.map(param=>literal(kind,param));
   const override=kind==='postgresql'&&columns.some(c=>c.identity==='always')?' OVERRIDING SYSTEM VALUE':'';
   return `INSERT INTO ${table({connectionId:'',schema:meta.schema,table:meta.name})} (${columns.map(c=>q(c.name)).join(', ')})${override} VALUES (${values.join(', ')});\n`;
  },
 };
}
