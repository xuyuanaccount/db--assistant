// @vitest-environment jsdom
import {afterEach, expect, test, vi} from 'vitest';
import {act,cleanup, fireEvent, render, screen, waitFor} from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {installEditorGeometry,replaceSql} from '../web/sql-editor-helpers';
import {SqlEditor} from '../../src/web/features/sql/SqlEditor';

installEditorGeometry();
afterEach(()=>{cleanup();localStorage.clear();vi.unstubAllGlobals();});
test('an interrupted SQL result is visibly marked for review rather than successful',async()=>{
  vi.stubGlobal('fetch',async(input:string)=>new Response(JSON.stringify(input.endsWith('/schemas')?{schemas:[]}:{operationId:'op',columns:[{name:'x',dataType:'LONG'}],rows:[['1']],affectedRows:0,durationMs:2,truncated:true,needsReview:true,maxRows:100}),{status:200,headers:{'Content-Type':'application/json'}}));
  render(<SqlEditor connections={[{id:'connection',name:'本机',host:'127.0.0.1',port:3306,username:'root',tls:false,connected:true}]}/>);
  fireEvent.click(screen.getByRole('button',{name:'▶ 执行 SQL'}));
  expect(await screen.findByText('结果待核对')).toBeTruthy();
  expect(screen.queryByText('✓ 执行完成')).toBeNull();
});
const profiles=[{id:'connection',name:'本机',host:'127.0.0.1',port:3306,username:'root',tls:false,connected:true}];
test('remembers the row cap and shows the cap used by the displayed result',async()=>{
 let executed:any;
 vi.stubGlobal('fetch',async(path:string,init:any)=>{
  if(path.endsWith('/sql/execute')){executed=JSON.parse(init.body);return new Response(JSON.stringify({operationId:'op',columns:[{name:'x',dataType:'LONG'}],rows:[['1']],affectedRows:0,durationMs:1,truncated:true,needsReview:true,maxRows:executed.maxRows}));}
  return new Response(JSON.stringify({schemas:[],tables:[],truncated:false}));
 });
 const mounted=render(<SqlEditor connections={profiles}/>);
 const cap=screen.getByLabelText('查询行数') as HTMLInputElement;expect(cap.value).toBe('100');
 fireEvent.change(cap,{target:{value:'25'}});fireEvent.click(screen.getByRole('button',{name:'▶ 执行 SQL'}));await screen.findByText('结果待核对');expect(executed.maxRows).toBe(25);
 replaceSql('SELECT changed');expect((screen.getByLabelText('已执行 SQL') as HTMLTextAreaElement).value).toBe('SELECT VERSION() AS version, NOW() AS utc_time;');
 fireEvent.change(cap,{target:{value:'50'}});expect(screen.getByText(/最多 25 行/)).toBeTruthy();
 mounted.unmount();render(<SqlEditor connections={profiles}/>);expect((screen.getByLabelText('查询行数') as HTMLInputElement).value).toBe('50');
 fireEvent.change(screen.getByLabelText('查询行数'),{target:{value:'0'}});expect((screen.getByRole('button',{name:'▶ 执行 SQL'}) as HTMLButtonElement).disabled).toBe(true);
});
test('suggests keywords while typing and accepts a completion with Tab',async()=>{
 vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({schemas:[],tables:[],truncated:false})));
 render(<SqlEditor connections={profiles}/>);const user=userEvent.setup({delay:100});const editor=screen.getByLabelText('SQL 内容');
 replaceSql('SEL',true);
 expect(await screen.findByRole('option',{name:/SELECT/})).toBeTruthy();await user.keyboard('{Tab}');expect(editor.textContent).toContain('SELECT');
});
test('completes table aliases and functions, while Enter accepts instead of executing',async()=>{
 let executions=0;
 vi.stubGlobal('fetch',async(path:string)=>new Response(JSON.stringify(path.endsWith('/schemas')?{schemas:['s']}:path.endsWith('/sql/completions')?{tables:[{name:'records',columns:['amount','id']}],truncated:false}:(executions++,{operationId:'op',columns:[],rows:[],affectedRows:0,durationMs:1,maxRows:100,truncated:false}))));
 render(<SqlEditor connections={profiles} defaultDatabase="s"/>);await screen.findByText('1 个表 / 视图');const user=userEvent.setup({delay:100});
 replaceSql('SELECT r.am FROM records r',true,11);
 expect(await screen.findByRole('option',{name:/amount/})).toBeTruthy();await user.keyboard('{Enter}');expect(screen.getByLabelText('SQL 内容').textContent).toBe('SELECT r.`amount` FROM records r');expect(executions).toBe(0);
 replaceSql('SELECT JSON_EXT',true);expect(await screen.findByRole('option',{name:/JSON_EXTRACT/})).toBeTruthy();await user.keyboard('{Escape}');expect(screen.queryByRole('listbox')).toBeNull();
 replaceSql('SELECT 1');fireEvent.keyDown(screen.getByLabelText('SQL 内容'),{key:'Enter',ctrlKey:true});await screen.findByText('✓ 执行完成');expect(executions).toBe(1);
});
test('ignores a late metadata response from the previous database',async()=>{
 let resolveOld!:(r:Response)=>void;
 vi.stubGlobal('fetch',async(path:string,init:any)=>{
  if(path.endsWith('/schemas'))return new Response(JSON.stringify({schemas:['a','b']}));
  if(JSON.parse(init.body).database==='a')return new Promise<Response>(resolve=>{resolveOld=resolve;});
  return new Response(JSON.stringify({tables:[{name:'orders_b',columns:['id']}],truncated:false}));
 });
 render(<SqlEditor connections={profiles} defaultDatabase="a"/>);await screen.findByRole('option',{name:'b'});
 fireEvent.change(screen.getByLabelText('SQL 数据库'),{target:{value:'b'}});await screen.findByText('1 个表 / 视图');
 await act(async()=>{resolveOld(new Response(JSON.stringify({tables:[{name:'records_a',columns:['secret_a']}],truncated:false})));});
 replaceSql('SELECT * FROM ord',true);expect(await screen.findByRole('option',{name:/orders_b/})).toBeTruthy();expect(screen.queryByRole('option',{name:/records_a/})).toBeNull();
});
test('quotes completed table and column identifiers so unusual names remain runnable',async()=>{
 vi.stubGlobal('fetch',async(path:string)=>new Response(JSON.stringify(path.endsWith('/schemas')?{schemas:['s']}: {tables:[{name:'order detail',columns:['商品名','back`tick']}],truncated:false})));
 render(<SqlEditor connections={profiles} defaultDatabase="s"/>);await screen.findByText('1 个表 / 视图');const user=userEvent.setup({delay:100});
 replaceSql('SELECT * FROM ord',true);await user.click(await screen.findByRole('option',{name:/order detail/}));expect(screen.getByLabelText('SQL 内容').textContent).toBe('SELECT * FROM `order detail`');
 replaceSql('SELECT t. FROM `order detail` t',false,9);fireEvent.keyDown(screen.getByLabelText('SQL 内容'),{key:' ',code:'Space',ctrlKey:true});await user.click(await screen.findByRole('option',{name:/back`tick/}));expect(screen.getByLabelText('SQL 内容').textContent).toBe('SELECT t.`back``tick` FROM `order detail` t');
});
test('completes names containing literal dots within the selected database',async()=>{
 vi.stubGlobal('fetch',async(path:string)=>new Response(JSON.stringify(path.endsWith('/schemas')?{schemas:['db.with.dot']}:{tables:[{name:'report.detail',columns:['id']}],truncated:false})));
 render(<SqlEditor connections={profiles} defaultDatabase="db.with.dot"/>);await screen.findByText('1 个表 / 视图');replaceSql('SELECT * FROM rep',true);
 const user=userEvent.setup({delay:100});await user.click(await screen.findByRole('option',{name:/report.detail/}));expect(screen.getByLabelText('SQL 内容').textContent).toBe('SELECT * FROM `report.detail`');
});
