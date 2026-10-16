import{expect,test as baseTest}from'vitest';
const test=baseTest.skipIf(!process.env.MWA_TEST_PASSWORD);
import{fixture}from'../mysql/fixture.js';import{readSource}from'../../src/server/features/transfers/import/codec.js';import{readFileSync}from'node:fs';
test('CSV/XLSX exports retain raw types and SQL INSERT restores binary and generated values',async()=>{const f=await fixture();try{const target={connectionId:f.profile.id,schema:f.schema,table:'records'};const request={target,page:1,pageSize:100,filters:[],sort:[]};const baseline=(await f.request('/api/data/browse',request)).json();let sql='';for(const format of ['csv','xlsx','sql']){const started=await f.request('/api/transfers/export/start',{request,scope:'all',format});expect(started.statusCode).toBe(202);await f.app.services.queue.idle();const task=f.app.services.queue.store.get(started.json().id);expect(task.state,task.error?.message).toBe('completed');expect(task.exportedRows).toBe(1);const file=f.app.services.files.get(task.outputFileId!);if(format==='sql'){sql=readFileSync(file.path,'utf8');expect(sql).not.toContain('`derived_qty`');}else{const rows=[];for await(const row of readSource(file.path,{format:format as 'csv'|'xlsx',hasHeader:true,toolEscaping:true,emptyCells:'null'}))rows.push(row);expect(rows[1].cells[1]).toBe('18446744073709551615');expect(rows[1].cells[2]).toBe('123456789012345678901234567890.12345678');expect(rows[1].cells[10]).toBe('0x00ff5c27');}}
 await f.admin.query('DELETE FROM records');for(const statement of sql.split(';').map(s=>s.trim()).filter(Boolean))await f.admin.query(statement);const restored=(await f.request('/api/data/browse',request)).json();expect(restored.rows).toEqual(baseline.rows);
}finally{await f.cleanup();}});

test('page exports keep loaded values while filtered and all exports read their explicit scopes',async()=>{
 const f=await fixture();try{
  await f.admin.query("INSERT INTO import_rows(id,required_text) VALUES(1,'one'),(2,'two'),(3,'three')");
  const target={connectionId:f.profile.id,schema:f.schema,table:'import_rows'};
  const request={target,page:1,pageSize:100,filters:[{column:'id',op:'gte',value:'2'}],sort:[{column:'id',direction:'desc'}]};
  const rows=[{id:'2',required_text:'two',qty:'7'}];
  await f.admin.query("UPDATE import_rows SET required_text='changed' WHERE id=2");
  for(const [scope,expected] of [['page',[['2','two','7']]],['filtered',[['3','three','7'],['2','changed','7']]],['all',[['3','three','7'],['2','changed','7'],['1','one','7']]]] as const){
   const response=await f.request('/api/transfers/export/start',{request,scope,format:'csv',...(scope==='page'?{rows}:{})});
   expect(response.statusCode).toBe(202);await f.app.services.queue.idle();
   const task=f.app.services.queue.store.get(response.json().id);expect(task.state,task.error?.message).toBe('completed');
   const actual=[];for await(const row of readSource(f.app.services.files.get(task.outputFileId!).path,{format:'csv',hasHeader:true,toolEscaping:true,emptyCells:'null'}))actual.push(row.cells);
   expect(actual.slice(1)).toEqual(expected);
  }
 }finally{await f.cleanup();}
});
