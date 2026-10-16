import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import assert from 'node:assert/strict';
const production=process.argv.includes('--production');
const {buildApp}=await import(production?'../../dist/server/app.js':'../../src/server/app.ts');
const dir=await mkdtemp(join(tmpdir(),'sqlite-worker-smoke-'));
const path=join(dir,'synthetic.sqlite');
const db=new DatabaseSync(path);db.exec('CREATE TABLE smoke(id INTEGER PRIMARY KEY, value TEXT)');db.close();
const app=buildApp({dataDir:join(dir,'config'),token:'smoke-token',port:3319});
try {
 const profile=await app.services.connections.saveProfile({kind:'sqlite',name:'Smoke',filePath:path,readOnly:false});
 await app.services.connections.connect(profile.id,'');
 const adapter=app.services.databases.get(profile.id);
 assert.deepEqual(await adapter.listTables(profile.id,'main'),[{name:'smoke',kind:'table'}]);
 const session=await adapter.openSession(profile.id,'main','sql');
 try {const cursor=await session.openStatement({sql:'SELECT 9223372036854775807 AS exact_integer',params:[]});assert.deepEqual((await cursor.read(100,10000)).rows[0],{values:['9223372036854775807'],valueKinds:['integer']});await cursor.close();}finally{await session.close('discard');}
 const health=await app.inject({url:'/api/health',headers:{host:'127.0.0.1:3319'}});assert.equal(health.statusCode,200);
 console.log(JSON.stringify({marker:'SQLITE_RUNTIME_SMOKE_OK',mode:production?'production':'development',node:process.version,sqlite:app.services.connections.context(profile.id).version}));
}finally{await app.close();await rm(dir,{recursive:true,force:true});}
