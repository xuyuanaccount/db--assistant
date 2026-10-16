import {useEffect,useState} from 'react';
import {api} from '../../api/client';
import type {TableTarget} from '../../../shared/contracts';
import type {DatabaseStructure} from '../../../shared/database';
export function StructureReadPanel({target}:{target:TableTarget}){
 const [structure,setStructure]=useState<DatabaseStructure>(),[error,setError]=useState('');
 useEffect(()=>{const controller=new AbortController();setStructure(undefined);setError('');void api<DatabaseStructure>('/database/structure/describe',{method:'POST',body:JSON.stringify(target),signal:controller.signal}).then(value=>{if(!controller.signal.aborted)setStructure(value);}).catch(e=>{if(!controller.signal.aborted)setError(e.message);});return()=>controller.abort();},[target]);
 return <section className="content-page"><h2>{target.table} · 结构查看</h2><p className="notice">只读结构信息；可通过 SQL 编辑器手工执行受支持的 DDL。</p>{error&&<p role="alert" className="error-banner">{error}</p>}{structure&&<>
 <p>{structure.databaseKind} · {structure.objectKind} · 主键：{structure.primaryKey.join('、')||'无'}</p>
 <table className="data-table"><thead><tr><th>字段</th><th>原生类型</th><th>允许 NULL</th><th>默认值</th><th>生成 / Identity</th><th>注释</th></tr></thead><tbody>{structure.columns.map(c=><tr key={c.name}><td>{c.name}</td><td>{c.columnType}</td><td>{c.nullable?'是':'否'}</td><td>{c.defaultSql??'—'}</td><td>{c.generated?'生成列':c.identity}</td><td>{c.comment}</td></tr>)}</tbody></table>
 <h3>索引</h3>{structure.indexes.map(i=><p key={i.name}>{i.name} · {i.unique?'唯一':'非唯一'} · {i.columns.map(c=>`${c.name??c.expression??'表达式不可用'} ${c.direction??''}`).join('、')}{i.predicate&&` WHERE ${i.predicate}`}</p>)}
 <h3>外键与 CHECK</h3>{[...structure.foreignKeys,...structure.checks].map((c,i)=><pre key={i}>{c.name}: {c.definition}</pre>)}
 <h3>{structure.definition.kind==='summary'?'结构摘要（非完整建表 SQL）':'原始定义'}</h3><pre className="sql-detail">{structure.definition.text??structure.definition.reason??'不可用'}</pre>{structure.unavailableReasons.map((r,i)=><p key={i} className="notice">{r}</p>)}
 </>}</section>;
}
