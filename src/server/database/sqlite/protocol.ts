import type {CompiledStatement,NormalizedRow,ResultColumn} from '../../../shared/database.js';
import type {AppError} from '../../../shared/contracts.js';
import type {CommandCompletion} from '../contracts.js';
export type WorkerOperation={op:'open';filePath:string;ownDatabasePath:string;identity:string;readOnly:boolean}|{op:'prepare'|'execute';command:CompiledStatement}|{op:'fetch';cursorId:string;maxRows:number;maxBytes:number}|{op:'begin';mode:'write'|'snapshot'|'sql'}|{op:'commit'}|{op:'rollback'}|{op:'close';cursorId?:string};
export type WorkerRequest=WorkerOperation & {requestId:string;sessionId:string};
export interface Prepared {cursorId:string;columns:ResultColumn[]}
export interface Chunk {rows:NormalizedRow[];done:boolean;omittedRows?:number;completion?:CommandCompletion}
export type WorkerResponse={requestId:string;sessionId:string;type:'result';value:unknown}|{requestId:string;sessionId:string;type:'error';error:AppError};
