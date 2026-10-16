import {expect,it} from 'vitest';
import {types} from 'pg';
import {postgresqlOptions} from '../../src/server/database/postgresql/factory.js';
import {pgBind,pgRow,pgTextTypes} from '../../src/server/database/postgresql/values.js';
it('PostgreSQL scoped parsers preserve precision and do not change global driver parsers',()=>{
 const globalParser=types.getTypeParser(114);const raw=['9223372036854775807','12345678901234567890.12345678','{"n":9007199254740993}','2020-01-01 01:02:03.123456'];
 expect(pgRow(raw.map((v,i)=>pgTextTypes.getTypeParser([20,1700,114,1114][i])(v)),[20,1700,114,1114]).values).toEqual(raw);expect(types.getTypeParser(114)).toBe(globalParser);
 expect(pgBind([{value:raw[0],kind:'integer'},{value:raw[1],kind:'decimal'},{value:raw[2],kind:'json'},{value:{binaryHex:'00ff'},kind:'binary'}])).toEqual([...raw.slice(0,3),Buffer.from([0,255])]);
});
it('PostgreSQL TLS requests verified host certificates without connection-string overrides',()=>{const options=postgresqlOptions({kind:'postgresql',name:'test',host:'db.example.com',port:5432,username:'app',database:'app',defaultSchema:'public',tls:true},'synthetic');expect(options.ssl).toEqual({rejectUnauthorized:true,servername:'db.example.com'});expect(options).not.toHaveProperty('connectionString');expect(options.connectionTimeoutMillis).toBe(10000);});
