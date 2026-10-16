import type {FastifyInstance} from 'fastify';
import type {DatabaseRegistry} from '../../database/registry.js';
import {targetSchema} from '../data/types.js';
export function structureReadRoutes(app:FastifyInstance,registry:DatabaseRegistry){app.post('/api/database/structure/describe',async request=>{const target=targetSchema.parse(request.body);return registry.get(target.connectionId).describeStructure(target);});}
