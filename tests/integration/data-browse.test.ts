import {expect,test as baseTest} from 'vitest';
const test=baseTest.skipIf(!process.env.MWA_TEST_PASSWORD);

import {fixture} from '../mysql/fixture.js';
import {readFileSync} from 'node:fs';
import {parse} from 'csv-parse/sync';
test('browse preserves large numbers, JSON text, binary and UTC microseconds',async()=>{
 const f=await fixture();try{
   const result=await f.request('/api/data/browse',{target:{connectionId:f.profile.id,schema:f.schema,table:'records'},page:1,pageSize:100,filters:[],sort:[]});
   expect(result.statusCode).toBe(200);const data=result.json();const row=data.rows[0];
   expect(row.id).toBe('18446744073709551615');expect(row.amount).toBe('123456789012345678901234567890.12345678');
   expect(row.json_value).toContain('9007199254740993');expect(row.timestamp_value).toBe('2026-10-12 00:00:00.654321');expect(row.binary_value).toEqual({binaryHex:'00ff5c27'});
   for(let i=0;i<101;i++)await f.admin.execute('INSERT INTO no_pk_rows(value) VALUES(?)',[String(i)]);
   const page=await f.request('/api/data/browse',{target:{connectionId:f.profile.id,schema:f.schema,table:'no_pk_rows'},page:1,pageSize:100,filters:[],sort:[]});
   expect(page.json().rows).toHaveLength(100);expect(page.json().hasNext).toBe(true);
 }finally{await f.cleanup();}
});
test('extended filters select the right rows and return runnable SQL matching the loaded page',async()=>{
 const f=await fixture();try{
 await f.admin.query('CREATE TABLE filter_rows(id INT PRIMARY KEY,label VARCHAR(40) NULL)');
 for(const [id,label] of [[1,'alpha'],[2,'alphabet'],[3,'beta'],[4,''],[5,null],[6,'a%_'],[7,"O'Reilly"]])await f.admin.execute('INSERT INTO filter_rows VALUES(?,?)',[id,label]);
 const query=(filters:unknown[],filterMatch='all')=>f.request('/api/data/browse',{target:{connectionId:f.profile.id,schema:f.schema,table:'filter_rows'},page:1,pageSize:100,filters,filterMatch,sort:[]});
 for(const [filter,ids] of [
  [{column:'id',op:'in',values:['1','3']},['1','3']],
  [{column:'id',op:'not-in',values:['1','3']},['2','4','5','6','7']],
  [{column:'id',op:'between',value:'2',valueTo:'3'},['2','3']],
  [{column:'id',op:'not-between',value:'2',valueTo:'6'},['1','7']],
  [{column:'label',op:'starts-with',value:'alpha'},['1','2']],
  [{column:'label',op:'ends-with',value:'bet'},['2']],
  [{column:'label',op:'contains',value:'a%_'},['6']],
  [{column:'label',op:'not-contains',value:'a'},['4','7']],
  [{column:'label',op:'like',value:'alpha%'},['1','2']],
  [{column:'label',op:'not-like',value:'alpha%'},['3','4','6','7']],
  [{column:'label',op:'is-empty'},['4']],
  [{column:'label',op:'is-not-empty'},['1','2','3','6','7']],
 ] as const){const response=await query([filter]);expect(response.statusCode,response.body).toBe(200);expect(response.json().rows.map((r:{id:string})=>r.id)).toEqual(ids);}
 const any=await query([{column:'id',op:'between',value:'1',valueTo:'2'},{column:'label',op:'eq',value:"O'Reilly"}],'any');
 expect(any.json().rows.map((r:{id:string})=>r.id)).toEqual(['1','2','7']);expect(any.json().querySql).toContain(' LIMIT 101 OFFSET 0');expect(any.json().querySql).not.toContain('?');
 const [replayed]=await f.admin.query(any.json().querySql);expect((replayed as {id:number}[]).map(r=>String(r.id))).toEqual(['1','2','7']);
 const exported=await f.request('/api/transfers/export/start',{request:{target:{connectionId:f.profile.id,schema:f.schema,table:'filter_rows'},page:1,pageSize:100,filters:[{column:'id',op:'between',value:'1',valueTo:'2'},{column:'label',op:'eq',value:"O'Reilly"}],filterMatch:'any',sort:[]},scope:'filtered',format:'csv'});
 expect(exported.statusCode,exported.body).toBe(202);await f.app.services.queue.idle();const task=f.app.services.queue.store.get(exported.json().id);expect(task.state,task.error?.message).toBe('completed');
 expect(parse(readFileSync(f.app.services.files.get(task.outputFileId!).path),{bom:true}).slice(1).map((row:string[])=>row[0])).toEqual(['1','2','7']);
 expect((await query([{column:'id',op:'in',values:[]}])).statusCode).toBe(400);
 }finally{await f.cleanup();}
});
