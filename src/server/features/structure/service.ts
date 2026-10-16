import {assertMysqlProfile} from '../connections/service.js';
import type {Connection,ResultSetHeader,RowDataPacket} from 'mysql2/promise';
import {AppFault,errorInfo,type TableTarget} from '../../../shared/contracts.js';
import type {DdlApplyResult,StructurePreviewRequest,StructureAction,TableStructure,SchemaInfo} from '../../../shared/structure.js';
import type {MysqlAdapter} from '../../mysql/adapter.js';import type {OperationStore} from '../../local/operations.js';
import {readSchemaInfo,readTableStructure,describeStructure} from './metadata.js';import {compileDdl} from './compiler.js';import {PreviewStore} from './previews.js';import {quoteIdentifier as q,previewSchema,applySchema,targetSchema} from './validation.js';
export class StructureService {
 private previews=new PreviewStore();private closing=false;private active=new Set<Promise<DdlApplyResult>>();
 constructor(private adapter:MysqlAdapter,private operations:OperationStore){}
 private open(){if(this.closing)throw new AppFault('SERVICE_CLOSING','服务正在关闭',503);}
 describe(target:TableTarget){this.open();assertMysqlProfile(this.adapter.connections.store.get(target.connectionId));return describeStructure(this.adapter,targetSchema.parse(target));}
 private async context(conn:Connection,action:StructureAction):Promise<{schema:SchemaInfo;structure:TableStructure|null;hasRows:boolean}>{
 const schema=await readSchemaInfo(conn,action.target.schema);let structure:TableStructure|null=null,hasRows=false;
 if(action.kind==='create_table'){const [objects]=await conn.execute<RowDataPacket[]>('SELECT TABLE_NAME FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',[action.target.schema,action.target.table]);if(objects.length)throw new AppFault('TABLE_EXISTS','已有同名表或视图，请更换表名',409);}
 else {structure=await readTableStructure(conn,action.target);if(action.kind==='add_column'){const [r]=await conn.query<RowDataPacket[]>(`SELECT 1 FROM ${q(action.target.schema)}.${q(action.target.table)} LIMIT 1`);hasRows=r.length>0;}}
 return {schema,structure,hasRows};
 }
 async preview(input:StructurePreviewRequest){this.open();const parsed=previewSchema.parse(input);assertMysqlProfile(this.adapter.connections.store.get(parsed.action.target.connectionId));return this.adapter.withConnection(parsed.action.target.connectionId,undefined,async conn=>{
 const context=await this.context(conn,parsed.action);if(context.structure&&parsed.expectedFingerprint!==context.structure.fingerprint)throw new AppFault('STRUCTURE_CHANGED','页面结构已变化，请刷新后重新预览',409);
 const compiled=compileDdl(parsed.action,context);this.open();return this.previews.put({...compiled,action:parsed.action,generation:this.adapter.connections.generation(parsed.action.target.connectionId),fingerprint:context.structure?.fingerprint||null,schema:context.schema});
 });}
 apply(input:{previewId:string;confirmationTableName?:string}):Promise<DdlApplyResult>{
 try{this.open();applySchema.parse(input);const preview=this.previews.get(input.previewId);assertMysqlProfile(this.adapter.connections.store.get(preview.target.connectionId));const release=this.adapter.connections.retainExclusive(preview.target.connectionId);const promise=this.execute(input,preview,release);this.active.add(promise);void promise.then(()=>this.active.delete(promise),()=>this.active.delete(promise));return promise;}catch(error){return Promise.reject(error);}
 }
 private async execute(input:{previewId:string;confirmationTableName?:string},p:ReturnType<PreviewStore['get']>,release:()=>void):Promise<DdlApplyResult>{
 const started=Date.now();let conn:Connection|undefined,operationId:string|undefined,sent=false,ddlSucceeded=false,expired=false;let rejectDeadline!:(e:Error)=>void;
 const deadline=new Promise<never>((_,reject)=>{rejectDeadline=reject;});
 const timer=setTimeout(()=>{expired=true;conn?.destroy();rejectDeadline(new AppFault('DDL_TIMEOUT','执行超过 60 秒，结果需核对',409));},60_000);
 const timed=<T>(promise:Promise<T>):Promise<T>=>Promise.race([promise,deadline]);
 try{
 assertMysqlProfile(this.adapter.connections.store.get(p.target.connectionId));
 if(p.generation!==this.adapter.connections.generation(p.target.connectionId))throw new AppFault('CONNECTION_CHANGED','连接已变化，请重新预览',409);
 if(p.confirmationTableName!==null&&input.confirmationTableName!==p.confirmationTableName)throw new AppFault('CONFIRMATION_REQUIRED','请输入完整表名确认删除');
 const creating=this.adapter.createDedicated(p.target.connectionId);void creating.then(c=>{if(expired)c.destroy();},()=>{});conn=await timed(creating);
 await timed(conn.query("SET time_zone='+00:00', SESSION sql_mode='STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION', SESSION lock_wait_timeout=10"));
 const context=await timed(this.context(conn,p.action));
 if((context.structure?.fingerprint||null)!==p.fingerprint||JSON.stringify(context.schema)!==JSON.stringify(p.schema))throw new AppFault('STRUCTURE_CHANGED','表结构或数据库设置已变化，请重新预览',409);
 const checked=compileDdl(p.action,context);if(checked.sql!==p.sql)throw new AppFault('STRUCTURE_CHANGED','预览条件已变化，请重新预览',409);
 // Recheck TTL after potentially slow metadata reads, before logging or sending SQL.
 this.previews.get(p.previewId);
 operationId=this.operations.begin({type:'schema_change',connectionId:p.target.connectionId,connectionName:this.adapter.connections.store.get(p.target.connectionId).name,schema:p.target.schema,table:p.target.table,sql:p.sql});
 this.previews.consume(p.previewId);sent=true;
 const [result]=await timed(conn.query<ResultSetHeader>(p.sql));ddlSucceeded=true;let warnings:string[]=[];
 if(result.warningStatus){const [r]=await timed(conn.query<RowDataPacket[]>('SHOW WARNINGS LIMIT 20'));warnings=r.map(w=>`${w.Code}: ${w.Message}`);if(!warnings.length)warnings=['数据库返回 warning，请核对结构和数据。'];}
 const status=warnings.length?'needs_review' as const:'completed' as const;let structure:TableStructure|undefined,refreshError;
 try{structure=await timed(readTableStructure(conn,p.target));}catch(error){refreshError=errorInfo(error);}
 this.operations.finish(operationId,{status,durationMs:Date.now()-started,...(warnings.length?{error:{code:'DDL_WARNING',message:warnings.join('；')}}:{})});
 return {operationId,status,structure,refreshError,warnings};
 }catch(error){
 if(!operationId)throw error;
 const info=errorInfo(error);const definitelyRejected=sent&&!ddlSucceeded&&info.mysqlCode!==undefined;
 const status=definitelyRejected?'failed':'needs_review';try{this.operations.finish(operationId,{status,durationMs:Date.now()-started,error:info});}catch{/* A durable running record is recovered as needs_review after restart. */}
 if(!sent)throw error;
 if(definitelyRejected)throw Object.assign(error as object,{operationId});
 throw new AppFault('RESULT_UNKNOWN','执行结果需核对，请查看操作日志并刷新真实结构，勿直接重复变更',409,operationId);
 }finally{clearTimeout(timer);conn?.destroy();release();}
 }
 async close():Promise<void>{this.closing=true;await Promise.allSettled([...this.active]);this.previews.clear();}
}
