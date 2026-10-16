import {expect,test} from 'vitest';
import {PreviewStore} from '../../src/server/features/structure/previews.js';
import {schemaInfo} from '../helpers/structure.js';
const record={action:{kind:'rename_column' as const,target:{connectionId:'c',schema:'s',table:'t'},column:'old',newName:'new'},generation:1,fingerprint:'h',schema:schemaInfo,sql:'SQL',warnings:[],confirmationTableName:null};
test('expires previews and refuses capacity overflow without evicting pending work',()=>{
 let now=0;const store=new PreviewStore(()=>now);const p=store.put(record);for(let i=1;i<50;i++)store.put(record);
 expect(()=>store.put(record)).toThrow();expect(store.get(p.previewId).sql).toBe('SQL');now=300_000;expect(()=>store.get(p.previewId)).toThrow();expect(store.put(record).previewId).toBeTruthy();
});
test('consumes a preview only once',()=>{const store=new PreviewStore();const p=store.put(record);expect(store.consume(p.previewId).sql).toBe('SQL');expect(()=>store.consume(p.previewId)).toThrow();});
