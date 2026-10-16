import {afterEach,expect,test} from 'vitest';
import {mkdtempSync,readFileSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';
import {parse} from 'csv-parse/sync';import ExcelJS from 'exceljs';
import {buildApp,type AppInstance} from '../../src/server/app.js';
let app:AppInstance;let dir:string;
afterEach(async()=>{await app?.close();if(dir)rmSync(dir,{recursive:true,force:true});});
function setup(status:'completed'|'needs_review'='completed'){
 dir=mkdtempSync(join(tmpdir(),'mwa-query-export-'));app=buildApp({dataDir:dir,token:'t',port:3210});
 const operationId=app.services.operations.begin({type:'sql',connectionId:'original',connectionName:'原连接',schema:'原数据库',sql:'SELECT 1'});app.services.operations.finish(operationId,{status,durationMs:1});
 const payload={source:{operationId,connectionId:'original',connectionName:'原连接',database:'原数据库'},format:'csv',columns:[{name:'重复',dataType:'LONGLONG'},{name:'重复',dataType:'VAR_STRING'},{name:'',dataType:'VAR_STRING'},{name:'二进制',dataType:'BLOB'}],rows:[['18446744073709551615','中文😀\n多行',null,{binaryHex:'00ff'}],['12345678901234567890.12345678','',String.raw`\N`,{binaryHex:''}]],truncated:false,needsReview:false,acknowledgeIncomplete:false};
 return {operationId,payload,request:(body:Record<string,unknown>)=>app.inject({method:'POST',url:'/api/transfers/export/query/start',headers:{host:'127.0.0.1:3210','x-mwa-token':'t'},payload:body})};
}
test('exports the submitted matrix without a database connection and preserves duplicate headers',async()=>{
 const f=setup();const r=await f.request(f.payload);expect(r.statusCode,r.body).toBe(202);await app.services.queue.idle();
 const task=app.services.queue.store.get(r.json().id);expect(task.state,task.error?.message).toBe('completed');expect(task.exportedRows).toBe(2);expect(task.target).toEqual({connectionId:'original',schema:'原数据库',table:'查询结果'});
 const csv=parse(readFileSync(app.services.files.get(task.outputFileId!).path),{bom:true});
 expect(csv).toEqual([['重复','重复','','二进制'],['18446744073709551615','中文😀\n多行',String.raw`\N`,'0x00ff'],['12345678901234567890.12345678','',String.raw`\\N`,'0x']]);
 expect(app.services.operations.get(task.operationId)).toMatchObject({type:'export',sourceOperationId:f.operationId,status:'completed',connectionName:'原连接'});
 const stored=JSON.stringify(app.services.queue.store.get(task.id));expect(stored).not.toContain('18446744073709551615');
 const file=await app.inject({method:'POST',url:`/api/transfers/tasks/${task.id}/download`,headers:{host:'127.0.0.1:3210','content-type':'application/x-www-form-urlencoded'},payload:'token=t'});expect(file.statusCode).toBe(200);
});
test('writes XLSX cells as text with stable column order and an empty result still exports headers',async()=>{
 const f=setup();const r=await f.request({...f.payload,format:'xlsx'});expect(r.statusCode,r.body).toBe(202);await app.services.queue.idle();const task=app.services.queue.store.get(r.json().id);expect(task.state,task.error?.message).toBe('completed');
 const book=new ExcelJS.Workbook();await book.xlsx.readFile(app.services.files.get(task.outputFileId!).path);const sheet=book.worksheets[0];expect(sheet.getRow(1).values).toEqual([undefined,'重复','重复',String.raw`\E`,'二进制']);expect(sheet.getRow(2).getCell(1).value).toBe('18446744073709551615');expect(sheet.getRow(3).getCell(2).value).toBe(String.raw`\E`);
 const empty=await f.request({...f.payload,rows:[]});expect(empty.statusCode).toBe(202);await app.services.queue.idle();const emptyTask=app.services.queue.store.get(empty.json().id);expect(parse(readFileSync(app.services.files.get(emptyTask.outputFileId!).path),{bom:true})).toEqual([['重复','重复','','二进制']]);
});
test('requires explicit acknowledgement for incomplete source results even if client clears the flag',async()=>{
 const f=setup('needs_review');const rejected=await f.request(f.payload);expect(rejected.statusCode).toBe(400);expect(rejected.json().error.code).toBe('INCOMPLETE_RESULT');expect(app.services.queue.store.list()).toHaveLength(0);
 const accepted=await f.request({...f.payload,acknowledgeIncomplete:true});expect(accepted.statusCode).toBe(202);await app.services.queue.idle();const task=app.services.queue.store.get(accepted.json().id);expect(task.details.partial).toBe(true);expect(task.state).toBe('completed');expect(app.services.files.get(task.outputFileId!).name).toContain('partial');
});
test('rejects bad row widths, unsupported formats and invalid binary without creating a task',async()=>{
 const f=setup();for(const body of [{...f.payload,rows:[['one']]},{...f.payload,columns:[]},{...f.payload,format:'sql'},{...f.payload,rows:[[null,null,null,{binaryHex:'xyz'}]]},{...f.payload,source:{...f.payload.source,connectionId:'another'}}])expect((await f.request(body)).statusCode).toBe(400);
 expect(app.services.queue.store.list()).toHaveLength(0);
});
test('can still export an existing page snapshot after the original query log is cleared',async()=>{
 const f=setup();app.services.operations.clear();const r=await f.request(f.payload);expect(r.statusCode,r.body).toBe(202);await app.services.queue.idle();const task=app.services.queue.store.get(r.json().id);expect(task.state).toBe('completed');expect(task.details.sourceLogMissing).toBe(true);
});
test('releases cancelled queued snapshots so the four-result capacity can be reused',async()=>{
 const f=setup();let resume!:()=>void;const held=new Promise<void>(r=>{resume=r;});app.services.queue.register('import',async()=>held);app.services.queue.enqueue({direction:'import',format:'csv',target:{connectionId:'held',schema:'s',table:'t'},details:{}});
 try{await Promise.resolve();const ids:string[]=[];for(let i=0;i<4;i++){const r=await f.request(f.payload);expect(r.statusCode).toBe(202);ids.push(r.json().id);}const full=await f.request(f.payload);expect(full.statusCode).toBe(409);expect(full.json().error.code).toBe('QUERY_EXPORT_BUSY');const cancelled=await app.inject({method:'POST',url:`/api/transfers/tasks/${ids[0]}/cancel`,headers:{host:'127.0.0.1:3210','x-mwa-token':'t'}});expect(cancelled.statusCode).toBe(200);expect((await f.request(f.payload)).statusCode).toBe(202);
 }finally{resume();await app.services.queue.idle();}
});
test('rejects XLSX cells expanded beyond its text limit and leaves CSV available',async()=>{
 const f=setup();const rows=[['\\'.repeat(16384),'value',null,{binaryHex:'00'}]];
 const rejected=await f.request({...f.payload,format:'xlsx',rows});expect(rejected.statusCode).toBe(400);expect(rejected.json().error.code).toBe('XLSX_CELL_LIMIT');expect(app.services.queue.store.list()).toHaveLength(0);
 const csv=await f.request({...f.payload,format:'csv',rows});expect(csv.statusCode).toBe(202);await app.services.queue.idle();expect(app.services.queue.store.get(csv.json().id).state).toBe('completed');
});
