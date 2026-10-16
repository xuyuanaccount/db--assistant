import {createSqlDialect} from '../dialect.js';
export const createOracleDialect=(identifierBytes:30|128=30)=>createSqlDialect('oracle',{oracleIdentifierBytes:identifierBytes});
export const oracleDialect=createOracleDialect();
