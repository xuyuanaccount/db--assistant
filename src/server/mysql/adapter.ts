import mysql, { type PoolConnection, type Connection, type RowDataPacket } from 'mysql2/promise';
import { AppFault, type TableMeta, type TableTarget } from '../../shared/contracts.js';
import { ConnectionService, mysqlOptions, assertMysqlProfile } from '../features/connections/service.js';
export class MysqlAdapter {
  constructor(readonly connections: ConnectionService) {}
  async withConnection<T>(id: string, database: string|undefined, fn: (conn: PoolConnection)=>Promise<T>): Promise<T> {
    assertMysqlProfile(this.connections.store.get(id));
    const release = this.connections.retain(id); let conn: PoolConnection|undefined;
    try { conn = await this.connections.session(id).pool.getConnection();
      await conn.query("SET time_zone = '+00:00', SESSION sql_mode = 'STRICT_ALL_TABLES,NO_ENGINE_SUBSTITUTION'");
      if (database) await conn.query(`USE ${mysql.escapeId(database)}`);
      return await fn(conn);
    } finally { conn?.release(); release(); }
  }
  async createDedicated(id: string,database?: string): Promise<Connection> {
    const session = this.connections.session(id);
    const profile=this.connections.store.get(id);if(profile.kind!=='mysql')throw new AppFault('DATABASE_KIND_UNSUPPORTED','需要 MySQL 连接');
    const generation=this.connections.generation(id);
    const conn = await mysql.createConnection(mysqlOptions(profile,session.password,database));
    try { if(this.connections.generation(id)!==generation||this.connections.runtime(id).kind!=='mysql')throw new AppFault('CONNECTION_CHANGED','连接已变化',409);await conn.query("SET time_zone = '+00:00'");if(this.connections.generation(id)!==generation)throw new AppFault('CONNECTION_CHANGED','连接已变化',409);this.connections.runtime(id);return conn; } catch(error) { conn.destroy(); throw error; }
  }
  async listSchemas(id: string): Promise<string[]> {
    return this.withConnection(id,undefined,async conn => { const [rows] = await conn.query<RowDataPacket[]>('SHOW DATABASES'); return rows.map(row => String(Object.values(row)[0])); });
  }
  async listTables(id: string,schema: string) {
    return this.withConnection(id,undefined,async conn => { const [rows] = await conn.execute<RowDataPacket[]>('SELECT TABLE_NAME, TABLE_TYPE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? ORDER BY TABLE_NAME',[schema]);
      return rows.map(row => ({name:String(row.TABLE_NAME),kind:row.TABLE_TYPE==='VIEW' ? 'view' as const:'table' as const})); });
  }
  async describeTable(target: TableTarget): Promise<TableMeta> {
    return this.withConnection(target.connectionId,undefined,async conn => {
      const [tables] = await conn.execute<RowDataPacket[]>('SELECT TABLE_TYPE,ENGINE FROM information_schema.TABLES WHERE TABLE_SCHEMA=? AND TABLE_NAME=?',[target.schema,target.table]);
      if (!tables.length) throw new AppFault('TABLE_NOT_FOUND','找不到此表或没有访问权限',404);
      const [columns] = await conn.execute<RowDataPacket[]>('SELECT COLUMN_NAME,DATA_TYPE,COLUMN_TYPE,IS_NULLABLE,COLUMN_DEFAULT,EXTRA,ORDINAL_POSITION,GENERATION_EXPRESSION FROM information_schema.COLUMNS WHERE TABLE_SCHEMA=? AND TABLE_NAME=? ORDER BY ORDINAL_POSITION',[target.schema,target.table]);
      const [keys] = await conn.execute<RowDataPacket[]>('SELECT COLUMN_NAME FROM information_schema.KEY_COLUMN_USAGE WHERE TABLE_SCHEMA=? AND TABLE_NAME=? AND CONSTRAINT_NAME=\'PRIMARY\' ORDER BY ORDINAL_POSITION',[target.schema,target.table]);
      return {schema:target.schema,name:target.table,kind:tables[0].TABLE_TYPE==='VIEW'?'view':'table',engine:tables[0].ENGINE,
        columns:columns.map(col => ({name:col.COLUMN_NAME,dataType:col.DATA_TYPE,columnType:col.COLUMN_TYPE,nullable:col.IS_NULLABLE==='YES',hasDefault:col.COLUMN_DEFAULT!==null,generated:!!col.GENERATION_EXPRESSION,autoIncrement:String(col.EXTRA).includes('auto_increment'),ordinal:Number(col.ORDINAL_POSITION)})),primaryKey:keys.map(key=>String(key.COLUMN_NAME))};
    });
  }
}
