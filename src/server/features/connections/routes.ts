import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { connectionDraftSchema } from './types.js';
import type { ConnectionService } from './service.js';
import type {DatabaseRegistry} from '../../database/registry.js';
export function connectionRoutes(app: FastifyInstance, service: ConnectionService, databases: DatabaseRegistry) {
  app.get('/api/connections',async()=>service.list());
  app.post('/api/connections',async(request,reply)=>reply.code(201).send(await service.saveProfile(connectionDraftSchema.parse(request.body))));
  app.patch('/api/connections/:id',async request=>service.update(z.object({id:z.string()}).parse(request.params).id,connectionDraftSchema.parse(request.body)));
  app.delete('/api/connections/:id',async(request,reply)=>{ await service.remove(z.object({id:z.string()}).parse(request.params).id); return reply.code(204).send(); });
  app.post('/api/connections/test',async request=>{ const body=z.object({draft:connectionDraftSchema,password:z.string().max(4096)}).parse(request.body); await service.test(body.draft,body.password); return {ok:true}; });
  app.post('/api/connections/:id/connect',async request=>{ const {id}=z.object({id:z.string()}).parse(request.params); const {password}=z.object({password:z.string().max(4096)}).parse(request.body); await service.connect(id,password); return {connected:true}; });
  app.post('/api/connections/:id/disconnect',async(request,reply)=>{ await service.disconnect(z.object({id:z.string()}).parse(request.params).id); return reply.code(204).send(); });
  app.get('/api/connections/:id/context',async request=>databases.context(z.object({id:z.string()}).parse(request.params).id));
  app.get('/api/connections/:id/schemas',async request=>({schemas:await databases.get(z.object({id:z.string()}).parse(request.params).id).listNamespaces(z.object({id:z.string()}).parse(request.params).id)}));
  app.get('/api/connections/:id/schemas/:schema/tables',async request=>{const {id,schema}=z.object({id:z.string(),schema:z.string()}).parse(request.params);return {tables:await databases.get(id).listTables(id,schema)};});
}
