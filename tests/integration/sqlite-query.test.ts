import {afterEach,expect,it} from 'vitest';
import {sqliteFixture} from '../sqlite/fixture.js';
import type {DatabaseFixture} from '../helpers/database.js';
import type {SqlResult} from '../../src/server/features/sql/types.js';
const fixtures:DatabaseFixture[]=[];
async function fixture(){const f=await sqliteFixture();fixtures.push(f);return f;}
afterEach(async()=>{await Promise.all(fixtures.splice(0).map(f=>f.cleanup()));});
async function sql(f:DatabaseFixture,text:string,maxRows=100){return f.request<SqlResult>('/api/sql/execute',{connectionId:f.profile.id,database:'main',sql:text,maxRows},'POST');}
it('SQLite browse filters, stable PK ordering, pages, and exact executable SQL',async()=>{
 const f=await fixture();await f.exec("WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<205) INSERT INTO records(id,value) SELECT x,'literal_%' FROM n");
 const input={target:f.target('records'),page:2,pageSize:100,filters:[{column:'value',op:'contains',value:'_%'}],sort:[]};
 const r=await f.request<any>('/api/data/browse',input,'POST');expect(r.statusCode).toBe(200);expect(r.body.rows).toHaveLength(100);expect(r.body.rows[0].id).toBe('101');expect(r.body.hasNext).toBe(true);expect(r.body.rowKinds[0].id).toBe('integer');expect((await f.query(r.body.querySql)).map(r=>r.values[0])).toHaveLength(101);
 const structure=await f.request<any>('/api/database/structure/describe',f.target('records'),'POST');expect(structure.statusCode).toBe(200);expect(structure.body.databaseKind).toBe('sqlite');
 const completions=await f.request<any>('/api/sql/completions',{connectionId:f.profile.id,database:'main'},'POST');expect(completions.body.tables).toContainEqual({name:'records',columns:['id','value','qty','derived_qty']});
});
it('zero rows retain headers and duplicate/empty aliases retain matrix positions',async()=>{
 const f=await fixture();const zero=await sql(f,'SELECT id AS x,value AS x,qty AS "" FROM records WHERE 0');expect(zero.statusCode).toBe(200);expect(zero.body.columns.map(c=>c.name)).toEqual(['x','x','']);expect(zero.body.rows).toEqual([]);
 const row=await sql(f,'SELECT 9223372036854775807 AS x,\'1\' AS x,NULL AS ""');expect(row.body.rows).toEqual([['9223372036854775807','1',null]]);expect(row.body.valueKinds).toEqual([['integer','text','null']]);
});
it('returning_limit_does_not_limit_write',async()=>{
 const f=await fixture();const result=await sql(f,"WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1005) INSERT INTO records(value) SELECT 'row'||x FROM n RETURNING id",3);
 expect(result.statusCode).toBe(200);expect(result.body.rows).toHaveLength(3);expect(result.body).toMatchObject({truncated:true,executionState:'completed',affectedRows:1005});expect((await f.query('SELECT count(*) FROM records'))[0].values[0]).toBe('1005');
});
it('byte truncation drains remaining RETURNING and confirms the entire write',async()=>{
 const f=await fixture();const result=await sql(f,"WITH RECURSIVE n(x) AS (VALUES(1) UNION ALL SELECT x+1 FROM n WHERE x<1005) INSERT INTO records(value) SELECT printf('%011000d',x) FROM n RETURNING value",1000);
 expect(result.statusCode).toBe(200);expect(result.body.rows.length).toBeLessThan(1000);expect(result.body).toMatchObject({truncated:true,executionState:'completed',affectedRows:1005});expect(Buffer.byteLength(JSON.stringify(result.body.rows))).toBeLessThanOrEqual(10*1024*1024);expect((await f.query('SELECT count(*) FROM records'))[0].values[0]).toBe('1005');
});
it('a single oversized RETURNING value is omitted while the write completes',async()=>{
 const f=await fixture();const result=await sql(f,"INSERT INTO records(value) VALUES(zeroblob(11000000)) RETURNING value");
 expect(result.statusCode).toBe(200);expect(result.body.rows).toEqual([]);expect(result.body).toMatchObject({truncated:true,executionState:'completed',affectedRows:1});expect((await f.query('SELECT length(value) FROM records'))[0].values[0]).toBe('11000000');
});
it('failed SQL rolls back and completed SQL cannot leak temporary state',async()=>{
 const f=await fixture();await f.exec("INSERT INTO records(id,value) VALUES(1,'original')");
 const failed=await sql(f,"INSERT INTO records(id,value) VALUES(2,'rollback'),(1,'duplicate') RETURNING id");expect(failed.statusCode).toBe(400);expect((await f.query('SELECT count(*) FROM records'))[0].values[0]).toBe('1');
 expect((await sql(f,'CREATE TEMP TABLE ephemeral(id INTEGER)')).statusCode).toBe(200);expect((await sql(f,'SELECT * FROM ephemeral')).statusCode).toBe(400);
});
it('completion metadata stops at 5001 fields and exposes its truncation',async()=>{
 const f=await fixture();for(let table=0;table<3;table++)await f.exec(`CREATE TABLE many_${table}(${Array.from({length:2000},(_,i)=>`c${i} TEXT`).join(',')})`);
 const result=await f.request<any>('/api/sql/completions',{connectionId:f.profile.id,database:'main'},'POST');expect(result.statusCode).toBe(200);expect(result.body.truncated).toBe(true);expect(result.body.tables.flatMap((t:any)=>t.columns)).toHaveLength(5000);
});
