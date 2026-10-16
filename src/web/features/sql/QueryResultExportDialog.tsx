import {useRef,useState} from 'react';
import type {QueryExportSource,QueryResultExportRequest} from '../../../shared/query-export';
import type {SqlResult} from '../../../server/features/sql/types';
import {api} from '../../api/client';

export function QueryResultExportDialog({result,source,onClose,onStarted}:{result:SqlResult;source:QueryExportSource;onClose:()=>void;onStarted:()=>void}) {
  const [format,setFormat]=useState<'csv'|'xlsx'>('csv');
  const [acknowledgeIncomplete,setAcknowledged]=useState(false);
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const submitting=useRef(false);
  const needsReview=result.executionState?result.executionState==='needs_review':!!result.needsReview;
  const partial=result.truncated||needsReview;
  async function start(){
    if(submitting.current||(partial&&!acknowledgeIncomplete))return;
    submitting.current=true;setBusy(true);setError('');
    const request:QueryResultExportRequest={source,format,columns:result.columns,rows:result.rows,truncated:result.truncated,needsReview,valueKinds:result.valueKinds,executionState:result.executionState,acknowledgeIncomplete};
    try{await api('/transfers/export/query/start',{method:'POST',body:JSON.stringify(request)});onStarted();}
    catch(error){setError((error as Error).message);}
    finally{submitting.current=false;setBusy(false);}
  }
  return <div className="modal-backdrop"><section className="modal" role="dialog" aria-label="导出查询结果">
    <div className="modal-header"><h2>导出查询结果</h2><button aria-label="关闭查询结果导出" disabled={busy} onClick={onClose}>×</button></div>
    <p className="notice">来源：{source.connectionName} / {source.database||'无默认数据库'}<br/>查询操作：{source.operationId}</p>
    <p>仅导出当前显示的 {result.rows.length} 行、{result.columns.length} 列，不重新执行 SQL。列顺序和重复列名会保留。</p>
    <label>文件格式<select aria-label="查询结果文件格式" value={format} disabled={busy} onChange={e=>setFormat(e.target.value as 'csv'|'xlsx')}><option value="csv">CSV · UTF-8 BOM</option><option value="xlsx">XLSX · Excel 工作簿</option></select></label>
    <p className="muted">NULL 编码为 \N，反斜杠可逆转义。{format==='xlsx'?'数值与日期按文本保存，空字符串编码为 \\E。':'空字符串保留为空字符串。'}二进制显示为 0x 十六进制。</p>
    {partial&&<div className="notice"><p>{result.executionState==='completed'?'查询执行已完成，文件只包含当前展示的部分结果。':'当前查询被截断或结果待核对，文件只包含已显示的部分结果。'}</p><label className="check-label"><input type="checkbox" aria-label="我确认只导出当前已显示的部分结果" checked={acknowledgeIncomplete} disabled={busy} onChange={e=>setAcknowledged(e.target.checked)}/>我确认只导出当前已显示的部分结果</label></div>}
    {error&&<p className="error-banner" role="alert">{error}</p>}
    <div className="modal-footer"><button disabled={busy} onClick={onClose}>取消</button><button className="primary" disabled={busy||(partial&&!acknowledgeIncomplete)} onClick={()=>void start()}>{busy?'创建任务…':'开始导出'}</button></div>
  </section></div>;
}
