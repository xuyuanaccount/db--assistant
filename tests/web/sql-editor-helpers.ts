import {act,screen} from '@testing-library/react';
import {EditorView} from '@codemirror/view';
import {Transaction} from '@codemirror/state';

// jsdom has no layout engine; CodeMirror measures DOM ranges for its popup.
export function installEditorGeometry(){
 if(!Range.prototype.getClientRects)Range.prototype.getClientRects=()=>[] as unknown as DOMRectList;
 if(!Range.prototype.getBoundingClientRect)Range.prototype.getBoundingClientRect=()=>new DOMRect();
}
export function replaceSql(value:string,typing=false,cursor=value.length){
 const view=EditorView.findFromDOM(screen.getByLabelText('SQL 内容'))!;
 act(()=>{view.focus();view.dispatch({changes:{from:0,to:view.state.doc.length,insert:value},selection:{anchor:cursor},annotations:Transaction.userEvent.of(typing?'input.type':'input.paste')});});
 return view;
}
