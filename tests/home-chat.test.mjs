import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startServer} from '../src/server.mjs';

test('home uses a real separate CLI session per conversation, streams visible text, and resumes after restart',async t=>{
  const workspace=fs.mkdtempSync(path.join(os.tmpdir(),'niuma-home-'));
  const executable=path.join(workspace,'fixture.cjs');
  const session='native-cc-session';
  // Hold the first native child until we have observed the partial reply and exercised the concurrency guard.
  fs.writeFileSync(executable,`const fs=require('node:fs');
    const emit=x=>console.log(JSON.stringify(x));
    emit({type:'system',subtype:'init',session_id:'${session}'});
    const args=process.argv.slice(2);process.stdin.setEncoding('utf8');let prompt='';
    process.stdin.on('data',s=>prompt+=s);
    process.stdin.on('end',()=>{
      if(!args.includes('--include-partial-messages'))process.exit(3);
      const finish=()=>emit({type:'result',subtype:'success',session_id:'${session}',result:args.includes('--resume')?'continued '+args[args.indexOf('--resume')+1]:'new reply'});
      if(prompt!=='first request'){finish();return;}
      emit({type:'stream_event',event:{type:'content_block_delta',delta:{type:'thinking_delta',thinking:'not a reply'}}});
      emit({type:'stream_event',event:{type:'content_block_delta',delta:{type:'text_delta',text:'streamed text'}}});
      const wait=setInterval(()=>{if(fs.existsSync('release-fixture')){clearInterval(wait);finish();}},15);
    });`);
  const scanner=async()=>({clis:{cc:{available:true,path:executable}},sessions:[],processes:[],warnings:[]});
  let app=await startServer({workspace,port:0,scanner});
  t.after(async()=>{await app.close();fs.rmSync(workspace,{recursive:true,force:true});});
  let token;
  async function snapshot(id=''){const r=await fetch(app.url+'/api/home-chat?chat='+id);const data=await r.json();token=data.token;return data;}
  const post=(body,route='/api/home-chat/send',key=token)=>fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Relay-Token':key},body:JSON.stringify({workspace,...body})});
  async function until(id,match){const end=Date.now()+6000;do{const s=await snapshot(id);if(match(s.chat.turns.at(-1)))return s.chat;await delay(20);}while(Date.now()<end);throw Error('Missing expected chat state');}

  const empty=await snapshot();assert.deepEqual(empty.chats,[]);
  assert.match(await fetch(app.url+'/').then(r=>r.text()),/id="composer"/);
  assert.match(await fetch(app.url+'/experiments/').then(r=>r.text()),/src="\/app\.js"/);
  assert.equal((await post({message:'first request',requestId:'first'},undefined,'invalid')).status,403);
  const accepted=await post({message:'first request',requestId:'first'});
  assert.equal(accepted.status,202);const {chatId}=await accepted.json();
  await until(chatId,t=>t.status==='running'&&t.reply==='streamed text');
  assert.equal((await post({chatId,message:'too soon',requestId:'early'})).status,409);
  assert.equal((await post({workspace:'another',message:'wrong scope',requestId:'wrong'})).status,409);
  assert.equal((await post({message:'first request',requestId:'first'}).then(r=>r.json())).chatId,chatId);
  assert.equal((await post({path:workspace},'/api/workspace')).status,409);
  fs.writeFileSync(path.join(workspace,'release-fixture'),'ok');
  await until(chatId,t=>t.status==='completed'&&t.reply==='new reply');
  await app.close();app=await startServer({workspace,port:0,scanner});await snapshot();
  assert.equal((await post({chatId,message:'follow up',requestId:'second'})).status,202);
  const history=await until(chatId,t=>t.reply==='continued '+session);
  assert.equal(history.turns.length,2);
  const other=await post({message:'independent',requestId:'other'}).then(r=>r.json());
  assert.notEqual(other.chatId,chatId);await until(other.chatId,t=>t.reply==='new reply');
  assert.deepEqual(app.store.state.projects,[]);
});
