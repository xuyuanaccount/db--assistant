import{randomUUID}from'node:crypto';import type{LocalStore}from'../../local/database.js';import{AppFault}from'../../../shared/contracts.js';import type{TaskInput,TaskRecord}from'./types.js';
export class TransferStore {
 constructor(private local:LocalStore){}
 create(input:TaskInput,operationId:string,id:string=randomUUID()):TaskRecord{const task:TaskRecord={...input,id,operationId,state:'queued',createdAt:new Date().toISOString(),finishedAt:null,cancelRequested:false,pendingBatch:null,failedBatch:null,outputFileId:null,error:null,readRows:0,committedRows:0,exportedRows:0,bytes:0};this.local.db.prepare('INSERT INTO transfers(id,created_at,payload) VALUES(?,?,?)').run(task.id,task.createdAt,JSON.stringify(task));return task;}
 get(id:string):TaskRecord{const row=this.local.db.prepare('SELECT payload FROM transfers WHERE id=?').get(id);if(!row)throw new AppFault('TASK_NOT_FOUND','找不到任务',404);return JSON.parse(String(row.payload));}
 patch(id:string,patch:Partial<TaskRecord>):TaskRecord{const task={...this.get(id),...patch};this.local.db.prepare('UPDATE transfers SET payload=? WHERE id=?').run(JSON.stringify(task),id);return task;}
 list():TaskRecord[]{return this.local.db.prepare('SELECT payload FROM transfers ORDER BY created_at DESC,id DESC').all().map(row=>JSON.parse(String(row.payload)));}
 remove(id:string){this.local.db.prepare('DELETE FROM transfers WHERE id=?').run(id);}
}
