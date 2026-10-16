import {expect,it} from 'vitest';
import {sqliteFixture} from '../sqlite/fixture.js';
it('the released application rejects deferred database types before saving configuration',async()=>{
 const f=await sqliteFixture();try{for(const draft of [{kind:'oracle',name:'Deferred',host:'localhost',port:1521,username:'none',tls:false,serviceName:'none'}]){const result=await f.request<any>('/api/connections',draft,'POST');expect(result.statusCode).toBe(409);expect(result.body.error.code).toBe('DRIVER_UNAVAILABLE');}const saved=await f.request<any>('/api/connections',{kind:'postgresql',name:'PostgreSQL',host:'localhost',port:5432,username:'none',tls:false,database:'postgres'},'POST');expect(saved.statusCode).toBe(201);expect(saved.body).not.toHaveProperty('password');expect(f.app.services.connections.list()).toHaveLength(2);}finally{await f.cleanup();}
});
