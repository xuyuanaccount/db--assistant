import {expect,test as baseTest} from 'vitest';
const test=baseTest.skipIf(!process.env.MWA_TEST_PASSWORD);

import {readFileSync} from 'node:fs';import {parse} from 'csv-parse/sync';import ExcelJS from 'exceljs';
import {fixture} from '../mysql/fixture.js';
test('exports the original SQL result after data changes and disconnect, without rerunning the query',async()=>{
 const f=await fixture();try{
 const query=await f.request('/api/sql/execute',{connectionId:f.profile.id,database:f.schema,sql:'SELECT id AS repeated,text_value AS repeated,amount,optional_text,binary_value,json_value,timestamp_value FROM records ORDER BY tenant_id'});expect(query.statusCode,query.body).toBe(200);const result=query.json();
 expect(result.columns.map((c:any)=>c.name)).toEqual(['repeated','repeated','amount','optional_text','binary_value','json_value','timestamp_value']);expect(result.rows[0][0]).toBe('18446744073709551615');
 await f.admin.query("UPDATE records SET amount=0,text_value='changed after query'");await f.app.services.connections.disconnect(f.profile.id);
 for(const format of ['csv','xlsx']){
 const r=await f.request('/api/transfers/export/query/start',{source:{operationId:result.operationId,connectionId:f.profile.id,connectionName:f.profile.name,database:f.schema},format,columns:result.columns,rows:result.rows,truncated:result.truncated,needsReview:!!result.needsReview,acknowledgeIncomplete:false});expect(r.statusCode,r.body).toBe(202);await f.app.services.queue.idle();const task=f.app.services.queue.store.get(r.json().id);expect(task.state,task.error?.message).toBe('completed');const path=f.app.services.files.get(task.outputFileId!).path;
 if(format==='csv'){const values=parse(readFileSync(path),{bom:true});expect(values[0]).toEqual(['repeated','repeated','amount','optional_text','binary_value','json_value','timestamp_value']);expect(values[1]).toEqual(['18446744073709551615','中文😀 "引号"\n换行\\\\N','123456789012345678901234567890.12345678','\\N','0x00ff5c27',result.rows[0][5],'2026-10-12 00:00:00.654321']);}
 else {const book=new ExcelJS.Workbook();await book.xlsx.readFile(path);const sheet=book.worksheets[0];expect(sheet.getRow(1).getCell(1).text).toBe('repeated');expect(sheet.getRow(1).getCell(2).text).toBe('repeated');expect(sheet.getRow(2).getCell(1).value).toBe('18446744073709551615');expect(sheet.getRow(2).getCell(3).value).toBe('123456789012345678901234567890.12345678');}
 expect(f.app.services.operations.get(task.operationId).sourceOperationId).toBe(result.operationId);
 const download=await f.request(`/api/transfers/tasks/${task.id}/download`,{},'POST');expect(download.statusCode).toBe(200);
 }
 expect(f.app.services.operations.list({page:1,type:'sql'}).items).toHaveLength(1);
 }finally{await f.cleanup();}
});
test('a real truncated query requires acknowledgement and stays visibly partial in the export task',async()=>{
 const f=await fixture();try{
 const q=await f.request('/api/sql/execute',{connectionId:f.profile.id,database:f.schema,maxRows:1000,sql:'WITH RECURSIVE seq AS (SELECT 0 AS n UNION ALL SELECT n+1 FROM seq WHERE n<100) SELECT a.n AS repeated,b.n AS repeated FROM seq a CROSS JOIN seq b LIMIT 1005'});expect(q.statusCode,q.body).toBe(200);const result=q.json();expect(result.rows).toHaveLength(1000);expect(result.truncated).toBe(true);
 const payload={source:{operationId:result.operationId,connectionId:f.profile.id,connectionName:f.profile.name,database:f.schema},columns:result.columns,rows:result.rows,truncated:true,needsReview:true,format:'csv',acknowledgeIncomplete:false};expect((await f.request('/api/transfers/export/query/start',payload)).statusCode).toBe(400);
 const accepted=await f.request('/api/transfers/export/query/start',{...payload,acknowledgeIncomplete:true});expect(accepted.statusCode,accepted.body).toBe(202);await f.app.services.queue.idle();const task=f.app.services.queue.store.get(accepted.json().id);expect(task.state,task.error?.message).toBe('completed');expect(task.details.partial).toBe(true);expect(parse(readFileSync(f.app.services.files.get(task.outputFileId!).path),{bom:true})).toHaveLength(1001);
 }finally{await f.cleanup();}
});
