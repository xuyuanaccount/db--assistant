import {expect,test as baseTest,vi} from 'vitest';
const test=baseTest.skipIf(!process.env.MWA_TEST_PASSWORD);
import {fixture} from '../mysql/fixture.js';
import {field} from '../helpers/structure.js';
test('executes once, rejects stale previews, rechecks row conditions and logs the real SQL',async()=>{
 const f=await fixture();try{
 const target={connectionId:f.profile.id,schema:f.schema,table:'structure_new'};
 const preview=await f.request('/api/structure/preview',{action:{kind:'create_table',target,columns:[field('value')],primaryKey:[],comment:'test'}});expect(preview.statusCode,preview.body).toBe(200);
 const results=await Promise.all([f.request('/api/structure/apply',{previewId:preview.json().previewId}),f.request('/api/structure/apply',{previewId:preview.json().previewId})]);expect(results.filter(r=>r.statusCode===200)).toHaveLength(1);
 const done=results.find(r=>r.statusCode===200)!.json();expect(f.app.services.operations.get(done.operationId)).toMatchObject({type:'schema_change',status:'completed',sql:preview.json().sql});
 const describe=async()=>(await f.request('/api/structure/describe',target)).json();
 const make=async(action:any)=>{const r=await f.request('/api/structure/preview',{action:{target,...action},expectedFingerprint:(await describe()).fingerprint});expect(r.statusCode,r.body).toBe(200);return r.json();};
 const add=await make({kind:'add_column',definition:{...field('required'),type:{kind:'INT'},nullable:false,default:{kind:'none'}}});await f.admin.query("INSERT INTO structure_new(value) VALUES('one')");
 const blocked=await f.request('/api/structure/apply',{previewId:add.previewId});expect(blocked.statusCode).toBe(400);expect((await describe()).columns.map((c:any)=>c.name)).not.toContain('required');
 const stale=await make({kind:'rename_column',column:'value',newName:'renamed'});await f.admin.query('ALTER TABLE structure_new ADD extra INT');expect((await f.request('/api/structure/apply',{previewId:stale.previewId})).json().error.code).toBe('STRUCTURE_CHANGED');
 const noLog=await make({kind:'rename_column',column:'value',newName:'renamed'});const begin=vi.spyOn(f.app.services.operations,'begin').mockImplementation(()=>{throw new Error('disk');});expect((await f.request('/api/structure/apply',{previewId:noLog.previewId})).statusCode).toBe(500);begin.mockRestore();expect((await describe()).columns[0].name).toBe('value');
 const renamed=await f.request('/api/structure/apply',{previewId:noLog.previewId});expect(renamed.statusCode,renamed.body).toBe(200);
 const reconnect=await make({kind:'add_index',name:'ix',unique:false,columns:[{name:'renamed',prefixLength:5}]});await f.app.services.connections.disconnect(f.profile.id);await f.app.services.connections.connect(f.profile.id,process.env.MWA_TEST_PASSWORD!);expect((await f.request('/api/structure/apply',{previewId:reconnect.previewId})).json().error.code).toBe('CONNECTION_CHANGED');
 }finally{await f.cleanup();}
});
