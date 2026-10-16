// @vitest-environment jsdom
import {afterEach,expect,test,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {DataGrid} from '../../src/web/features/data/DataGrid';
afterEach(()=>{cleanup();vi.unstubAllGlobals();});
test('applies list/range filters with OR and copies SQL from the loaded result, not the draft',async()=>{
 const requests:any[]=[];let copied='';
 Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async(text:string)=>{copied=text;}}});
 const meta={schema:'db',name:'records',kind:'table',engine:'InnoDB',primaryKey:['id'],columns:[{name:'id',dataType:'int',columnType:'int',nullable:false,hasDefault:false,generated:false,autoIncrement:false,ordinal:1}]};
 const executed="SELECT `id` FROM `db`.`records` WHERE `id` IN ('1', '3') OR `id` BETWEEN '8' AND '9' ORDER BY `id` ASC LIMIT 101 OFFSET 0";
 vi.stubGlobal('fetch',async(path:string,init:any)=>{const request=JSON.parse(init.body);requests.push(request);if(path.endsWith('/export/start'))return new Response(JSON.stringify({id:'task'}));return new Response(JSON.stringify({meta,rows:[],hasNext:false,querySql:request.filters.length?executed:'SELECT `id` FROM `db`.`records` ORDER BY `id` ASC LIMIT 101 OFFSET 0'}));});
 render(<DataGrid target={{connectionId:'c',schema:'db',table:'records'}}/>);await screen.findByRole('button',{name:'＋ 新增记录'});
 fireEvent.click(screen.getByRole('button',{name:'＋ 筛选条件'}));fireEvent.change(screen.getByLabelText('筛选条件 1'),{target:{value:'in'}});fireEvent.change(screen.getByLabelText('筛选列表 1'),{target:{value:'1\n3'}});
 fireEvent.click(screen.getByRole('button',{name:'＋ 筛选条件'}));fireEvent.change(screen.getByLabelText('筛选条件 2'),{target:{value:'between'}});fireEvent.change(screen.getByLabelText('筛选值 2'),{target:{value:'8'}});fireEvent.change(screen.getByLabelText('筛选上限 2'),{target:{value:'9'}});
 fireEvent.change(screen.getByLabelText('筛选条件关系'),{target:{value:'any'}});fireEvent.click(screen.getByRole('button',{name:'应用筛选'}));
 await waitFor(()=>expect((screen.getByLabelText('本次查询 SQL') as HTMLTextAreaElement).value).toBe(executed));
 expect(requests.at(-1)).toMatchObject({filterMatch:'any',filters:[{column:'id',op:'in',values:['1','3']},{column:'id',op:'between',value:'8',valueTo:'9'}]});
 fireEvent.change(screen.getByLabelText('筛选列表 1'),{target:{value:'2'}});fireEvent.click(screen.getByRole('button',{name:'复制 SQL'}));await screen.findByText('已复制');expect(copied).toBe(executed);
 fireEvent.click(screen.getByRole('button',{name:'↧ 导出'}));fireEvent.change(screen.getByRole('combobox',{name:'导出范围'}),{target:{value:'filtered'}});fireEvent.click(screen.getByRole('button',{name:'开始导出'}));
 await waitFor(()=>expect(requests.at(-1).request).toMatchObject({filterMatch:'any',filters:[{values:['1','3']},{value:'8',valueTo:'9'}]}));
 await waitFor(()=>expect(screen.queryByRole('dialog',{name:'导出数据'})).toBeNull());
 fireEvent.click(screen.getByRole('button',{name:'移除筛选 2'}));fireEvent.click(screen.getByRole('button',{name:'移除筛选 1'}));fireEvent.click(screen.getByRole('button',{name:/^清除$/}));
 await waitFor(()=>expect(requests.at(-1)).toMatchObject({filters:[],filterMatch:'all'}));
});
