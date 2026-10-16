import type {AppError,JsonObject,TableTarget} from '../../../shared/contracts.js';
export type TaskState='queued'|'running'|'completed'|'failed'|'cancelled'|'interrupted'|'needs_review';
export interface TaskInput{direction:'import'|'export';target:TableTarget;format:'csv'|'xlsx'|'sql';details:JsonObject}
export interface TransferCounts{readRows:number;committedRows:number;exportedRows:number;bytes:number}
export interface BatchRange{firstRow:number;lastRow:number}
export interface TaskRecord extends TaskInput,TransferCounts{id:string;state:TaskState;operationId:string;createdAt:string;finishedAt:string|null;cancelRequested:boolean;pendingBatch:BatchRange|null;failedBatch:BatchRange|null;outputFileId:string|null;error:AppError|null}
export interface TransferContext{signal:AbortSignal;progress(counts:Partial<TransferCounts>):void;beginBatch(range:BatchRange):void;confirmBatch(committedRows:number):void;rollbackBatch():void;setOutputFile(id:string):void}
