import type {FastifyInstance} from 'fastify';
import type {MysqlAdapter} from '../../mysql/adapter.js';
import type {OperationStore} from '../../local/operations.js';
import type {DatabaseRegistry} from '../../database/registry.js';
import {executeDatabaseSql} from './database-service.js';
import {executeSingleSql} from './service.js';
import {sqlRequestSchema,completionRequestSchema} from './types.js';
import {loadSqlCompletions} from './completions.js';
export function sqlRoutes(app:FastifyInstance,adapter:MysqlAdapter,operations:OperationStore,databases:DatabaseRegistry) {
 app.post('/api/sql/execute',async request=>{const {connectionId,database,sql,maxRows}=sqlRequestSchema.parse(request.body);return databases.get(connectionId).kind==='mysql'?executeSingleSql(adapter,operations,connectionId,database,sql,maxRows):executeDatabaseSql(databases,operations,{connectionId,database,sql,maxRows});});
 app.post('/api/sql/completions',async request=>{const {connectionId,database}=completionRequestSchema.parse(request.body);return databases.get(connectionId).kind==='mysql'?loadSqlCompletions(adapter,connectionId,database):databases.get(connectionId).loadCompletions(connectionId,database);});
}
