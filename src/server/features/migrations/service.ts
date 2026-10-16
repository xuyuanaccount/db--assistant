import {assertMysqlProfile} from '../connections/service.js';
import {randomUUID} from 'node:crypto';
import type {Connection} from 'mysql2/promise';
import {AppFault,errorInfo} from '../../../shared/contracts.js';
import type {MigrationTask,MigrationRequest} from '../../../shared/migrations.js';
import type {MysqlAdapter} from '../../mysql/adapter.js';
import type {OperationStore} from '../../local/operations.js';
import {MigrationStore} from './store.js';
import {MigrationPreviews} from './previews.js';
import {createPlan,prepareSession} from './planner.js';
import {runMigration,timed} from './worker.js';
import {migrationRequestSchema,migrationStartSchema} from './validation.js';
export type MigrationRunner=(task:MigrationTask,signal:AbortSignal)=>Promise<void>;
export class MigrationService {
 readonly previews=new MigrationPreviews();private running:Promise<void>|null=null;private controller:AbortController|null=null;private currentId:string|null=null;private closing=false;
 constructor(readonly store:MigrationStore,private adapter:MysqlAdapter,private operations:OperationStore,private runner?:MigrationRunner){
  for(const t of store.recover())try{operations.finish(t.operationId,{status:t.state==='needs_review'?'needs_review':'interrupted',durationMs:Date.now()-Date.parse(t.createdAt),affectedRows:t.insertedRows+t.updatedRows,error:t.error!});}catch{}
 }
 private assertMysql(request:MigrationRequest){for(const id of [request.source.connectionId,request.target.connectionId])assertMysqlProfile(this.adapter.connections.store.get(id));}
 private async sessions<T>(request:MigrationRequest,exclusive:boolean,fn:(source:Connection,target:Connection)=>Promise<T>):Promise<T>{
  this.assertMysql(request);
  const releases:(()=>void)[]=[];const conns:Connection[]=[];
  try{
   for(const id of [...new Set([request.source.connectionId,request.target.connectionId])].sort())releases.push(exclusive?this.adapter.connections.retainExclusive(id):this.adapter.connections.retain(id));
   const source=await this.adapter.createDedicated(request.source.connectionId);conns.push(source);const target=await this.adapter.createDedicated(request.target.connectionId);conns.push(target);
   for(const c of conns)await timed(c,()=>prepareSession(c));
   return await fn(source,target);
  }finally{for(const c of conns)c.destroy();for(const release of releases.reverse())release();}
 }
 async preview(input:unknown){if(this.closing)throw new AppFault('SERVICE_CLOSING','服务正在关闭',503);const r=migrationRequestSchema.parse(input);return this.sessions(r,false,async(s,t)=>this.previews.put(await timed(s,()=>createPlan(this.adapter,r,s,t))));}
 start(input:unknown):MigrationTask {
  if(this.closing)throw new AppFault('SERVICE_CLOSING','服务正在关闭',503);
  if(this.store.list().filter(t=>['queued','running'].includes(t.state)).length>=20)throw new AppFault('QUEUE_FULL','同步/迁移队列已满，请等待任务结束',429);
  const b=migrationStartSchema.parse(input);const {plan}=this.previews.get(b.previewId);this.assertMysql(plan.request);
  if(b.confirmationSchema!==plan.request.target.schema)throw new AppFault('CONFIRMATION_REQUIRED','请输入完整目标数据库名确认',400);
  if(plan.sourceGeneration!==this.adapter.connections.generation(plan.request.source.connectionId)||plan.targetGeneration!==this.adapter.connections.generation(plan.request.target.connectionId))throw new AppFault('PLAN_CHANGED','连接已变化，请重新预检',409);
  const taskId=randomUUID();
  const operationId=this.operations.begin({taskId,type:plan.request.mode==='migrate'?'migration':'sync',connectionId:plan.request.target.connectionId,connectionName:plan.targetName,schema:plan.request.target.schema,table:plan.request.tables.join(', '),sql:`${plan.sourceName} / ${plan.request.source.schema} → ${plan.targetName} / ${plan.request.target.schema}\n${plan.request.mode==='migrate'?'CREATE TABLE + 参数化 INSERT':'按主键 SELECT FOR UPDATE + 参数化 INSERT/UPDATE；保留目标多余记录'}`});
  let task:MigrationTask;
  try{task=this.store.create(plan,operationId,taskId);}catch(e){this.operations.finish(operationId,{status:'failed',durationMs:0,error:errorInfo(e)});throw e;}
  this.previews.consume(b.previewId);queueMicrotask(()=>this.drain());return task;
 }
 cancel(id:string):void {const t=this.store.get(id);if(!['queued','running'].includes(t.state))return;this.store.patch(id,{cancelRequested:true});if(t.state==='queued'){this.store.patch(id,{state:'cancelled',finishedAt:new Date().toISOString()});this.operations.finish(t.operationId,{status:'cancelled',durationMs:0});}else if(this.currentId===id)this.controller?.abort();}
 private drain():void {
  if(this.running||this.closing)return;const task=this.store.next();if(!task)return;
  this.currentId=task.id;this.controller=new AbortController();const signal=this.controller.signal;
  this.running=(async()=>{
   let completed=false;
   try{
    this.assertMysql(task.plan.request);
    this.store.patch(task.id,{state:'running'});
    if(this.runner)await this.runner(task,signal);else await this.sessions(task.plan.request,true,(s,t)=>runMigration(this.adapter,this.store,task,s,t,signal));
    completed=true;const latest=this.store.get(task.id);const state=signal.aborted?'cancelled':'completed';
    this.operations.finish(task.operationId,{status:state,durationMs:Date.now()-Date.parse(task.createdAt),affectedRows:latest.insertedRows+latest.updatedRows});
    this.store.patch(task.id,{state,finishedAt:new Date().toISOString()});
   }catch(e){
    const latest=this.store.get(task.id);const state=completed||latest.pending||(e as {code?:string}).code==='RESULT_UNKNOWN'?'needs_review':signal.aborted?'cancelled':'failed';
    const error=completed?{code:'LOG_CONFIRMATION_FAILED',message:'任务已执行，但结束记录未确认；请核对目标数据和日志'}:errorInfo(e);
    try{this.store.patch(task.id,{state,error,finishedAt:new Date().toISOString()});}catch{}
    try{this.operations.finish(task.operationId,{status:state,durationMs:Date.now()-Date.parse(task.createdAt),affectedRows:latest.insertedRows+latest.updatedRows,error});}catch{}
   }
  })().finally(()=>{this.running=null;this.controller=null;this.currentId=null;queueMicrotask(()=>this.drain());});
 }
 async idle():Promise<void>{await Promise.resolve();while(this.running){await this.running;await Promise.resolve();}}
 async close():Promise<void>{this.closing=true;this.previews.clear();for(const t of this.store.list())if(['queued','running'].includes(t.state))try{this.cancel(t.id);}catch{if(t.id===this.currentId)this.controller?.abort();}await this.running;}
}
