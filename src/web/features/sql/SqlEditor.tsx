import {useState,useEffect,useRef} from 'react';
import {api} from '../../api/client';
import type {ConnectionProfileInput as ConnectionProfile} from '../../../server/features/connections/types';
import type {SqlResult,SqlCompletions} from '../../../server/features/sql/types';
import {LIMITS} from '../../../shared/limits';
import {Cell} from '../data/DataGrid';
import {QueryResultExportDialog} from './QueryResultExportDialog';
import type {QueryExportSource} from '../../../shared/query-export';
import {SqlCodeEditor} from './SqlCodeEditor';
import {QuerySqlPreview} from './QuerySqlPreview';

import {connectionKind,namespaceLabel,sqlExample} from '../connections/database-options';
import type {DatabaseContext} from '../../../shared/database';
const rowPreference='mwa.sql.maxRows';
const noTables:SqlCompletions['tables']=[];
function validRows(value:string){return /^\d+$/.test(value)&&Number(value)>=1&&Number(value)<=LIMITS.resultRows;}
function savedRows(){try{const saved=localStorage.getItem(rowPreference);if(saved&&validRows(saved))return saved;}catch{}return String(LIMITS.defaultResultRows);}
export function SqlEditor({connections,defaultConnection='',defaultDatabase='',onExportStarted}:{onExportStarted?:()=>void;connections:ConnectionProfile[];defaultConnection?:string;defaultDatabase?:string}) {
 const [exportOpen,setExportOpen]=useState(false);const [resultSource,setResultSource]=useState<QueryExportSource>();
 const [connectionId,setConnectionId]=useState(defaultConnection||connections.find(c=>c.connected)?.id||'');
 const [database,setDatabase]=useState(defaultDatabase);const [schemas,setSchemas]=useState<string[]>([]);
 const selected=connections.find(c=>c.id===connectionId),kind=connectionKind(selected),generation=selected?.generation??0;
 const sqlDirty=useRef(false);const [sql,setSql]=useState(()=>sqlExample(kind));
 useEffect(()=>{if(!sqlDirty.current)setSql(sqlExample(kind));},[kind]);
 const changeSql=(value:string)=>{if(value!==sql)sqlDirty.current=true;setSql(value);};const [result,setResult]=useState<SqlResult>();
 const [executedSql,setExecutedSql]=useState('');
 const [error,setError]=useState('');const [busy,setBusy]=useState(false);const [maxRows,setMaxRows]=useState(savedRows);
 const [refresh,setRefresh]=useState(0);
 const [completion,setCompletion]=useState<{key:string;data?:SqlCompletions;error?:string}>();
 const connected=!!connections.find(c=>c.id===connectionId)?.connected;
 const completionKey=JSON.stringify([connectionId,database,connected,generation,refresh]);
 const currentCompletion=completion?.key===completionKey?completion:undefined;
 const resultNeedsReview=result?.executionState?result.executionState==='needs_review':!!result?.needsReview;
 const canExecute=!busy&&!exportOpen&&connected&&!!sql.trim()&&validRows(maxRows);
 useEffect(()=>{
  let alive=true;setSchemas([]);
  if(connected&&kind!=='mysql')void api<DatabaseContext>(`/connections/${connectionId}/context`).then(context=>{if(alive)setDatabase(current=>current||context.defaultNamespace||'');}).catch(e=>{if(alive)setError(e.message);});
  if(connected)void api<{schemas:string[]}>(`/connections/${connectionId}/schemas`).then(r=>{if(alive)setSchemas(r.schemas);}).catch(e=>{if(alive)setError(e.message);});
  return()=>{alive=false;};
 },[connectionId,connected,generation,kind]);
 useEffect(()=>{
  let alive=true;
  if(connected&&database)void api<SqlCompletions>('/sql/completions',{method:'POST',body:JSON.stringify({connectionId,database})}).then(data=>{if(alive)setCompletion({key:completionKey,data});}).catch(e=>{if(alive)setCompletion({key:completionKey,error:e.message});});
  return()=>{alive=false;};
 },[completionKey,connectionId,database,connected]);
 function changeRows(value:string){setMaxRows(value);if(validRows(value))try{localStorage.setItem(rowPreference,String(Number(value)));}catch{}}
 async function execute(){
  if(!canExecute)return;
  const source={connectionId,connectionName:connections.find(c=>c.id===connectionId)?.name||connectionId,database};
  setBusy(true);setError('');setResult(undefined);setResultSource(undefined);
  try{const loaded=await api<SqlResult>('/sql/execute',{method:'POST',body:JSON.stringify({connectionId,database,sql,maxRows:Number(maxRows)})});setResult(loaded);setExecutedSql(sql);setResultSource({...source,operationId:loaded.operationId});}
  catch(e){setError((e as Error).message);}
  finally{setBusy(false);setRefresh(r=>r+1);}
 }
 return <section className="sql-workspace">
  <div className="toolbar sql-toolbar"><strong>SQL 查询</strong><span className="spacer"/>
   <select aria-label="SQL 连接" value={connectionId} disabled={busy||exportOpen} onChange={e=>{setConnectionId(e.target.value);setDatabase('');}}><option value="">选择连接</option>{connections.filter(c=>c.connected).map(c=><option value={c.id} key={c.id}>{c.name}</option>)}</select>
   <select aria-label={kind==='mysql'?'SQL 数据库':`SQL ${namespaceLabel(kind)}`} value={database} disabled={busy||exportOpen} onChange={e=>setDatabase(e.target.value)}><option value="">选择{namespaceLabel(kind)}</option>{schemas.map(s=><option key={s}>{s}</option>)}</select>
   <label className="sql-row-limit">最多 <input aria-label="查询行数" type="number" min="1" max={LIMITS.resultRows} step="1" value={maxRows} disabled={busy||exportOpen} aria-invalid={!validRows(maxRows)} onChange={e=>changeRows(e.target.value)}/> 行</label>
   <button className="primary" disabled={!canExecute} onClick={()=>void execute()}>{busy?'执行中…':'▶ 执行 SQL'}</button>
  </div>
  {!validRows(maxRows)&&<p className="warning" role="alert">查询行数请输入 1–1,000 的整数。</p>}
  <p className="notice">每次执行使用独立会话，只支持一条 SQL。用户变量、临时表及事务不会跨执行保留。{kind==='mysql'?'写入按 MySQL 自身规则生效。':kind==='oracle'?'普通语句确认提交后完成，DDL 按 Oracle 规则隐式提交。':'语句执行完成并确认提交后生效。'}</p>
  <div className="sql-editor-frame"><span className="editor-label">SQL · {kind} · {database||'无默认数据库'}</span>
   <SqlCodeEditor kind={kind} value={sql} onChange={changeSql} onExecute={()=>void execute()} database={connected?database:''} tables={currentCompletion?.data?.tables??noTables}/>
   <div className="editor-footer"><span className={currentCompletion?.error?'warning':'completion-status'}>
    {!connected||!database?'选择数据库后提示表名与字段':currentCompletion?.error?'表字段提示暂不可用，仍可提示关键字和函数':currentCompletion?.data?`${currentCompletion.data.tables.length} 个表 / 视图${currentCompletion.data.truncated?'（结构较大，仅加载前 5,000 个字段）':''}`:'正在加载表字段提示…'}
   </span><button className="completion-refresh" disabled={!connected||!database||busy||exportOpen} onClick={()=>setRefresh(r=>r+1)}>刷新提示</button><span className="editor-shortcut">Ctrl Space 提示 · Tab / Enter 补全 · ⌘ Enter 执行</span></div>
  </div>
  {error&&<div className="error-banner" role="alert">{error}</div>}
  {result&&<><div className="toolbar"><span className={resultNeedsReview?'warning':'success'}>{resultNeedsReview?'结果待核对':'✓ 执行完成'}</span><span className="chip">{result.durationMs} ms</span><span>{result.columns.length?`${result.rows.length} 行结果`:`${result.affectedRows} 行受影响`}</span>{result.truncated&&<span className="warning">结果已截断（最多 {result.maxRows.toLocaleString()} 行 / 10 MiB）</span>}{result.columns.length>0&&resultSource&&<><span className="spacer"/><button aria-label="导出查询结果" disabled={busy||exportOpen} onClick={()=>setExportOpen(true)}>↧ 导出查询结果</button></>}</div>
   {resultNeedsReview&&<p className="notice">执行被中断，显示的结果可能不完整；请核对数据库状态后再决定是否重试。</p>}
   <QuerySqlPreview sql={executedSql} caption="已执行 SQL" note="对应下方结果；编辑器后续修改不会改变此语句。"/>
   <div className="grid-scroll"><table className="data-table"><thead><tr>{result.columns.map((c,i)=><th key={i}>{c.name}<small>{c.dataType}</small></th>)}</tr></thead><tbody>{result.rows.map((r,i)=><tr key={i}>{r.map((v,j)=><td key={j}><Cell value={v}/></td>)}</tr>)}</tbody></table></div></>}
  {exportOpen&&result&&resultSource&&<QueryResultExportDialog result={result} source={resultSource} onClose={()=>setExportOpen(false)} onStarted={()=>{setExportOpen(false);onExportStarted?.();}}/>}
 </section>;
}
