import { useState } from 'react';
import { api } from '../../api/client';
import type { ConnectionProfile, ConnectionDraft } from '../../../server/features/connections/types';
import {connectionDefaults,databaseLabels,supportedDatabaseKinds} from './database-options';
import type {DatabaseKind} from '../../../shared/database';
export function ConnectionManager({profile,onClose,onSaved}: {profile?:ConnectionProfile;onClose:()=>void;onSaved:(profile:ConnectionProfile)=>void}) {
  const [draft,setDraft]=useState<ConnectionDraft>(profile || connectionDefaults('mysql'));
  const [password,setPassword]=useState(''); const [busy,setBusy]=useState(false); const [message,setMessage]=useState('');
  const change=(key:string,value:string|number|boolean)=>setDraft(old=>({...old,[key]:value} as ConnectionDraft));
  async function run(kind:'test'|'save'|'connect'|'delete'|'disconnect') {
    setBusy(true);setMessage('');
    try {
      if(kind==='test') {await api('/connections/test',{method:'POST',body:JSON.stringify({draft,password})});setMessage('连接测试成功');return;}
      if(kind==='delete'&&profile) {await api(`/connections/${profile.id}`,{method:'DELETE'});onClose();onSaved(profile);return;}
      if(kind==='disconnect'&&profile) {await api(`/connections/${profile.id}/disconnect`,{method:'POST'});onSaved({...profile,connected:false});onClose();return;}
      const saved=await api<ConnectionProfile>(profile?`/connections/${profile.id}`:'/connections',{method:profile?'PATCH':'POST',body:JSON.stringify(draft)});
      if(kind==='connect') {await api(`/connections/${saved.id}/connect`,{method:'POST',body:JSON.stringify({password})});saved.connected=true;}
      setPassword('');onSaved(saved);onClose();
    } catch(error) {setMessage((error as Error).message);} finally {setBusy(false);}
  }
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-label="数据库连接"><div className="modal-header"><div><span className="eyebrow">CONNECTION</span><h2>{profile?'管理连接':'新建数据库连接'}</h2></div><button onClick={onClose} disabled={busy} aria-label="关闭">×</button></div>
    <form onSubmit={e=>{e.preventDefault();void run('connect');}}><div className="form-grid">
      <label className="full">连接名称<input value={draft.name} onChange={e=>change('name',e.target.value)} required/></label>
      <label className="full">数据库类型<select value={draft.kind} onChange={e=>{const next=e.target.value as DatabaseKind;if(!supportedDatabaseKinds.includes(next))return;setDraft({...connectionDefaults(next),name:draft.name});setPassword('');}}>{Object.entries(databaseLabels).filter(([kind])=>supportedDatabaseKinds.includes(kind as DatabaseKind)).map(([kind,label])=><option key={kind} value={kind}>{label}</option>)}</select></label>
      {draft.kind==='sqlite'?<><label className="full">文件绝对路径<input value={draft.filePath} onChange={e=>change('filePath',e.target.value)} required placeholder="/path/to/existing.sqlite"/></label><label className="checkbox"><input type="checkbox" checked={draft.readOnly} onChange={e=>change('readOnly',e.target.checked)}/>只读连接</label><p className="notice">连接本机已存在的数据库文件，不会新建文件。</p></>:<>
      <label>主机<input value={draft.host} onChange={e=>change('host',e.target.value)} required/></label><label>端口<input type="number" min="1" max="65535" value={draft.port} onChange={e=>change('port',Number(e.target.value))} required/></label>
      <label>用户名<input value={draft.username} autoComplete="off" onChange={e=>change('username',e.target.value)} required/></label><label>密码<input type="password" value={password} autoComplete="off" onChange={e=>setPassword(e.target.value)} placeholder="仅在本次运行中保留"/></label>
      {draft.kind==='mysql'?<label className="full">默认数据库（可选）<input value={draft.defaultDatabase||''} onChange={e=>change('defaultDatabase',e.target.value)}/></label>:draft.kind==='postgresql'?<><label>数据库<input value={draft.database} required onChange={e=>change('database',e.target.value)}/></label><label>默认 schema<input value={draft.defaultSchema} onChange={e=>change('defaultSchema',e.target.value)}/></label></>:<><label>服务名<input value={draft.serviceName} required onChange={e=>change('serviceName',e.target.value)}/></label><label>默认 owner（可选）<input value={draft.defaultSchema||''} onChange={e=>change('defaultSchema',e.target.value)}/></label></>}
      <label className="full checkbox"><input type="checkbox" checked={draft.tls} onChange={e=>change('tls',e.target.checked)}/> 使用 TLS 并验证服务端证书及主机名</label></>}
    </div><p className="notice">密码不会保存到磁盘；服务重启后需重新输入。</p>{message&&<div role="status" className="notice">{message}</div>}
    <div className="modal-footer"><button type="button" disabled={busy} onClick={()=>void run('test')}>测试连接</button><span className="spacer"/>{profile&&<button type="button" disabled={busy} onClick={()=>void run(profile.connected?'disconnect':'delete')}>{profile.connected?'断开':'删除配置'}</button>}<button type="button" disabled={busy} onClick={()=>void run('save')}>仅保存</button><button className="primary" disabled={busy} type="submit">{busy?'连接中…':'保存并连接'}</button></div></form>
  </section></div>;
}
