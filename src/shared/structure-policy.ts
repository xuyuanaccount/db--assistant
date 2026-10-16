import type {TableStructure,StructureIndex} from './structure.js';
export function indexDependencies(s:TableStructure,i:StructureIndex):string[]{
 const reasons=[...i.blockedReasons];
 for(const fk of s.foreignKeys){const names=fk.direction==='outgoing'?fk.columns:fk.referencedColumns;if(names.every((name,n)=>i.columns[n]?.name===name))reasons.push(`外键 ${fk.name} 可能依赖此索引`);}
 return reasons;
}
export function columnDependencies(s:TableStructure,name:string):string[]{
 const reasons=[...(s.columns.find(c=>c.name===name)?.blockedReasons||[])];
 for(const i of s.indexes)if(i.columns.some(c=>c.name===name))reasons.push(`索引 ${i.name} 依赖此字段`);
 for(const fk of s.foreignKeys)if((fk.direction==='outgoing'?fk.columns:fk.referencedColumns).includes(name))reasons.push(`外键 ${fk.name} 依赖此字段`);
 if(s.columns.some(c=>c.generationExpression)||s.checks.length||s.partitionDefinitions.length)reasons.push('表含生成列、CHECK 或分区依赖，已有字段变更暂受保护');
 return reasons;
}
