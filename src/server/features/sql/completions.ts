import type {RowDataPacket} from 'mysql2/promise';
import type {MysqlAdapter} from '../../mysql/adapter.js';
import type {SqlCompletions} from './types.js';

// A bounded metadata read per refresh; no table values or typed SQL are read.
const maxColumns=5000;
export async function loadSqlCompletions(adapter:MysqlAdapter,connectionId:string,database:string):Promise<SqlCompletions> {
 return adapter.withConnection(connectionId,undefined,async conn=>{
  const [rows]=await conn.execute<RowDataPacket[]>({sql:'SELECT TABLE_NAME,COLUMN_NAME FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME,ORDINAL_POSITION LIMIT 5001',timeout:10000},[database]);
  const tables=new Map<string,string[]>();
  for(const row of rows.slice(0,maxColumns)) {
   const name=String(row.TABLE_NAME);let columns=tables.get(name);
   if(!columns){columns=[];tables.set(name,columns);}columns.push(String(row.COLUMN_NAME));
  }
  return {tables:Array.from(tables,([name,columns])=>({name,columns})),truncated:rows.length>maxColumns};
 });
}
