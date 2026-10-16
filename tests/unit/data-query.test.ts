import { expect, test } from 'vitest';
import { compileTableQuery } from '../../src/server/features/data/query.js';
import { bindCell, decodeCell } from '../../src/server/mysql/values.js';
import type { TableMeta } from '../../src/shared/contracts.js';
const meta:TableMeta={schema:'db',name:'odd`table',kind:'table',engine:'InnoDB',primaryKey:['id'],columns:[{name:'id',dataType:'bigint',columnType:'bigint unsigned',nullable:false,hasDefault:false,generated:false,autoIncrement:false,ordinal:1},{name:'te`xt',dataType:'varchar',columnType:'varchar(255)',nullable:true,hasDefault:false,generated:false,autoIncrement:false,ordinal:2}]};
test('safe query escapes real identifiers, binds filters and appends primary key ordering',()=>{
  const query=compileTableQuery(meta,{target:{connectionId:'x',schema:'db',table:meta.name},page:2,pageSize:100,filters:[{column:'te`xt',op:'contains',value:'a%_'}],sort:[]},'page');
  expect(query.sql).toContain('`odd``table`');expect(query.sql).toContain('ORDER BY `id` ASC');expect(query.params).toEqual(['%a\\%\\_%',101,100]);
  expect(()=>compileTableQuery(meta,{target:{connectionId:'x',schema:'db',table:meta.name},page:1,pageSize:100,filters:[{column:'missing',op:'eq',value:'1'}],sort:[]},'page')).toThrow();
});
test('extended conditions bind every value and combine OR without changing full-table exports',()=>{
 const input={target:{connectionId:'x',schema:'db',table:meta.name},page:1,pageSize:100,sort:[]};
 const query=(filter:Record<string,unknown>)=>compileTableQuery(meta,{...input,filters:[filter]} as never,'filtered');
 for(const [op,sql,params] of [
  ['in','`id` IN (?, ?)', ['1','18446744073709551615']],
  ['not-in','`id` NOT IN (?, ?)', ['1','18446744073709551615']],
 ] as const){const result=query({column:'id',op,values:['1','18446744073709551615']});expect(result.sql).toContain(sql);expect(result.params).toEqual(params);}
 for(const op of ['between','not-between']){const result=query({column:'id',op,value:'2',valueTo:'8'});expect(result.sql).toContain(op==='between'?'BETWEEN ? AND ?':'NOT BETWEEN ? AND ?');expect(result.params).toEqual(['2','8']);}
 for(const [op,pattern,operator] of [
  ['starts-with','a\\%\\_%','LIKE'],['ends-with','%a\\%\\_','LIKE'],['not-contains','%a\\%\\_%','NOT LIKE'],['like','a%_','LIKE'],['not-like','a%_','NOT LIKE'],
 ]){const result=query({column:'te`xt',op,value:'a%_'});expect(result.sql).toContain(` ${operator} ?`);expect(result.params).toEqual([pattern]);}
 expect(query({column:'te`xt',op:'is-empty'}).sql).toContain("`te``xt` = ''");expect(query({column:'te`xt',op:'is-not-empty'}).sql).toContain("`te``xt` <> ''");
 const mixed={...input,filterMatch:'any',filters:[{column:'id',op:'between',value:'2',valueTo:'8'},{column:'te`xt',op:'eq',value:"x' OR 1=1 --"}]} as never;
 const combined=compileTableQuery(meta,mixed,'filtered');expect(combined.sql).toContain('BETWEEN ? AND ? OR `te``xt` = ?');expect(combined.sql).not.toContain("x' OR");expect(combined.params).toEqual(['2','8',"x' OR 1=1 --"]);
 expect(compileTableQuery(meta,mixed,'all').sql).not.toContain('WHERE');
 for(const filter of [{column:'id',op:'in',values:[]},{column:'id',op:'in',values:[null]},{column:'id',op:'between',value:'1'},{column:'id',op:'between',value:'1',valueTo:'18446744073709551616'},{column:'id',op:'bad',value:'1'}])expect(()=>query(filter)).toThrow();
});
test('BIGINT binding and binary decoding keep exact values and reject overflow',()=>{
  expect(bindCell(meta.columns[0],'18446744073709551615')).toBe('18446744073709551615');
  expect(()=>bindCell(meta.columns[0],'18446744073709551616')).toThrow();
  expect(decodeCell(meta.columns[1],Buffer.from([0,255]))).toEqual({binaryHex:'00ff'});
});
test('a real MySQL name containing dots stays one identifier and LIKE declares its escape character',()=>{
 const dotted={...meta,schema:'db.part',name:'orders.live',columns:[{...meta.columns[0],name:'row.id'},{...meta.columns[1],name:'note.text'}],primaryKey:['row.id']};
 const command=compileTableQuery(dotted,{target:{connectionId:'x',schema:dotted.schema,table:dotted.name},page:1,pageSize:100,filters:[{column:'note.text',op:'contains',value:'%_\\'}],sort:[]},'filtered');
 expect(command.sql).toContain('`db.part`.`orders.live`');
 expect(command.sql).toContain('`note.text` LIKE ? ESCAPE');
 expect(command.sql).toContain('ORDER BY `row.id` ASC');
 expect(command.params).toEqual(['%\\%\\_\\\\%']);
});
