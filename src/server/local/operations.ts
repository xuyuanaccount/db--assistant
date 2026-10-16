import { randomUUID } from 'node:crypto';
import type { LocalStore } from './database.js';
import type { LogQuery, OperationInput, OperationOutcome, OperationRecord } from '../../shared/contracts.js';
export class OperationStore {
  private store: LocalStore;
  constructor(store: LocalStore) { this.store = store; }
  begin(input: OperationInput): string {
    const id = randomUUID();
    const safe: OperationInput = { type: input.type, connectionId: input.connectionId, connectionName: input.connectionName,
      schema: input.schema, table: input.table, sql: input.sql, taskId: input.taskId, sourceOperationId: input.sourceOperationId };
    const record: OperationRecord = { ...safe, id, startedAt: new Date().toISOString(), finishedAt: null,
      status: 'running', durationMs: null, affectedRows: null, error: null };
    this.store.db.prepare('INSERT INTO operations (id,started_at,type,status,connection_id,payload) VALUES (?,?,?,?,?,?)')
      .run(id, record.startedAt, record.type, record.status, record.connectionId ?? null, JSON.stringify(record));
    return id;
  }
  get(id: string): OperationRecord {
    const row = this.store.db.prepare('SELECT payload FROM operations WHERE id=?').get(id) as { payload: string }|undefined;
    if (!row) throw Object.assign(new Error('操作记录不存在'), { statusCode: 404, code: 'NOT_FOUND' });
    return JSON.parse(row.payload);
  }
  finish(id: string, outcome: OperationOutcome): void {
    const record = this.get(id);
    Object.assign(record, { status: outcome.status, durationMs: outcome.durationMs, affectedRows: outcome.affectedRows ?? null,
      error: outcome.error ?? null, finishedAt: new Date().toISOString() });
    this.store.db.prepare('UPDATE operations SET status=?,finished_at=?,payload=? WHERE id=?')
      .run(record.status, record.finishedAt, JSON.stringify(record), id);
  }
  list(query: LogQuery): { items: OperationRecord[]; hasNext: boolean } {
    const conditions: string[] = []; const params: string[] = [];
    for (const [field, value, operator] of [
      ['started_at',query.from,'>='],['started_at',query.to,'<='],['connection_id',query.connectionId,'='],
      ['type',query.type,'='],['status',query.status,'='],
    ] as const) if (value) { conditions.push(`${field} ${operator} ?`); params.push(value); }
    if(query.search){conditions.push('instr(lower(payload),lower(?)) > 0');params.push(query.search);}
    const where = conditions.length ? ` WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.store.db.prepare(`SELECT payload FROM operations${where} ORDER BY started_at DESC,id DESC LIMIT 51 OFFSET ?`)
      .all(...params, (query.page - 1) * 50) as { payload: string }[];
    return { items: rows.slice(0,50).map(row => JSON.parse(row.payload)), hasNext: rows.length > 50 };
  }
  clear(): void { this.store.db.prepare("DELETE FROM operations WHERE status NOT IN ('running','needs_review')").run(); }
  recover():void {for(const row of this.store.db.prepare("SELECT payload FROM operations WHERE status='running'").all()){const r=JSON.parse(String(row.payload)) as OperationRecord;this.finish(r.id,{status:r.type==='connection_test'?'interrupted':'needs_review',durationMs:Date.now()-Date.parse(r.startedAt),error:{code:'SERVICE_RESTARTED',message:'服务在操作结束确认前重启，请核对结果'}});}}
}
