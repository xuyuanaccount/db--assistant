import {expect,test,vi} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir} from 'node:os';import {join} from 'node:path';import {buildApp} from '../../src/server/app.js';
test('coordinates normal and exclusive leases and releases idempotently',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mwa-exclusive-'));const app=buildApp({dataDir:dir,token:'t',port:3210});const c=app.services.connections;
 try{const p=c.create({name:'unit',host:'127.0.0.1',port:3306,username:'root',tls:false});vi.spyOn(c,'test').mockResolvedValue();await c.connect(p.id,'unit');const generation=c.generation(p.id);
 const read=c.retain(p.id);expect(()=>c.retainExclusive(p.id)).toThrow();read();read();const write=c.retainExclusive(p.id);expect(()=>c.retain(p.id)).toThrow();expect(()=>c.retainExclusive(p.id)).toThrow();await expect(c.disconnect(p.id)).rejects.toMatchObject({code:'CONNECTION_BUSY'});write();write();const r=c.retain(p.id);r();await c.disconnect(p.id);expect(c.generation(p.id)).toBeGreaterThan(generation);
 }finally{await app.close();rmSync(dir,{recursive:true,force:true});}
});
