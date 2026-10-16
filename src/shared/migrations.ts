import type {AppError, OperationStatus} from './contracts.js';
export interface DatabaseEndpoint {connectionId:string; schema:string}
export interface MigrationRequest {mode:'migrate'|'sync'; source:DatabaseEndpoint; target:DatabaseEndpoint; tables:string[]; batchSize:number}
export interface MigrationTablePlan {name:string; sourceFingerprint:string; targetFingerprint:string|null; createSql:string|null; writeColumns:string[]; primaryKey:string[]}
export interface MigrationPlan {request:MigrationRequest; sourceServer:string; targetServer:string; sourceGeneration:number; targetGeneration:number; sourceName:string; targetName:string; tables:MigrationTablePlan[]; warnings:string[]}
export interface MigrationPreview {previewId:string; expiresAt:string; plan:MigrationPlan}
export interface MigrationCounts {readRows:number; insertedRows:number; updatedRows:number; unchangedRows:number}
export interface MigrationTableResult extends MigrationCounts {name:string; created:boolean; completed:boolean}
export interface MigrationPending {table:string; phase:'create'|'data'; firstRow:number; lastRow:number}
export interface MigrationTask extends MigrationCounts {id:string; operationId:string; plan:MigrationPlan; state:'queued'|OperationStatus; createdAt:string; finishedAt:string|null; cancelRequested:boolean; currentTable:string|null; pending:MigrationPending|null; failedBatch:MigrationPending|null; tables:MigrationTableResult[]; error:AppError|null}
