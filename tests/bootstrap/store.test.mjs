import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openLocalStore } from '../../src/server/local/database.ts';
import { OperationStore } from '../../src/server/local/operations.ts';
test('persist unknown write outcome across application restarts', () => {
  const dir = mkdtempSync(join(tmpdir(), 'mwa-bootstrap-'));
  let store = openLocalStore(dir);
  try {
    let logs = new OperationStore(store);
    const id = logs.begin({ type: 'data_edit', connectionName: 'local', sql: 'UPDATE t SET x=?' });
    store.close(); store = openLocalStore(dir); logs = new OperationStore(store);
    assert.equal(logs.get(id).status, 'running');
    logs.finish(id, { status: 'needs_review', durationMs: 3 });
    assert.equal(logs.get(id).status, 'needs_review');
  } finally { store.close(); rmSync(dir, { recursive: true, force: true }); }
});
