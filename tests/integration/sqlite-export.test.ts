import {afterEach,expect,it} from 'vitest';
import {readFile} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {parse} from 'csv-parse/sync';
import {sqliteFixture} from '../sqlite/fixture.js';
import type {DatabaseFixture} from '../helpers/database.js';
const fixtures:DatabaseFixture[]=[];async function fixture(){const f=await sqliteFixture();fixtures.push(f);return f;}afterEach(async()=>{await Promise.all(fixtures.splice(0).map(f=>f.cleanup()));});
function request(f:DatabaseFixture,table='records'){return {target:f.target(table),page:1,pageSize:100,filters:[],sort:[]};}
async function exportTask(f:DatabaseFixture,input:unknown){const r=await f.request<any>('/api/transfers/export/start',input,'POST');expect(r.statusCode).toBe(202);await f.app.services.queue.idle();return f.app.services.queue.store.get(r.body.id);}
it('SQLite SQL restores values and actual storage classes in an independent target',async()=>{
 const f=await fixture(),target=await fixture();await f.exec("INSERT INTO mixed_rows VALUES(1),('1'),(1.5),(X'00ff'),(NULL)");const sourceRows=await f.query('SELECT value FROM mixed_rows');const task=await exportTask(f,{request:request(f,'mixed_rows'),scope:'all',format:'sql'});expect(task.state).toBe('completed');
 const sql=await readFile(f.app.services.files.get(task.outputFileId!).path,'utf8');if(target.profile.kind!=='sqlite')throw Error('fixture kind');const db=new DatabaseSync(target.profile.filePath);try{db.exec(sql);}finally{db.close();}
 const restored=await target.query('SELECT value FROM mixed_rows');expect(restored.map(r=>r.values)).toEqual(sourceRows.map(r=>r.values));expect(restored.map(r=>r.valueKinds)).toEqual(sourceRows.map(r=>r.valueKinds));
});
it('queued page snapshots survive changed source rows and disconnect',async()=>{
 const f=await fixture();await f.exec("INSERT INTO records(value) VALUES('old')");const b=request(f),page=(await f.request<any>('/api/data/browse',b,'POST')).body;
 let resume!:()=>void;const held=new Promise<void>(resolve=>resume=resolve);f.app.services.queue.register('import',async()=>held);f.app.services.queue.enqueue({direction:'import',format:'csv',target:f.target('records'),details:{}});
 try{await Promise.resolve();const start=await f.request<any>('/api/transfers/export/start',{request:b,scope:'page',format:'csv',rows:page.rows,rowKinds:page.rowKinds,meta:page.meta,generation:page.generation},'POST');expect(start.statusCode).toBe(202);await f.exec("UPDATE records SET value='new'");await f.app.services.connections.disconnect(f.profile.id);resume();await f.app.services.queue.idle();const task=f.app.services.queue.store.get(start.body.id);expect(task.state).toBe('completed');expect(parse(await readFile(f.app.services.files.get(task.outputFileId!).path),{bom:true})[1][1]).toBe('old');}finally{resume();await f.app.services.queue.idle();}
});
it('all ignores filters but keeps sort; filtered keeps both',async()=>{
 const f=await fixture();await f.exec("INSERT INTO records(value) VALUES('a'),('b'),('c')");const b={...request(f),filters:[{column:'value',op:'eq',value:'a'}],sort:[{column:'id',direction:'desc'}]};for(const scope of ['all','filtered']){const task=await exportTask(f,{request:b,scope,format:'csv'});expect(task.state).toBe('completed');const csv=parse(await readFile(f.app.services.files.get(task.outputFileId!).path),{bom:true});expect(csv.slice(1).map((r:string[])=>r[1])).toEqual(scope==='all'?['c','b','a']:['a']);}
});
it('confirmed partial RETURNING exports only its matrix and keeps duplicate/empty headers',async()=>{
 const f=await fixture();const result=(await f.request<any>('/api/sql/execute',{connectionId:f.profile.id,database:'main',sql:"INSERT INTO records(value) VALUES('a'),('b') RETURNING id AS x,value AS x,qty AS \"\"",maxRows:1},'POST')).body;
 const payload={source:{operationId:result.operationId,connectionId:f.profile.id,connectionName:f.profile.name,database:'main'},columns:result.columns,rows:result.rows,valueKinds:result.valueKinds,executionState:result.executionState,truncated:result.truncated,needsReview:false,format:'csv',acknowledgeIncomplete:false};expect((await f.request('/api/transfers/export/query/start',payload,'POST')).statusCode).toBe(400);await f.app.services.connections.disconnect(f.profile.id);const r=await f.request<any>('/api/transfers/export/query/start',{...payload,acknowledgeIncomplete:true},'POST');expect(r.statusCode).toBe(202);await f.app.services.queue.idle();const task=f.app.services.queue.store.get(r.body.id);expect(task.state).toBe('completed');const csv=parse(await readFile(f.app.services.files.get(task.outputFileId!).path),{bom:true});expect(csv[0]).toEqual(['x','x','']);expect(csv).toHaveLength(2);expect(f.app.services.operations.get(result.operationId).status).toBe('completed');
});
