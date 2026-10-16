import {randomUUID} from 'node:crypto';
import {AppFault} from '../../../shared/contracts.js';
import type {DdlPreview,SchemaInfo,StructureAction} from '../../../shared/structure.js';
export interface StoredPreview extends DdlPreview {action:StructureAction;generation:number;fingerprint:string|null;schema:SchemaInfo;createdAt:number}
export type PreviewRecord=Omit<StoredPreview,'previewId'|'target'|'expiresAt'|'createdAt'>;
export class PreviewStore {
 private items=new Map<string,StoredPreview>();
 constructor(private now:()=>number=Date.now){}
 private expire(){for(const [id,p] of this.items)if(this.now()>=p.createdAt+300_000)this.items.delete(id);}
 put(record:PreviewRecord):DdlPreview{this.expire();if(this.items.size>=50)throw new AppFault('PREVIEW_LIMIT','待确认预览已达 50 个，请等待过期或完成已有操作',409);const createdAt=this.now(),previewId=randomUUID();const p={...structuredClone(record),previewId,target:record.action.target,createdAt,expiresAt:new Date(createdAt+300_000).toISOString()};this.items.set(previewId,p);return this.public(p);}
 private public(p:StoredPreview):DdlPreview{return structuredClone({previewId:p.previewId,target:p.target,sql:p.sql,expiresAt:p.expiresAt,warnings:p.warnings,confirmationTableName:p.confirmationTableName});}
 get(id:string):StoredPreview{this.expire();const p=this.items.get(id);if(!p)throw new AppFault('PREVIEW_EXPIRED','预览已过期、已执行或服务已重启，请重新预览',409);return structuredClone(p);}
 consume(id:string):StoredPreview{const p=this.get(id);this.items.delete(id);return p;}
 clear():void{this.items.clear();}
}
