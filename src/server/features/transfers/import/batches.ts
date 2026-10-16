import {AppFault} from '../../../../shared/contracts.js';
import {LIMITS} from '../../../../shared/limits.js';
import type {ParsedSourceRow} from './types.js';
export async function* makeBatches(rows:AsyncIterable<ParsedSourceRow>,maxPacketBytes:number):AsyncGenerator<ParsedSourceRow[]>{const budget=Math.min(8*1024*1024,Math.floor(maxPacketBytes/2));let batch:ParsedSourceRow[]=[];let bytes=0;for await(const row of rows){const size=Buffer.byteLength(JSON.stringify(row.cells))*2+1024;if(size>budget)throw new AppFault('ROW_TOO_LARGE',`源记录 ${row.sourceRow}：单行数据过大，超过数据包预算`);if(batch.length&&(batch.length>=LIMITS.batchRows||bytes+size>budget)){yield batch;batch=[];bytes=0;}batch.push(row);bytes+=size;}if(batch.length)yield batch;}
