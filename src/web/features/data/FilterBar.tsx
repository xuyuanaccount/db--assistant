import type {ColumnMeta} from '../../../shared/contracts';
import type {Filter} from '../../../server/features/data/types';
import {FILTER_OPERATORS,FILTER_LABELS} from '../../../shared/filters';
import type {DatabaseKind} from '../../../shared/database';
export function FilterBar({columns,filters,onChange,match='all',onMatchChange,kind='mysql'}:{kind?:DatabaseKind;columns:ColumnMeta[];filters:Filter[];onChange:(filters:Filter[])=>void;match?:'all'|'any';onMatchChange?:(match:'all'|'any')=>void}) {
 const update=(index:number,partial:Partial<Filter>)=>onChange(filters.map((f,i)=>i===index?{...f,...partial}:f));
 function changeOperator(index:number,op:Filter['op']) {
  const list=op==='in'||op==='not-in',range=op==='between'||op==='not-between';
  onChange(filters.map((f,i)=>i===index?{column:f.column,op,...(!op.startsWith('is-')&&!list?{value:''}:{}),...(list?{values:[]}:{}),...(range?{valueTo:''}:{})}:f));
 }
 return <div className="filter-bar">
  {filters.length>1&&<label className="filter-match">条件关系 <select aria-label="筛选条件关系" value={match} onChange={e=>onMatchChange?.(e.target.value as 'all'|'any')}><option value="all">AND · 全部满足</option><option value="any">OR · 任一满足</option></select></label>}
  {filters.map((f,i)=>{
   const list=f.op==='in'||f.op==='not-in',range=f.op==='between'||f.op==='not-between';
   return <div className="row filter-row" key={i}>
    <select aria-label={`筛选字段 ${i+1}`} value={f.column} onChange={e=>update(i,{column:e.target.value})}>{columns.map(c=><option key={c.name}>{c.name}</option>)}</select>
    <select aria-label={`筛选条件 ${i+1}`} value={f.op} onChange={e=>changeOperator(i,e.target.value as Filter['op'])}>{FILTER_OPERATORS.filter(op=>kind!=='oracle'||!(['is-empty','is-not-empty'] as string[]).includes(op)).map(op=><option key={op} value={op}>{FILTER_LABELS[op]}</option>)}</select>
    {list?<label className="filter-list"><textarea aria-label={`筛选列表 ${i+1}`} rows={2} placeholder="每行一个值，不加引号" value={(f.values||[]).join('\n')} onChange={e=>update(i,{values:e.target.value.split(/\r?\n/)})}/><small>每行一个值，最多 100 个；忽略空行</small></label>:!f.op.startsWith('is-')&&<>
     <input aria-label={`筛选值 ${i+1}`} placeholder={range?'下限（包含）':f.op==='like'||f.op==='not-like'?'% 任意长度，_ 单字符':'筛选值'} value={typeof f.value==='string'?f.value:''} onChange={e=>update(i,{value:e.target.value})}/>
     {range&&<><span>至</span><input aria-label={`筛选上限 ${i+1}`} placeholder="上限（包含）" value={typeof f.valueTo==='string'?f.valueTo:''} onChange={e=>update(i,{valueTo:e.target.value})}/></>}
    </>}
    <button aria-label={`移除筛选 ${i+1}`} onClick={()=>onChange(filters.filter((_,index)=>i!==index))}>×</button>
   </div>;
  })}
  <button className="subtle" disabled={!columns.length||filters.length>=30} onClick={()=>onChange([...filters,{column:columns[0].name,op:'eq',value:''}])}>＋ 筛选条件</button>
  {filters.length>0&&<small className="muted">{kind==='oracle'?'Oracle 空字符串视为 NULL；否定条件不包含 NULL':'NULL 与空字符串分别筛选；否定条件不包含 NULL'}</small>}
 </div>;
}
