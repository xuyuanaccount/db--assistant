import {randomUUID} from 'node:crypto';
import {AppFault,type AppError} from '../../../shared/contracts.js';
import type {MigrationPlan,MigrationTask} from '../../../shared/migrations.js';
import type {LocalStore} from '../../local/database.js';
export class MigrationStore {
 constructor(private local:LocalStore){local.db.exec('CREATE TABLE IF NOT EXISTS migrations(id TEXT PRIMARY KEY, created_at TEXT NOT NULL, payload TEXT NOT NULL)');}
 create(plan:MigrationPlan,operationId:string,id:string=randomUUID()):MigrationTask {
  const t:MigrationTask={id,operationId,plan:structuredClone(plan),state:'queued',createdAt:new Date().toISOString(),finishedAt:null,cancelRequested:false,currentTable:null,pending:null,failedBatch:null,tables:plan.tables.map(p=>({name:p.name,created:false,completed:false,readRows:0,insertedRows:0,updatedRows:0,unchangedRows:0})),readRows:0,insertedRows:0,updatedRows:0,unchangedRows:0,error:null};
  this.local.db.prepare('INSERT INTO migrations(id,created_at,payload) VALUES(?,?,?)').run(t.id,t.createdAt,JSON.stringify(t));return t;
 }
 get(id:string):MigrationTask {const r=this.local.db.prepare('SELECT payload FROM migrations WHERE id=?').get(id);if(!r)throw new AppFault('MIGRATION_NOT_FOUND','找不到同步/迁移任务',404);return JSON.parse(String(r.payload));}
 patch(id:string,changes:Partial<MigrationTask>):MigrationTask {const task={...this.get(id),...changes};this.local.db.prepare('UPDATE migrations SET payload=? WHERE id=?').run(JSON.stringify(task),id);return task;}
 next():MigrationTask|undefined {const r=this.local.db.prepare("SELECT payload FROM migrations WHERE json_extract(payload,'$.state')='queued' ORDER BY rowid LIMIT 1").get();return r?JSON.parse(String(r.payload)):undefined;}
 list():MigrationTask[]{return this.local.db.prepare('SELECT payload FROM migrations ORDER BY created_at DESC,id DESC').all().map(r=>JSON.parse(String(r.payload)));}
 recover():MigrationTask[]{const recovered:MigrationTask[]=[];for(const t of this.list())if(['queued','running'].includes(t.state)){const error:AppError={code:'SERVICE_RESTARTED',message:t.pending?'服务在修改结果确认前中断，请核对目标表和未确认批次，勿直接重试':'服务已重启；已确认批次保留，任务不会自动继续'};recovered.push(this.patch(t.id,{state:t.pending?'needs_review':'interrupted',error,finishedAt:new Date().toISOString()}));}return recovered;}
}
