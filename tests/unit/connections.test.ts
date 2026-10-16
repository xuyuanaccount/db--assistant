import { expect, test } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildApp } from '../../src/server/app.js';
test('connection profiles persist without submitted passwords', async () => {
  const dir = mkdtempSync(join(tmpdir(),'mwa-connections-'));
  const options = { dataDir: dir, token: 'token', port: 3210 };
  let app = buildApp(options);
  const headers = { host: '127.0.0.1:3210', 'x-mwa-token': 'token' };
  try {
    const response = await app.inject({ method: 'POST', url: '/api/connections', headers,
      payload: { name: '本机', host: '127.0.0.1', port: 3306, username: 'root', tls: false, password: 'must-not-persist' } });
    expect(response.statusCode).toBe(201);
    expect(response.json()).not.toHaveProperty('password');
    await app.close(); app = buildApp(options);
    const list = (await app.inject({ url: '/api/connections', headers })).json();
    expect(list).toHaveLength(1); expect(list[0].name).toBe('本机');
    expect(JSON.stringify(app.services.store.db.prepare('SELECT payload FROM connections').all())).not.toContain('must-not-persist');
  } finally { await app.close(); rmSync(dir,{recursive:true,force:true}); }
});
test('invalid connection port is rejected before storing configuration', async () => {
  const dir = mkdtempSync(join(tmpdir(),'mwa-bad-'));
  const app = buildApp({dataDir:dir,token:'token',port:3210});
  try {
    const response = await app.inject({method:'POST',url:'/api/connections',headers:{host:'127.0.0.1:3210','x-mwa-token':'token'},
      payload:{name:'bad',host:'localhost',port:0,username:'root',tls:false}});
    expect(response.statusCode).toBe(400);
  } finally { await app.close(); rmSync(dir,{recursive:true,force:true}); }
});
