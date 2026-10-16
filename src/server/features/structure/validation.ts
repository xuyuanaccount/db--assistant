import mysql from 'mysql2/promise';
import {z} from 'zod';
export const identifier=z.string().min(1).max(64).refine(s=>!/[\u0000-\u001f\u007f\ud800-\udfff]/.test(s)&&!s.endsWith(' '),'标识符不能含控制字符、代理字符或尾部空格');
export const targetSchema=z.object({connectionId:z.string().min(1),schema:identifier,table:identifier}).strict();
export function quoteIdentifier(name:string):string{return mysql.escapeId(identifier.parse(name),true);}
import {FIELD_KINDS} from '../../../shared/structure.js';
const fieldType=z.object({kind:z.enum(FIELD_KINDS),unsigned:z.boolean().optional(),length:z.number().int().optional(),precision:z.number().int().optional(),scale:z.number().int().optional(),fsp:z.number().int().optional(),booleanDisplay:z.boolean().optional()}).strict();
const fieldDefault=z.discriminatedUnion('kind',[z.object({kind:z.literal('none')}).strict(),z.object({kind:z.literal('null')}).strict(),z.object({kind:z.literal('literal'),value:z.string().refine(s=>Buffer.byteLength(s)<=16384,'默认值过长')}).strict(),z.object({kind:z.literal('current_timestamp')}).strict()]);
export const definitionSchema=z.object({name:identifier,type:fieldType,nullable:z.boolean(),default:fieldDefault,comment:z.string().max(1024),autoIncrement:z.boolean()}).strict();
const at={target:targetSchema};
export const actionSchema=z.discriminatedUnion('kind',[
 z.object({...at,kind:z.literal('create_table'),columns:z.array(definitionSchema).min(1).max(128),primaryKey:z.array(identifier).max(16),comment:z.string().max(2048)}).strict(),
 z.object({...at,kind:z.literal('add_column'),definition:definitionSchema}).strict(),
 z.object({...at,kind:z.literal('modify_column'),column:identifier,patch:definitionSchema.pick({type:true,nullable:true,default:true,comment:true}).partial().refine(x=>Object.keys(x).length>0,'请选择修改内容')}).strict(),
 z.object({...at,kind:z.literal('rename_column'),column:identifier,newName:identifier}).strict(),
 z.object({...at,kind:z.literal('drop_column'),column:identifier}).strict(),
 z.object({...at,kind:z.literal('add_index'),name:identifier,unique:z.boolean(),columns:z.array(z.object({name:identifier,prefixLength:z.number().int().min(1).max(3072).optional()}).strict()).min(1).max(16)}).strict(),
 z.object({...at,kind:z.literal('drop_index'),name:identifier}).strict(),
]);
export const previewSchema=z.object({action:actionSchema,expectedFingerprint:z.string().min(1).max(64).optional()}).strict();
export const applySchema=z.object({previewId:z.string().uuid(),confirmationTableName:z.string().max(64).optional()}).strict();
