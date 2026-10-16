import {expect,test} from 'vitest';
import {mkdtempSync,rmSync} from 'node:fs';import {tmpdir}from'node:os';import{join}from'node:path';
import{openLocalStore}from'../../src/server/local/database.js';import{OperationStore}from'../../src/server/local/operations.js';
import{TransferStore}from'../../src/server/features/transfers/store.js';import{TransferQueue}from'../../src/server/features/transfers/queue.js';
test('queue is serial and restart preserves unresolved batch without retry',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'mwa-queue-'));const local=openLocalStore(dir);const store=new TransferStore(local);const operations=new OperationStore(local);const queue=new TransferQueue(store,operations);
 const input={direction:'import' as const,target:{connectionId:'x',schema:'s',table:'t'},format:'csv' as const,details:{}};let active=0,max=0;
 queue.register('import',async(_task,ctx)=>{active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,5));ctx.beginBatch({firstRow:2,lastRow:501});ctx.confirmBatch(500);active--;});
 try{queue.enqueue(input);queue.enqueue(input);await queue.idle();expect(max).toBe(1);expect(store.list().every(t=>t.committedRows===500)).toBe(true);
 const task=store.create(input,'operation');store.patch(task.id,{state:'running',pendingBatch:{firstRow:502,lastRow:1001},committedRows:500});
 const recovered=new TransferQueue(store,operations);expect(store.get(task.id).state).toBe('needs_review');expect(store.get(task.id).committedRows).toBe(500);await recovered.close();
 }finally{await queue.close();local.close();rmSync(dir,{recursive:true,force:true});}
});
