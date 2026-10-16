import {afterEach,describe,expect,it} from 'vitest';
import {link,symlink,rename} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {sqliteFixture} from '../sqlite/fixture.js';
import {assertDatabaseWorkflow,type DatabaseFixture} from '../helpers/database.js';
const live:DatabaseFixture[]=[];async function fixture(readOnly=false){const f=await sqliteFixture({readOnly});live.push(f);return f;}afterEach(async()=>{await Promise.all(live.splice(0).map(f=>f.cleanup()));});
describe('real SQLite Worker adapter',()=>{
 it('sqlite_mixed_storage_is_preserved and sqlite_int64_is_text',async()=>{const f=await fixture();await f.exec("INSERT INTO mixed_rows VALUES(1),('1'),(1.5),(X'00ff'),(NULL)");const rows=await f.query('SELECT value FROM mixed_rows');expect(rows.map(r=>r.valueKinds[0])).toEqual(['integer','text','real','binary','null']);const [bigRow]=await f.query('SELECT 9223372036854775807');expect(bigRow.values[0]).toBe('9223372036854775807');expect(rows[3].values[0]).toEqual({binaryHex:'00ff'});});
 it('metadata includes generated columns and reliable PK exceptions',async()=>{const f=await fixture();await assertDatabaseWorkflow(f);for(const [name,definition,reliable] of [['normal','id INTEGER PRIMARY KEY',true],['desc_pk','id INTEGER PRIMARY KEY DESC',false],['nullable','id TEXT PRIMARY KEY',false],['composite','id INTEGER, b TEXT, PRIMARY KEY(id,b)',false],['strict_pk','id TEXT PRIMARY KEY) STRICT',true]] as const){await f.exec(`CREATE TABLE ${name} (${definition}${name==='strict_pk'?'':')'}`);const meta=await f.app.services.databases.get(f.profile.id).describeTable(f.target(name));expect(meta.capabilities.update.enabled,name).toBe(reliable);}const s=await f.app.services.databases.get(f.profile.id).describeStructure(f.target('records'));expect(s.definition.text).toContain('GENERATED ALWAYS');});
 it('sqlite_file_aliases_are_rejected',async()=>{const f=await fixture();const own=join(f.app.services.store.dataDir,'assistant.sqlite');for(const [name,make] of [['sym',symlink],['hard',link]] as const){const alias=join(dirname(own),name);await make(own,alias);await expect(f.app.services.connections.saveProfile({kind:'sqlite',name,filePath:alias,readOnly:false})).rejects.toMatchObject({code:'SQLITE_OWN_DATABASE'});}});
 it('replaced_file_requires_reconnect',async()=>{const f=await fixture();if(f.profile.kind!=='sqlite')throw Error();const replacement=await fixture();if(replacement.profile.kind!=='sqlite')throw Error();await rename(replacement.profile.filePath,f.profile.filePath);await expect(f.query('SELECT 1')).rejects.toMatchObject({code:'CONNECTION_CHANGED'});});
 it('readonly_does_not_mutate_journal',async()=>{const f=await fixture(true);const journalBefore=(await f.query('PRAGMA journal_mode'))[0].values[0];await expect(f.exec("INSERT INTO records(value) VALUES('no')")).rejects.toMatchObject({databaseKind:'sqlite'});const journalAfter=(await f.query('PRAGMA journal_mode'))[0].values[0];expect(journalAfter).toBe(journalBefore);expect((await f.query('SELECT count(*) FROM records'))[0].values[0]).toBe('0');expect((await f.app.services.databases.get(f.profile.id).describeTable(f.target('records'))).capabilities.insert.enabled).toBe(false);});
 it('worker_fetch_obeys_backpressure and byte budget',async()=>{const f=await fixture();const session=await f.app.services.databases.get(f.profile.id).openSession(f.profile.id,'main','browse');try{const c=await session.openStatement({sql:'WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<250) SELECT x FROM n',params:[]});const first=await c.read(1000,100000);expect(first.rows).toHaveLength(100);expect(first.done).toBe(false);const second=await c.read(1000,150);expect(second.rows[0].values[0]).toBe('101');expect(Buffer.byteLength(JSON.stringify(second.rows))).toBeLessThanOrEqual(152);await c.close();}finally{await session.close('discard');}});
 it('transactions rollback, constraints apply, and SQL sessions do not leak temp state',async()=>{const f=await fixture();const a=f.app.services.databases.get(f.profile.id);const s=await a.openSession(f.profile.id,'main','edit');await s.begin('write');await s.execute({sql:"INSERT INTO records(value) VALUES('rollback')",params:[]});await s.rollback();await s.close('reuse');expect((await f.query('SELECT count(*) FROM records'))[0].values[0]).toBe('0');await f.exec('CREATE TEMP TABLE private_temp(a)');await expect(f.query('SELECT * FROM private_temp')).rejects.toBeDefined();const again=await a.openSession(f.profile.id,'main','browse');await again.close('reuse');});
});

