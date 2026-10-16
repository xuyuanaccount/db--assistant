import {PostgresqlDriverFactory} from './database/postgresql/factory.js';
import {PostgresqlDatabaseAdapter} from './database/postgresql/adapter.js';
import {SqliteDriverFactory} from './database/sqlite/factory.js';
import {SqliteDatabaseAdapter} from './database/sqlite/adapter.js';
import {DatabaseRegistry} from './database/registry.js';
import {MysqlDatabaseAdapter} from './database/mysql.js';
import {MysqlDriverFactory} from './database/mysql-factory.js';
import Fastify, { type FastifyInstance } from 'fastify';
import serveStatic from '@fastify/static';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { ZodError } from 'zod';
import { errorInfo } from '../shared/contracts.js';
import { openLocalStore, type LocalStore } from './local/database.js';
import { OperationStore } from './local/operations.js';
import { installAccess } from './http/access.js';
import { ConnectionStore } from './features/connections/store.js';
import { ConnectionService } from './features/connections/service.js';
import { connectionRoutes } from './features/connections/routes.js';
import { MysqlAdapter } from './mysql/adapter.js';
import { dataRoutes } from './features/data/routes.js';
import {sqlRoutes} from './features/sql/routes.js';
import{TransferStore}from'./features/transfers/store.js';import{TransferQueue}from'./features/transfers/queue.js';import{FileStore}from'./features/transfers/files.js';import{transferRoutes}from'./features/transfers/routes.js';
import{logRoutes}from'./features/logs/routes.js';
import {StructureService} from './features/structure/service.js';
import {MigrationStore} from './features/migrations/store.js';
import {MigrationService} from './features/migrations/service.js';
import {migrationRoutes} from './features/migrations/routes.js';
import {structureReadRoutes} from './features/structure/read-routes.js';
import {structureRoutes} from './features/structure/routes.js';
export interface AppServices { store: LocalStore; operations: OperationStore; connections: ConnectionService; databases:DatabaseRegistry; mysql: MysqlAdapter;queue:TransferQueue;files:FileStore;structure:StructureService; migrations:MigrationService }
export type AppInstance = FastifyInstance & { services: AppServices };
export function buildApp(options: { dataDir: string; token: string; port: number; webDir?: string; devOrigin?: string }): AppInstance {
  const store = openLocalStore(options.dataDir);
  const operations = new OperationStore(store);
  const connections = new ConnectionService(new ConnectionStore(store),operations);
  const mysql = new MysqlAdapter(connections);
  const databases=new DatabaseRegistry(connections,{postgresql:{factory:new PostgresqlDriverFactory(),adapter:connections=>new PostgresqlDatabaseAdapter(connections)},mysql:{factory:new MysqlDriverFactory(),adapter:new MysqlDatabaseAdapter(mysql)},sqlite:{factory:new SqliteDriverFactory(join(store.dataDir,'assistant.sqlite')),adapter:connections=>new SqliteDatabaseAdapter(connections)}});
  const structure=new StructureService(mysql,operations);
  const migrations=new MigrationService(new MigrationStore(store),mysql,operations);
  const queue=new TransferQueue(new TransferStore(store),operations);const files=new FileStore(store);
  operations.recover();
  const app = Object.assign(Fastify({ logger: false, bodyLimit: 12 * 1024 * 1024 }),
    { services: { store, operations, connections, databases, mysql,queue,files,structure,migrations } });
  installAccess(app, options);
  app.setErrorHandler((error, _request, reply) => {
    if (error instanceof ZodError) return reply.code(400).send({ error: { code: 'VALIDATION', message: error.issues.map(issue => issue.message).join('；') } });
    const info = errorInfo(error);
    const status = (error as { statusCode?: number }).statusCode || (info.mysqlCode ? 400 : 500);
    return reply.code(status).send({ error: info });
  });
  app.get('/api/health', async () => ({ ok: true }));
  app.get('/api/bootstrap', async () => ({ token: options.token }));
  connectionRoutes(app,connections,databases);
  dataRoutes(app,mysql,operations,databases);
  structureRoutes(app,structure);
  migrationRoutes(app,migrations);
  sqlRoutes(app,mysql,operations,databases);
  structureReadRoutes(app,databases);
  transferRoutes(app,queue,files,mysql,operations,databases);
  logRoutes(app,operations);
  const cleanup=async(startup=false)=>{const tasks=queue.store.list();await files.cleanup(new Date(),tasks,startup);for(const task of tasks)if(task.finishedAt&&task.state!=='needs_review'&&Date.now()-Date.parse(task.finishedAt)>24*60*60*1000)queue.store.remove(task.id);};
  app.addHook('onReady',async()=>{await cleanup(true);});
  const cleanupTimer=setInterval(()=>{void cleanup().catch(()=>{});},60_000);cleanupTimer.unref();
  if (options.webDir && existsSync(join(options.webDir,'index.html'))) {
    void app.register(serveStatic, { root: options.webDir });
    app.setNotFoundHandler((request, reply) => request.url.startsWith('/api/')
      ? reply.code(404).send({ error: { code: 'NOT_FOUND', message: '接口不存在' } }) : reply.sendFile('index.html'));
  }
  app.addHook('onClose', async () => { clearInterval(cleanupTimer);await migrations.close();await queue.close();await structure.close();await connections.close(); store.close(); });
  return app;
}
