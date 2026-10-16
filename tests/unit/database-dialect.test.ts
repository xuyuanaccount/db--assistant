import {expect,test} from 'vitest';
import {postgresqlDialect} from '../../src/server/database/postgresql/dialect.js';
import {oracleDialect} from '../../src/server/database/oracle/dialect.js';
import {createOracleDialect} from '../../src/server/database/oracle/dialect.js';
import {sqliteDialect} from '../../src/server/database/sqlite/dialect.js';
import type {NormalizedTableMeta} from '../../src/shared/database.js';
import type {BrowseRequest} from '../../src/server/features/data/types.js';
import {targetSchema} from '../../src/server/features/data/types.js';
import {sqlRequestSchema} from '../../src/server/features/sql/types.js';

const yes=()=>({enabled:true,reasons:[]});
const meta:NormalizedTableMeta={databaseKind:'postgresql',definitionFingerprint:'fixture',schema:'main',name:'a.b',kind:'table',engine:null,primaryKey:['id'],capabilities:{browse:yes(),insert:yes(),update:yes(),delete:yes(),import:yes(),exportCsv:yes(),exportXlsx:yes(),exportSql:yes(),structureEdit:yes(),migration:yes()},columns:[
 {name:'id',dataType:'bigint',columnType:'bigint',nullable:false,hasDefault:false,generated:false,autoIncrement:false,ordinal:1,valueKind:'integer',identity:'none',editable:yes(),importable:yes(),comparable:true},
 {name:'a.b',dataType:'text',columnType:'text',nullable:true,hasDefault:false,generated:false,autoIncrement:false,ordinal:2,valueKind:'text',identity:'none',editable:yes(),importable:yes(),comparable:true},
]};
const request=(filters:BrowseRequest['filters']=[]):BrowseRequest=>({target:{connectionId:'c',schema:'main',table:'a.b'},page:2,pageSize:100,filters,sort:[]});