it('four execution units permit sixteen waiters and release admits the next waiter',async()=>{
 const f=await fixture();const a=f.app.services.databases.get(f.profile.id);const sessions=await Promise.all(Array.from({length:4},()=>a.openSession(f.profile.id,'main','browse')));
 const waiting=Array.from({length:16},()=>a.openSession(f.profile.id,'main','browse'));for(const p of waiting)void p.catch(()=>{});
 await expect(a.openSession(f.profile.id,'main','browse')).rejects.toMatchObject({code:'CONNECTION_BUSY'});
 await sessions.shift()!.close('reuse');const admitted=await waiting.shift()!;await admitted.close('reuse');
 for(const p of waiting)await (await p).close('reuse');await Promise.all(sessions.map(s=>s.close('reuse')));
});
it('namespace isolation, foreign keys, zero-row headers and duplicate names survive the Worker boundary',async()=>{
 const f=await fixture();const a=f.app.services.databases.get(f.profile.id);await expect(a.openSession(f.profile.id,'temp','sql')).rejects.toMatchObject({code:'INVALID_NAMESPACE'});
 expect((await f.query('PRAGMA foreign_keys'))[0].values[0]).toBe('1');expect((await f.query('PRAGMA busy_timeout'))[0].values[0]).toBe('5000');
 await f.exec('CREATE TABLE child(parent_id INTEGER REFERENCES records(id))');await expect(f.exec('INSERT INTO child VALUES(999)')).rejects.toMatchObject({databaseKind:'sqlite'});
 const s=await a.openSession(f.profile.id,'main','browse');try {const c=await s.openStatement({sql:'SELECT id AS x, value AS x FROM records WHERE 0',params:[]});expect(c.columns.map(c=>c.name)).toEqual(['x','x']);expect((await c.read(100,10000)).done).toBe(true);await c.close();}finally{await s.close('reuse');}
});
it('lockTable detects a definition changed since preview in the same write transaction',async()=>{
 const f=await fixture();const a=f.app.services.databases.get(f.profile.id);const meta=await a.describeTable(f.target('records'));await f.exec('ALTER TABLE records ADD COLUMN extra TEXT');const s=await a.openSession(f.profile.id,'main','edit');try{await s.begin('write');await expect(s.lockTable(meta)).rejects.toMatchObject({code:'TABLE_CHANGED'});await s.rollback();}finally{await s.close('discard');}
});

it('lockTable requires BEGIN IMMEDIATE rather than a deferred snapshot transaction',async()=>{
 const f=await fixture();const a=f.app.services.databases.get(f.profile.id);const meta=await a.describeTable(f.target('records'));const s=await a.openSession(f.profile.id,'main','edit');try{await s.begin('snapshot');await expect(s.lockTable(meta)).rejects.toMatchObject({code:'TRANSACTION_REQUIRED'});await s.rollback();}finally{await s.close('discard');}
});
it('commit dispatched without acknowledgement is RESULT_UNKNOWN and cancelled worker releases its lock',async()=>{
 const f=await fixture();const a=f.app.services.databases.get(f.profile.id);const writer=await a.openSession(f.profile.id,'main','edit'),reader=await a.openSession(f.profile.id,'main','browse');
 try{await writer.begin('write');await writer.execute({sql:"INSERT INTO records(value) VALUES('pending')",params:[]});await reader.begin('snapshot');const cursor=await reader.openStatement({sql:'SELECT * FROM records',params:[]});await cursor.read(100,10000);await cursor.close();const committed=writer.commit();const uncertain=expect(committed).rejects.toMatchObject({code:'RESULT_UNKNOWN'});await writer.cancel();await uncertain;await reader.rollback();}finally{await writer.close('discard');await reader.close('discard');}
 const next=await a.openSession(f.profile.id,'main','edit');try{await next.begin('write');await next.rollback();}finally{await next.close('reuse');}
});
it('partial RETURNING consumption rolls back on close and explicit exhaustion commits all writes',async()=>{
 const f=await fixture();await f.exec("INSERT INTO records(value) VALUES('a'),('b'),('c')");const a=f.app.services.databases.get(f.profile.id);const first=await a.openSession(f.profile.id,'main','sql');try{await first.begin('sql');const cursor=await first.openStatement({sql:'UPDATE records SET qty=8 RETURNING id',params:[]});expect((await cursor.read(1,10000)).rows).toHaveLength(1);await cursor.close();}finally{await first.close('reuse');}expect((await f.query('SELECT sum(qty) FROM records'))[0].values[0]).toBe('21');
 const second=await a.openSession(f.profile.id,'main','sql');try{await second.begin('sql');const cursor=await second.openStatement({sql:'UPDATE records SET qty=9 RETURNING id',params:[]});let done=false;while(!done)done=(await cursor.read(1,10000)).done;await cursor.close();await second.commit();}finally{await second.close('discard');}expect((await f.query('SELECT sum(qty) FROM records'))[0].values[0]).toBe('27');
});
it('external write lock reports SQLITE_BUSY after the configured five second wait',async()=>{
 const f=await fixture();const a=f.app.services.databases.get(f.profile.id);const first=await a.openSession(f.profile.id,'main','edit'),second=await a.openSession(f.profile.id,'main','edit');try{await first.begin('write');const start=Date.now();await expect(second.begin('write')).rejects.toMatchObject({databaseKind:'sqlite',driverCode:'ERR_SQLITE_ERROR'});expect(Date.now()-start).toBeGreaterThanOrEqual(4500);await first.rollback();}finally{await first.close('discard');await second.close('discard');}
});

