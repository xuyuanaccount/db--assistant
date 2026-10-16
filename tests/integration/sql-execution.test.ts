import {expect,test as baseTest} from 'vitest';
const test=baseTest.skipIf(!process.env.MWA_TEST_PASSWORD);

import {fixture} from '../mysql/fixture.js';
test('SQL execution preserves duplicate columns and uses independent sessions',async()=>{
 const f=await fixture();try{
 const execute=(sql:string)=>f.request('/api/sql/execute',{connectionId:f.profile.id,database:f.schema,sql});
 const dup=await execute('SELECT 1 AS x, 2 AS x');expect(dup.statusCode).toBe(200);expect(dup.json().rows).toEqual([['1','2']]);expect(dup.json().columns.map((c:{name:string})=>c.name)).toEqual(['x','x']);
 expect((await execute('SET @probe=1')).statusCode).toBe(200);expect((await execute('SELECT @probe')).json().rows).toEqual([[null]]);
 expect((await execute('SELECT 1; SELECT 2')).statusCode).toBe(400);
 expect((await execute('SELECT * FROM missing_table')).json().error.mysqlCode).toBe('ER_NO_SUCH_TABLE');
 }finally{await f.cleanup();}
});
test('SQL returns the requested row count, defaults to 100 and rejects invalid caps',async()=>{
 const f=await fixture();try{
 const sql='WITH RECURSIVE seq AS (SELECT 1 AS n UNION ALL SELECT n+1 FROM seq WHERE n<105) SELECT n FROM seq';
 const execute=(extra:Record<string,unknown>={})=>f.request('/api/sql/execute',{connectionId:f.profile.id,database:f.schema,sql,...extra});
 const small=await execute({maxRows:3});expect(small.statusCode,small.body).toBe(200);expect(small.json().rows).toEqual([['1'],['2'],['3']]);expect(small.json()).toMatchObject({maxRows:3,truncated:true});
 const defaults=await execute();expect(defaults.json().rows).toHaveLength(100);expect(defaults.json()).toMatchObject({maxRows:100,truncated:true});
 const exact=await execute({sql:'SELECT 1 UNION ALL SELECT 2',maxRows:2});expect(exact.json()).toMatchObject({rows:[['1'],['2']],truncated:false,maxRows:2});
 for(const maxRows of [0,-1,1001,1.5,'10',null])expect((await execute({maxRows})).statusCode).toBe(400);
 // The cap limits returned rows, never adds a LIMIT to writes.
 expect((await execute({sql:'INSERT INTO import_rows(id,required_text) VALUES(1,\'a\'),(2,\'b\'),(3,\'c\')',maxRows:1})).json().affectedRows).toBe(3);
 }finally{await f.cleanup();}
});
test('completion metadata contains only the selected database and preserves unusual identifiers',async()=>{
 const f=await fixture();try{
 await f.admin.query('CREATE TABLE `order detail` (`商品名` VARCHAR(20), `__proto__` INT)');
 await f.admin.query('CREATE VIEW completion_view AS SELECT id FROM import_rows');
 const response=await f.request('/api/sql/completions',{connectionId:f.profile.id,database:f.schema});
 expect(response.statusCode,response.body).toBe(200);expect(response.json().truncated).toBe(false);
 expect(response.json().tables).toEqual(expect.arrayContaining([{name:'order detail',columns:['商品名','__proto__']},{name:'completion_view',columns:['id']}]));
 expect(response.json().tables.find((t:{name:string})=>t.name==='records').columns).toContain('amount');
 expect((await f.request('/api/sql/completions',{connectionId:f.profile.id,database:'mysql'})).json().tables.some((t:{name:string})=>t.name==='records')).toBe(false);
 expect((await f.request('/api/sql/completions',{connectionId:f.profile.id,database:''})).statusCode).toBe(400);
 }finally{await f.cleanup();}
});
