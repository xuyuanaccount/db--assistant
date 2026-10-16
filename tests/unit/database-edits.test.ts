import {expect,it} from 'vitest';
import {runTransaction} from '../../src/server/database/transaction.js';
import {sqliteFixture} from '../sqlite/fixture.js';
it('commit acknowledgement loss is unknown and rollback failure is never reported as confirmed',async()=>{
 const f=await sqliteFixture();const s=await f.app.services.databases.get(f.profile.id).openSession(f.profile.id,'main','edit');
 try{const commit=s.commit.bind(s);s.commit=async()=>{await commit();throw Error('lost ack');};await expect(runTransaction(s,'write',async()=>{await s.execute({sql:"INSERT INTO records(value) VALUES('committed')",params:[]});})).rejects.toMatchObject({code:'RESULT_UNKNOWN'});}finally{await s.close('discard');}
 expect((await f.query('SELECT count(*) FROM records'))[0].values[0]).toBe('1');
 const rollback=await f.app.services.databases.get(f.profile.id).openSession(f.profile.id,'main','edit');try{rollback.rollback=async()=>{throw Error('rollback ack lost');};await expect(runTransaction(rollback,'write',async()=>{throw Error('work failed');})).rejects.toMatchObject({code:'RESULT_UNKNOWN'});}finally{await rollback.close('discard');await f.cleanup();}
});
