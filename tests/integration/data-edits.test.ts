import {expect,test as baseTest,vi} from 'vitest';
const test=baseTest.skipIf(!process.env.MWA_TEST_PASSWORD);

import {fixture} from '../mysql/fixture.js';
test('edits lock composite keys, detect stale rows and rollback all changes',async()=>{
 const f=await fixture();try{
 const target={connectionId:f.profile.id,schema:f.schema,table:'records'};
 const original=(await f.request('/api/data/browse',{target,page:1,pageSize:100,filters:[],sort:[]})).json().rows[0];
 await f.admin.query('UPDATE records SET qty=8');
 const conflict=await f.request('/api/data/edits',{target,changes:[{kind:'insert',values:{tenant_id:'2',id:'1'}},{kind:'update',original,values:{qty:'9'}}]});
 expect(conflict.statusCode).toBe(409);expect(conflict.json().error.code).toBe('ROW_CONFLICT');
 const [rows]=await f.admin.query('SELECT * FROM records WHERE tenant_id=2');expect(rows).toHaveLength(0);
 const next=(await f.request('/api/data/browse',{target,page:1,pageSize:100,filters:[],sort:[]})).json().rows[0];
 expect((await f.request('/api/data/edits',{target,changes:[{kind:'update',original:next,values:{tenant_id:'3',qty:'10'}}]})).statusCode).toBe(200);
 const [updated]=await f.admin.query('SELECT tenant_id,qty FROM records');expect(updated).toMatchObject([{tenant_id:3,qty:10}]);
 const begin=vi.spyOn(f.app.services.operations,'begin').mockImplementation(()=>{throw new Error('storage unavailable');});
 const blocked=await f.request('/api/data/edits',{target,changes:[{kind:'insert',values:{tenant_id:'9',id:'1'}}]});expect(blocked.statusCode).toBe(500);begin.mockRestore();
 const [absent]=await f.admin.query('SELECT * FROM records WHERE tenant_id=9');expect(absent).toHaveLength(0);
 }finally{await f.cleanup();}
});
