// @vitest-environment jsdom
import {afterEach,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen} from '@testing-library/react';
import {ConnectionManager} from '../../src/web/features/connections/ConnectionManager';
import {DatabaseTree} from '../../src/web/features/data/DatabaseTree';
import {SqlEditor} from '../../src/web/features/sql/SqlEditor';
import {StructureReadPanel} from '../../src/web/features/structure/StructureReadPanel';
import {RowEditor,EditPreview} from '../../src/web/features/data/EditPreview';
import {installEditorGeometry,replaceSql} from '../web/sql-editor-helpers';
installEditorGeometry();afterEach(()=>{cleanup();vi.unstubAllGlobals();});
it('connection types show only their relevant fields and correct default ports',()=>{
 render(<ConnectionManager onClose={()=>{}} onSaved={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('数据库类型'),{target:{value:'sqlite'}});expect(screen.queryByLabelText('主机')).toBeNull();expect(screen.queryByLabelText('密码')).toBeNull();expect(screen.getByLabelText('文件绝对路径')).toBeTruthy();
 fireEvent.change(screen.getByLabelText('数据库类型'),{target:{value:'postgresql'}});expect((screen.getByLabelText('端口') as HTMLInputElement).value).toBe('5432');expect(screen.getByLabelText('数据库')).toBeTruthy();expect(screen.getByLabelText('默认 schema')).toBeTruthy();expect(screen.queryByRole('option',{name:'Oracle'})).toBeNull();fireEvent.change(screen.getByLabelText('数据库类型'),{target:{value:'mysql'}});expect((screen.getByLabelText('端口') as HTMLInputElement).value).toBe('3306');
});
const sqlite={id:'s',kind:'sqlite' as const,name:'SQLite',filePath:'/synthetic.sqlite',readOnly:false,connected:true};
it('non-MySQL tree shows its namespace and hides create-table controls',async()=>{
 vi.stubGlobal('fetch',async(path:string)=>new Response(JSON.stringify(path.endsWith('/context')?{defaultNamespace:'main',namespaceLabel:'命名空间'}:path.endsWith('/schemas')?{schemas:['main']}:{tables:[]})));
 render(<DatabaseTree connections={[sqlite]} target={null} onSelect={()=>{}}/>);await screen.findByRole('option',{name:'main'});expect(screen.queryByRole('button',{name:'新建表'})).toBeNull();expect((screen.getByLabelText('浏览数据库') as HTMLSelectElement).value).toBe('main');
});
it('switching SQL dialect keeps the edited draft and completed partial output stays successful',async()=>{
 vi.stubGlobal('fetch',async(path:string)=>new Response(JSON.stringify(path.endsWith('/context')?{defaultNamespace:'main'}:path.endsWith('/schemas')?{schemas:['main']}:path.endsWith('/sql/execute')?{operationId:'op',columns:[{name:'x',dataType:'INTEGER'}],rows:[['1']],valueKinds:[['integer']],affectedRows:3,durationMs:1,truncated:true,executionState:'completed',maxRows:100}:{tables:[],truncated:false})));
 render(<SqlEditor connections={[{id:'m',name:'MySQL',host:'localhost',port:3306,username:'x',tls:false,connected:true},sqlite]} defaultConnection="m"/>);replaceSql('SELECT my_draft');fireEvent.change(screen.getByLabelText('SQL 连接'),{target:{value:'s'}});await screen.findByRole('option',{name:'main'});expect(screen.getByLabelText('SQL 内容').textContent).toBe('SELECT my_draft');fireEvent.click(screen.getByRole('button',{name:'▶ 执行 SQL'}));expect(await screen.findByText('✓ 执行完成')).toBeTruthy();expect(screen.queryByText('结果待核对')).toBeNull();
});
it('reconnecting the same id drops old completion responses by generation',async()=>{
 let resolveOld!:(r:Response)=>void;let calls=0;
 vi.stubGlobal('fetch',async(path:string)=>{if(path.endsWith('/context'))return new Response(JSON.stringify({defaultNamespace:'main'}));if(path.endsWith('/schemas'))return new Response(JSON.stringify({schemas:['main']}));if(path.endsWith('/completions')){calls++;if(calls===1)return new Promise<Response>(r=>resolveOld=r);return new Response(JSON.stringify({tables:[{name:'new',columns:['id']}],truncated:false}));}return new Response('{}');});
 const profile={...sqlite,generation:1};const mounted=render(<SqlEditor connections={[profile]} defaultDatabase="main"/>);await screen.findByRole('option',{name:'main'});mounted.rerender(<SqlEditor connections={[{...profile,generation:2}]} defaultDatabase="main"/>);await screen.findByText('1 个表 / 视图');await act(async()=>resolveOld(new Response(JSON.stringify({tables:[{name:'old',columns:['stale']},{name:'other',columns:[]}],truncated:false}))));expect(screen.queryByText('2 个表 / 视图')).toBeNull();
});
it('structure summaries remain read-only and unavailable DDL keeps visible columns',async()=>{
 vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({databaseKind:'postgresql',objectKind:'table',primaryKey:['id'],columns:[{name:'id',columnType:'bigint',nullable:false,defaultSql:null,identity:'none',comment:'visible'}],indexes:[],foreignKeys:[],checks:[],definition:{kind:'summary',text:'catalog summary'},unavailableReasons:['完整定义不可用']})));
 render(<StructureReadPanel target={{connectionId:'p',schema:'public',table:'records'}}/>);expect(await screen.findByText('bigint')).toBeTruthy();expect(screen.getByText('结构摘要（非完整建表 SQL）')).toBeTruthy();expect(screen.queryByRole('button',{name:/修改|执行|建表/})).toBeNull();
});
it('SQLite changing only storage category still stages an explicit value change',()=>{
 let staged:any;const column={name:'value',dataType:'',columnType:'',nullable:true,hasDefault:false,generated:false,autoIncrement:false,ordinal:1,valueKind:'binary' as const};
 render(<RowEditor meta={{schema:'main',name:'dynamic',kind:'table',engine:'SQLite',databaseKind:'sqlite',primaryKey:[],columns:[column]}} original={{value:'1'}} originalKinds={{value:'integer'}} onStage={change=>staged=change} onClose={()=>{}}/>);
 fireEvent.change(screen.getByLabelText('value SQLite 存储类别'),{target:{value:'text'}});fireEvent.click(screen.getByRole('button',{name:'暂存变更'}));expect(staged.values).toEqual({value:'1'});expect(staged.valueKinds).toEqual({value:'text'});
});
it('Oracle edit preview displays the actual NULL normalization',()=>{
 render(<EditPreview target={{connectionId:'o',schema:'APP',table:'T'}} meta={{schema:'APP',name:'T',kind:'table',engine:null,databaseKind:'oracle',primaryKey:['id'],columns:[]}} changes={[{kind:'insert',values:{value:''}}]} onClose={()=>{}} onCommitted={()=>{}}/>);expect(screen.getByText('{"value":null}')).toBeTruthy();
});
it('PostgreSQL grid does not display SQLite affinity advice',async()=>{
 const {DataGrid}=await import('../../src/web/features/data/DataGrid');const cap={enabled:true,reasons:[]};
 vi.stubGlobal('fetch',async()=>new Response(JSON.stringify({generation:1,meta:{schema:'public',name:'records',kind:'table',engine:null,databaseKind:'postgresql',definitionFingerprint:'f',primaryKey:['id'],columns:[{name:'id',dataType:'int8',columnType:'bigint',nullable:false,hasDefault:true,generated:false,autoIncrement:true,ordinal:1,valueKind:'integer',identity:'by-default',editable:cap,importable:cap,comparable:true}],capabilities:{browse:cap,insert:cap,update:cap,delete:cap,import:cap,exportCsv:cap,exportXlsx:cap,exportSql:cap}},rows:[{id:'1'}],rowKinds:[{id:'integer'}],hasMore:false,querySql:'SELECT id FROM records'})));
 render(<DataGrid target={{connectionId:'p',schema:'public',table:'records'}}/>);await screen.findByText('bigint');expect(screen.queryByText(/SQLite NUMERIC/)).toBeNull();
});
