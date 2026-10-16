import {FIELD_KINDS,type FieldDefinition,type FieldKind,type FieldType} from '../../../shared/structure';
export function newField(name=''):FieldDefinition{return {name,type:{kind:'VARCHAR',length:255},nullable:true,default:{kind:'none'},comment:'',autoIncrement:false};}
export function defaultType(kind:FieldKind):FieldType{return kind==='CHAR'||kind==='VARCHAR'?{kind,length:kind==='CHAR'?1:255}:kind==='DECIMAL'?{kind,precision:10,scale:2}:['TIME','DATETIME','TIMESTAMP'].includes(kind)?{kind,fsp:0}:{kind};}
export function FieldDefinitionForm({value,onChange,mode}:{value:FieldDefinition;onChange:(v:FieldDefinition)=>void;mode:'create'|'add'|'modify'}){
 const patch=(p:Partial<FieldDefinition>)=>onChange({...value,...p});const type=(p:Partial<FieldType>)=>patch({type:{...value.type,...p}});const kind=value.type.kind;
 return <div className="field-definition">
 {mode!=='modify'&&<label>字段名<input aria-label="字段名" required maxLength={64} value={value.name} onChange={e=>patch({name:e.target.value})}/></label>}
 <label>类型<select aria-label="字段类型" value={kind} onChange={e=>{const k=e.target.value as FieldKind;patch({type:defaultType(k),autoIncrement:false,default:{kind:'none'}});}}>{FIELD_KINDS.map(k=><option key={k}>{k}</option>)}</select></label>
 {['CHAR','VARCHAR'].includes(kind)&&<label>长度<input aria-label="字段长度" type="number" min={1} max={kind==='CHAR'?255:16383} value={value.type.length??''} onChange={e=>type({length:Number(e.target.value)})}/></label>}
 {kind==='DECIMAL'&&<><label>精度<input aria-label="小数精度" type="number" min={1} max={65} value={value.type.precision??10} onChange={e=>type({precision:Number(e.target.value)})}/></label><label>小数位<input aria-label="小数位数" type="number" min={0} max={30} value={value.type.scale??2} onChange={e=>type({scale:Number(e.target.value)})}/></label></>}
 {['TIME','DATETIME','TIMESTAMP'].includes(kind)&&<label>时间小数位<input aria-label="时间小数位" type="number" min={0} max={6} value={value.type.fsp??0} onChange={e=>type({fsp:Number(e.target.value)})}/></label>}
 {['TINYINT','SMALLINT','INT','BIGINT'].includes(kind)&&<label className="check-label"><input type="checkbox" checked={value.type.unsigned||false} onChange={e=>type({unsigned:e.target.checked})}/>UNSIGNED</label>}
 {kind==='TINYINT'&&<label className="check-label"><input type="checkbox" checked={value.type.booleanDisplay||false} onChange={e=>type({booleanDisplay:e.target.checked})}/>TINYINT(1)</label>}
 <label className="check-label"><input type="checkbox" aria-label="允许 NULL" checked={value.nullable} disabled={value.autoIncrement} onChange={e=>patch({nullable:e.target.checked,...(!e.target.checked&&value.default.kind==='null'?{default:{kind:'none' as const}}:{})})}/>允许 NULL</label>
 <label>默认值<select aria-label="默认值类型" disabled={value.autoIncrement} value={value.default.kind} onChange={e=>patch({default:e.target.value==='literal'?{kind:'literal',value:''}:{kind:e.target.value as 'none'|'null'|'current_timestamp'}})}><option value="none">无默认值</option><option value="null" disabled={!value.nullable}>NULL</option>{!['TEXT','LONGTEXT','JSON'].includes(kind)&&<option value="literal">字面值</option>}{['DATETIME','TIMESTAMP'].includes(kind)&&<option value="current_timestamp">CURRENT_TIMESTAMP</option>}</select></label>
 {value.default.kind==='literal'&&<label>默认字面值<input aria-label="默认字面值" value={value.default.value} onChange={e=>patch({default:{kind:'literal',value:e.target.value}})}/></label>}
 {mode==='create'&&['INT','BIGINT'].includes(kind)&&<label className="check-label"><input type="checkbox" aria-label="自增" checked={value.autoIncrement} onChange={e=>patch({autoIncrement:e.target.checked,...(e.target.checked?{nullable:false,default:{kind:'none' as const}}:{})})}/>自增</label>}
 <label className="field-comment">注释<input aria-label="字段注释" maxLength={1024} value={value.comment} onChange={e=>patch({comment:e.target.value})}/></label>
 </div>;
}
