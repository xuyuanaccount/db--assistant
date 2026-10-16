// @vitest-environment jsdom
import {afterEach,expect,test,vi} from 'vitest';import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {CreateTableDialog} from '../../src/web/features/structure/CreateTableDialog';import {StructurePanel} from '../../src/web/features/structure/StructurePanel';import {DatabaseTree} from '../../src/web/features/data/DatabaseTree';import {structure} from '../helpers/structure.js';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
const preview={previewId:'00000000-0000-4000-8000-000000000001',target:{connectionId:'c',schema:'s',table:'new'},sql:'CREATE TABLE `s`.`new` (...)',expiresAt:new Date(Date.now()+300000).toISOString(),warnings:['可能等待锁'],confirmationTableName:null};
test('creates from an empty schema only after preview confirmation',async()=>{
 const requests:{path:string;body:any}[]=[];vi.stubGlobal('fetch',async(path:string,init:any)=>{requests.push({path,body:init?.body?JSON.parse(init.body):null});return new Response(JSON.stringify(path.endsWith('/preview')?preview:{operationId:'op',status:'completed',warnings:[]}));});
 const created=vi.fn();render(<CreateTableDialog connectionId="c" schema="s" onClose={()=>{}} onCreated={created}/>);
 fireEvent.change(screen.getByLabelText('表名'),{target:{value:'new'}});fireEvent.change(screen.getByLabelText('字段名'),{target:{value:'id'}});fireEvent.click(screen.getByRole('button',{name:'预览 SQL'}));expect(await screen.findByText(preview.sql)).toBeTruthy();expect(requests.filter(r=>r.path.endsWith('/apply'))).toHaveLength(0);
 fireEvent.click(screen.getByRole('button',{name:'确认执行'}));await screen.findByText('已执行');expect(requests.filter(r=>r.path.endsWith('/apply')).map(r=>r.body)).toEqual([{previewId:preview.previewId}]);fireEvent.click(screen.getByRole('button',{name:'完成并刷新'}));expect(created).toHaveBeenCalledWith(preview.target);
});
test('does not render a late response for the previously selected table',async()=>{
 const a=structure(),b={...structure(),target:{...a.target,table:'b'},comment:'table B'};let resolveA!:(r:Response)=>void;
 vi.stubGlobal('fetch',async(_path:string,init:any)=>{const target=JSON.parse(init.body);if(target.table==='t')return new Promise<Response>(r=>{resolveA=r;});return new Response(JSON.stringify(b));});
 const r=render(<StructurePanel target={a.target} blockedByDataEdits={false} onChanged={()=>{}}/>);r.rerender(<StructurePanel target={b.target} blockedByDataEdits={false} onChanged={()=>{}}/>);await screen.findByText(/table B/);resolveA(new Response(JSON.stringify({...a,comment:'stale A'})));await waitFor(()=>expect(screen.queryByText('stale A')).toBeNull());
});
test('offers create table even when the selected schema has no tables',async()=>{
 vi.stubGlobal('fetch',async(path:string)=>new Response(JSON.stringify(path.endsWith('/schemas')?{schemas:['s']}:{tables:[]})));const create=vi.fn();render(<DatabaseTree connections={[{id:'c',name:'test',host:'127.0.0.1',port:3306,username:'root',tls:false,connected:true}]} target={null} onSelect={()=>{}} revision={0} onCreateTable={create}/>);
 await screen.findByRole('option',{name:'s'});fireEvent.change(screen.getByLabelText('浏览数据库'),{target:{value:'s'}});fireEvent.click(screen.getByRole('button',{name:'新建表'}));expect(create).toHaveBeenCalledWith({connectionId:'c',schema:'s'});
});
