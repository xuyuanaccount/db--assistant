import {expect,it,vi} from 'vitest';
import {setTimeout as realDelay} from 'node:timers/promises';
import {sqliteFixture} from '../sqlite/fixture.js';
import {normalizeSqliteRow} from '../../src/server/database/sqlite/values.js';
it('normalizes native Buffer and Uint8Array without stringifying objects',()=>{expect(normalizeSqliteRow([Buffer.from([0,255]),new Uint8Array([1,128])])).toEqual({values:[{binaryHex:'00ff'},{binaryHex:'0180'}],valueKinds:['binary','binary']});});
it('deadline terminates synchronous Worker without blocking health',async()=>{const f=await sqliteFixture();await f.app.ready();const s=await f.app.services.databases.get(f.profile.id).openSession(f.profile.id,'main','sql');try{vi.useFakeTimers({toFake:['setTimeout','clearTimeout']});const c=await s.openStatement({sql:'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n',params:[]});const p=c.read(100,10000);const rejected=expect(p).rejects.toMatchObject({code:'QUERY_TIMEOUT'});await realDelay(100);expect((await f.request('/api/health')).statusCode).toBe(200);await vi.advanceTimersByTimeAsync(60001);await rejected;}finally{vi.useRealTimers();await s.close('discard');await f.cleanup();}});

// Observe the real execution unit's exit state; no worker behavior is mocked.
it('app.close waits for an active write worker to exit',async()=>{
 const f=await sqliteFixture();const s=await f.app.services.databases.get(f.profile.id).openSession(f.profile.id,'main','edit');
 const worker=Reflect.get(s,'host') as import('node:child_process').ChildProcess;
 const {once}=await import('node:events');const exited=once(worker,'exit');
 try{await s.begin('write');await s.execute({sql:"INSERT INTO records(value) VALUES('uncommitted')",params:[]});await f.app.close();expect(worker.signalCode).toBe('SIGKILL');}finally{await exited;await s.close('discard');await f.cleanup();}
});
it('close after abort waits for the same active worker to exit',async()=>{
 const f=await sqliteFixture();const controller=new AbortController();const s=await f.app.services.databases.get(f.profile.id).openSession(f.profile.id,'main','edit',controller.signal);
 const worker=Reflect.get(s,'host') as import('node:child_process').ChildProcess;
 const {once}=await import('node:events');const exited=once(worker,'exit');
 try{await s.begin('write');await s.execute({sql:"INSERT INTO records(value) VALUES('aborted')",params:[]});controller.abort();await s.close('discard');expect(worker.signalCode).toBe('SIGKILL');}finally{await exited;await f.cleanup();}
});

it('an execution unit has a separate process and an unexpected exit rejects pending IPC requests',async()=>{
 const f=await sqliteFixture();const s=await f.app.services.databases.get(f.profile.id).openSession(f.profile.id,'main','sql');
 try{
  const host=Reflect.get(s,'host') as import('node:child_process').ChildProcess|undefined;
  expect(host?.pid).toBeTypeOf('number');expect(host!.pid).not.toBe(process.pid);
  const c=await s.openStatement({sql:'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n',params:[]});
  const read=expect(c.read(100,10000)).rejects.toMatchObject({code:'WORKER_EXITED'});
  const queued=expect(s.execute({sql:'SELECT 1',params:[]})).rejects.toMatchObject({code:'WORKER_EXITED'});
  await realDelay(100);host!.kill('SIGKILL');await Promise.all([read,queued]);await s.close('discard');expect(host!.signalCode).toBe('SIGKILL');
  const fresh=await f.app.services.databases.get(f.profile.id).openSession(f.profile.id,'main','browse');await fresh.close('reuse');
 }finally{await s.close('discard');await f.cleanup();}
});
it('IPC disconnect rejects pending work and close awaits the execution process exit',async()=>{
 const f=await sqliteFixture();const s=await f.app.services.databases.get(f.profile.id).openSession(f.profile.id,'main','sql');
 try{
  const host=Reflect.get(s,'host') as import('node:child_process').ChildProcess|undefined;expect(host?.pid).toBeTypeOf('number');
  const c=await s.openStatement({sql:'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1000000000) SELECT sum(x) FROM n',params:[]});
  const failed=expect(c.read(100,10000)).rejects.toMatchObject({code:'WORKER_EXITED'});await realDelay(100);host!.disconnect();await failed;await s.close('discard');expect(host!.signalCode).toBe('SIGKILL');
 }finally{await s.close('discard');await f.cleanup();}
});
