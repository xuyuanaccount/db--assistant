import type {Capability,CapabilitySet,DatabaseKind,ValueKind} from './database.js';
export type DbCell = null | string | { binaryHex: string };
export type DataRow = Record<string, DbCell>;
export interface TableTarget { connectionId: string; schema: string; table: string }
export interface ColumnMeta {
  valueKind?:ValueKind;identity?:'none'|'always'|'by-default';editable?:Capability;importable?:Capability;comparable?:boolean;
  name: string; dataType: string; columnType: string; nullable: boolean;
  hasDefault: boolean; generated: boolean; autoIncrement: boolean; ordinal: number;
}
export interface TableMeta {
  databaseKind?:DatabaseKind;capabilities?:CapabilitySet;definitionFingerprint?:string;
  schema: string; name: string; kind: 'table'|'view'; engine: string|null;
  columns: ColumnMeta[]; primaryKey: string[];
}
export interface AppError { code: string; message: string; operationId?: string; mysqlCode?: string;databaseKind?:DatabaseKind;driverCode?:string }
export type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };
export type JsonObject = { [key: string]: JsonValue };
export type OperationStatus = 'running'|'completed'|'failed'|'cancelled'|'interrupted'|'needs_review';
export interface OperationInput {
  type: 'connection_test'|'sql'|'data_edit'|'import'|'export'|'schema_change'|'migration'|'sync';
  connectionId?: string; connectionName?: string; schema?: string; table?: string; sql?: string; taskId?: string; sourceOperationId?: string;
}
export interface OperationOutcome {
  status: Exclude<OperationStatus,'running'>; durationMs: number; affectedRows?: number; error?: AppError;
}
export interface OperationRecord extends OperationInput {
  id: string; startedAt: string; finishedAt: string|null; status: OperationStatus;
  durationMs: number|null; affectedRows: number|null; error: AppError|null;
}
export interface LogQuery {
  page: number; from?: string; to?: string; connectionId?: string; type?: OperationInput['type']; status?: OperationStatus;search?:string;
}
export class AppFault extends Error {
  code: string; statusCode: number; operationId?: string; databaseKind?:DatabaseKind;driverCode?:string;
  constructor(code: string, message: string, statusCode = 400, operationId?: string) {
    super(message); this.code = code; this.statusCode = statusCode; this.operationId = operationId;
  }
}
export function errorInfo(error: unknown): AppError {
  const e = error as { code?: string; message?: string; operationId?: string;databaseKind?:DatabaseKind;driverCode?:string };
  return { code: e.code || 'INTERNAL_ERROR', message: e.message || '操作失败', operationId: e.operationId, ...(e.databaseKind?{databaseKind:e.databaseKind}:{}),...(e.driverCode?{driverCode:e.driverCode}:{}),
    ...((e.code || '').startsWith('ER_') ? { mysqlCode: e.code } : {}) };
}
