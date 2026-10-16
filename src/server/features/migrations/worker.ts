import type {Connection,RowDataPacket,ResultSetHeader} from 'mysql2/promise';
import {AppFault,type DataRow} from '../../../shared/contracts.js';
import type {MigrationTask,MigrationCounts} from '../../../shared/migrations.js';
import type {MysqlAdapter} from '../../mysql/adapter.js';
import {bindCell,decodeCell,textTypeCast} from '../../mysql/values.js';
import {coreConnection} from '../sql/service.js';
import {quoteIdentifier as q} from '../structure/validation.js';
import {inspectTable,tableMeta,createPlan,samePlan,qualified} from './planner.js';
import {rowDecision} from './policy.js';
import type {MigrationStore} from './store.js';
const deadline=60_000;
export async function timed<T>(conn:Connection,fn:()=>Promise<T>):Promise<T>{
 let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([fn(),new Promise<never>((_,reject)=>{timer=setTimeout(()=>{conn.destroy();reject(new AppFault('QUERY_TIMEOUT','数据库操作超过 60 秒，连接已关闭'));},deadline);})]);}finally{clearTimeout(timer);}
}
function rejectedByServer(e:unknown):boolean{return (e as {code?:string}).code?.startsWith('ER_')===true;}
export async function runMigration(adapter:MysqlAdapter,store:MigrationStore,task:MigrationTask,source:Connection,target:Connection,signal:AbortSignal):Promise<void>{
 const plan=task.plan;const request=plan.request;
 const patch=(p:Partial<MigrationTask>)=>Object.assign(task,store.patch(task.id,p));
 const tablePatch=(name:string,values:Partial<MigrationTask['tables'][number]>)=>patch({tables:task.tables.map(t=>t.name===name?{...t,...values}:t)});
 const fresh=await timed(source,()=>createPlan(adapter,request,source,target));samePlan(plan,fresh);
 await timed(source,()=>source.query('SET TRANSACTION ISOLATION LEVEL REPEATABLE READ'));
 await timed(source,()=>source.query('START TRANSACTION WITH CONSISTENT SNAPSHOT, READ ONLY'));
 // Transaction-duration metadata locks keep selected source definitions stable.
 for(const p of plan.tables)await timed(source,()=>source.query(`SELECT 1 FROM ${qualified(request.source.schema,p.name)} LIMIT 0`));
 const [packet]=await timed(target,()=>target.query<RowDataPacket[]>('SELECT @@max_allowed_packet AS bytes'));
 const budget=Math.min(8*1024*1024,Math.floor(Number(packet[0].bytes)/2));
 for(const p of plan.tables){
  if(signal.aborted)break;patch({currentTable:p.name});
  // Inspect and acquire a source metadata lock before creating the target.
  const s=await timed(source,()=>inspectTable(source,request.source.connectionId,request.source.schema,p.name));
  if(s.fingerprint!==p.sourceFingerprint)throw new AppFault('PLAN_CHANGED',`${p.name}：源结构已变化，停止执行`);
  const meta=tableMeta(s);const columns=p.writeColumns.map(name=>meta.columns.find(c=>c.name===name)!);
  const targetTable=qualified(request.target.schema,p.name);
  if(p.createSql){
   patch({pending:{table:p.name,phase:'create',firstRow:0,lastRow:0}});
   let confirmed=false;
   try {
    const [result]=await timed(target,()=>target.query<ResultSetHeader>(p.createSql!));
    if(result.warningStatus)throw new AppFault('RESULT_UNKNOWN','建表已执行但有 MySQL warning，请核对结构');
    confirmed=true;tablePatch(p.name,{created:true});patch({pending:null});
   }catch(e){if(!confirmed&&rejectedByServer(e)){patch({failedBatch:task.pending,pending:null});throw e;}throw new AppFault('RESULT_UNKNOWN',`${p.name}：建表或本地确认结果待核对，勿直接重试`);}
   const created=await timed(target,()=>inspectTable(target,request.target.connectionId,request.target.schema,p.name));
   if(created.fingerprint!==p.sourceFingerprint)throw new AppFault('STRUCTURE_MISMATCH',`${p.name}：目标创建后结构与源不同，未复制数据`);
  }
  const insertSql=`INSERT INTO ${targetTable} (${columns.map(c=>q(c.name)).join(',')}) VALUES (${columns.map(()=>'?').join(',')})`;
  const updateColumns=columns.filter(c=>!p.primaryKey.includes(c.name));
  const where=p.primaryKey.map(k=>`${q(k)}=?`).join(' AND ');
  const selectSql=`SELECT ${columns.map(c=>q(c.name)).join(',')} FROM ${targetTable} WHERE ${where} FOR UPDATE`;
  const updateSql=`UPDATE ${targetTable} SET ${updateColumns.map(c=>`${q(c.name)}=?`).join(',')} WHERE ${where}`;
  let seen=0;let batch:DataRow[]=[];let bytes=0;
  const flush=async()=>{
   if(!batch.length)return;
   if(signal.aborted){batch=[];return;}
   const counts:MigrationCounts={readRows:0,insertedRows:0,updatedRows:0,unchangedRows:0};
   patch({pending:{table:p.name,phase:'data',firstRow:seen-batch.length+1,lastRow:seen}});
   let committing=false;
   try {
    await timed(target,()=>target.beginTransaction());
    await timed(target,()=>target.query(`SELECT 1 FROM ${targetTable} LIMIT 0`));
    const current=await timed(target,()=>inspectTable(target,request.target.connectionId,request.target.schema,p.name));
    if(current.fingerprint!==p.sourceFingerprint)throw new AppFault('STRUCTURE_MISMATCH',`${p.name}：目标结构已改变，当前批次未写入`);
    for(const row of batch){
     const params=columns.map(c=>bindCell(c,row[c.name]));let decision:'insert'|'update'|'unchanged'='insert';
     const keyValues=p.primaryKey.map(k=>bindCell(meta.columns.find(c=>c.name===k)!,row[k]));
     if(request.mode==='sync'){
      const [rows]=await timed(target,()=>target.query<RowDataPacket[]>({sql:selectSql,values:keyValues,typeCast:textTypeCast}));
      if(rows.length>1)throw new AppFault('PRIMARY_KEY_MATCH','主键匹配返回多行，已停止');
      const old=rows[0]?Object.fromEntries(columns.map(c=>[c.name,decodeCell(c,rows[0][c.name])])) as DataRow:undefined;
      decision=rowDecision(p.writeColumns,row,old);
     }
     if(decision!=='unchanged'){
      const [result]=await timed(target,()=>target.execute<ResultSetHeader>(decision==='insert'?insertSql:updateSql,decision==='insert'?params:[...updateColumns.map(c=>bindCell(c,row[c.name])),...keyValues]));
      if(result.warningStatus)throw new AppFault('MYSQL_WARNING','MySQL 数据转换 warning，当前批次回滚');
     }
     counts[decision==='insert'?'insertedRows':decision==='update'?'updatedRows':'unchangedRows']++;
    }
    committing=true;await timed(target,()=>target.commit());
    const old=task.tables.find(t=>t.name===p.name)!;
    // One SQLite update atomically confirms all counts and clears the pending marker.
    patch({pending:null,insertedRows:task.insertedRows+counts.insertedRows,updatedRows:task.updatedRows+counts.updatedRows,unchangedRows:task.unchangedRows+counts.unchangedRows,tables:task.tables.map(t=>t===old?{...t,insertedRows:t.insertedRows+counts.insertedRows,updatedRows:t.updatedRows+counts.updatedRows,unchangedRows:t.unchangedRows+counts.unchangedRows}:t)});
   }catch(e){
    if(committing)throw new AppFault('RESULT_UNKNOWN',`${p.name}：批次提交或本地确认未完成，请核对目标数据`);
    try{await timed(target,()=>target.rollback());}catch{throw new AppFault('RESULT_UNKNOWN',`${p.name}：批次回滚未确认，请核对目标数据`);}
    patch({failedBatch:task.pending,pending:null});throw e;
   }
   batch=[];bytes=0;
  };
  const core=coreConnection(source);
  const stream=core.query({sql:`SELECT ${columns.map(c=>q(c.name)).join(',')} FROM ${qualified(request.source.schema,p.name)}${p.primaryKey.length?` ORDER BY ${p.primaryKey.map(q).join(',')}`:''}`,typeCast:textTypeCast}).stream({highWaterMark:16});
  let timer:ReturnType<typeof setTimeout>|undefined;
  const reset=()=>{clearTimeout(timer);timer=setTimeout(()=>{stream.destroy(new AppFault('SOURCE_TIMEOUT','源数据读取超过 60 秒无进展'));source.destroy();},deadline);};
  const abort=()=>{stream.destroy(new AppFault('CANCELLED','已请求取消；已提交批次保留'));source.destroy();};signal.addEventListener('abort',abort,{once:true});reset();if(signal.aborted)abort();
  try {
   for await(const raw of stream){
    clearTimeout(timer);
    const row=Object.fromEntries(columns.map(c=>[c.name,decodeCell(c,raw[c.name])])) as DataRow;
    const size=Buffer.byteLength(JSON.stringify(row))*2+1024;
    if(size>budget)throw new AppFault('ROW_TOO_LARGE',`${p.name}：源记录 ${seen+1} 超出目标数据包预算`);
    if(batch.length&&(batch.length>=request.batchSize||bytes+size>budget))await flush();
    if(signal.aborted)break;
    batch.push(row);bytes+=size;seen++;
    if(seen%50===0){const old=task.tables.find(t=>t.name===p.name)!;patch({readRows:task.readRows+seen-old.readRows,tables:task.tables.map(t=>t===old?{...t,readRows:seen}:t)});}
    reset();
   }
   clearTimeout(timer);await flush();
  }finally{
   clearTimeout(timer);signal.removeEventListener('abort',abort);stream.destroy();
   const old=task.tables.find(t=>t.name===p.name)!;
   patch({readRows:task.readRows+seen-old.readRows,tables:task.tables.map(t=>t===old?{...t,readRows:seen}:t)});
  }
  if(signal.aborted)break;tablePatch(p.name,{completed:true});
 }
 patch({currentTable:null});
}
