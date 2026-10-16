import {expect,test} from 'vitest';
import {validateChanges} from '../../src/server/features/data/edits.js';
import type {TableMeta} from '../../src/shared/contracts.js';
const meta:TableMeta={schema:'x',name:'t',kind:'table',engine:'InnoDB',primaryKey:['id'],columns:[{name:'id',dataType:'int',columnType:'int',nullable:false,hasDefault:false,generated:false,autoIncrement:false,ordinal:1},{name:'computed',dataType:'int',columnType:'int',nullable:true,hasDefault:false,generated:true,autoIncrement:false,ordinal:2}]};
test('edits reject read-only tables, generated columns and incomplete original snapshots',()=>{
 expect(()=>validateChanges({...meta,primaryKey:[]},[{kind:'insert',values:{id:'1'}}])).toThrow();
 expect(()=>validateChanges(meta,[{kind:'insert',values:{id:'1',computed:'2'}}])).toThrow();
 expect(()=>validateChanges(meta,[{kind:'update',original:{id:'1'},values:{id:'2'}}])).toThrow();
 expect(()=>validateChanges(meta,[{kind:'insert',values:{id:'1'}}])).not.toThrow();
});
