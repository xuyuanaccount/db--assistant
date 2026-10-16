import {AppFault} from '../../shared/contracts.js';
import type {BoundValue,DatabaseKind} from '../../shared/database.js';

type LiteralKind=Exclude<DatabaseKind,'mysql'>;
const unsupported=(message:string):never=>{throw new AppFault('UNRENDERABLE_SQL',message);};
const quoted=(value:string)=>`'${value.replaceAll("'","''")}'`;
const datePattern=/^\d{4}-\d{2}-\d{2}$/;
const dateTimePattern=/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})(\.\d{1,9})?(?:\s*(Z|[+-]\d{2}:\d{2}))?$/i;
const timePattern=/^\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:\s*(?:Z|[+-]\d{2}:\d{2}))?$/i;

export function temporalSqlLiteral(kind:LiteralKind,param:BoundValue):string {
 const value=param.value;
 const column=param.column;
 if(typeof value!=='string'||!column)return unsupported('时间值缺少字段类型，无法可靠渲染');
 if(kind==='sqlite')return quoted(value);
 const type=`${column.dataType} ${column.columnType}`.toLowerCase();
 const isDate=/\bdate\b/.test(type)&&!/\btimestamp\b/.test(type);
 const isTime=/\btime\b/.test(type)&&!/\btimestamp\b/.test(type)&&!isDate;
 const isTimestamp=/\btimestamp\b|\btimestamptz\b/.test(type);
 const zoned=/\bwith\s+(?:local\s+)?time\s+zone\b|\btimestamptz\b|\btimetz\b/.test(type);
 if(kind==='postgresql'){
  if(isDate&&datePattern.test(value))return `DATE ${quoted(value)}`;
  if(isTime&&timePattern.test(value))return `${zoned?'TIME WITH TIME ZONE':'TIME'} ${quoted(value)}`;
  if(isTimestamp&&dateTimePattern.test(value)){
   const parsed=dateTimePattern.exec(value)!;
   if(zoned&&!parsed[4]||!zoned&&parsed[4])return unsupported('时间值与字段时区语义不一致');
   return `${zoned?'TIMESTAMPTZ':'TIMESTAMP'} ${quoted(value)}`;
  }
  return unsupported('不支持或格式无效的 PostgreSQL 时间值');
 }
 if(isDate){
  const match=dateTimePattern.exec(value);
  if(!match||match[3]||match[4])return unsupported('Oracle DATE 需要不带时区和小数的完整日期时间');
  return `TO_DATE(${quoted(`${match[1]} ${match[2]}`)}, 'YYYY-MM-DD HH24:MI:SS', 'NLS_DATE_LANGUAGE=American')`;
 }
 if(isTimestamp){
  const match=dateTimePattern.exec(value);
  if(!match)return unsupported('Oracle TIMESTAMP 格式无效');
  const zone=match[4],fraction=match[3]||'';
  if(zoned&&!zone||!zoned&&zone)return unsupported('时间值与字段时区语义不一致');
  const valueText=`${match[1]} ${match[2]}${fraction}${zone?' '+(zone.toUpperCase()==='Z'?'+00:00':zone):''}`;
  const format=`YYYY-MM-DD HH24:MI:SS${fraction?`.FF${fraction.length-1}`:''}${zoned?' TZH:TZM':''}`;
  return `${zoned?'TO_TIMESTAMP_TZ':'TO_TIMESTAMP'}(${quoted(valueText)}, ${quoted(format)}, 'NLS_DATE_LANGUAGE=American')`;
 }
 return unsupported('不支持的 Oracle 时间字段类型');
}
