import {expect,test} from 'vitest';
import {compileDdl} from '../../src/server/features/structure/compiler.js';
import {field,structure,schemaInfo} from '../helpers/structure.js';
 test('rejects dependencies, advanced attributes and last-column deletion',()=>{
 for(const variant of ['index','check','generated','onupdate','last']){
 const s=structure();if(variant==='index')s.indexes=[{name:'i',unique:false,type:'BTREE',visible:true,columns:[{name:'old',expression:null,prefixLength:null,direction:'asc'}],blockedReasons:[]}];
 if(variant==='check')s.checks=[{name:'ck',clause:'second>0',enforced:true}];if(variant==='generated')s.columns[1].generationExpression='old*2';if(variant==='onupdate')s.columns[0].blockedReasons=['ON UPDATE'];if(variant==='last')s.columns=s.columns.slice(0,1);
 expect(()=>compileDdl({kind:'drop_column',target:s.target,column:'old'},{schema:schemaInfo,structure:s,hasRows:false})).toThrow();
 }
 });
 test('requires explicit usable defaults for NOT NULL on a populated table',()=>{
 const s=structure(),action={kind:'add_column' as const,target:s.target,definition:{...field(),nullable:false,default:{kind:'none' as const}}};
 expect(()=>compileDdl(action,{schema:schemaInfo,structure:s,hasRows:true})).toThrow();expect(compileDdl(action,{schema:schemaInfo,structure:s,hasRows:false}).sql).toContain('NOT NULL');
 });
 test('protects all indexes that could be required by incoming or outgoing foreign keys',()=>{
 const s=structure();s.indexes=[{name:'i',unique:false,type:'BTREE',visible:true,columns:[{name:'old',expression:null,prefixLength:null,direction:'asc'}],blockedReasons:[]}];s.foreignKeys=[{direction:'outgoing',schema:'s',table:'t',name:'fk',columns:['old'],referencedSchema:'s',referencedTable:'parent',referencedColumns:['id'],updateRule:'RESTRICT',deleteRule:'RESTRICT',referencedIndex:'PRIMARY'}];
 expect(()=>compileDdl({kind:'drop_index',target:s.target,name:'i'},{schema:schemaInfo,structure:s,hasRows:false})).toThrow();
 });
