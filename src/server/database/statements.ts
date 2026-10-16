import {AppFault} from '../../shared/contracts.js';
import type {DatabaseKind} from '../../shared/database.js';
import {LIMITS} from '../../shared/limits.js';

export interface SqlLex {code:string;visible:string;mask:boolean[];semicolons:number[];quotedIdentifiers:{name:string;start:number;end:number}[]}
const invalid=(message:string):never=>{throw new AppFault('INVALID_SQL',message);};
/** Keep source offsets while hiding quoted text and comments from statement checks. */
export function lexSql(kind:DatabaseKind,sql:string):SqlLex {
 const mask=Array(sql.length).fill(true) as boolean[],code=sql.split(''),visible=sql.split('');const semicolons:number[]=[],quotedIdentifiers:SqlLex['quotedIdentifiers']=[];
 const hide=(start:number,end:number,identifier=false)=>{for(let j=start;j<end;j++){mask[j]=false;code[j]=' ';if(!identifier)visible[j]=' ';}};
 let i=0;
 while(i<sql.length){
  const start=i,ch=sql[i],next=sql[i+1];
  if(kind==='postgresql'&&/[Uu]/.test(ch)&&next==='&'&&sql[i+2]==='"')invalid('不支持 PostgreSQL Unicode 转义标识符');
  if(ch==='-'&&next==='-' || kind==='mysql'&&ch==='#') {i+=ch==='#'?1:2;while(i<sql.length&&sql[i]!=='\n')i++;hide(start,i);continue;}
  if(ch==='/'&&next==='*') {i+=2;let depth=1;while(i<sql.length&&depth){if(kind==='postgresql'&&sql.slice(i,i+2)==='/*'){depth++;i+=2;}else if(sql.slice(i,i+2)==='*/'){depth--;i+=2;}else i++;}if(depth)invalid('SQL 注释未结束');hide(start,i);continue;}
  if(kind==='postgresql'&&ch==='$'&&(start===0||!/[\w$]/.test(sql[start-1]))) {const tag=sql.slice(i).match(/^\$(?:[A-Za-z_][A-Za-z_0-9]*)?\$/)?.[0];if(tag){const end=sql.indexOf(tag,i+tag.length);if(end<0)invalid('SQL dollar quote 未结束');i=end+tag.length;hide(start,i);continue;}}
  if(kind==='oracle'&&/[qQ]/.test(ch)&&next==="'"&&(start===0||!/[\w$#]/.test(sql[start-1]))) {const opener=sql[i+2];if(opener){const closer=({'[':']','{':'}','(':')','<':'>'} as Record<string,string>)[opener]||opener;const end=sql.indexOf(closer+"'",i+3);if(end<0)invalid('Oracle q quote 未结束');i=end+2;hide(start,i);continue;}}
  if(ch==="'"||ch==='"'||(kind==='mysql'||kind==='sqlite')&&ch==='`'||kind==='sqlite'&&ch==='['){const closer=ch==='['?']':ch;const backslash=ch==="'"&&(kind==='mysql'||kind==='postgresql'&&/[eE]/.test(sql[start-1]||'')&&(start<2||!/[\w$]/.test(sql[start-2])));i++;let ended=false;while(i<sql.length){if(backslash&&sql[i]==='\\'){i+=2;continue;}if(sql[i]===closer){if(sql[i+1]===closer){i+=2;continue;}i++;ended=true;break;}i++;}if(!ended)invalid('SQL 引号未结束');if(ch!=="'")quotedIdentifiers.push({name:sql.slice(start+1,i-1).replaceAll(closer+closer,closer),start,end:i});hide(start,i,ch!=="'");continue;}
  if(ch===';')semicolons.push(i);
  i++;
 }
 return {code:code.join(''),visible:visible.join(''),mask,semicolons,quotedIdentifiers};
}

const sqliteReadPragmas=new Set(['table_info','table_xinfo','index_list','index_info','index_xinfo','foreign_key_list','database_list','collation_list','compile_options','function_list','module_list','pragma_list','schema_version','user_version','application_id','foreign_keys','page_count','freelist_count','encoding']);
export function assertSingleSql(kind:DatabaseKind,sql:string):{text:string;category:'transactional'|'ddl'|'metadata'} {
 if(Buffer.byteLength(sql,'utf8')>LIMITS.sqlBytes)invalid('SQL 超过 256 KiB');
 const scan=lexSql(kind,sql),code=scan.code;
 if(scan.semicolons.length>1||scan.semicolons.length===1&&scan.visible.slice(scan.semicolons[0]+1).trim())invalid('一次只允许一条 SQL');
 const body=scan.semicolons.length?code.slice(0,scan.semicolons[0]):code;
 const visibleBody=scan.semicolons.length?scan.visible.slice(0,scan.semicolons[0]):scan.visible;
 const first=/^\s*([A-Za-z_][\w$]*)/.exec(body)?.[1]?.toUpperCase();
 if(!first)invalid('请输入 SQL');
 if(kind==='mysql')return {text:sql.trim(),category:/^(CREATE|ALTER|DROP|TRUNCATE|RENAME)$/.test(first!)?'ddl':'transactional'};
 const words=body.toUpperCase();
 const prohibitedCalls=new Set(['LOAD_EXTENSION','SET_CONFIG','PG_ADVISORY_LOCK','PG_ADVISORY_UNLOCK','PG_ADVISORY_XACT_LOCK']);
 const unquotedCall=/\b(?:LOAD_EXTENSION|SET_CONFIG|PG_ADVISORY_(?:LOCK|UNLOCK|XACT_LOCK))\s*\(/.test(words);
 const quotedCall=scan.quotedIdentifiers.some(token=>prohibitedCalls.has(token.name.toUpperCase())&&/^\s*\(/.test(scan.visible.slice(token.end)));
 if(unquotedCall||quotedCall)invalid('此 SQL 命令不受支持');
 if(/^\s*EXPLAIN\s+(?:ANALYZE\s+)?(?:COPY|DO|CALL|EXEC|EXECUTE)\b/.test(words))invalid('过程或协议命令不受支持');
 if(/\b(ALTER\s+SESSION|SET\s+TRANSACTION|START\s+TRANSACTION)\b/.test(words))invalid('会话或事务控制不受支持');
 if(first==='PRAGMA'&&kind==='sqlite'){
  const pragma=/^\s*PRAGMA\s+(?:(?:"[^"]+"|[\w]+)\s*\.\s*)?([A-Za-z_][\w]*)\s*(?:\(([^()]*)\))?\s*$/i.exec(visibleBody);
  if(!pragma||!sqliteReadPragmas.has(pragma[1]!.toLowerCase())||pragma[2]!==undefined&&!/^(table_info|table_xinfo|index_list|index_info|index_xinfo|foreign_key_list)$/i.test(pragma[1]!))invalid('仅支持只读 SQLite PRAGMA');
  return {text:sql.trim(),category:'metadata'};
 }
 if(/^(BEGIN|COMMIT|ROLLBACK|SAVEPOINT|RELEASE|END|SET|RESET|USE|ATTACH|DETACH|VACUUM|REINDEX|ANALYZE|GRANT|REVOKE|LOCK|UNLOCK|DISCARD|LISTEN|NOTIFY|UNLISTEN|PREPARE|DEALLOCATE|DECLARE|FETCH|CLOSE)$/.test(first!))invalid('此 SQL 命令不受支持');
 if(/^(CREATE|ALTER|DROP)$/.test(first!)){
  if(/\b(FUNCTION|PROCEDURE|TRIGGER|PACKAGE|EXTENSION|LANGUAGE|POLICY|ROLE|USER|DATABASE|SCHEMA|TABLESPACE|SYSTEM)\b/.test(words))invalid('此 DDL 类型不受支持');
  return {text:sql.trim(),category:'ddl'};
 }
 if(first==='SHOW'&&kind==='postgresql')return {text:sql.trim(),category:'metadata'};
 if(!/^(SELECT|WITH|INSERT|UPDATE|DELETE|EXPLAIN)$/.test(first!))invalid('此 SQL 命令不受支持');
 return {text:sql.trim(),category:'transactional'};
}
