import {expect,test} from 'vitest';
import {assertSingleSql} from '../../src/server/database/statements.js';

test('allows semicolons inside PostgreSQL dollar quotes, E strings and nested comments',()=>{
 expect(()=>assertSingleSql('postgresql','SELECT $$a;b$$')).not.toThrow();
 expect(()=>assertSingleSql('postgresql',"SELECT E'a\\';b' /* outer /* inner ; */ rest */")).not.toThrow();
 expect(assertSingleSql('postgresql',' /* lead */ SELECT 1; -- tail').category).toBe('transactional');
});
test('allows semicolons inside Oracle q quotes',()=>{
 expect(()=>assertSingleSql('oracle',"SELECT q'[a;b]' FROM dual")).not.toThrow();
 expect(()=>assertSingleSql('oracle',"SELECT q'{a;b}' FROM dual")).not.toThrow();
});
test('rejects a second statement and unterminated SQL in every new dialect',()=>{
 expect(()=>assertSingleSql('sqlite','SELECT 1; DELETE FROM records')).toThrow();
 for(const kind of ['postgresql','oracle','sqlite'] as const){
  expect(()=>assertSingleSql(kind,'SELECT 1; SELECT 2')).toThrow();
  expect(()=>assertSingleSql(kind,"SELECT 'unfinished")).toThrow();
  expect(()=>assertSingleSql(kind,' -- only comment')).toThrow();
 }
});
test('rejects procedural, protocol, extension and transaction/session commands before execution',()=>{
 const rejected:[Parameters<typeof assertSingleSql>[0],string][]= [
  ['postgresql','DO $$ BEGIN NULL; END $$'],['postgresql','COPY t TO STDOUT'],['postgresql','CREATE FUNCTION f() RETURNS int AS $$ SELECT 1 $$ LANGUAGE SQL'],
  ['oracle','BEGIN NULL; END;'],['oracle','DECLARE x NUMBER; BEGIN NULL; END;'],['oracle','CALL p()'],
  ['sqlite',"ATTACH DATABASE 'other.db' AS other"],['sqlite','DETACH DATABASE other'],['sqlite',"SELECT load_extension('x')"],
  ['postgresql','BEGIN'],['oracle','COMMIT'],['sqlite','ROLLBACK'],['postgresql','SET search_path = public'],['oracle','ALTER SESSION SET CURRENT_SCHEMA = X'],
 ];
 for(const [kind,sql] of rejected)expect(()=>assertSingleSql(kind,sql),`${kind}: ${sql}`).toThrow();
});
test('classifies ordinary DDL and metadata commands and restricts SQLite PRAGMA to read only forms',()=>{
 expect(assertSingleSql('postgresql','CREATE TABLE x (id int)').category).toBe('ddl');
 expect(assertSingleSql('sqlite','PRAGMA table_info("x")').category).toBe('metadata');
 expect(()=>assertSingleSql('sqlite','PRAGMA journal_mode=WAL')).toThrow();
 expect(()=>assertSingleSql('sqlite','PRAGMA foreign_keys(OFF)')).toThrow();
});
test('ordinary identifiers named after forbidden commands do not reject a SELECT',()=>{
 expect(()=>assertSingleSql('postgresql','SELECT copy, function FROM records')).not.toThrow();
});
test('metadata commands must fit the database and server controls are rejected',()=>{
 expect(assertSingleSql('postgresql','SHOW server_version').category).toBe('metadata');
 expect(()=>assertSingleSql('sqlite','SHOW TABLES')).toThrow();
 expect(()=>assertSingleSql('oracle','DESCRIBE T')).toThrow();
 expect(()=>assertSingleSql('postgresql','ALTER SYSTEM SET work_mem = 1024')).toThrow();
});
test('supplementary Unicode before a separator cannot hide the following statement',()=>{
 const sql="SELECT '"+'😀'.repeat(50)+"'; DELETE FROM records";
 expect(()=>assertSingleSql('postgresql',sql)).toThrow();
 expect(()=>assertSingleSql('sqlite',sql)).toThrow();
});
test('quoted callable names cannot bypass session and extension restrictions',()=>{
 expect(()=>assertSingleSql('postgresql',`SELECT "set_config"('search_path','other',false)`)).toThrow();
 expect(()=>assertSingleSql('sqlite',`SELECT "load_extension"('x')`)).toThrow();
});
test('dollars inside PostgreSQL names and quoted SQLite names remain identifiers',()=>{
 expect(()=>assertSingleSql('postgresql','SELECT foo$tag$bar FROM records')).not.toThrow();
 expect(()=>assertSingleSql('sqlite','SELECT `a;b` FROM records')).not.toThrow();
 expect(assertSingleSql('sqlite','PRAGMA "main".table_info("t")').category).toBe('metadata');
});
test('PostgreSQL Unicode-escaped callable identifiers are rejected before execution',()=>{
 expect(()=>assertSingleSql('postgresql',`SELECT U&"\\0073et_config"('search_path','other',false)`)).toThrow();
 expect(()=>assertSingleSql('postgresql',`SELECT U&"!0073et_config" UESCAPE '!'('search_path','other',false)`)).toThrow();
});
test('ordinary quoted identifiers do not become command keywords',()=>{
 expect(assertSingleSql('postgresql','CREATE TABLE "user" (id integer)').category).toBe('ddl');
 expect(assertSingleSql('sqlite','CREATE TABLE accounts("role" TEXT)').category).toBe('ddl');
 expect(assertSingleSql('postgresql','SELECT "alter session" FROM t').category).toBe('transactional');
});
test('call rejection matches the complete quoted callable name',()=>{
 expect(()=>assertSingleSql('postgresql',`SELECT "my set_config"('x')`)).not.toThrow();
 expect(()=>assertSingleSql('sqlite',`SELECT "load_extension helper"('x')`)).not.toThrow();
});
