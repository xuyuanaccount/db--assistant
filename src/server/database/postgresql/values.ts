import {types} from 'pg';
import {AppFault} from '../../../shared/contracts.js';
import type {BoundValue,NormalizedRow,ValueKind} from '../../../shared/database.js';
const kinds=new Map<number,ValueKind>([[16,'boolean'],[17,'binary'],[20,'integer'],[21,'integer'],[23,'integer'],[26,'integer'],[700,'real'],[701,'real'],[1700,'decimal'],[114,'json'],[3802,'json'],[1082,'temporal'],[1083,'temporal'],[1114,'temporal'],[1184,'temporal'],[1266,'temporal'],[18,'text'],[19,'text'],[25,'text'],[1042,'text'],[1043,'text'],[2950,'text']]);
export function pgValueKind(oid:number):ValueKind{return kinds.get(oid)??'text';}
export function pgKnownType(oid:number){return kinds.has(oid);}
// Local parsers avoid global pg parser mutation and all number/Date/JSON conversions.
export const pgTextTypes={getTypeParser:(oid:number)=>oid===17?types.getTypeParser(17,'text'):(value:string)=>value};
export function pgRow(raw:unknown[],oids:number[]):NormalizedRow{const valueKinds:ValueKind[]=[];const values=raw.map((value,i)=>{if(value===null){valueKinds.push('null');return null;}const kind=pgValueKind(oids[i]);valueKinds.push(kind);if(kind==='binary'&&Buffer.isBuffer(value))return {binaryHex:value.toString('hex')};if(typeof value!=='string')throw new AppFault('UNSUPPORTED_VALUE','PostgreSQL 返回值无法保真读取');if(kind==='boolean')return value==='t'?'true':value==='f'?'false':value;if(kind==='temporal'&&(oids[i]===1184||oids[i]===1266))return value.replace(/([+-]\d{2})$/,'$1:00');return value;});return {values,valueKinds};}
export function pgBind(params:BoundValue[]){return params.map(({value,kind})=>{if(value===null)return null;if(kind==='binary'&&typeof value==='object'&&/^(?:[a-f0-9]{2})*$/i.test(value.binaryHex))return Buffer.from(value.binaryHex,'hex');if(typeof value!=='string')throw new AppFault('INVALID_VALUE','PostgreSQL 参数类别无效');if(kind==='boolean'&&!['true','false','t','f','1','0'].includes(value))throw new AppFault('INVALID_VALUE','布尔值需要 true 或 false');return value;});}

const typeNames:Record<number,string>={16:'bool',17:'bytea',20:'int8',21:'int2',23:'int4',26:'oid',700:'float4',701:'float8',1700:'numeric',114:'json',3802:'jsonb',1082:'date',1083:'time',1114:'timestamp',1184:'timestamptz',1266:'timetz',18:'char',19:'name',25:'text',1042:'bpchar',1043:'varchar',2950:'uuid'};
export function pgTypeName(oid:number){return typeNames[oid]??`oid:${oid}`;}
