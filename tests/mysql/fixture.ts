import mysql from 'mysql2/promise';
import { randomUUID } from 'node:crypto';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../src/server/app.js';
export async function fixture({httpPort=3210}:{httpPort?:number}={}) {
  if(!process.env.MWA_TEST_PASSWORD)throw new Error('设置 MWA_TEST_PASSWORD 以运行真实 MySQL 测试');
  const password=process.env.MWA_TEST_PASSWORD;
  const draft={name:'独立集成测试',host:process.env.MWA_TEST_HOST||'127.0.0.1',port:Number(process.env.MWA_TEST_PORT||3306),username:process.env.MWA_TEST_USER||'root',tls:false};
  const admin=await mysql.createConnection({host:draft.host,port:draft.port,user:draft.username,password,multipleStatements:false,dateStrings:true,supportBigNumbers:true,bigNumberStrings:true,jsonStrings:true});
  const schema=`mwa_test_${randomUUID().replaceAll('-','')}`;
  const dir=mkdtempSync(join(tmpdir(),'mwa-integration-'));const app=buildApp({dataDir:dir,token:'fixture-token',port:httpPort});
  const headers={host:`127.0.0.1:${httpPort}`,'x-mwa-token':'fixture-token'};
  try {
    await admin.query(`CREATE DATABASE \`${schema}\` CHARACTER SET utf8mb4`);
    await admin.query(`USE \`${schema}\``);await admin.query("SET time_zone='+00:00'");
    await admin.query('CREATE TABLE records (tenant_id INT NOT NULL, id BIGINT UNSIGNED NOT NULL, amount DECIMAL(38,8), ratio DOUBLE, text_value LONGTEXT, optional_text VARCHAR(64) NULL, date_value DATE, datetime_value DATETIME(6), timestamp_value TIMESTAMP(6) NULL, json_value JSON, binary_value VARBINARY(64) NULL, qty INT NOT NULL DEFAULT 7, derived_qty INT GENERATED ALWAYS AS (qty * 2) STORED, PRIMARY KEY(tenant_id,id)) ENGINE=InnoDB');
    await admin.execute('INSERT INTO records(tenant_id,id,amount,ratio,text_value,optional_text,date_value,datetime_value,timestamp_value,json_value,binary_value) VALUES(?,?,?,?,?,?,?,?,?,?,?)',[1,'18446744073709551615','123456789012345678901234567890.12345678','1.23456789','中文😀 "引号"\n换行\\N',null,'2026-10-12','2026-10-12 12:34:56.123456','2026-10-12 00:00:00.654321','{"large":9007199254740993,"text":"中文"}',Buffer.from([0,255,92,39])]);
    await admin.query('CREATE TABLE import_rows(id INT PRIMARY KEY, required_text VARCHAR(16) NOT NULL, qty INT NOT NULL DEFAULT 7) ENGINE=InnoDB');
    await admin.query('CREATE TABLE no_pk_rows(value VARCHAR(20)) ENGINE=InnoDB');
    await admin.query('CREATE TABLE non_tx_rows(id INT PRIMARY KEY) ENGINE=MyISAM');
    const profile=app.services.connections.create(draft);await app.services.connections.connect(profile.id,password);
    const [version]=await admin.query('SELECT VERSION() AS version');
    return {app,admin,schema,dir,headers,profile,version:(version as {version:string}[])[0].version,
      request:async(url:string,payload?:Record<string,unknown>,method?:'GET'|'POST'|'DELETE')=>app.inject({url,method:method||(payload?'POST':'GET'),headers,payload}),
      cleanup:async()=>{await app.close();if(/^mwa_test_[a-f0-9]{32}$/.test(schema))await admin.query(`DROP DATABASE \`${schema}\``);await admin.end();rmSync(dir,{recursive:true,force:true});}};
  } catch(error) {await app.close();if(/^mwa_test_[a-f0-9]{32}$/.test(schema))await admin.query(`DROP DATABASE IF EXISTS \`${schema}\``).catch(()=>{});admin.destroy();rmSync(dir,{recursive:true,force:true});throw error;}
}
