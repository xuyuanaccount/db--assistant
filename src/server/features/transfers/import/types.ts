import{z}from'zod';import type{DbCell}from'../../../../shared/contracts.js';import{targetSchema}from'../../data/types.js';
export const importOptionsSchema=z.object({format:z.enum(['csv','xlsx']),delimiter:z.enum([',','\t']).default(','),hasHeader:z.boolean(),sheet:z.string().optional(),toolEscaping:z.boolean(),emptyCells:z.enum(['null','empty'])});
export type ImportOptions=z.input<typeof importOptionsSchema>;
export const mappingSchema=z.array(z.object({sourceIndex:z.number().int().min(0).max(16383),targetColumn:z.string()})).max(500);
export type ColumnMapping=z.infer<typeof mappingSchema>[number];
export interface ParsedSourceRow{sourceRow:number;cells:DbCell[]}
export const importRequestSchema=z.object({uploadId:z.string(),target:targetSchema,options:importOptionsSchema,mappings:mappingSchema});
