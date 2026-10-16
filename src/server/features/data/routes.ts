import type { FastifyInstance } from 'fastify';
import type { MysqlAdapter } from '../../mysql/adapter.js';
import type {DatabaseRegistry} from '../../database/registry.js';
import {browseDatabase} from './database-query.js';
import { browseSchema,editsSchema } from './types.js';
import { browse } from './query.js';
import {applyDatabaseEdits} from './database-edits.js';
import {applyEdits} from './edits.js';
import type {OperationStore} from '../../local/operations.js';
export function dataRoutes(app:FastifyInstance,adapter:MysqlAdapter,operations:OperationStore,databases:DatabaseRegistry) {
  app.post('/api/data/browse',async request=>{const input=browseSchema.parse(request.body);return databases.get(input.target.connectionId).kind==='mysql'?browse(adapter,input):browseDatabase(databases,input);});
  app.post('/api/data/edits',async request=>{const {target,changes,expectedFingerprint,generation}=editsSchema.parse(request.body);return databases.get(target.connectionId).kind==='mysql'?applyEdits(adapter,operations,target,changes):applyDatabaseEdits(databases,operations,target,changes,expectedFingerprint??'',generation??NaN);});
}
