import {MigrationWorkspace} from './features/migrations/MigrationWorkspace';
import { useEffect, useState, useCallback } from 'react';
import { api, bootstrap } from './api/client';
import type { ConnectionProfile } from '../server/features/connections/types';
import { ConnectionManager } from './features/connections/ConnectionManager';
import { DatabaseTree } from './features/data/DatabaseTree';
import { DataGrid } from './features/data/DataGrid';
import type {TableTarget} from '../shared/contracts';
import {SqlEditor} from './features/sql/SqlEditor';
import{TaskList}from'./features/transfers/TaskList';
import{OperationLogs}from'./features/logs/OperationLogs';
import {StructurePanel} from './features/structure/StructurePanel';
import {CreateTableDialog} from './features/structure/CreateTableDialog';
import {StructureReadPanel} from './features/structure/StructureReadPanel';
import {connectionEndpoint,connectionKind} from './features/connections/database-options';
export function App() {
  const [error,setError] = useState('');
  const [connections,setConnections]=useState<ConnectionProfile[]>([]);
  const [dialog,setDialog]=useState<ConnectionProfile|null|undefined>(undefined);
  const [target,setTarget]=useState<TableTarget|null>(null);
  const [tab,setTab]=useState('data');const [sqlOpened,setSqlOpened]=useState(false);
  const [dirty,setDirty]=useState<Record<string,number>>({});
  const dirtyChange=useCallback((t:TableTarget,count:number)=>{const key=JSON.stringify(t);setDirty(old=>old[key]===count?old:{...old,[key]:count});},[]);
  const [pendingTarget,setPendingTarget]=useState<{target:TableTarget;tab:string}>();
  const selectTarget=(next:TableTarget,nextTab='data')=>{if(target&&JSON.stringify(target)!==JSON.stringify(next)&&dirty[JSON.stringify(target)]){setPendingTarget({target:next,tab:nextTab});return;}setTarget(next);setTab(nextTab);};
  const [treeRevision,setTreeRevision]=useState(0);const [dataRevision,setDataRevision]=useState(0);const [createTable,setCreateTable]=useState<{connectionId:string;schema:string}>();
  const changed=(t:TableTarget)=>{setTreeRevision(r=>r+1);if(target&&JSON.stringify(t)===JSON.stringify(target)&&!dirty[JSON.stringify(t)])setDataRevision(r=>r+1);};
  useEffect(()=>{const listener=()=>{if(location.hash==='#logs')setTab('logs');};window.addEventListener('hashchange',listener);return()=>window.removeEventListener('hashchange',listener);},[]);
  const migrationChanged=useCallback(()=>{setTreeRevision(r=>r+1);if(!Object.values(dirty).some(n=>n>0))setDataRevision(r=>r+1);},[dirty]);
  const refresh=()=>api<ConnectionProfile[]>('/connections').then(setConnections);
  useEffect(() => { void bootstrap().then(refresh).catch(error => setError(error.message)); },[]);
  return <div className="app-shell">
    <aside className="sidebar"><div className="brand"><span className="brand-icon">▤</span><div>数据库工作台<small>LOCAL WORKSPACE</small></div></div>
      <div className="sidebar-heading">我的连接 <button className="icon-button" aria-label="新建连接" onClick={()=>setDialog(null)}>＋</button></div>{connections.map(conn=><button key={conn.id} className="connection-item" onClick={()=>setDialog(conn)}><span className={conn.connected?'status-dot':'offline-dot'}/><span>{conn.name}<small>{connectionEndpoint(conn)} </small></span><span>⚙</span></button>)}{!connections.length&&<p className="sidebar-hint">添加一个数据库连接，开始管理数据。</p>}
      <DatabaseTree revision={treeRevision} onCreateTable={setCreateTable} connections={connections} target={target} onSelect={t=>selectTarget(t)}/><div className="sidebar-footer"><span className="status-dot"/> 仅在本机运行</div></aside>
    <main><header className="topbar"><div><span className="eyebrow">工作区</span><strong>{target?`${connections.find(c=>c.id===target.connectionId)?.name} / ${target.schema} / ${target.table}`:'数据库助手'}</strong></div><span className="local-badge">LOCAL · DATABASE</span></header>
      {error && <div className="error-banner" role="alert">{error}</div>}
      <nav className="workspace-tabs"><button disabled={!target} className={tab==='structure'?'active':''} onClick={()=>setTab('structure')}>▤ 表结构</button><button className={tab==='data'?'active':''} onClick={()=>setTab('data')}>▦ 数据</button><button className={tab==='sql'?'active':''} onClick={()=>{setSqlOpened(true);setTab('sql');}}>⌘ SQL 查询</button>{connections.some(c=>connectionKind(c)==='mysql')&&<button className={tab==='migrations'?'active':''} onClick={()=>setTab('migrations')}>⇄ 同步与迁移</button>}<button className={tab==='tasks'?'active':''} onClick={()=>setTab('tasks')}>↥↧ 传输任务</button><button className={tab==='logs'?'active':''} onClick={()=>setTab('logs')}>◷ 操作日志</button></nav>
      <div hidden={tab!=='data'}>{target?<DataGrid key={`${JSON.stringify(target)}/${dataRevision}`} target={target} onDirtyChange={dirtyChange} onTransferStarted={()=>setTab('tasks')}/>:<section className="welcome"><span className="welcome-icon">▤</span><span className="eyebrow">YOUR DATA, YOUR WORKSPACE</span><h1>{connections.some(c=>c.connected)?'选择一张数据表':'从一个连接开始'}</h1><p>浏览数据、执行 SQL、导入导出。<br/>所有连接配置和操作记录，都保存在这台 Mac。</p><button className="primary" onClick={()=>setDialog(null)}>＋ 新建数据库连接</button><div className="welcome-features"><span>数据操作</span><span>导入与导出</span><span>操作日志</span></div></section>}</div>{tab==='structure'&&target&&(connectionKind(connections.find(c=>c.id===target.connectionId))!=='mysql'?<StructureReadPanel target={target}/>:<StructurePanel key={JSON.stringify(target)} target={target} blockedByDataEdits={!!dirty[JSON.stringify(target)]} onChanged={changed}/ >)}{sqlOpened&&<div hidden={tab!=='sql'}><SqlEditor connections={connections} defaultConnection={target?.connectionId} defaultDatabase={target?.schema} onExportStarted={()=>setTab('tasks')}/></div>}{tab==='migrations'&&<MigrationWorkspace connections={connections} onChanged={migrationChanged} blockedByDataEdits={Object.values(dirty).some(n=>n>0)}/ >}{tab==='tasks'&&<TaskList/>}{tab==='logs'&&<OperationLogs connections={connections}/>}
    </main>{createTable&&<CreateTableDialog {...createTable} onClose={()=>setCreateTable(undefined)} onExecuted={changed} onCreated={t=>{setCreateTable(undefined);selectTarget(t,'structure');setTreeRevision(r=>r+1);}}/>}{pendingTarget&&<div className="modal-backdrop"><section className="modal" role="dialog" aria-label="切换表确认"><h2>当前表有暂存变更</h2><p>切换到 {pendingTarget.target.table} 前，请先处理 {target?.table} 的暂存数据。返回当前表可继续提交或编辑。</p><div className="modal-footer"><button className="primary" onClick={()=>{setPendingTarget(undefined);setTab('data');}}>返回当前表</button><button onClick={()=>{setTarget(pendingTarget.target);setTab(pendingTarget.tab);setPendingTarget(undefined);}}>丢弃变更并切换</button></div></section></div>}{dialog!==undefined&&<ConnectionManager profile={dialog||undefined} onClose={()=>setDialog(undefined)} onSaved={()=>void refresh()}/>}</div>;
}
