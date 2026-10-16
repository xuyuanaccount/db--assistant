import mysql,{type RowDataPacket,type ResultSetHeader} from 'mysql2/promise';
import {AppFault,errorInfo,type DataRow,type TableMeta,type TableTarget} from '../../../shared/contracts.js';
import {bindCell,binaryTypes,decodeCell,textTypeCast,unsupportedTypes} from '../../mysql/values.js';
import type {MysqlAdapter} from '../../mysql/adapter.js';
import type {OperationStore} from '../../local/operations.js';
import type {RowChange} from './types.js';
export function validateChanges(meta:TableMeta,changes:RowChange[]) {
 if(meta.kind!=='table'||meta.engine?.toLowerCase()!=='innodb'||!meta.primaryKey.length)throw new AppFault('READ_ONLY_TABLE','表格编辑需要带主键的 InnoDB 普通表');
 for(const change of changes) {
  if(change.kind!=='insert'&&meta.columns.some(col=>!Object.hasOwn(change.original,col.name)))throw new AppFault('INVALID_SNAPSHOT','原始记录不完整，请刷新');
  if(change.kind!=='delete')for(const [name,value]of Object.entries(change.values)) {
   const column=meta.columns.find(c=>c.name===name);if(!column)throw new AppFault('UNKNOWN_COLUMN',`字段不存在：${name}`);
   if(column.generated||column.dataType==='json'||binaryTypes.has(column.dataType)||unsupportedTypes.has(column.dataType))throw new AppFault('READ_ONLY_COLUMN',`${name} 暂不支持表格编辑`);
   bindCell(column,value);
  }
 }
}
export async function applyEdits(adapter:MysqlAdapter,operations:OperationStore,target:TableTarget,changes:RowChange[]) {
 const meta=await adapter.describeTable(target);validateChanges(meta,changes);
 const table=`${mysql.escapeId(target.schema)}.${mysql.escapeId(target.table)}`;
 const operationId=operations.begin({type:'data_edit',connectionId:target.connectionId,connectionName:adapter.connections.store.get(target.connectionId).name,schema:target.schema,table:target.table,sql:'事务数据编辑（参数化 INSERT / UPDATE / DELETE）'});
 const started=Date.now();let committing=false;let committed=false;let affectedRows=0;
 try {
  await adapter.withConnection(target.connectionId,target.schema,async conn=>{
   await conn.beginTransaction();
   try {
    for(const change of changes) {
     let condition='';let keyValues:(string|Buffer|null)[]=[];
     if(change.kind!=='insert') {
      condition=meta.primaryKey.map(key=>`${mysql.escapeId(key)} <=> ?`).join(' AND ');
      keyValues=meta.primaryKey.map(key=>bindCell(meta.columns.find(c=>c.name===key)!,change.original[key]));
      const [rows]=await conn.query<RowDataPacket[]>({sql:`SELECT * FROM ${table} WHERE ${condition} FOR UPDATE`,typeCast:textTypeCast},keyValues);
      if(rows.length!==1||meta.columns.some(col=>JSON.stringify(decodeCell(col,rows[0][col.name]))!==JSON.stringify(change.original[col.name])))throw new AppFault('ROW_CONFLICT','记录已被其他客户端修改或删除，请刷新后重新编辑',409,operationId);
     }
     let sql:string;let params:(string|Buffer|null)[];
     if(change.kind==='delete'){sql=`DELETE FROM ${table} WHERE ${condition}`;params=keyValues;}
     else {
      const names=Object.keys(change.values);const values=names.map(name=>bindCell(meta.columns.find(c=>c.name===name)!,change.values[name]));
      if(change.kind==='insert'){sql=names.length?`INSERT INTO ${table} (${names.map(name=>mysql.escapeId(name)).join(',')}) VALUES (${names.map(()=>'?').join(',')})`:`INSERT INTO ${table} () VALUES ()`;params=values;}
      else {if(!names.length)continue;sql=`UPDATE ${table} SET ${names.map(name=>`${mysql.escapeId(name)}=?`).join(',')} WHERE ${condition}`;params=[...values,...keyValues];}
     }
     const [result]=await conn.execute<ResultSetHeader>(sql,params);if(result.warningStatus)throw new AppFault('MYSQL_WARNING','MySQL 返回数据转换警告，本次修改已回滚');affectedRows+=result.affectedRows;
    }
    committing=true;await conn.commit();committed=true;
   } catch(error) {if(!committing)try{await conn.rollback();}catch{conn.destroy();throw new AppFault('RESULT_UNKNOWN','连接中断，回滚结果待核对，连接已关闭',409,operationId);}else if(!committed)conn.destroy();throw error;}
  });
  operations.finish(operationId,{status:'completed',durationMs:Date.now()-started,affectedRows});
  return {operationId,affectedRows};
 } catch(error) {
  const unknown=committing||(error as {code?:string}).code==='RESULT_UNKNOWN';const info=unknown?{code:'RESULT_UNKNOWN',message:'提交或回滚结果待核对，请检查数据和操作记录，勿直接重试',operationId}:errorInfo(error);
  try{operations.finish(operationId,{status:unknown?'needs_review':'failed',durationMs:Date.now()-started,error:info});}catch{}
  if(unknown)throw new AppFault(info.code,info.message,409,operationId);
  if(error instanceof AppFault){error.operationId=operationId;throw error;}
  throw Object.assign(error as Error,{operationId});
 }
}
