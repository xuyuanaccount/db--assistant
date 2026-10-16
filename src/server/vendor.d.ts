declare module 'unzipper' {
 import type {Readable} from 'node:stream';
 interface Entry{path:string;uncompressedSize:number;stream():Readable}
 const unzipper:{Open:{file(path:string):Promise<{files:Entry[]}>}};
 export default unzipper;
}