it('invalid database bytes are rejected by connection testing without creating missing files',async()=>{
 const f=await fixture();const {writeFile,access}=await import('node:fs/promises');const path=join(f.app.services.store.dataDir,'invalid.sqlite');await writeFile(path,'this is not a SQLite database');const p=await f.app.services.connections.saveProfile({kind:'sqlite',name:'invalid',filePath:path,readOnly:false});await expect(f.app.services.connections.connect(p.id,'')).rejects.toMatchObject({databaseKind:'sqlite'});
 const missing=join(f.app.services.store.dataDir,'missing.sqlite');await expect(f.app.services.connections.saveProfile({kind:'sqlite',name:'missing',filePath:missing,readOnly:false})).rejects.toMatchObject({code:'INVALID_SQLITE_FILE'});await expect(access(missing)).rejects.toBeDefined();
});
it('retargeting a saved symlink rejects a fresh execution unit',async()=>{
 const f=await fixture(),replacement=await fixture();if(f.profile.kind!=='sqlite'||replacement.profile.kind!=='sqlite')throw Error();const path=join(f.app.services.store.dataDir,'alias.sqlite');await symlink(f.profile.filePath,path);const p=await f.app.services.connections.saveProfile({kind:'sqlite',name:'alias',filePath:path,readOnly:false});await f.app.services.connections.connect(p.id,'');const {unlink}=await import('node:fs/promises');await unlink(path);await symlink(replacement.profile.filePath,path);await expect(f.app.services.databases.get(p.id).openSession(p.id,'main','browse')).rejects.toMatchObject({code:'CONNECTION_CHANGED'});
});
it('fetch byte limit includes the returned row array delimiters',async()=>{
 const f=await fixture();const s=await f.app.services.databases.get(f.profile.id).openSession(f.profile.id,'main','browse');try{const c=await s.openStatement({sql:'SELECT 1 UNION ALL SELECT 2 UNION ALL SELECT 3',params:[]});const chunk=await c.read(100,82);expect(Buffer.byteLength(JSON.stringify(chunk.rows))).toBeLessThanOrEqual(82);await c.close();}finally{await s.close('discard');}
});

it('cursor completion reports direct DML changes without triggers or stale counters',async()=>{
 const f=await fixture();await f.exec('CREATE TABLE audit(id INTEGER)');await f.exec('CREATE TRIGGER log_records AFTER INSERT ON records BEGIN INSERT INTO audit VALUES(new.id); END');
 const s=await f.app.services.databases.get(f.profile.id).openSession(f.profile.id,'main','sql');
 const completion=async(sql:string)=>{const c=await s.openStatement({sql,params:[]});try{for(;;){const part=await c.read(1,10000);if(part.done)return part.completion?.affectedRows;}}finally{await c.close();}};
 try{
  expect(await completion("INSERT INTO records(value) VALUES('triggered') RETURNING id")).toBe(1);
  expect(await completion("WITH seed(value) AS (VALUES('cte')) INSERT INTO records(value) SELECT value FROM seed RETURNING id")).toBe(1);
  expect(await completion('UPDATE records SET qty=qty+1 WHERE id<0 RETURNING id')).toBe(0);
  expect(await completion("INSERT INTO records(value) VALUES('ordinary'),('another')")).toBe(2);
  expect(await completion('SELECT * FROM records')).toBe(0);
  expect(await completion('CREATE TABLE no_changes(id INTEGER)')).toBe(0);
  expect((await s.execute({sql:'UPDATE records SET qty=10',params:[]})).affectedRows).toBe(4);
  expect(await completion('WITH result AS (SELECT qty FROM records) SELECT * FROM result')).toBe(0);
 }finally{await s.close('discard');}
 expect((await f.query('SELECT count(*) FROM audit'))[0].values[0]).toBe('4');
});
it('INSTEAD OF view trigger completion reports zero directly changed rows',async()=>{
 const f=await fixture();await f.exec('CREATE VIEW records_view AS SELECT value FROM records');await f.exec('CREATE TRIGGER insert_view INSTEAD OF INSERT ON records_view BEGIN INSERT INTO records(value) VALUES(new.value); END');
 const s=await f.app.services.databases.get(f.profile.id).openSession(f.profile.id,'main','sql');try{const c=await s.openStatement({sql:"INSERT INTO records_view VALUES('from view') RETURNING value",params:[]});const part=await c.read(100,10000);expect(part.completion?.affectedRows).toBe(0);await c.close();}finally{await s.close('discard');}
 expect((await f.query('SELECT count(*) FROM records'))[0].values[0]).toBe('1');
});
