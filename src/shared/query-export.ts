import type {DbCell} from './contracts.js';
export interface QueryExportSource {
  operationId:string;
  connectionId:string;
  connectionName:string;
  database:string;
}
export interface QueryResultSnapshot {
  valueKinds?:import('./database.js').ValueKind[][];
  executionState?:'completed'|'needs_review';
  columns:{name:string;dataType:string}[];
  rows:DbCell[][];
  truncated:boolean;
  needsReview:boolean;
}
export interface QueryResultExportRequest extends QueryResultSnapshot {
  source:QueryExportSource;
  format:'csv'|'xlsx';
  acknowledgeIncomplete:boolean;
}
