import {expect,test} from 'vitest';
import {checkEndpoints,checkTable,copyCreateSql,checkCompatible,rowDecision} from '../../src/server/features/migrations/policy.js';
import type {TableStructure} from '../../src/shared/structure.js';
const structure={kind:'table',engine:'InnoDB',tableOptions:'',partitionDefinitions:[],foreignKeys:[],checks:[],indexes:[],columns:[{name:'id',dataType:'bigint',columnType:'bigint unsigned',nullable:false,extra:'',generationExpression:'',ordinal:1}],fingerprint:'a'} as unknown as TableStructure;
test('rejects same physical database even through different connection aliases and system schemas',()=>{
 expect(()=>checkEndpoints({connectionId:'a',schema:'x'},{connectionId:'b',schema:'x'},'uuid','uuid',false)).toThrow(/同一/);
 expect(()=>checkEndpoints({connectionId:'a',schema:'X'},{connectionId:'b',schema:'x'},'uuid','uuid',true)).toThrow();
 expect(()=>checkEndpoints({connectionId:'a',schema:'mysql'},{connectionId:'b',schema:'x'},'a','b',false)).toThrow(/系统/);
 expect(()=>checkEndpoints({connectionId:'a',schema:'x'},{connectionId:'b',schema:'x'},'a','b',false)).not.toThrow();
});
test('copy changes only the CREATE target, quoting dots and backticks literally',()=>{
 const sql='CREATE TABLE `a``.b` (\n `v` text COMMENT \'CREATE TABLE `a``.b`\'\n) ENGINE=InnoDB';
 expect(copyCreateSql(sql,'a`.b','目标.库')).toBe('CREATE TABLE `目标.库`.`a``.b` (\n `v` text COMMENT \'CREATE TABLE `a``.b`\'\n) ENGINE=InnoDB');
 expect(()=>copyCreateSql('CREATE VIEW `x` AS SELECT 1','x','z')).toThrow();
});
test('preflight refuses lossy or side effecting table migrations',()=>{
 expect(()=>checkTable(structure,0)).not.toThrow();
 for(const patch of [{kind:'view'},{engine:'MyISAM'},{foreignKeys:[{}]},{partitionDefinitions:[{}]},{tableOptions:'ENCRYPTION="Y"'},{columns:[{dataType:'geometry'}]}])expect(()=>checkTable({...structure,...patch} as TableStructure,0)).toThrow();
 expect(()=>checkTable(structure,1)).toThrow(/触发器/);
});
test('sync requires compatible definitions and a primary key',()=>{
 expect(()=>checkCompatible(structure,{...structure,fingerprint:'b'},['id'])).toThrow(/结构/);
 expect(()=>checkCompatible(structure,structure,[])).toThrow(/主键/);
 expect(()=>checkCompatible(structure,structure,['id'])).not.toThrow();
});
test('row comparison preserves precision, null, bytes and excludes generated values',()=>{
 const cols=['id','v','bin'];const source={id:'18446744073709551615',v:null,bin:{binaryHex:'00ff'}};
 expect(rowDecision(cols,source,undefined)).toBe('insert');
 expect(rowDecision(cols,source,{...source,derived:'ignored'})).toBe('unchanged');
 expect(rowDecision(cols,source,{...source,v:''})).toBe('update');
 expect(rowDecision(cols,source,{...source,id:'18446744073709551614'})).toBe('update');
});
