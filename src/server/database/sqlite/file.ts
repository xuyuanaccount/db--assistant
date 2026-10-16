import {realpath,stat} from 'node:fs/promises';
import {isAbsolute} from 'node:path';
import {AppFault} from '../../../shared/contracts.js';
export async function validateSqliteFile(path:string,ownDatabasePath:string):Promise<{realPath:string;identity:string}>{
 if(!isAbsolute(path)||path.includes('\0')||path.includes('?'))throw new AppFault('INVALID_SQLITE_FILE','需要现有 SQLite 文件的绝对路径');
 try{const realPath=await realpath(path),info=await stat(realPath,{bigint:true});if(!info.isFile())throw new AppFault('INVALID_SQLITE_FILE','SQLite 路径必须是普通文件');const own=await stat(ownDatabasePath,{bigint:true});if(info.dev===own.dev&&info.ino===own.ino)throw new AppFault('SQLITE_OWN_DATABASE','不可连接工作台配置数据库');return {realPath,identity:JSON.stringify([realPath,String(info.dev),String(info.ino)])};}catch(e){if(e instanceof AppFault)throw e;throw new AppFault('INVALID_SQLITE_FILE','SQLite 文件不存在或不可访问');}
}
