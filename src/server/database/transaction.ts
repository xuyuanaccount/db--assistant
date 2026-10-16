import {AppFault} from '../../shared/contracts.js';
import type {DbSession} from './contracts.js';
export async function runTransaction<T>(session:DbSession,mode:'write'|'snapshot'|'sql',work:()=>Promise<T>):Promise<T>{
 let begun=false,committing=false;
 try{await session.begin(mode);begun=true;const result=await work();committing=true;await session.commit();return result;}
 catch(error){if(committing)throw new AppFault('RESULT_UNKNOWN','提交已发送但未确认，请先核对数据库',409);if(begun)try{await session.rollback();}catch{throw new AppFault('RESULT_UNKNOWN','回滚未确认，请先核对数据库',409);}throw error;}
}
