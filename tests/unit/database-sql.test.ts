import {expect,it,vi} from 'vitest';
import {sqliteFixture} from '../sqlite/fixture.js';
it('unsupported SQL is rejected before dispatch and operation begin failure prevents writes',async()=>{
 const f=await sqliteFixture();try{
 const request=(sql:string)=>f.request<any>('/api/sql/execute',{connectionId:f.profile.id,database:'main',sql},'POST');
 expect((await request('ATTACH DATABASE \'x\' AS extra')).statusCode).toBe(400);
 vi.spyOn(f.app.services.operations,'begin').mockImplementationOnce(()=>{throw Error('local store unavailable');});
 expect((await request("INSERT INTO records(value) VALUES('never')")).statusCode).toBe(500);expect((await f.query('SELECT count(*) FROM records'))[0].values[0]).toBe('0');
 }finally{await f.cleanup();}
});
it('log confirmation failure after commit reports unknown while preserving actual data',async()=>{
 const f=await sqliteFixture();try{
 vi.spyOn(f.app.services.operations,'finish').mockImplementationOnce(()=>{throw Error('confirmation failed');});
 const result=await f.request<any>('/api/sql/execute',{connectionId:f.profile.id,database:'main',sql:"INSERT INTO records(value) VALUES('committed')"},'POST');
 expect(result.statusCode).toBe(409);expect(result.body.error.code).toBe('RESULT_UNKNOWN');expect((await f.query('SELECT value FROM records'))[0].values[0]).toBe('committed');expect(f.app.services.operations.get(result.body.error.operationId).status).toBe('needs_review');
 }finally{await f.cleanup();}
});
it('a lost commit acknowledgement remains unknown even when SQLite committed',async()=>{
 const f=await sqliteFixture();try{
 const adapter=f.app.services.databases.get(f.profile.id),open=adapter.openSession.bind(adapter);
 vi.spyOn(adapter,'openSession').mockImplementationOnce(async(...args)=>{const session=await open(...args);return new Proxy(session,{get(target,key){if(key==='commit')return async()=>{await target.commit();throw Error('acknowledgement lost');};const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}});});
 const result=await f.request<any>('/api/sql/execute',{connectionId:f.profile.id,database:'main',sql:"INSERT INTO records(value) VALUES('committed')"},'POST');
 expect(result.statusCode).toBe(409);expect(result.body.error).toMatchObject({code:'RESULT_UNKNOWN',databaseKind:'sqlite'});expect((await f.query('SELECT count(*) FROM records'))[0].values[0]).toBe('1');expect(f.app.services.operations.get(result.body.error.operationId).status).toBe('needs_review');
 }finally{await f.cleanup();}
});
