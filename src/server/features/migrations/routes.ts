import type {FastifyInstance} from 'fastify';
import {z} from 'zod';
import type {MigrationService} from './service.js';
export function migrationRoutes(app:FastifyInstance,service:MigrationService):void {
 app.post('/api/migrations/preview',async request=>service.preview(request.body));
 app.post('/api/migrations/start',async(request,reply)=>reply.code(202).send(service.start(request.body)));
 app.get('/api/migrations/tasks',async()=>({items:service.store.list()}));
 app.get('/api/migrations/tasks/:id',async request=>service.store.get(z.object({id:z.string().uuid()}).parse(request.params).id));
 app.post('/api/migrations/tasks/:id/cancel',async request=>{service.cancel(z.object({id:z.string().uuid()}).parse(request.params).id);return {ok:true};});
}
