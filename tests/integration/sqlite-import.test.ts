import {afterEach,expect,it,vi} from 'vitest';
import {Readable} from 'node:stream';
import {sqliteFixture} from '../sqlite/fixture.js';
import type {DatabaseFixture} from '../helpers/database.js';
import type {TaskRecord} from '../../src/server/features/transfers/types.js';
import {TransferQueue} from '../../src/server/features/transfers/queue.js';
import ExcelJS from 'exceljs';
const fixtures:DatabaseFixture[]=[];async function fixture(){const f=await sqliteFixture();fixtures.push(f);return f;}afterEach(async()=>{await Promise.all(fixtures.splice(0).map(f=>f.cleanup()));});
async function input(f:DatabaseFixture,text:string){const file=await f.app.services.files.upload(Readable.from([text]),'synthetic.csv');return {uploadId:file.id,target:f.target('records'),options:{format:'csv',delimiter:',',hasHeader:true,toolEscaping:true,emptyCells:'null'},mappings:[{sourceIndex:0,targetColumn:'id'},{sourceIndex:1,targetColumn:'value'}]};}
async function start(f:DatabaseFixture,b:unknown){const result=await f.request<TaskRecord>('/api/transfers/import/start',b,'POST');expect(result.statusCode).toBe(202);await f.app.services.queue.idle();return f.app.services.queue.store.get(result.body.id);}
it('source record502 unique failure retains exactly the first confirmed500 rows',async()=>{
 const f=await fixture(),b=await input(f,'id,value\n'+Array.from({length:501},(_,i)=>`${i===500?1:i+1},v${i}\n`).join(''));const task=await start(f,b);expect(task.state).toBe('failed');expect(task.committedRows).toBe(500);expect(task.failedBatch).toEqual({firstRow:502,lastRow:502});expect((await f.query('SELECT count(*) FROM records'))[0].values[0]).toBe('500');
});
it('commit succeeds but local confirmation fails: pending survives recovery without reimport',async()=>{
 const f=await fixture(),b=await input(f,'id,value\n1,once\n'),store=f.app.services.queue.store,patch=store.patch.bind(store);
 vi.spyOn(store,'patch').mockImplementation((id,change)=>{if(change.committedRows===1)throw Error('confirmation lost');return patch(id,change);});
 const task=await start(f,b);expect(task).toMatchObject({state:'needs_review',committedRows:0});expect(task.pendingBatch).not.toBeNull();expect((await f.query('SELECT count(*) FROM records'))[0].values[0]).toBe('1');
 patch(task.id,{state:'running'});const recovered=new TransferQueue(store,f.app.services.operations);expect(recovered.store.get(task.id).state).toBe('needs_review');await recovered.idle();expect((await f.query('SELECT count(*) FROM records'))[0].values[0]).toBe('1');await recovered.close();
});
it('cancel at the first confirmation boundary keeps the first batch only',async()=>{
 const f=await fixture(),b=await input(f,'id,value\n'+Array.from({length:700},(_,i)=>`${i+1},v\n`).join('')),queue=f.app.services.queue,patch=queue.store.patch.bind(queue.store);
 vi.spyOn(queue.store,'patch').mockImplementation((id,change)=>{const result=patch(id,change);if(change.committedRows===500)queue.cancel(id);return result;});
 const task=await start(f,b);expect(task.state).toBe('cancelled');expect(task.committedRows).toBe(500);expect((await f.query('SELECT count(*) FROM records'))[0].values[0]).toBe('500');
});
it('preview shares validation, warns about SQLite affinity and excludes generated mapping',async()=>{
 const f=await fixture(),b=await input(f,'id,value\n1,preview\n');const r=await f.request<any>('/api/transfers/import/preview',b,'POST');expect(r.statusCode).toBe(200);expect(r.body.rows).toHaveLength(1);expect(r.body.warnings.join('')).toContain('亲和性');const invalid=await f.request<any>('/api/transfers/import/preview',{...b,mappings:[{sourceIndex:0,targetColumn:'derived_qty'}]},'POST');expect(invalid.body.errors.length).toBeGreaterThan(0);
});
it('XLSX import retains exact text and defaults through the same batch path',async()=>{
 const f=await fixture(),book=new ExcelJS.Workbook();book.addWorksheet('数据').addRows([['id','value'],['1','9007199254740993']]);const file=await f.app.services.files.upload(Readable.from([Buffer.from(await book.xlsx.writeBuffer())]),'synthetic.xlsx');
 const task=await start(f,{uploadId:file.id,target:f.target('records'),options:{format:'xlsx',hasHeader:true,toolEscaping:true,emptyCells:'null'},mappings:[{sourceIndex:0,targetColumn:'id'},{sourceIndex:1,targetColumn:'value'}]});expect(task).toMatchObject({state:'completed',committedRows:1});expect((await f.query('SELECT value,qty FROM records'))[0].values).toEqual(['9007199254740993','7']);
});
