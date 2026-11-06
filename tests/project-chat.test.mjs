import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {setTimeout as delay} from 'node:timers/promises';
import {startServer} from '../src/server.mjs';

test('project chats use the chosen shared subdirectory and persist separate sessions and experiment documents',async t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'niuma-project-chat-')));
  const workspace=path.join(root,'workspace'), directory=path.join(root,'shared-project');
  fs.mkdirSync(directory);
  const executable=path.join(root,'fixture.cjs');
  fs.writeFileSync(executable,`const fs=require('node:fs'),path=require('node:path');let prompt='';
    process.stdin.setEncoding('utf8');process.stdin.on('data',s=>prompt+=s);
    process.stdin.on('end',()=>{const a=process.argv.slice(2),resume=a.indexOf('--resume');
    console.log(JSON.stringify({type:'result',subtype:'success',session_id:resume<0?'session-'+path.basename(process.cwd()):a[resume+1],
      result:JSON.stringify({cwd:process.cwd(),resume:resume<0?'':a[resume+1],prompt,
        file:fs.existsSync('evidence.md')?fs.readFileSync('evidence.md','utf8'):''})}));});`);
  const scanner=async()=>({clis:{cc:{available:true,path:executable}},sessions:[],processes:[],warnings:[]});
  let app=await startServer({workspace,port:0,scanner});await app.refresh();
  t.after(async()=>{await app.close();fs.rmSync(root,{recursive:true,force:true});});
  const json=async url=>(await fetch(app.url+url)).json();
  let token=(await json('/api/home-chat')).token;
  const post=(url,body,key=token)=>fetch(app.url+url,{method:'POST',headers:{'Content-Type':'application/json','X-Relay-Token':key},body:JSON.stringify({workspace,...body})});
  const create={title:'Shared project fixture',directory};
  assert.equal((await post('/api/home-projects',create,'invalid')).status,403);
  assert.equal((await post('/api/home-projects',{...create,workspace:root})).status,409);
  const {project}=await post('/api/home-projects',create).then(r=>r.json());
  const duplicate=await post('/api/home-projects',create).then(r=>r.json());
  assert.equal(duplicate.existing,true);assert.equal(duplicate.project.id,project.id);
  const folder=await post('/api/project-folders',{projectId:project.id,name:'data'}).then(r=>r.json());
  assert.equal(folder.directory,path.join(directory,'data'));
  fs.writeFileSync(path.join(directory,'data','evidence.md'),'baseline: 42');
  app.store.setRules('PROJECT_RULE_SENTINEL',project.id);
  const skillDir=path.join(directory,'.agents','skills','fixture');
  fs.mkdirSync(skillDir,{recursive:true});fs.writeFileSync(path.join(skillDir,'SKILL.md'),'---\nname: project-fixture\ndescription: fixture\n---\nPROJECT_SKILL_SENTINEL');
  const catalog=await json('/api/skills?project='+project.id);
  assert.equal((await post('/api/projects/'+project.id+'/skills',{ids:[catalog.skills.find(s=>s.name==='project-fixture').id]})).status,200);
  const send=body=>post('/api/home-chat/send',body).then(async r=>({status:r.status,...await r.json()}));
  async function finish(chatId){
    for(let i=0;i<200;i++){
      const data=await json('/api/home-chat?chat='+chatId),turn=data.chat.turns.at(-1);
      if(turn.status==='completed')return {data,answer:JSON.parse(turn.reply)};
      if(turn.status==='failed')throw Error(turn.error);
      await delay(20);
    }throw Error('Fixture chat did not finish');
  }
  const independent=await send({requestId:'independent',message:'plain chat'});
  const free=await finish(independent.chatId);
  assert.equal(free.answer.cwd,workspace);assert.equal(free.answer.prompt,'plain chat');
  const accepted=await send({projectId:project.id,folder:'data',requestId:'project-first',message:'Read the evidence'});
  assert.equal(accepted.status,202);
  const first=await finish(accepted.chatId);
  assert.equal(first.answer.cwd,path.join(directory,'data'));assert.equal(first.answer.file,'baseline: 42');
  assert.match(first.answer.prompt,/PROJECT_RULE_SENTINEL/);assert.match(first.answer.prompt,/PROJECT_SKILL_SENTINEL/);
  assert.equal(first.answer.resume,'');
  assert.equal(first.data.chat.projectId,project.id);assert.equal(first.data.chat.folder,'data');
  assert.equal(first.data.projects[0].directory,directory);
  const job=app.store.state.jobs.find(j=>j.chatId===accepted.chatId);
  assert.equal(job.projectId,project.id);
  const doc=app.store.project(project.id).documents.find(d=>d.kind==='chat');
  assert.match(app.store.readDoc(project.id,doc.id).content,/Read the evidence/);
  assert.equal((await send({chatId:accepted.chatId,projectId:'',folder:'',requestId:'changed',message:'wrong scope'})).status,409);
  assert.equal((await send({projectId:'',requestId:'project-first',message:'Read the evidence'})).status,409);
  assert.equal((await send({projectId:project.id,folder:'../',requestId:'outside',message:'invalid'})).status,400);
  assert.equal((await send({projectId:project.id,folder:'data/evidence.md',requestId:'file',message:'invalid'})).status,400);
  await app.close();app=await startServer({workspace,port:0,scanner});await app.refresh();
  token=(await json('/api/home-chat')).token;
  const next=await send({chatId:accepted.chatId,requestId:'project-second',message:'Continue'});
  assert.equal(next.status,202);
  const resumed=await finish(accepted.chatId);
  assert.equal(resumed.answer.resume,job.sessionId);
  assert.equal(resumed.answer.cwd,path.join(directory,'data'));
  assert.equal(resumed.data.chat.turns.length,2);
  const rootChat=await send({projectId:project.id,requestId:'root',message:'New root discussion'});
  const fresh=await finish(rootChat.chatId);
  assert.equal(fresh.answer.cwd,directory);assert.equal(fresh.answer.resume,'');
});

