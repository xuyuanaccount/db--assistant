import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {buildApp} from '../../src/server/app.js';
import type {DatabaseFixture} from '../helpers/database.js';
export async function sqliteFixture(options:{readOnly?:boolean}={}):Promise<DatabaseFixture>{
 const dir=await mkdtemp(join(tmpdir(),'sqlite-adapter-')),path=join(dir,'user.sqlite');
 const db=new DatabaseSync(path);db.exec(`CREATE TABLE records(id INTEGER PRIMARY KEY,value TEXT,qty INTEGER DEFAULT 7,derived_qty INTEGER GENERATED ALWAYS AS (qty*2));CREATE TABLE mixed_rows(value);`);db.close();
 const app=buildApp({dataDir:join(dir,'config'),token:'test-token',port:3319});
 try{const profile=await app.services.connections.saveProfile({kind:'sqlite',name:'Fixture',filePath:path,readOnly:options.readOnly??false});await app.services.connections.connect(profile.id,'');
 const run=async(sql:string,params:import('../../src/shared/database.js').BoundValue[]=[])=>{const session=await app.services.databases.get(profile.id).openSession(profile.id,'main','sql');try{const cursor=await session.openStatement({sql,params});const rows:import('../../src/shared/database.js').NormalizedRow[]=[];for(;;){const p=await cursor.read(100,1024*1024);if(p.omittedRows)throw new Error('Fixture result exceeds budget');rows.push(...p.rows);if(p.done)break;}await cursor.close();return rows;}finally{await session.close('discard');}};
 return {app,profile,namespace:'main',target:table=>({connectionId:profile.id,schema:'main',table}),request:async<T>(url:string,payload?:unknown,method='GET')=>{const r=await app.inject({url,method:method as 'GET',payload:payload as object,headers:{host:'127.0.0.1:3319','x-mwa-token':'test-token'}});return {statusCode:r.statusCode,body:r.json<T>()};},exec:async(sql,params)=>{await run(sql,params);},query:run,cleanup:async()=>{await app.close();await rm(dir,{recursive:true,force:true});}};
 }catch(error){await app.close();await rm(dir,{recursive:true,force:true});throw error;}
}
