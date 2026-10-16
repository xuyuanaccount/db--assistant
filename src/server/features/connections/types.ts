import {z} from 'zod';
const name=z.string().trim().min(1).max(100);
const network={name,host:z.string().trim().min(1).max(255),username:z.string().min(1).max(128),tls:z.boolean().default(false)};
const port=(fallback:number)=>z.number().int().min(1).max(65535).default(fallback);
const namespace=z.string().max(128);
export const mysqlDraftSchema=z.object({...network,kind:z.literal('mysql'),port:port(3306),defaultDatabase:z.string().max(64).optional()});
const normalizedDraftSchema=z.discriminatedUnion('kind',[
 mysqlDraftSchema,
 z.object({...network,kind:z.literal('postgresql'),port:port(5432),database:z.string().min(1).max(128),defaultSchema:namespace.default('public')}),
 z.object({...network,kind:z.literal('oracle'),port:port(1521),serviceName:z.string().min(1).max(255),defaultSchema:namespace.optional()}),
 z.object({kind:z.literal('sqlite'),name,filePath:z.string().min(1).refine(p=>p.startsWith('/')&&!p.includes('\0')&&!p.includes('?'),'需要绝对文件路径'),readOnly:z.boolean().default(false)}),
]);
export const connectionDraftSchema=z.preprocess(value=>value&&typeof value==='object'&&!('kind' in value)?{...value,kind:'mysql'}:value,normalizedDraftSchema);
export type ConnectionDraft=z.infer<typeof normalizedDraftSchema>;
export type MysqlConnectionDraft=Extract<ConnectionDraft,{kind:'mysql'}>;
export type MysqlConnectionInput=MysqlConnectionDraft|Omit<MysqlConnectionDraft,'kind'>;
export type ConnectionInput=ConnectionDraft|Omit<MysqlConnectionDraft,'kind'>;
export type ConnectionProfile=ConnectionDraft & {id:string;connected?:boolean;generation?:number;fileIdentity?:string};

export type ConnectionProfileInput=ConnectionInput & {id:string;connected?:boolean;generation?:number};