test('shared file access is bounded to the project, including symlinks, and the experiment area is the real store',async t=>{
  const root=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'niuma-project-files-')));
  const app=await startServer({workspace:path.join(root,'workspace'),port:0,scanner:async()=>({clis:{}})});
  t.after(async()=>{await app.close();fs.rmSync(root,{recursive:true,force:true});});
  const p=app.store.newProject({title:'Files fixture'});
  const token=(await fetch(app.url+'/api/home-chat').then(r=>r.json())).token;
  const get=(area,value,file=false)=>fetch(app.url+'/api/project-files?'+new URLSearchParams({project:p.id,area,path:value,...(file?{file:'1'}:{})}));
  const outside=path.join(root,'outside');fs.mkdirSync(outside);fs.writeFileSync(path.join(outside,'private.md'),'outside');
  fs.symlinkSync(outside,path.join(p.directory,'external-link'),process.platform==='win32'?'junction':'dir');
  fs.writeFileSync(path.join(p.directory,'shared.md'),'shared contents');
  const listing=await get('project','').then(r=>r.json());
  assert.ok(listing.entries.some(e=>e.name==='shared.md'));assert.ok(!listing.entries.some(e=>e.name==='external-link'));
  assert.equal((await get('project','external-link/private.md',true)).status,403);
  for(const value of ['../outside/private.md','.relay-lab/state.json','x/../../secret','C:/secret']){
    assert.equal((await get('project',value,true)).status,400);
  }
  assert.equal((await get('research','00-brief.md',true).then(r=>r.json())).content,app.store.readDoc(p.id,p.documents[0].id).content);
  assert.equal((await get('project','shared.md',true).then(r=>r.json())).content,'shared contents');
  const post=body=>fetch(app.url+'/api/project-folders',{method:'POST',headers:{'Content-Type':'application/json','X-Relay-Token':token},body:JSON.stringify({workspace:app.store.workspace,projectId:p.id,...body})});
  assert.equal((await post({parent:'',name:'../escape'})).status,400);
  assert.equal((await post({parent:'',name:'con.txt'})).status,400);
  assert.equal((await post({parent:'',name:'实验资料'})).status,201);
  assert.equal((await post({parent:'',name:'实验资料'})).status,409);
  assert.equal((await post({workspace:root,parent:'',name:'wrong'})).status,409);
});
