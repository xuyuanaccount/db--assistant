import { expect,test as baseTest } from 'vitest';
const test=baseTest.skipIf(!process.env.MWA_TEST_PASSWORD);

import { fixture } from '../mysql/fixture.js';
test('real MySQL connects, lists authorized objects and exposes faithful metadata',async()=>{
  const f=await fixture();try{
    console.log(`真实 MySQL 版本：${f.version}`);
    const schemas=await f.app.services.mysql.listSchemas(f.profile.id);expect(schemas).toContain(f.schema);
    const meta=await f.app.services.mysql.describeTable({connectionId:f.profile.id,schema:f.schema,table:'records'});
    expect(meta.primaryKey).toEqual(['tenant_id','id']);expect(meta.columns.find(c=>c.name==='derived_qty')?.generated).toBe(true);
    await f.app.services.connections.disconnect(f.profile.id);
    await expect(f.app.services.mysql.listSchemas(f.profile.id)).rejects.toMatchObject({code:'NOT_CONNECTED'});
  }finally{await f.cleanup();}
});
