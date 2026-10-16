import type {ColumnMeta, DbCell, TableMeta, TableTarget} from './contracts.js';
export type DatabaseKind = 'mysql'|'postgresql'|'oracle'|'sqlite';
export type ValueKind = 'null'|'text'|'integer'|'decimal'|'real'|'boolean'|'temporal'|'json'|'binary';
export interface Capability {enabled:boolean;reasons:string[]}
export interface CapabilitySet {browse:Capability;insert:Capability;update:Capability;delete:Capability;import:Capability;exportCsv:Capability;exportXlsx:Capability;exportSql:Capability;structureEdit:Capability;migration:Capability}
export interface DatabaseContext {kind:DatabaseKind;version:string;namespaceLabel:string;defaultNamespace:string;endpoint:string;generation:number;resourceIdentity:string;capabilities:CapabilitySet}
export interface NormalizedColumnMeta extends ColumnMeta {valueKind:ValueKind;identity:'none'|'always'|'by-default';editable:Capability;importable:Capability;comparable:boolean}
export interface NormalizedTableMeta extends TableMeta {columns:NormalizedColumnMeta[];databaseKind:DatabaseKind;capabilities:CapabilitySet;definitionFingerprint:string}
export interface DatabaseStructure {
 target:TableTarget;databaseKind:DatabaseKind;objectKind:'table'|'view';
 columns:(NormalizedColumnMeta & {defaultSql:string|null;comment:string})[];primaryKey:string[];
 indexes:{name:string;unique:boolean;method:string|null;columns:{name:string|null;expression:string|null;direction:'asc'|'desc'|null}[];predicate:string|null}[];
 foreignKeys:{name:string;definition:string}[];checks:{name:string;definition:string}[];
 definition:{kind:'native'|'summary'|'unavailable';text:string|null;reason?:string};unavailableReasons:string[];
}
export interface BoundValue {value:DbCell;kind:ValueKind;column?:ColumnMeta}
export interface CompiledStatement {sql:string;params:BoundValue[]}
export interface NormalizedRow {values:DbCell[];valueKinds:ValueKind[]}
export interface ResultColumn {name:string;dataType:string;valueKind:ValueKind}
