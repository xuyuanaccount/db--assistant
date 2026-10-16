import {randomUUID} from 'node:crypto';
import {AppFault} from '../../../shared/contracts.js';
import type {MigrationPlan,MigrationPreview} from '../../../shared/migrations.js';
export class MigrationPreviews {
 private records=new Map<string,MigrationPreview>();
 constructor(private now:()=>number=Date.now){}
 put(plan:MigrationPlan):MigrationPreview {this.expire();if(this.records.size>=50)throw new AppFault('PREVIEW_LIMIT','待确认预览已达 50 个，请等待过期或完成已有任务',409);const p={previewId:randomUUID(),expiresAt:new Date(this.now()+300_000).toISOString(),plan:structuredClone(plan)};this.records.set(p.previewId,p);return structuredClone(p);}
 private expire(){for(const [id,p] of this.records)if(Date.parse(p.expiresAt)<=this.now())this.records.delete(id);}
 get(id:string):MigrationPreview {this.expire();const p=this.records.get(id);if(!p)throw new AppFault('PREVIEW_EXPIRED','预览已过期、已使用或服务已重启，请重新预检',409);return structuredClone(p);}
 consume(id:string):void {this.get(id);this.records.delete(id);}
 clear():void{this.records.clear();}
}
