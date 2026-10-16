import {afterEach,expect,it} from 'vitest';
import {sqliteFixture} from '../sqlite/fixture.js';
import type {DatabaseFixture} from '../helpers/database.js';
const fixtures:DatabaseFixture[]=[];async function fixture(readOnly=false){const f=await sqliteFixture({readOnly});fixtures.push(f);return f;}
afterEach(async()=>{await Promise.all(fixtures.splice(0).map(f=>f.cleanup()));});
async function preview(f:DatabaseFixture,table='records'){return (await f.request<any>('/api/data/browse',{target:f.target(table),page:1,pageSize:100,filters:[],sort:[]},'POST')).body;}
function edits(f:DatabaseFixture,p:any,changes:unknown[],table='records'){return f.request<any>('/api/data/edits',{target:f.target(table),changes,expectedFingerprint:p.meta.definitionFingerprint,generation:f.app.services.connections.generation(f.profile.id)},'POST');}
it('stale full-row snapshots and equal-looking INTEGER to TEXT both conflict',async()=>{
 const f=await fixture();await f.exec("INSERT INTO records(value) VALUES('first')");let p=await preview(f);await f.exec('UPDATE records SET qty=8');let r=await edits(f,p,[{kind:'update',original:p.rows[0],originalKinds:p.rowKinds[0],values:{value:'new'}}]);expect(r.statusCode).toBe(409);expect(r.body.error.code).toBe('ROW_CONFLICT');
 await f.exec('CREATE TABLE dynamic(id INTEGER PRIMARY KEY,value)');await f.exec('INSERT INTO dynamic VALUES(1,1)');p=await preview(f,'dynamic');await f.exec('UPDATE dynamic SET value=CAST(value AS TEXT)');expect((await f.query('SELECT value FROM dynamic'))[0]).toEqual({values:['1'],valueKinds:['text']});expect(p.rows[0].value).toBe('1');expect(p.rowKinds[0].value).toBe('integer');r=await edits(f,p,[{kind:'delete',original:p.rows[0],originalKinds:p.rowKinds[0]}],'dynamic');expect(r.statusCode).toBe(409);expect(r.body.error.code).toBe('ROW_CONFLICT');
});
it('the second unique-key failure rolls back the first change',async()=>{
 const f=await fixture(),p=await preview(f);const before=await f.query('SELECT * FROM records');const r=await edits(f,p,[{kind:'insert',values:{id:'1',value:'a'}},{kind:'insert',values:{id:'1',value:'b'}}]);expect(r.statusCode).toBe(400);expect(r.body.error.operationId).toBeTruthy();expect(await f.query('SELECT * FROM records')).toEqual(before);
});
it('defaults, generated restrictions, schema binding, reliable PK and read-only enforcement',async()=>{
 const f=await fixture();let p=await preview(f);expect((await edits(f,p,[{kind:'insert',values:{}}])).statusCode).toBe(200);expect((await f.query('SELECT qty,derived_qty FROM records'))[0].values).toEqual(['7','14']);expect((await edits(f,p,[{kind:'insert',values:{derived_qty:'20'}}])).statusCode).toBe(400);
 await f.exec('ALTER TABLE records ADD COLUMN extra TEXT');expect((await edits(f,p,[{kind:'insert',values:{value:'stale'}}])).body.error.code).toBe('SCHEMA_CHANGED');
 await f.exec('CREATE TABLE nullable(id TEXT PRIMARY KEY,value TEXT)');await f.exec("INSERT INTO nullable VALUES(NULL,'x')");p=await preview(f,'nullable');expect((await edits(f,p,[{kind:'delete',original:p.rows[0],originalKinds:p.rowKinds[0]}],'nullable')).statusCode).toBe(400);
 const readonly=await fixture(true);p=await preview(readonly);expect((await edits(readonly,p,[{kind:'insert',values:{value:'no'}}])).statusCode).toBe(400);
});
it('composite primary key updates locate the original key and preserve original dynamic types',async()=>{
 const f=await fixture();await f.exec('CREATE TABLE composite(a TEXT NOT NULL,b INTEGER NOT NULL,value,PRIMARY KEY(a,b))');await f.exec("INSERT INTO composite VALUES('x',1,1)");const p=await preview(f,'composite');const result=await edits(f,p,[{kind:'update',original:p.rows[0],originalKinds:p.rowKinds[0],values:{a:'new',value:'2'}}],'composite');expect(result.statusCode).toBe(200);expect((await f.query('SELECT a,b,value FROM composite'))[0]).toEqual({values:['new','1','2'],valueKinds:['text','integer','integer']});
 expect((await edits(f,p,[{kind:'delete',original:p.rows[0]}],'composite')).statusCode).toBe(400);
});
it('NUMERIC affinity binds decimal text and rejects out-of-range integer input',async()=>{
 const f=await fixture();await f.exec('CREATE TABLE numbers(id INTEGER PRIMARY KEY,amount NUMERIC)');const p=await preview(f,'numbers');expect((await edits(f,p,[{kind:'insert',values:{amount:'1.25'}}],'numbers')).statusCode).toBe(200);expect((await f.query('SELECT amount,typeof(amount) FROM numbers'))[0].values).toEqual(['1.25','real']);expect((await edits(f,p,[{kind:'insert',values:{amount:'9223372036854775808'}}],'numbers')).statusCode).toBe(400);
});
