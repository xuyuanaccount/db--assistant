import {writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {fixture} from './fixture.js';

const f=await fixture();
const uploadPath=join(f.dir,'browser-import.csv');
writeFileSync(uploadPath,'id,required_text,qty\n2,浏览器导入,9\n3,中文测试,11\n');
console.log(JSON.stringify({schema:f.schema,mysqlVersion:f.version,uploadPath}));
let stopping=false;
async function stop(){if(stopping)return;stopping=true;await f.cleanup();process.exit(0);}
process.on('SIGINT',()=>void stop());
process.on('SIGTERM',()=>void stop());
process.stdin.resume();
