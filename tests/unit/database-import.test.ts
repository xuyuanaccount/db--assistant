import {expect,it} from 'vitest';
import {Readable} from 'node:stream';
import {rename} from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {sqliteFixture} from '../sqlite/fixture.js';
import {runDatabaseImport} from '../../src/server/features/transfers/import/database-worker.js';
it.each(['reconnect','disconnect','schema','replacement'] as const)('queued import refuses %s before any write',async mode=>{
 const f=await sqliteFixture();let replacement:Awaited<ReturnType<typeof sqliteFixture>>|undefined;let release!:()=>void;const gate=new Promise<void>(resolve=>release=resolve);
 f.app.services.queue.register('import',async(task,ctx)=>{await gate;await runDatabaseImport(f.app.services.databases,f.app.services.files,task,ctx);});
 try{
 const upload=await f.app.services.files.upload(Readable.from(['id,value\n1,never\n']),'bound.csv');const result=await f.request<any>('/api/transfers/import/start',{uploadId:upload.id,target:f.target('records'),options:{format:'csv',hasHeader:true,toolEscaping:true,emptyCells:'null'},mappings:[{sourceIndex:0,targetColumn:'id'},{sourceIndex:1,targetColumn:'value'}]},'POST');expect(result.statusCode).toBe(202);
 if(mode==='schema')await f.exec('ALTER TABLE records ADD COLUMN extra TEXT');
 else if(mode==='replacement'){replacement=await sqliteFixture();if(f.profile.kind!=='sqlite'||replacement.profile.kind!=='sqlite')throw Error('fixture kind');await rename(replacement.profile.filePath,f.profile.filePath);}
 else{await f.app.services.connections.disconnect(f.profile.id);if(mode==='reconnect')await f.app.services.connections.connect(f.profile.id,'');}
 release();await f.app.services.queue.idle();const task=f.app.services.queue.store.get(result.body.id);expect(task.state).toBe('failed');expect(task.error?.code).toBe(mode==='schema'?'SCHEMA_CHANGED':'CONNECTION_CHANGED');expect(task.pendingBatch).toBeNull();
 if(f.profile.kind!=='sqlite')throw Error('fixture kind');const db=new DatabaseSync(f.profile.filePath,{readOnly:true});try{expect(db.prepare('SELECT count(*) AS n FROM records').get()?.n).toBe(0);}finally{db.close();}
 }finally{release();await f.cleanup();await replacement?.cleanup();}
});
