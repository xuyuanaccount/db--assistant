import {expect,test} from 'vitest';
import {compileDdl} from '../../src/server/features/structure/compiler.js';
import {field,structure,schemaInfo} from '../helpers/structure.js';
const s=structure(),target=s.target;const context={schema:schemaInfo,structure:s,hasRows:false};
const compile=(action:any)=>compileDdl({...action,target},context);
 test('renders standalone rename and quotes a dotted field as one name',()=>{
 expect(compile({kind:'rename_column',column:'old',newName:'new'}).sql).toBe('ALTER TABLE `s`.`t` RENAME COLUMN `old` TO `new`');
 expect(compile({kind:'rename_column',column:'old',newName:'a.b`x'}).sql).toBe('ALTER TABLE `s`.`t` RENAME COLUMN `old` TO `a.b``x`');
 });
 test('keeps string defaults distinct from SQL expressions and preserves collation',()=>{
 const result=compile({kind:'modify_column',column:'old',patch:{default:{kind:'literal',value:'CURRENT_TIMESTAMP'},comment:"中文'"}});
 expect(result.sql).toBe("ALTER TABLE `s`.`t` MODIFY COLUMN `old` VARCHAR(40) CHARACTER SET `utf8mb4` COLLATE `utf8mb4_bin` NULL DEFAULT 'CURRENT_TIMESTAMP' COMMENT '中文\\''");
 });
 test('creates exact composite primary key and rejects malformed and overflowing definitions',()=>{
 const columns=[{...field('id'),type:{kind:'BIGINT' as const,unsigned:true},nullable:false,default:{kind:'none' as const},autoIncrement:true},{...field('tenant'),nullable:false,default:{kind:'none' as const}}];
 expect(compileDdl({kind:'create_table',target,columns,primaryKey:['id','tenant'],comment:''},{...context,structure:null}).sql).toContain('PRIMARY KEY (`id`, `tenant`)');
 for(const type of [{kind:'VARCHAR',length:0},{kind:'DECIMAL',precision:2,scale:3},{kind:'INT',unsigned:true,length:8},{kind:'INT); DROP TABLE t;--'}])expect(()=>compile({kind:'add_column',definition:{...field(),type}})).toThrow();
 for(const [type,value] of [[{kind:'BIGINT',unsigned:true},'18446744073709551616'],[{kind:'TIME',fsp:0},'839:00:00'],[{kind:'JSON'},'{}'],[{kind:'TIMESTAMP',fsp:0},'2026-02-30 00:00:00']])expect(()=>compile({kind:'add_column',definition:{...field(),type,default:{kind:'literal',value}}})).toThrow();
 expect(compile({kind:'add_column',definition:{...field(),type:{kind:'BIGINT',unsigned:true},default:{kind:'literal',value:'18446744073709551615'}}}).sql).toContain("DEFAULT '18446744073709551615'");
 });
 test('compiles ordered prefix indexes and rejects reserved names and duplicate fields',()=>{
 expect(compile({kind:'add_index',name:'combined',unique:true,columns:[{name:'old',prefixLength:8},{name:'second'}]}).sql).toBe('ALTER TABLE `s`.`t` ADD UNIQUE INDEX `combined` (`old`(8), `second`) USING BTREE');
 for(const name of ['PRIMARY','primary'])expect(()=>compile({kind:'add_index',name,unique:false,columns:[{name:'old'}]})).toThrow();
 expect(()=>compile({kind:'add_index',name:'i',unique:false,columns:[{name:'old'},{name:'old'}]})).toThrow();
 });
