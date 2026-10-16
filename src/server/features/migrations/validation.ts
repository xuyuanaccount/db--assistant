import {z} from 'zod';
import {identifier} from '../structure/validation.js';
const endpoint=z.object({connectionId:z.string().min(1).max(128),schema:identifier}).strict();
export const migrationRequestSchema=z.object({mode:z.enum(['migrate','sync']),source:endpoint,target:endpoint,tables:z.array(identifier).min(1).max(100).refine(t=>new Set(t).size===t.length,'不能重复选择表'),batchSize:z.number().int().min(1).max(500).default(500)}).strict();
export const migrationStartSchema=z.object({previewId:z.string().uuid(),confirmationSchema:identifier}).strict();
