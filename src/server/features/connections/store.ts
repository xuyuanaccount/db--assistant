import { randomUUID } from 'node:crypto';
import type { LocalStore } from '../../local/database.js';
import { AppFault } from '../../../shared/contracts.js';
import { connectionDraftSchema, type ConnectionInput, type ConnectionProfile } from './types.js';
export class ConnectionStore {
  constructor(private local: LocalStore) {}
  list(): ConnectionProfile[] { return this.local.db.prepare('SELECT payload FROM connections ORDER BY rowid').all().map(row => this.normalize(JSON.parse(String(row.payload)))); }
  private normalize(value:ConnectionProfile):ConnectionProfile {return {...connectionDraftSchema.parse(value),id:value.id,...(value.kind==='sqlite'&&value.fileIdentity?{fileIdentity:value.fileIdentity}:{})};}
  get(id: string): ConnectionProfile { const item = this.list().find(item => item.id === id); if (!item) throw new AppFault('NOT_FOUND','连接不存在',404); return item; }
  save(draft: ConnectionInput, id: string = randomUUID(), fileIdentity?:string): ConnectionProfile {
    const parsed=connectionDraftSchema.parse(draft);
    const profile = { ...parsed, id,...(parsed.kind==='sqlite'&&fileIdentity?{fileIdentity}:{}) };
    this.local.db.prepare('INSERT INTO connections(id,payload) VALUES(?,?) ON CONFLICT(id) DO UPDATE SET payload=excluded.payload').run(id,JSON.stringify(profile));
    return profile;
  }
  remove(id: string): void { this.get(id); this.local.db.prepare('DELETE FROM connections WHERE id=?').run(id); }
}
