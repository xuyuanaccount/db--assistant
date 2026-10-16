import {expect,test} from 'vitest';
import {validateSql,collectSqlStream} from '../../src/server/features/sql/service.js';
import {LIMITS} from '../../src/shared/limits.js';
import {Readable} from 'node:stream';
test('SQL size is measured in UTF-8 bytes and empty SQL is rejected',()=>{
 expect(()=>validateSql('')).toThrow();expect(()=>validateSql('中'.repeat(LIMITS.sqlBytes/2))).toThrow();expect(()=>validateSql('SELECT 1; SELECT 2')).toThrow();expect(()=>validateSql("SELECT ';' AS x;")).not.toThrow();
});
test('UTF-8 result byte cap stops before an oversized row is returned',async()=>{
 const stream=Readable.from([['中'],['中']]);let stopped=false;
 const result=await collectSqlStream(stream,()=>{stopped=true;},[{name:'x',columnType:253}] as never,1000,8);
 expect(result.rows).toEqual([['中']]);expect(result.truncated).toBe(true);expect(stopped).toBe(true);
});
test('incremental result collector truncates without consuming unbounded rows',async()=>{
 const stream=Readable.from(Array.from({length:1100},()=>['1']));let destroyed=false;
 const result=await collectSqlStream(stream,()=>{destroyed=true;},[{name:'x',columnType:3}] as never,1000,10*1024*1024);
 expect(result.rows).toHaveLength(1000);expect(result.truncated).toBe(true);expect(destroyed).toBe(true);
});
