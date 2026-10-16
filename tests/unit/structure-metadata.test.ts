import {expect,test} from 'vitest';
import {structureFingerprint} from '../../src/server/features/structure/metadata.js';
import type {TableStructure} from '../../src/shared/structure.js';
test('fingerprints structure instead of SHOW CREATE auto-increment text or presentation',()=>{
 const value={target:{connectionId:'c',schema:'s',table:'t'},kind:'table',engine:'InnoDB',characterSet:'utf8mb4',collation:'utf8mb4_bin',comment:'',columns:[],indexes:[],foreignKeys:[],checks:[],partitionDefinitions:[],tableOptions:'',createSql:'CREATE TABLE t AUTO_INCREMENT=1',fingerprint:'',readOnlyReasons:[]} as TableStructure;
 const original=structureFingerprint(value);
 expect(structureFingerprint({...value,createSql:'CREATE TABLE t AUTO_INCREMENT=9',readOnlyReasons:['presentation'],fingerprint:'ignored'})).toBe(original);
 expect(structureFingerprint({...value,comment:'changed'})).not.toBe(original);
});
