import {expect,it,vi} from 'vitest';
import {sqliteFixture} from '../sqlite/fixture.js';
async function exported(f:Awaited<ReturnType<typeof sqliteFixture>>,format:string){const r=await f.request<any>('/api/transfers/export/start',{request:{target:f.target('records'),page:1,pageSize:100,filters:[],sort:[]},scope:'all',format},'POST');expect(r.statusCode).toBe(202);await f.app.services.queue.idle();return f.app.services.queue.store.get(r.body.id);}
it('DDL committed during a WAL snapshot prevents publishing the file',async()=>{
 const f=await sqliteFixture();try{await f.exec('PRAGMA journal_mode=WAL');await f.exec("INSERT INTO records(value) VALUES('before')");const adapter=f.app.services.databases.get(f.profile.id),describe=adapter.describeTable.bind(adapter);let calls=0;
 vi.spyOn(adapter,'describeTable').mockImplementation(async(...args)=>{if(++calls===3)await f.exec('ALTER TABLE records ADD COLUMN extra TEXT');return describe(...args);});
 const task=await exported(f,'csv');expect(task.state).toBe('failed');expect(task.error?.code).toBe('SCHEMA_CHANGED');expect(task.outputFileId).toBeNull();expect((await f.request(`/api/transfers/tasks/${task.id}/download`,{},'POST')).statusCode).toBe(404);expect((await f.query('SELECT extra FROM records'))[0].values[0]).toBeNull();
 }finally{await f.cleanup();}
});
it('unsafe SQL literal and oversized XLSX cell leave no downloadable partial file',async()=>{
 const f=await sqliteFixture();try{await f.exec('INSERT INTO records(value) VALUES(char(0))');let task=await exported(f,'sql');expect(task.state).toBe('failed');expect(task.error?.code).toBe('EXPORT_TYPE');expect((await f.request(`/api/transfers/tasks/${task.id}/download`,{},'POST')).statusCode).toBe(404);
 await f.exec('UPDATE records SET value=?',[{value:'x'.repeat(32768),kind:'text'}]);task=await exported(f,'xlsx');expect(task.state).toBe('failed');expect(task.error?.code).toBe('XLSX_CELL_LIMIT');expect(task.outputFileId).toBeNull();
 }finally{await f.cleanup();}
});
