import {expect} from 'vitest';
import type {AppInstance} from '../../src/server/app.js';
import type {ConnectionProfile} from '../../src/server/features/connections/types.js';
import type {TableTarget} from '../../src/shared/contracts.js';
import type {BoundValue,NormalizedRow} from '../../src/shared/database.js';
export interface ApiResponse<T>{statusCode:number;body:T}
export interface DatabaseFixture {app:AppInstance;profile:ConnectionProfile;namespace:string;target:(logicalName:string)=>TableTarget;request:<T>(url:string,payload?:unknown,method?:'GET'|'POST'|'DELETE'|'PATCH')=>Promise<ApiResponse<T>>;exec:(sql:string,params?:BoundValue[])=>Promise<void>;query:(sql:string,params?:BoundValue[])=>Promise<NormalizedRow[]>;cleanup:()=>Promise<void>}
export async function assertDatabaseWorkflow(f:DatabaseFixture):Promise<void>{const adapter=f.app.services.databases.get(f.profile.id);expect(await adapter.listNamespaces(f.profile.id)).toContain(f.namespace);expect(await adapter.listTables(f.profile.id,f.namespace)).toContainEqual({name:'records',kind:'table'});const meta=await adapter.describeTable(f.target('records'));expect(meta.primaryKey).toEqual(['id']);expect(meta.columns.find(c=>c.name==='derived_qty')?.generated).toBe(true);await assertDatabaseQueries(f);if(meta.capabilities.insert.enabled&&meta.capabilities.update.enabled&&meta.capabilities.delete.enabled){await assertDatabaseEdits(f);await assertDatabaseTransfers(f);}}

export async function assertDatabaseQueries(f:DatabaseFixture){const r=await f.request<any>('/api/sql/execute',{connectionId:f.profile.id,database:f.namespace,sql:'SELECT 1 AS value'},'POST');expect(r.statusCode).toBe(200);expect(r.body.executionState).toBe('completed');const b=await f.request<any>('/api/data/browse',{target:f.target('records'),page:1,pageSize:100,filters:[],sort:[]},'POST');expect(b.statusCode).toBe(200);expect(b.body.meta.primaryKey).toEqual(['id']);}

export async function assertDatabaseEdits(f:DatabaseFixture){
 const browse=async()=>(await f.request<any>('/api/data/browse',{target:f.target('records'),page:1,pageSize:100,filters:[],sort:[]},'POST')).body;
 const edit=async(p:any,changes:unknown[])=>f.request<any>('/api/data/edits',{target:f.target('records'),expectedFingerprint:p.meta.definitionFingerprint,generation:p.generation,changes},'POST');
 let p=await browse();expect((await edit(p,[{kind:'insert',values:{value:'workflow'}}])).statusCode).toBe(200);p=await browse();let i=p.rows.findIndex((row:any)=>row.value==='workflow');expect(i).toBeGreaterThanOrEqual(0);
 const original=p.rows[i],originalKinds=p.rowKinds[i];expect((await edit(p,[{kind:'update',original,originalKinds,values:{value:'changed'}}])).statusCode).toBe(200);expect((await edit(p,[{kind:'delete',original,originalKinds}])).body.error.code).toBe('ROW_CONFLICT');
 p=await browse();i=p.rows.findIndex((row:any)=>row.value==='changed');expect((await edit(p,[{kind:'delete',original:p.rows[i],originalKinds:p.rowKinds[i]}])).statusCode).toBe(200);
}

export async function assertDatabaseTransfers(f:DatabaseFixture){
 const {Readable}=await import('node:stream');const ExcelJS=(await import('exceljs')).default;
 for(const format of ['csv','xlsx'] as const){const book=new ExcelJS.Workbook();book.addWorksheet('数据').addRows([['value'],[`workflow_${format}`]]);const data=format==='csv'?Buffer.from('value\nworkflow_csv\n'):Buffer.from(await book.xlsx.writeBuffer());const upload=await f.app.services.files.upload(Readable.from([data]),`workflow.${format}`);
 const r=await f.request<any>('/api/transfers/import/start',{uploadId:upload.id,target:f.target('records'),options:{format,hasHeader:true,toolEscaping:true,emptyCells:'null'},mappings:[{sourceIndex:0,targetColumn:'value'}]},'POST');expect(r.statusCode).toBe(202);await f.app.services.queue.idle();expect(f.app.services.queue.store.get(r.body.id).state).toBe('completed');}
 const request={target:f.target('records'),page:1,pageSize:100,filters:[],sort:[]};
 const {readSource}=await import('../../src/server/features/transfers/import/codec.js');
 for(const format of ['csv','xlsx','sql'] as const){const r=await f.request<any>('/api/transfers/export/start',{request,scope:'all',format},'POST');expect(r.statusCode).toBe(202);await f.app.services.queue.idle();const task=f.app.services.queue.store.get(r.body.id);expect(task.state,task.error?.message).toBe('completed');if(format!=='sql'){const rows=[];for await(const row of readSource(f.app.services.files.get(task.outputFileId!).path,{format,hasHeader:true,toolEscaping:true,emptyCells:'null'}))rows.push(row.cells);expect(rows.slice(1).map(row=>row[1])).toEqual(['workflow_csv','workflow_xlsx']);}}
 const p=(await f.request<any>('/api/data/browse',request,'POST')).body;expect((await f.request('/api/data/edits',{target:f.target('records'),expectedFingerprint:p.meta.definitionFingerprint,generation:p.generation,changes:p.rows.filter((r:any)=>r.value==='workflow_csv'||r.value==='workflow_xlsx').map((original:any)=>({kind:'delete',original,originalKinds:p.rowKinds[p.rows.indexOf(original)]}))},'POST')).statusCode).toBe(200);
}
