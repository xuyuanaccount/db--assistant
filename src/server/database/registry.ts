import {AppFault} from '../../shared/contracts.js';
import type {DatabaseContext,DatabaseKind} from '../../shared/database.js';
import type {ConnectionService} from '../features/connections/service.js';
import type {DatabaseAdapter,DriverFactory} from './contracts.js';
export interface DatabaseRegistration {factory:DriverFactory;adapter:DatabaseAdapter|((connections:ConnectionService)=>DatabaseAdapter)}
export class DatabaseRegistry {
 private adapters=new Map<DatabaseKind,DatabaseAdapter>();
 constructor(private connections:ConnectionService,definitions:Partial<Record<DatabaseKind,DatabaseRegistration>>){for(const [kind,definition] of Object.entries(definitions)){if(!definition)continue;connections.registerFactory(kind as DatabaseKind,definition.factory);this.adapters.set(kind as DatabaseKind,typeof definition.adapter==='function'?definition.adapter(connections):definition.adapter);}}
 get(id:string):DatabaseAdapter {const kind=this.connections.store.get(id).kind;const adapter=this.adapters.get(kind);if(!adapter)throw new AppFault('DRIVER_UNAVAILABLE','此数据库驱动尚未安装或注册',409);return adapter;}
 context(id:string):DatabaseContext{return this.connections.context(id);}
}
