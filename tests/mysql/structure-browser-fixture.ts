import {randomUUID} from 'node:crypto';import {resolve} from 'node:path';import serveStatic from '@fastify/static';import {fixture} from './fixture.js';
const httpPort=Number(process.env.MWA_BROWSER_PORT||3210);
const f=await fixture({httpPort});const empty=`mwa_test_${randomUUID().replaceAll('-','')}`;
let stopping=false;async function stop(){if(stopping)return;stopping=true;try{await f.admin.query(`DROP DATABASE IF EXISTS \`${empty}\``);}finally{await f.cleanup();}process.exit(0);}
process.on('SIGINT',()=>void stop());process.on('SIGTERM',()=>void stop());
try{await f.admin.query(`CREATE DATABASE \`${empty}\` CHARACTER SET utf8mb4`);await f.app.register(serveStatic,{root:resolve('dist/web')});await f.app.listen({host:'127.0.0.1',port:httpPort});console.log(JSON.stringify({url:`http://127.0.0.1:${httpPort}`,schema:f.schema,empty,mysqlVersion:f.version}));process.stdin.resume();}catch(error){console.error((error as Error).message);await stop();}
