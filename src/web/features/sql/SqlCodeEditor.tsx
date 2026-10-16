import {useEffect,useRef} from 'react';
import {Compartment,EditorState,Prec} from '@codemirror/state';
import {EditorView,keymap,lineNumbers,highlightActiveLine} from '@codemirror/view';
import {defaultKeymap,history,historyKeymap} from '@codemirror/commands';
import {autocompletion,acceptCompletion,closeCompletion,completeFromList,ifNotIn} from '@codemirror/autocomplete';
import {sql,MySQL,PostgreSQL,SQLite,PLSQL} from '@codemirror/lang-sql';
import {syntaxHighlighting,defaultHighlightStyle} from '@codemirror/language';
import type {SqlCompletions} from '../../../server/features/sql/types';

import type {DatabaseKind} from '../../../shared/database';
const dialects={mysql:MySQL,postgresql:PostgreSQL,sqlite:SQLite,oracle:PLSQL};
const functions={mysql:['NOW','VERSION','CONCAT','IFNULL','DATE_FORMAT','DATE_ADD','DATEDIFF','JSON_EXTRACT','JSON_UNQUOTE'],postgresql:['NOW','VERSION','STRING_AGG','DATE_TRUNC','TO_CHAR','JSONB_EXTRACT_PATH'],sqlite:['SQLITE_VERSION','DATETIME','STRFTIME','JULIANDAY','IFNULL','JSON_EXTRACT'],oracle:['NVL','TO_CHAR','TO_DATE','TO_TIMESTAMP','SYS_CONTEXT','SYSTIMESTAMP']};
function functionCompletion(kind:DatabaseKind){return ifNotIn(['QuotedIdentifier','String','LineComment','BlockComment','.'],completeFromList([...['COUNT','SUM','AVG','MIN','MAX','COALESCE','NULLIF','ROUND','LENGTH','SUBSTRING','REPLACE','TRIM','UPPER','LOWER','ABS'],...functions[kind]].map(label=>({label,type:'function',detail:`${kind} 函数`}))));}
const theme=EditorView.theme({
 '&':{fontSize:'14px',backgroundColor:'#f8fafc',color:'#244356'},
 '.cm-scroller':{fontFamily:'ui-monospace,SFMono-Regular,monospace',lineHeight:'1.8',minHeight:'180px',maxHeight:'400px',overflow:'auto'},
 '.cm-content':{padding:'14px 0',minHeight:'180px'},'.cm-line':{padding:'0 14px'},
 '.cm-gutters':{backgroundColor:'#f1f5f9',color:'#91a0ae',borderRight:'1px solid #e4ebf1'},
 '&.cm-focused':{outline:'none'},'.cm-activeLine':{backgroundColor:'#edf5f6'},
 '.cm-tooltip-autocomplete':{border:'1px solid #d8e2eb',borderRadius:'5px',backgroundColor:'#fff',boxShadow:'0 4px 16px #17334820'},
 '.cm-tooltip-autocomplete ul li[aria-selected]':{backgroundColor:'#087f6c',color:'#fff'},
});
function language(database:string,tables:SqlCompletions['tables'],kind:DatabaseKind) {
 const quote=kind==='mysql'?'`':'"';
 const identifier=(label:string,type:string,detail:string)=>({label,type,detail,apply:quote+label.replaceAll(quote,quote+quote)+quote});
 // SQLNamespace treats dots in keys as qualification unless escaped.
 const namespaceKey=(name:string)=>name.replaceAll('.', '\\.');
 const children=Object.fromEntries(tables.map(table=>[namespaceKey(table.name),{self:identifier(table.name,'class','表 / 视图'),children:table.columns.map(label=>identifier(label,'property','字段'))}]));
 const support=sql({dialect:dialects[kind],upperCaseKeywords:true,schema:database?{[namespaceKey(database)]:children}:{},defaultSchema:database||undefined});
 return [support,dialects[kind].language.data.of({autocomplete:functionCompletion(kind)})];
}
export function SqlCodeEditor({value,onChange,onExecute,database,tables,kind='mysql'}:{kind?:DatabaseKind;value:string;onChange:(value:string)=>void;onExecute:()=>void;database:string;tables:SqlCompletions['tables']}) {
 const host=useRef<HTMLDivElement>(null);const editor=useRef<EditorView>(null);const compartment=useRef(new Compartment());
 const callbacks=useRef({onChange,onExecute});callbacks.current={onChange,onExecute};
 useEffect(()=>{
  const view=new EditorView({parent:host.current!,state:EditorState.create({doc:value,extensions:[
   lineNumbers(),highlightActiveLine(),history(),theme,syntaxHighlighting(defaultHighlightStyle),EditorView.lineWrapping,
   compartment.current.of(language(database,tables,kind)),
   autocompletion({activateOnTyping:true,maxRenderedOptions:60}),
   Prec.highest(keymap.of([{key:'Mod-Enter',run:view=>{if(view.composing)return false;callbacks.current.onExecute();return true;}},{key:'Tab',run:acceptCompletion}])),
   keymap.of([...defaultKeymap,...historyKeymap]),
   EditorView.contentAttributes.of({'aria-label':'SQL 内容','aria-multiline':'true',spellcheck:'false'}),
   EditorView.updateListener.of(update=>{if(update.docChanged)callbacks.current.onChange(update.state.doc.toString());}),
  ]})});editor.current=view;
  return()=>{editor.current=null;view.destroy();};
 },[]);
 useEffect(()=>{const view=editor.current;if(view&&view.state.doc.toString()!==value)view.dispatch({changes:{from:0,to:view.state.doc.length,insert:value}});},[value]);
 useEffect(()=>{const view=editor.current;if(view){closeCompletion(view);view.dispatch({effects:compartment.current.reconfigure(language(database,tables,kind))});}},[database,tables,kind]);
 return <div className="sql-code-editor" ref={host}/>;
}
