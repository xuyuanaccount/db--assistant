import {expect,test as baseTest} from 'vitest';
const test=baseTest.skipIf(!process.env.MWA_TEST_PASSWORD);
import type {StructureAction} from '../../src/shared/structure.js';import {fixture} from '../mysql/fixture.js';import {field} from '../helpers/structure.js';
test('preserves existing data through the complete table structure workflow',async()=>{const f=await fixture();try{
 const target={connectionId:f.profile.id,schema:f.schema,table:'flow'};
 const describe=async()=>(await f.request('/api/structure/describe',target)).json();
 const apply=async(action:StructureAction,ok=true)=>{const r=await f.request('/api/structure/preview',{action,...(action.kind==='create_table'?{}:{expectedFingerprint:(await describe()).fingerprint})});expect(r.statusCode,r.body).toBe(200);const p=r.json();const a=await f.request('/api/structure/apply',{previewId:p.previewId,...(p.confirmationTableName?{confirmationTableName:p.confirmationTableName}:{})});if(ok)expect(a.statusCode,a.body).toBe(200);return a;};
 const id={...field('id'),type:{kind:'BIGINT' as const,unsigned:true},nullable:false,default:{kind:'none' as const},autoIncrement:true};
 await apply({kind:'create_table',target,columns:[id,field('text')],primaryKey:['id'],comment:'synthetic'});await f.admin.query("INSERT INTO flow(text) VALUES('one'),('two')");
 await apply({kind:'add_column',target,definition:{...field('qty'),type:{kind:'INT'},nullable:false,default:{kind:'literal',value:'7'}}});
 await f.admin.query('ALTER TABLE flow MODIFY text VARCHAR(40) COLLATE utf8mb4_bin NULL');
 await apply({kind:'modify_column',target,column:'text',patch:{type:{kind:'VARCHAR',length:100},default:{kind:'literal',value:'fallback'},comment:'保留排序规则'}});
 expect((await describe()).columns.find((c:any)=>c.name==='text')).toMatchObject({collation:'utf8mb4_bin',comment:'保留排序规则'});
 await apply({kind:'rename_column',target,column:'text',newName:'text_value'});
 for(const [name,unique,columns] of [['ordinary',false,[{name:'qty'}]],['single_unique',true,[{name:'text_value'}]],['combined',false,[{name:'text_value',prefixLength:5},{name:'qty'}]]] as const){await apply({kind:'add_index',target,name,unique,columns:[...columns]});await apply({kind:'drop_index',target,name});}
 const before=(await f.admin.query('SELECT id,text_value,qty FROM flow ORDER BY id'))[0];expect(before).toMatchObject([{id:'1',text_value:'one',qty:7},{id:'2',text_value:'two',qty:7}]);
 await f.admin.query('UPDATE flow SET qty=7');const failed=await apply({kind:'add_index',target,name:'duplicate',unique:true,columns:[{name:'qty'}]},false);expect(failed.json().error.mysqlCode).toBe('ER_DUP_ENTRY');expect((await f.admin.query('SELECT id,text_value,qty FROM flow ORDER BY id'))[0]).toEqual(before);expect((await describe()).indexes.some((i:any)=>i.name==='duplicate')).toBe(false);
 await apply({kind:'drop_column',target,column:'qty'});expect((await describe()).columns.map((c:any)=>c.name)).toEqual(['id','text_value']);
 const logs=await f.request('/api/logs?type=schema_change');expect(logs.statusCode).toBe(200);expect(logs.json().items.filter((l:any)=>l.status==='failed')).toHaveLength(1);expect(logs.json().items.every((l:any)=>l.sql&&l.schema===f.schema)).toBe(true);
 }finally{await f.cleanup();}});
