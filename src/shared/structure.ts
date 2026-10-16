import type {AppError,TableTarget} from './contracts.js';
export const FIELD_KINDS=['TINYINT','SMALLINT','INT','BIGINT','DECIMAL','DOUBLE','CHAR','VARCHAR','TEXT','LONGTEXT','DATE','TIME','DATETIME','TIMESTAMP','JSON'] as const;
export type FieldKind=typeof FIELD_KINDS[number];
export interface FieldType {kind:FieldKind;unsigned?:boolean;length?:number;precision?:number;scale?:number;fsp?:number;booleanDisplay?:boolean}
export type FieldDefault={kind:'none'|'null'}|{kind:'literal';value:string}|{kind:'current_timestamp'};
export type ExistingDefault=FieldDefault|{kind:'expression';sql:string};
export interface FieldDefinition {name:string;type:FieldType;nullable:boolean;default:FieldDefault;comment:string;autoIncrement:boolean}
export interface StructureColumn {name:string;ordinal:number;columnType:string;dataType:string;nullable:boolean;default:ExistingDefault;comment:string;characterSet:string|null;collation:string|null;extra:string;generationExpression:string;srsId:number|null;editableDefinition:FieldDefinition|null;blockedReasons:string[]}
export interface StructureIndex {name:string;unique:boolean;type:string;visible:boolean;columns:{name:string|null;expression:string|null;prefixLength:number|null;direction:'asc'|'desc'|null}[];blockedReasons:string[]}
export interface StructureForeignKey {direction:'incoming'|'outgoing';schema:string;table:string;name:string;columns:string[];referencedSchema:string;referencedTable:string;referencedColumns:string[];updateRule:string;deleteRule:string;referencedIndex:string|null}
export interface TableStructure {target:TableTarget;kind:'table'|'view';engine:string|null;characterSet:string|null;collation:string|null;comment:string;columns:StructureColumn[];indexes:StructureIndex[];foreignKeys:StructureForeignKey[];checks:{name:string;clause:string;enforced:boolean}[];partitionDefinitions:Record<string,string|null>[];tableOptions:string;createSql:string;fingerprint:string;readOnlyReasons:string[]}
export interface SchemaInfo {name:string;characterSet:string;collation:string;newTableCollation:string}
type At={target:TableTarget};
export type StructureAction=At&(
 {kind:'create_table';columns:FieldDefinition[];primaryKey:string[];comment:string}|
 {kind:'add_column';definition:FieldDefinition}|
 {kind:'modify_column';column:string;patch:Partial<Pick<FieldDefinition,'type'|'nullable'|'default'|'comment'>>}|
 {kind:'rename_column';column:string;newName:string}|
 {kind:'drop_column';column:string}|
 {kind:'add_index';name:string;unique:boolean;columns:{name:string;prefixLength?:number}[]}|
 {kind:'drop_index';name:string});
export interface StructurePreviewRequest {action:StructureAction;expectedFingerprint?:string}
export interface DdlPreview {previewId:string;target:TableTarget;sql:string;expiresAt:string;warnings:string[];confirmationTableName:string|null}
export interface DdlApplyResult {operationId:string;status:'completed'|'needs_review';structure?:TableStructure;refreshError?:AppError;warnings:string[]}
