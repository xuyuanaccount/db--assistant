import {AppFault} from '../../../shared/contracts.js';
import type {StructureAction,TableStructure} from '../../../shared/structure.js';
export function reject(message:string):never{throw new AppFault('STRUCTURE_UNSUPPORTED',message);}
import {columnDependencies,indexDependencies} from '../../../shared/structure-policy.js';
export {columnDependencies,indexDependencies} from '../../../shared/structure-policy.js';
export function validateStructureAction(action:StructureAction,context:{structure:TableStructure|null;hasRows:boolean}):void{
 if(action.kind==='create_table')return;const s=context.structure;if(!s)reject('请先读取表结构');if(s.readOnlyReasons.length)reject(s.readOnlyReasons.join('；'));
 if(action.kind==='add_column'){
 if(s.columns.some(c=>c.name.toLowerCase()===action.definition.name.toLowerCase()))reject('字段名称已存在');
 if(action.definition.autoIncrement)reject('仅建表时可设置自增');
 if(context.hasRows&&!action.definition.nullable&&['none','null'].includes(action.definition.default.kind))reject('非空表新增 NOT NULL 字段需要可用显式默认值');return;
 }
 if(action.kind==='add_index'){
 if(action.name.toUpperCase()==='PRIMARY'||s.indexes.some(i=>i.name.toLowerCase()===action.name.toLowerCase()))reject('索引名保留或已存在');
 if(new Set(action.columns.map(c=>c.name.toLowerCase())).size!==action.columns.length)reject('索引字段不能重复');
 for(const part of action.columns){const col=s.columns.find(c=>c.name===part.name);if(!col||!col.editableDefinition||col.generationExpression||col.dataType==='json')reject('不支持此索引字段');
 const textual=['char','varchar','text','longtext'].includes(col.dataType);
 if(part.prefixLength!==undefined&&(!textual||(col.editableDefinition.type.length!==undefined&&part.prefixLength>col.editableDefinition.type.length)))reject('无效索引前缀');
 if(['text','longtext'].includes(col.dataType)&&part.prefixLength===undefined)reject('TEXT 索引需要前缀长度');}return;
 }
 if(action.kind==='drop_index'){const i=s.indexes.find(i=>i.name===action.name);if(!i)reject('索引不存在');const reasons=indexDependencies(s,i);if(reasons.length)reject(reasons.join('；'));return;}
 const col=s.columns.find(c=>c.name===action.column);if(!col)reject('字段不存在');
 const reasons=columnDependencies(s,col.name);
 if(action.kind==='modify_column'&&!action.patch.type){const unsupported=[...col.blockedReasons];if(s.columns.some(c=>c.generationExpression)||s.checks.length||s.partitionDefinitions.length)unsupported.push('表含未解析依赖，已有字段修改暂受保护');if(unsupported.length)reject(unsupported.join('；'));}
 else if(reasons.length)reject(reasons.join('；'));
 if(action.kind==='drop_column'&&s.columns.length===1)reject('不能删除最后一个字段');
 if(action.kind==='rename_column'&&s.columns.some(c=>c.name.toLowerCase()===action.newName.toLowerCase()))reject('新字段名已存在');
}
