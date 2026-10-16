import { expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { openLocalStore } from '../../src/server/local/database.js';
import { OperationStore } from '../../src/server/local/operations.js';
test('operation start and unknown outcome survive reopening', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mwa-log-'));
  let store = openLocalStore(dir);
  try {
    let logs = new OperationStore(store);
    const id = logs.begin({ type: 'data_edit', connectionName: '开发库', sql: 'UPDATE t SET x=?' });
    store.close(); store = openLocalStore(dir); logs = new OperationStore(store);
    expect(logs.get(id).status).toBe('running');
    logs.finish(id, { status: 'needs_review', durationMs: 12 });
    expect(logs.get(id).status).toBe('needs_review');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