test('each dialect quotes a dotted name as one identifier and uses native placeholders',()=>{
 expect(postgresqlDialect.quoteIdentifier('a.b')).toBe('"a.b"');
 expect(postgresqlDialect.placeholder(2)).toBe('$2');
 expect(oracleDialect.placeholder(2)).toBe(':p2');
 expect(sqliteDialect.quoteIdentifier('a.b')).toBe('"a.b"');
 for(const dialect of [postgresqlDialect,oracleDialect,sqliteDialect])expect(dialect.qualifiedTable(request().target)).toBe('"main"."a.b"');
});
test('browse compiles page bounds as exact integer text and validates metadata columns',()=>{
 for(const dialect of [postgresqlDialect,oracleDialect,sqliteDialect]){
  const command=dialect.compileBrowse(meta,request([{column:'a.b',op:'eq',value:'x'}]),'page');
  expect(command.sql).toContain('"main"."a.b"');
  expect(command.params.slice(-2)).toEqual([{value:'101',kind:'integer'},{value:'100',kind:'integer'}]);
  expect(()=>dialect.compileBrowse(meta,request([{column:'missing',op:'eq',value:'x'}]),'page')).toThrow();
 }
 expect(postgresqlDialect.compileBrowse(meta,request([{column:'a.b',op:'eq',value:'x'}]),'page').sql).toContain('"a.b" = $1');
 expect(oracleDialect.compileBrowse(meta,request([{column:'a.b',op:'eq',value:'x'}]),'page').sql).toContain('"a.b" = :p1');
});
test('contains escapes wildcard and escape characters with an explicit ESCAPE clause',()=>{
 for(const dialect of [postgresqlDialect,oracleDialect,sqliteDialect]){
  const command=dialect.compileBrowse(meta,request([{column:'a.b',op:'contains',value:'a%_\\z'}]),'filtered');
  expect(command.sql).toMatch(/LIKE .* ESCAPE/);
  expect(command.params[0].value).toBe('%a\\%\\_\\\\z%');
 }
});
test('writes bind precise numbers, compare nullable snapshots, and avoid invented Oracle default values',()=>{
 const original={id:'9223372036854775807','a.b':null};
 for(const dialect of [postgresqlDialect,oracleDialect,sqliteDialect]){
  const command=dialect.compileUpdate(meta,{'a.b':'new'},original);
  expect(command.params[1]).toMatchObject({value:'9223372036854775807',kind:'integer'});
  expect(dialect.compileDelete(meta,original).sql).toContain('"id"');
  expect(dialect.compileLockRow(meta,original).sql).toContain('"id"');
 }
 expect(postgresqlDialect.compileInsert(meta,{}).sql).toContain('DEFAULT VALUES');
 expect(sqliteDialect.compileInsert(meta,{}).sql).toContain('DEFAULT VALUES');
 expect(()=>oracleDialect.compileInsert(meta,{})).toThrow();
});
test('render never alters placeholders inside string literals and declines overlarge values',()=>{
 const command={sql:"SELECT '?' AS marker, $1",params:[{value:'exact',kind:'text' as const}]};
 const rendered=postgresqlDialect.render(command);
 expect(rendered.sql).toContain("'?' AS marker");
 expect(rendered.sql).toContain("'exact'");
 const huge=postgresqlDialect.render({sql:'SELECT $1',params:[{value:'x'.repeat(300_000),kind:'text'}]});
 expect(huge.sql).toBeNull();expect(huge.template).toBe('SELECT $1');expect(huge.parameters).toHaveLength(1);
});
test('SQLite snapshot comparisons retain the original dynamic storage kind',()=>{
 const sqliteMeta={...meta,databaseKind:'sqlite' as const,columns:meta.columns.map(c=>c.name==='id'?{...c,valueKind:'text' as const}:c)};
 const command=sqliteDialect.compileUpdate(sqliteMeta,{'a.b':'new'},{id:'9223372036854775807','a.b':null},{id:'integer'});
 expect(command.params[1].kind).toBe('integer');
});
test('new API accepts 128 Unicode characters while quoting applies database byte limits',()=>{
 const name='😀'.repeat(128);
 expect(targetSchema.parse({connectionId:'c',schema:name,table:'x'}).schema).toBe(name);
 expect(sqlRequestSchema.parse({connectionId:'c',database:name,sql:'SELECT 1'}).database).toBe(name);
 expect(()=>postgresqlDialect.quoteIdentifier('😀'.repeat(16))).toThrow();
 expect(()=>oracleDialect.quoteIdentifier('x'.repeat(31))).toThrow();
});
test('renderer declines statements whose bind set cannot be represented completely',()=>{
 expect(postgresqlDialect.render({sql:"SELECT '$1'",params:[{value:'secret',kind:'text'}]}).sql).toBeNull();
 expect(oracleDialect.render({sql:'SELECT :p2 FROM dual',params:[{value:'x',kind:'text'}]}).sql).toBeNull();
 expect(sqliteDialect.render({sql:"SELECT '?' AS marker, ?",params:[{value:'x',kind:'text'}]}).sql).toContain("'?' AS marker, 'x'");
});
test('Oracle refuses an empty string for a nonnullable text column',()=>{
 const required={...meta,columns:meta.columns.map(c=>c.name==='a.b'?{...c,nullable:false}:c)};
 expect(()=>oracleDialect.compileInsert(required,{'a.b':''})).toThrow();
});
test('restore mode preserves PostgreSQL ALWAYS identity and Oracle refuses exact SQL export',()=>{
 const identity={...meta,columns:meta.columns.map(c=>c.name==='id'?{...c,identity:'always' as const,editable:{enabled:false,reasons:['identity']}}:c)};
 expect(()=>postgresqlDialect.compileInsert(identity,{id:'42'},undefined,'edit')).toThrow();
 const restore=postgresqlDialect.compileInsert(identity,{id:'42'},undefined,'restore');
 expect(restore.sql).toContain('OVERRIDING SYSTEM VALUE VALUES ($1)');
 expect(restore.params[0]).toMatchObject({kind:'integer',value:'42'});
 const row={values:['42','hello'],valueKinds:['integer','text'] as const};
 expect(postgresqlDialect.exportInsert(identity,{values:row.values,valueKinds:[...row.valueKinds]})).toContain('OVERRIDING SYSTEM VALUE VALUES (42,');
 expect(()=>oracleDialect.exportInsert(identity,{values:row.values,valueKinds:[...row.valueKinds]})).toThrow();
});
test('temporal SQL exports are typed and Oracle conversion is independent of session NLS formats',()=>{
 const timestamp={...meta,columns:[{...meta.columns[1],dataType:'timestamp',columnType:'TIMESTAMP(9)',valueKind:'temporal' as const}]};
 const date={...meta,columns:[{...meta.columns[1],dataType:'date',columnType:'DATE',valueKind:'temporal' as const}]};
 const zone={...meta,columns:[{...meta.columns[1],dataType:'timestamp with time zone',columnType:'TIMESTAMP(9) WITH TIME ZONE',valueKind:'temporal' as const}]};
 const stamp='2026-10-14 12:34:56.123456789';
 expect(postgresqlDialect.exportInsert(timestamp,{values:[stamp],valueKinds:['temporal']})).toContain("TIMESTAMP '2026-10-14 12:34:56.123456789'");
 expect(oracleDialect.exportInsert(date,{values:['2026-10-14 12:34:56'],valueKinds:['temporal']})).toContain("TO_DATE('2026-10-14 12:34:56', 'YYYY-MM-DD HH24:MI:SS'");
 expect(oracleDialect.exportInsert(timestamp,{values:[stamp],valueKinds:['temporal']})).toContain("TO_TIMESTAMP('2026-10-14 12:34:56.123456789', 'YYYY-MM-DD HH24:MI:SS.FF9'");
 expect(oracleDialect.exportInsert(zone,{values:[stamp+' +08:00'],valueKinds:['temporal']})).toContain('TO_TIMESTAMP_TZ(');
 expect(oracleDialect.render({sql:'SELECT :p1 FROM dual',params:[{value:stamp,kind:'temporal',column:timestamp.columns[0]}]}).sql).toContain('TO_TIMESTAMP(');
 expect(oracleDialect.render({sql:'SELECT :p1 FROM dual',params:[{value:stamp,kind:'temporal'}]}).sql).toBeNull();
});
test('SQLite REAL exports preserve floating storage class when the text is integral',()=>{
 const real={...meta,columns:[{...meta.columns[1],valueKind:'real' as const,dataType:'real',columnType:'REAL'}]};
 expect(sqliteDialect.exportInsert(real,{values:['1'],valueKinds:['real']})).toContain('VALUES (1.0)');
 expect(sqliteDialect.exportInsert(real,{values:['-0'],valueKinds:['real']})).toContain('VALUES (-0.0)');
});
test('Oracle identifier bytes follow injected compatibility while 12.1 remains conservative',()=>{
 expect(()=>oracleDialect.quoteIdentifier('x'.repeat(31))).toThrow();
 expect(createOracleDialect(128).quoteIdentifier('x'.repeat(31))).toBe('"'+'x'.repeat(31)+'"');
 expect(()=>createOracleDialect(128).quoteIdentifier('x'.repeat(129))).toThrow();
});
test('PostgreSQL and SQLite exports are not capped by Oracle single-value limits',()=>{
 const text='x'.repeat(3000);
 const one={...meta,columns:[meta.columns[1]]};
 expect(postgresqlDialect.exportInsert(one,{values:[text],valueKinds:['text']})).toContain(text);
 expect(sqliteDialect.exportInsert(one,{values:[text],valueKinds:['text']})).toContain(text);
});
