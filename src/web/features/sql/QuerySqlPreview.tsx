import {useEffect,useState} from 'react';
export function QuerySqlPreview({sql,template,parameters,reason,caption='本次查询 SQL',note}:{sql:string|null;template?:string;parameters?:unknown[];reason?:string;caption?:string;note?:string}) {
 const [copied,setCopied]=useState(false),[error,setError]=useState('');
 useEffect(()=>{setCopied(false);setError('');},[sql]);
 async function copy(){try{await navigator.clipboard.writeText(sql??'');setCopied(true);setError('');}catch{setError('复制失败，请选中下方 SQL 后手动复制。');}}
 return <details className="query-sql-preview" open>
  <summary>{caption}</summary><div className="query-sql-actions"><span className="muted">{note}</span><button disabled={sql===null} onClick={()=>void copy()}>{copied?'已复制':'复制 SQL'}</button></div>
  <textarea aria-label={caption} readOnly value={sql??template??''} rows={3} spellCheck={false}/>
  {sql===null&&<p className="notice">{reason||'此查询不能可靠渲染为整句 SQL'}；下方保留参数：<code>{JSON.stringify(parameters)}</code></p>}
  {error&&<p className="warning" role="alert">{error}</p>}
 </details>;
}
