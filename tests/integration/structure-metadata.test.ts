import {expect,test as baseTest} from 'vitest';
const test=baseTest.skipIf(!process.env.MWA_TEST_PASSWORD);

import {randomUUID} from 'node:crypto';
import {fixture} from '../mysql/fixture.js';
test('reads full structure and ignores statistics but detects DDL changes',async()=>{
 const f=await fixture();const other=`mwa_test_${randomUUID().replaceAll('-','')}`;
 try{
 await f.admin.query("CREATE TABLE inspected(id INT NOT NULL AUTO_INCREMENT PRIMARY KEY, label VARCHAR(40) COLLATE utf8mb4_bin DEFAULT 'CURRENT_TIMESTAMP', stamp TIMESTAMP(6) DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6), qty INT, calc INT GENERATED ALWAYS AS(qty*2) STORED, CHECK(qty>=0), INDEX labels(label(8) DESC,qty)) ENGINE=InnoDB");
 await f.admin.query('CREATE TABLE child(id INT PRIMARY KEY, parent INT, FOREIGN KEY(parent) REFERENCES inspected(id)) ENGINE=InnoDB');
 const target={connectionId:f.profile.id,schema:f.schema,table:'inspected'};
 const describe=async(t=target)=>{const r=await f.request('/api/structure/describe',t);expect(r.statusCode,r.body).toBe(200);return r.json();};
 const before=await describe();expect(before.createSql).toContain('CREATE TABLE');
 expect(before.columns[1]).toMatchObject({name:'label',collation:'utf8mb4_bin',default:{kind:'literal',value:'CURRENT_TIMESTAMP'}});
 expect(before.columns[2].default).toEqual({kind:'current_timestamp'});expect(before.columns[2].blockedReasons.length).toBeGreaterThan(0);
 expect(before.indexes.find((i:any)=>i.name==='labels').columns).toMatchObject([{name:'label',prefixLength:8,direction:'desc'},{name:'qty'}]);
 expect(before.foreignKeys).toMatchObject([{direction:'incoming',columns:['parent'],referencedColumns:['id']}]);expect(before.checks).toHaveLength(1);expect(before.checks[0].enforced).toBe(true);
 await f.admin.query("INSERT INTO inspected(label,qty) VALUES('demo',2)");expect((await describe()).fingerprint).toBe(before.fingerprint);
 await f.admin.query(`ALTER TABLE inspected ALTER CHECK \`${before.checks[0].name}\` NOT ENFORCED`);expect((await describe()).fingerprint).not.toBe(before.fingerprint);
 await f.admin.query('ALTER TABLE inspected ADD COLUMN extra INT');expect((await describe()).fingerprint).not.toBe(before.fingerprint);
 await f.admin.query('CREATE VIEW inspected_view AS SELECT id FROM inspected');expect((await describe({...target,table:'inspected_view'})).readOnlyReasons.length).toBeGreaterThan(0);
 expect((await describe({...target,table:'non_tx_rows'})).readOnlyReasons.length).toBeGreaterThan(0);
 await f.admin.query(`CREATE DATABASE \`${other}\` CHARACTER SET latin1`);
 const {readSchemaInfo}=await import('../../src/server/features/structure/metadata.js');
 const info=await readSchemaInfo(f.admin,other);expect(info.characterSet).toBe('latin1');expect(info.newTableCollation).toMatch(/^utf8mb4_/);
 const unauthorized=await f.app.inject({url:'/api/structure/describe',method:'POST',payload:target,headers:{host:'127.0.0.1:3210'}});expect(unauthorized.statusCode).toBe(401);
 }finally{await f.admin.query(`DROP DATABASE IF EXISTS \`${other}\``);await f.cleanup();}
});
