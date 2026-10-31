// Windows cannot retain POSIX executable bits while extracting Electron.
// Repair only the tar headers for the shipped Linux executables, then verify with tar -tvf.
import fs from 'node:fs';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createGunzip, createGzip } from 'node:zlib';
const file=path.resolve(process.argv[2]||'');
if(!file.endsWith('.tar.gz')||!fs.statSync(file).isFile())throw new Error('Provide an existing Linux .tar.gz archive.');
let buffer=Buffer.alloc(0),remaining=0;const changed=[];
const patch=new Transform({transform(chunk,encoding,callback){try{
  buffer=Buffer.concat([buffer,chunk]);
  while(buffer.length){
    if(remaining){const n=Math.min(remaining,buffer.length);this.push(buffer.subarray(0,n));buffer=buffer.subarray(n);remaining-=n;continue;}
    if(buffer.length<512)break;
    const header=Buffer.from(buffer.subarray(0,512));buffer=buffer.subarray(512);
    if(header.every(b=>b===0)){this.push(header);continue;}
    const name=header.subarray(0,100).toString().replace(/\0.*$/s,''),size=parseInt(header.subarray(124,136).toString().replace(/\0.*$/s,'').trim()||'0',8);
    if(!Number.isFinite(size)||size<0)throw new Error('Invalid tar entry size.');
    if(['relay-lab','relay-lab-cli','chrome-sandbox','chrome_crashpad_handler'].includes(name.split('/').pop())){
      header.write('0000755\0',100,8,'ascii');header.fill(32,148,156);let sum=0;for(const b of header)sum+=b;header.write(sum.toString(8).padStart(6,'0')+'\0 ',148,8,'ascii');changed.push(name);
    }
    this.push(header);remaining=Math.ceil(size/512)*512;
  }
  callback();
}catch(e){callback(e);}},flush(callback){callback(buffer.length||remaining?new Error('Incomplete tar stream.'):undefined);}});
await pipeline(fs.createReadStream(file),createGunzip(),patch,createGzip({level:1}),fs.createWriteStream(file+'.tmp'));
if(!changed.some(p=>p.endsWith('/relay-lab'))||!changed.some(p=>p.endsWith('/relay-lab-cli')))throw new Error('Expected Linux executables not found. Original archive kept.');
fs.renameSync(file+'.tmp',file);console.log(JSON.stringify({archive:file,executableEntries:changed}));
