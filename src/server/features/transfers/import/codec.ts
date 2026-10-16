import{StringDecoder}from'node:string_decoder';
import{createReadStream,chmodSync}from'node:fs';import{unlink}from'node:fs/promises';import{dirname,join,posix}from'node:path';import{randomUUID}from'node:crypto';import{DatabaseSync}from'node:sqlite';import type{Readable}from'node:stream';
import{parse}from'csv-parse';import unzipper from'unzipper';import saxes from'saxes';
import{AppFault,type DbCell}from'../../../../shared/contracts.js';import type{ImportOptions,ParsedSourceRow}from'./types.js';
type XmlEvent={kind:'open';name:string;attrs:Record<string,string>}|{kind:'text';text:string}|{kind:'close';name:string};
async function* xmlEvents(stream:Readable,maxBytes=4*1024*1024*1024):AsyncGenerator<XmlEvent>{const decoder=new StringDecoder('utf8');const parser=new saxes.SaxesParser();let events:XmlEvent[]=[];let bytes=0;let error:Error|undefined;parser.on('opentag',node=>events.push({kind:'open',name:node.name,attrs:node.attributes as Record<string,string>}));parser.on('text',text=>events.push({kind:'text',text}));parser.on('closetag',node=>events.push({kind:'close',name:node.name}));parser.on('error',value=>{error=value;});try{for await(const chunk of stream){bytes+=chunk.length;if(bytes>maxBytes)throw new AppFault('XLSX_TOO_LARGE','XLSX 解压内容超过处理上限');parser.write(decoder.write(chunk));if(error)throw error;for(const event of events)yield event;events=[];}parser.write(decoder.end());parser.close();if(error)throw error;for(const event of events)yield event;}finally{stream.destroy();}}
export function decodeText(value:string,options:ImportOptions):DbCell{if(!options.toolEscaping)return value;if(value==='\\N')return null;if(options.format==='xlsx'&&value==='\\E')return '';return options.format==='xlsx'?value.replace(/\\\\|\\u([0-9a-f]{4})/gi,(match,hex:string|undefined)=>hex?String.fromCharCode(parseInt(hex,16)):'\\'):value.replace(/\\\\/g,'\\');}
type XlsxBook=Awaited<ReturnType<typeof unzipper.Open.file>>;
async function xlsxMetadata(book:XlsxBook){const find=(path:string)=>book.files.find(f=>f.path===path);const workbook=find('xl/workbook.xml');const rels=find('xl/_rels/workbook.xml.rels');if(!workbook||!rels)throw new AppFault('INVALID_XLSX','无效的 XLSX 工作簿');const sheets:{name:string;rid:string;path:string}[]=[];const targets=new Map<string,string>();let date1904=false;
 for await(const e of xmlEvents(workbook.stream(),8*1024*1024))if(e.kind==='open'){if(e.name==='sheet')sheets.push({name:e.attrs.name,rid:e.attrs['r:id'],path:''});if(e.name==='workbookPr')date1904=['1','true'].includes(e.attrs.date1904);}
 for await(const e of xmlEvents(rels.stream(),8*1024*1024))if(e.kind==='open'&&e.name==='Relationship')targets.set(e.attrs.Id,e.attrs.Target.startsWith('/')?e.attrs.Target.slice(1):posix.normalize(`xl/${e.attrs.Target}`));
 for(const sheet of sheets)sheet.path=targets.get(sheet.rid)||'';return {sheets,date1904};
}
export async function listSheets(path:string){const book=await unzipper.Open.file(path);return (await xlsxMetadata(book)).sheets.map(s=>s.name);}
async function dateStyles(book:XlsxBook){const entry=book.files.find(f=>f.path==='xl/styles.xml');const dateIds=new Set([14,15,16,17,18,19,20,21,22,27,30,36,45,46,47,50,57]);const styles:boolean[]=[];if(!entry)return styles;let cellXfs=false;
 for await(const e of xmlEvents(entry.stream(),8*1024*1024)){if(e.kind==='open'){if(e.name==='numFmt'&&/[ymdhis]/i.test((e.attrs.formatCode||'').replace(/"[^"]*"|\\.|\[[^\]]*\]/g,'')))dateIds.add(Number(e.attrs.numFmtId));if(e.name==='cellXfs')cellXfs=true;if(cellXfs&&e.name==='xf')styles.push(dateIds.has(Number(e.attrs.numFmtId)));}else if(e.kind==='close'&&e.name==='cellXfs')cellXfs=false;}return styles;
}
function colIndex(ref:string){const letters=ref.match(/^[A-Z]+/)?.[0];if(!letters)throw new AppFault('INVALID_XLSX','无效单元格地址');let value=0;for(const ch of letters)value=value*26+ch.charCodeAt(0)-64;if(value>16384)throw new AppFault('INVALID_XLSX','列数超过 XLSX 上限');return value-1;}
async function* readXlsx(path:string,options:ImportOptions):AsyncGenerator<ParsedSourceRow>{const book=await unzipper.Open.file(path);const meta=await xlsxMetadata(book);const sheet=options.sheet?meta.sheets.find(s=>s.name===options.sheet):meta.sheets[0];if(!sheet)throw new AppFault('SHEET_NOT_FOUND','找不到所选工作表');const entry=book.files.find(f=>f.path===sheet.path);if(!entry)throw new AppFault('INVALID_XLSX','工作表内容不存在');const styles=await dateStyles(book);
 const scratch=join(dirname(path),`.xlsx-${randomUUID()}.sqlite`);const cache=new DatabaseSync(scratch);chmodSync(scratch,0o600);cache.exec('PRAGMA journal_mode=OFF; PRAGMA synchronous=OFF; CREATE TABLE strings(id INTEGER PRIMARY KEY,value TEXT)');const put=cache.prepare('INSERT INTO strings VALUES(?,?)');const get=cache.prepare('SELECT value FROM strings WHERE id=?');
 try{const strings=book.files.find(f=>f.path==='xl/sharedStrings.xml');if(strings){let index=0,text='',inText=false;for await(const e of xmlEvents(strings.stream())){if(e.kind==='open'){if(e.name==='si')text='';if(e.name==='t')inText=true;}else if(e.kind==='text'&&inText){text+=e.text;if(Buffer.byteLength(text)>16*1024*1024)throw new AppFault('CELL_TOO_LARGE','单元格超过 16 MiB');}else if(e.kind==='close'){if(e.name==='t')inText=false;if(e.name==='si')put.run(index++,text);}}}
 let headerWidth=0;let sourceRow=0,cells:DbCell[]=[],type='',style=0,ref='',v='',inline='',formula=false,hasValue=false,inValue=false,inText=false;
 for await(const e of xmlEvents(entry.stream())){
  if(e.kind==='open'){if(e.name==='row'){sourceRow=Number(e.attrs.r)||sourceRow+1;cells=[];}if(e.name==='c'){ref=e.attrs.r;type=e.attrs.t||'';style=Number(e.attrs.s)||0;v='';inline='';formula=false;hasValue=false;}if(e.name==='v'){inValue=true;hasValue=true;}if(e.name==='t')inText=true;if(e.name==='f')formula=true;}
  else if(e.kind==='text'){if(inValue)v+=e.text;if(inText)inline+=e.text;if(v.length+inline.length>16*1024*1024)throw new AppFault('CELL_TOO_LARGE',`源记录 ${sourceRow}：单元格过大`);}
  else {if(e.name==='v')inValue=false;if(e.name==='t')inText=false;
   if(e.name==='c'){if(formula&&!hasValue)throw new AppFault('FORMULA_NO_RESULT',`源记录 ${sourceRow}：公式没有缓存结果`);let value:DbCell;
    if(type==='e')throw new AppFault('EXCEL_ERROR',`源记录 ${sourceRow}：Excel 错误 ${v}`);
    if(type==='s'){const found=get.get(Number(v));if(!found)throw new AppFault('INVALID_XLSX','共享文本索引不存在');value=decodeText(String(found.value),options);}
    else if(type==='inlineStr'||type==='str')value=decodeText(type==='inlineStr'?inline:v,options);
    else if(type==='b')value=v==='1'?'1':'0';
    else if(!hasValue)value=options.emptyCells==='null'?null:'';
    else if(styles[style]){const date=new Date(Math.round((Number(v)-(meta.date1904?24107:25569))*86400000));if(!Number.isFinite(date.getTime()))throw new AppFault('INVALID_XLSX','无效 Excel 日期');value=date.toISOString().replace('T',' ').replace(/\.000Z$/,'').replace(/Z$/,'');}
    else value=decodeText(v,options);
    const index=colIndex(ref);while(cells.length<=index)cells.push(options.emptyCells==='null'?null:'');cells[index]=value;
   }if(e.name==='row'){if(options.hasHeader&&sourceRow===1)headerWidth=cells.length;while(cells.length<headerWidth)cells.push(options.emptyCells==='null'?null:'');yield {sourceRow,cells};}
  }
 }
 }finally{cache.close();await unlink(scratch).catch(()=>{});}
}
export async function* readSource(path:string,options:ImportOptions):AsyncGenerator<ParsedSourceRow>{if(options.format==='xlsx'){yield* readXlsx(path,options);return;}const input=createReadStream(path);const parser=input.pipe(parse({bom:true,delimiter:options.delimiter||',',skip_empty_lines:false,relax_column_count:false,max_record_size:16*1024*1024}));let sourceRow=0;try{for await(const cells of parser)yield {sourceRow:++sourceRow,cells:(cells as string[]).map(value=>decodeText(value,options))};}catch(error){throw new AppFault('CSV_PARSE',`源记录 ${sourceRow+1}：${(error as Error).message}`);}finally{input.destroy();parser.destroy();}}
