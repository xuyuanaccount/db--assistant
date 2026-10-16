import {AppFault,type DataRow} from '../../shared/contracts.js';
import type {BoundValue} from '../../shared/database.js';
import type {DbSession} from './contracts.js';
export async function databaseRows(session:DbSession,sql:string,params:BoundValue[]=[]):Promise<DataRow[]>{const cursor=await session.openStatement({sql,params});const rows:DataRow[]=[];try{for(;;){const chunk=await cursor.read(100,1024*1024);if(chunk.omittedRows)throw new AppFault('RESULT_TOO_LARGE','元数据单行超出预算');for(const row of chunk.rows)rows.push(Object.fromEntries(cursor.columns.map((c,i)=>[c.name,row.values[i]])));if(chunk.done)return rows;}}finally{await cursor.close();}}
