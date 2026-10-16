import type {TableTarget} from '../../shared/contracts.js';
import type {CompiledStatement, DatabaseContext, DatabaseKind, DatabaseStructure, NormalizedRow, NormalizedTableMeta, ResultColumn} from '../../shared/database.js';
import type {ConnectionDraft, ConnectionProfile} from '../features/connections/types.js';
import type {SqlCompletions} from '../features/sql/types.js';
import type {SqlDialect} from './dialect.js';
export type {BoundValue,CompiledStatement,NormalizedRow,ResultColumn} from '../../shared/database.js';
export type SessionPurpose = 'browse'|'sql'|'edit'|'import'|'export'|'metadata';
export interface CommandCompletion {affectedRows:number;warnings:string[]}
/** omittedRows signals consumed rows that exceed a chunk budget; callers must flag partial output or fail. */
export interface StatementCursor {columns:ResultColumn[];read(maxRows:number,maxBytes:number):Promise<{rows:NormalizedRow[];done:boolean;omittedRows?:number;completion?:CommandCompletion}>;close():Promise<void>}
export interface DbSession {openStatement(command:CompiledStatement):Promise<StatementCursor>;execute(command:CompiledStatement):Promise<CommandCompletion>;begin(mode:'write'|'snapshot'|'sql'):Promise<void>;lockTable(meta:NormalizedTableMeta):Promise<void>;commit():Promise<void>;rollback():Promise<void>;cancel():Promise<void>;close(disposition:'reuse'|'discard'):Promise<void>}
export interface ConnectionRuntime {kind:DatabaseKind;context:Omit<DatabaseContext,'generation'>;acquire(namespace:string,purpose:SessionPurpose,signal?:AbortSignal):Promise<DbSession>;close():Promise<void>}
export interface DriverFactory {validate(draft:ConnectionDraft):Promise<{draft:ConnectionDraft;fileIdentity?:string}>;test(profile:ConnectionDraft,password:string):Promise<void>;create(profile:ConnectionProfile,password:string):Promise<ConnectionRuntime>}
export interface DatabaseAdapter {kind:DatabaseKind;dialect:SqlDialect;openSession(id:string,namespace:string,purpose:SessionPurpose,signal?:AbortSignal):Promise<DbSession>;listNamespaces(id:string):Promise<string[]>;listTables(id:string,namespace:string):Promise<{name:string;kind:'table'|'view'}[]>;describeTable(target:TableTarget,session?:DbSession):Promise<NormalizedTableMeta>;describeStructure(target:TableTarget):Promise<DatabaseStructure>;loadCompletions(id:string,namespace:string):Promise<SqlCompletions>}
