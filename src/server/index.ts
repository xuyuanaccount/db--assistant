import { randomBytes } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import {existsSync}from'node:fs';
import { buildApp } from './app.js';
const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex >= 0 ? process.argv[portIndex+1] : process.env.MWA_PORT || 3210);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('端口必须为 1–65535');
const app = buildApp({
  dataDir: resolve(process.env.MWA_DATA_DIR || '.local-data'), token: randomBytes(32).toString('hex'), port,
  webDir: fileURLToPath(new URL('../web/', import.meta.url)),
  ...(!existsSync(fileURLToPath(new URL('../web/index.html',import.meta.url))) ? { devOrigin: 'http://127.0.0.1:5173' } : {}),
});
let stopping = false;
const stop = async () => { if (!stopping) { stopping = true; await app.close(); process.exit(0); } };
process.on('SIGINT', stop); process.on('SIGTERM', stop);
try { await app.listen({ host: '127.0.0.1', port }); console.log(`MySQL 工作台：http://127.0.0.1:${port}`); }
catch (error) { console.error((error as NodeJS.ErrnoException).code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请使用 --port 指定其他端口` : '服务启动失败'); await app.close(); process.exitCode = 1; }
