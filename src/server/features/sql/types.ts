import {z} from 'zod';
import type {DbCell} from '../../../shared/contracts.js';
import {LIMITS} from '../../../shared/limits.js';
import {identifier128} from '../data/types.js';
export const sqlRequestSchema=z.object({connectionId:z.string().min(1),database:identifier128.or(z.literal('')),sql:z.string(),maxRows:z.number().int().min(1).max(LIMITS.resultRows).default(LIMITS.defaultResultRows)});
export const completionRequestSchema=z.object({connectionId:z.string().min(1),database:identifier128});
export type SqlRequest=z.infer<typeof sqlRequestSchema>;
export interface SqlCompletions {tables:{name:string;columns:string[]}[];truncated:boolean}
export interface SqlResult {operationId:string;columns:{name:string;dataType:string}[];rows:DbCell[][];affectedRows:number;durationMs:number;truncated:boolean;needsReview?:boolean;valueKinds?:import('../../../shared/database.js').ValueKind[][];executionState?:'completed'|'needs_review';maxRows:number}
