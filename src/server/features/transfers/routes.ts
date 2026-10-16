import type{FastifyInstance}from'fastify';import multipart from'@fastify/multipart';import formbody from'@fastify/formbody';import{z}from'zod';
import{AppFault}from'../../../shared/contracts.js';import{LIMITS}from'../../../shared/limits.js';import type{TransferQueue}from'./queue.js';import type{FileStore}from'./files.js';
import type{MysqlAdapter}from'../../mysql/adapter.js';import{importRequestSchema}from'./import/types.js';import{previewImport}from'./import/preview.js';
import{startImport,runImport}from'./import/worker.js';
import{startExport,runExport}from'./export/worker.js';import type{DataRow}from'../../../shared/contracts.js';
import type {OperationStore} from '../../local/operations.js';
import {startQueryResultExport,runQueryResultExport,type QueryResultCache} from './export/query-result.js';
import type {DatabaseRegistry} from '../../database/registry.js';
import {previewDatabaseImport} from './import/database-preview.js';
import {startDatabaseImport,runDatabaseImport} from './import/database-worker.js';
import {startDatabaseExport,runDatabaseExport,type PageSnapshot} from './export/database-worker.js';
import {exportRequestSchema} from './export/types.js';
export function transferRoutes(app:FastifyInstance,queue:TransferQueue,files:FileStore,adapter:MysqlAdapter,operations:OperationStore,databases:DatabaseRegistry){
 queue.register('import',(task,ctx)=>task.details.databaseKind&&task.details.databaseKind!=='mysql'?runDatabaseImport(databases,files,task,ctx):runImport(adapter,files,task,ctx));
 const pageCache=new Map<string,DataRow[]>();const databasePages=new Map<string,PageSnapshot>();const queryCache:QueryResultCache=new Map();
 queue.register('export',(task,ctx)=>task.details.scope==='query_result'?runQueryResultExport(files,queryCache,task,ctx):task.details.databaseKind&&task.details.databaseKind!=='mysql'?runDatabaseExport(databases,files,databasePages,task,ctx):runExport(adapter,files,pageCache,task,ctx));
 app.addHook('onClose',async()=>{queryCache.clear();pageCache.clear();databasePages.clear();});
 void app.register(multipart,{limits:{fileSize:LIMITS.uploadBytes,files:1,fields:0,parts:1}});void app.register(formbody);
 app.post('/api/transfers/uploads',async request=>{const data=await request.file();if(!data)throw new AppFault('NO_FILE','请选择文件');const file=await files.upload(data.file,data.filename);return {id:file.id,name:file.name,format:file.format};});
 app.post('/api/transfers/import/preview',async request=>{const b=importRequestSchema.parse(request.body);return databases.get(b.target.connectionId).kind==='mysql'?previewImport(files,adapter,b.uploadId,b.target,b.options,b.mappings):previewDatabaseImport(files,databases,b.uploadId,b.target,b.options,b.mappings);});
 app.post('/api/transfers/import/start',async(request,reply)=>reply.code(202).send(await (databases.get(importRequestSchema.parse(request.body).target.connectionId).kind==='mysql'?startImport(queue,files,adapter,request.body):startDatabaseImport(queue,files,databases,request.body))));
 app.post('/api/transfers/export/start',async(request,reply)=>reply.code(202).send(await (databases.get(exportRequestSchema.parse(request.body).request.target.connectionId).kind==='mysql'?startExport(queue,adapter,pageCache,request.body):startDatabaseExport(queue,databases,databasePages,request.body))));
 app.post('/api/transfers/export/query/start',async(request,reply)=>reply.code(202).send(startQueryResultExport(queue,operations,queryCache,request.body)));
 app.get('/api/transfers/tasks',async()=>({items:queue.store.list()}));
 app.get('/api/transfers/tasks/:id',async request=>queue.store.get(z.object({id:z.string()}).parse(request.params).id));
 app.post('/api/transfers/tasks/:id/cancel',async request=>{const {id}=z.object({id:z.string()}).parse(request.params);queue.cancel(id);if(queue.store.get(id).state==='cancelled'){pageCache.delete(id);databasePages.delete(id);queryCache.delete(id);}return {ok:true};});
 app.post('/api/transfers/tasks/:id/download',async(request,reply)=>{const task=queue.store.get(z.object({id:z.string()}).parse(request.params).id);if(task.state!=='completed'||!task.outputFileId)throw new AppFault('FILE_NOT_READY','任务尚未完成',404);const file=files.get(task.outputFileId);reply.header('Content-Disposition',`attachment; filename*=UTF-8''${encodeURIComponent(file.name)}`).type('application/octet-stream');return reply.send(files.download(file.id));});
}
