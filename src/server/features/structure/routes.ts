import type {FastifyInstance} from 'fastify';import type {StructureService} from './service.js';
import {targetSchema,previewSchema,applySchema} from './validation.js';
export function structureRoutes(app:FastifyInstance,service:StructureService){
 app.post('/api/structure/describe',req=>service.describe(targetSchema.parse(req.body)));
 app.post('/api/structure/preview',req=>service.preview(previewSchema.parse(req.body)));
 app.post('/api/structure/apply',req=>service.apply(applySchema.parse(req.body)));
}
