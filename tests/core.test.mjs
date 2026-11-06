import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { Store } from '../src/store.mjs';
import { Runner, cliArgs, decodeEvent } from '../src/runner.mjs';
import { Workflow, roles, validatePlan } from '../src/workflow.mjs';
import { classifyProcess, scanSessions } from '../src/platform.mjs';
import { startServer } from '../src/server.mjs';
import { scanSkills } from '../src/skills.mjs';
import {councilResult} from './fixtures/proposal-council.mjs';

function temp(t){const dir=fs.mkdtempSync(path.join(os.tmpdir(),'relay-test-'));t.after(()=>{const resolved=fs.realpathSync(dir);assert(resolved.startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(resolved,{recursive:true,force:true});});return dir;}
function fixture(t){const root=temp(t),store=new Store(root);t.after(()=>store.close());const p=store.newProject({title:'Test research',brief:'A real test boundary, no inference.'});p.autonomy.mode='assisted';p.modelPolicy.allowCCSwitch=false;return{root,store,p};}

test('CLI args preserve prompts on stdin, sandbox, explicit resume IDs',()=>{
  const args=cliArgs('cx',{sessionId:'abc'});assert.deepEqual(args,['-a','never','-s','workspace-write','exec','resume','--json','--skip-git-repo-check','abc','-']);
  const cc=cliArgs('cc',{sessionId:'def'});assert(cc.includes('--resume'));assert(cc.includes('dontAsk'));assert(!cc.includes('--dangerously-skip-permissions'));
});
test('process classification excludes desktop helpers and unrelated node processes',()=>{
  assert.equal(classifyProcess('codex.exe'),'cx');assert.equal(classifyProcess('codex-command-runner.exe'),null);
  assert.equal(classifyProcess('node','node /opt/node_modules/@anthropic-ai/claude-code/cli.js'),'cc');assert.equal(classifyProcess('node','node app.js'),null);
});
test('session scan recovers from truncated JSONL and takes latest duplicate entry',async t=>{
  const root=temp(t);fs.writeFileSync(path.join(root,'session_index.jsonl'),'broken\n'+JSON.stringify({id:'a',thread_name:'old',updated_at:'2025'})+'\n'+JSON.stringify({id:'a',thread_name:'new',updated_at:'2026'})+'\n');
  const found=await scanSessions('cx',root);assert.equal(found.length,1);assert.equal(found[0].title,'new');assert.equal(found[0].status,'unknown');
});
test('workspace lock, rule persistence, document path restriction and recovery',t=>{
  const {root,store,p}=fixture(t);assert.throws(()=>new Store(root),/占用/);
  store.setRules('Use Chinese.');store.setRules('Use a fixed seed.',p.id);
  assert.match(store.rulesText(p.id),/fixed seed/);assert.throws(()=>store.doc(p.id,'../escape.md','bad','no'),/非法/);
  store.state.jobs.push({id:'interrupted',status:'running'});store.save();store.close();const restored=new Store(root);t.after(()=>restored.close());
  assert.equal(restored.state.jobs[0].status,'interrupted');assert.equal(restored.project(p.id).title,p.title);assert.match(restored.rules().workspace,/Chinese/);
});
test('failed CLI events cannot be mistaken for successful results',()=>{
  assert.equal(decodeEvent('cc',{type:'result',is_error:true,result:'auth failed'}).error,'auth failed');
  assert.equal(decodeEvent('cx',{type:'turn.failed',error:{message:'blocked'}}).error,'blocked');
});
test('real subprocess streaming captures split JSON, session ID and structured result',async t=>{
  const {root,store,p}=fixture(t),runner=new Runner(store);t.after(()=>runner.close());
  const file=path.join(root,'fixture.mjs');fs.writeFileSync(file,`let s='';process.stdin.on('data',x=>s+=x);process.stdin.on('end',()=>{process.stdout.write('{"type":"system","session_id":"session-x"}\\n');process.stdout.write('{"type":"res');setTimeout(()=>process.stdout.write('ult","subtype":"success","result":"done","structured_output":{"ok":true}}\\n'),20);});`);
  const result=await runner.run({projectId:p.id,provider:'cc',kind:'test',title:'stream contract',executable:process.execPath,cwd:root,prompt:'input',args:[file]});
  assert.equal(result.job.sessionId,'session-x');assert.equal(result.structured.ok,true);assert.equal(result.text,'done');assert.equal(result.job.status,'completed');
  assert.match(fs.readFileSync(path.join(store.folder(p.id),'runs',result.job.id,'input.md'),'utf8'),/本次工作区/);
});
test('native process exit zero plus error event is rejected',async t=>{
  const {root,store,p}=fixture(t),runner=new Runner(store);t.after(()=>runner.close());
  await assert.rejects(runner.run({projectId:p.id,provider:'cx',kind:'test',title:'failure',executable:process.execPath,cwd:root,prompt:'x',args:['-e',`process.stdin.resume();console.log(JSON.stringify({type:'turn.failed',error:{message:'denied'}}))`]}),/denied/);
  assert.equal(store.state.jobs[0].status,'failed');
});
test('review gate blocks pending, revised, rejected scope and uncovered approval',t=>{
  const {store,p}=fixture(t),runner=new Runner(store),flow=new Workflow(store,runner,()=>({clis:{cc:{available:true,path:'test'},cx:{available:true,path:'test'}}}));
  p.questions=[{id:'q1',decision:'pending'},{id:'q2',decision:'rejected'}];assert.throws(()=>flow.plan(p.id),/批阅/);
  p.questions[0].decision='revise';assert.throws(()=>flow.plan(p.id),/修改/);
  p.questions[0].decision='approved';const task={title:'one',instructions:'do it',acceptance:'assert',questionIds:['q2']};
  assert.throws(()=>validatePlan({tasks:[task]},p.questions),/未经/);
  task.questionIds=['q1'];assert.equal(validatePlan({tasks:[task]},p.questions).tasks.length,1);
  p.questions.push({id:'q3',decision:'approved'});assert.throws(()=>validatePlan({tasks:[task]},p.questions),/遗漏/);
});
test('full orchestration contract: 4 perspectives → review → plan → bounded CX concurrency → CC report',async t=>{
  const {store,p}=fixture(t);store.state.settings.concurrency=2;
  const runner=new Runner(store);let active=0,max=0;
  runner.run=async args=>{
    active++;max=Math.max(max,active);await new Promise(r=>setTimeout(r,10));active--;
    const job={id:String(Math.random()),sessionId:'sid',status:'completed'};
    if(args.kind==='brainstorm')return{job,structured:{summary:'summary',perspectives:roles.map(r=>({role:r.key,analysis:'independent analysis'})),questions:[{title:'Question?',why:'why',options:['A','B'],recommendation:'A'}]}};
    if(args.kind==='plan')return{job,structured:{summary:'plan',tasks:[1,2,3].map(i=>({title:`task${i}`,instructions:'write a file',acceptance:'verify',questionIds:['q1'],workerId:`cx-${i}`}))}};
    return{job,text:'# Report\nVerified fixture output.'};
  };
  const flow=new Workflow(store,runner,()=>({clis:{cc:{available:true,path:'test'},cx:{available:true,path:'test'}}}));
  await flow.brainstorm(p.id);assert.equal(p.status,'awaiting_review');assert.equal(p.perspectives.length,4);
  flow.review(p.id,{questionId:'q1',decision:'approved',answer:'A',comment:'Proceed'});
  await flow.plan(p.id);assert.equal(p.tasks.length,3);assert.throws(()=>flow.review(p.id,{questionId:'q1',decision:'rejected',answer:'',comment:''}),/阶段/);
  await flow.execute(p.id);assert.equal(p.status,'executed');assert.equal(max,2);assert.equal(new Set(p.tasks.map(t=>t.cwd)).size,3);assert(p.tasks.every(t=>fs.existsSync(path.join(t.cwd,'TASK.md'))));
  await flow.summarize(p.id);assert.equal(p.status,'completed');assert(p.documents.some(d=>d.name==='50-cc-summary.md'));
});
test('HTTP protects mutations, persists rules, switches workspaces and serves Markdown safely',async t=>{
  const root=temp(t),second=path.join(root,'another');let scans=0;
  const app=await startServer({workspace:root,port:0,scanner:async()=>{scans++;return{clis:{},sessions:[],processes:[],warnings:[]};}});t.after(()=>app.close());
  const initial=await fetch(app.url+'/api/state').then(r=>r.json());
  const post=(route,body,headers={})=>fetch(app.url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Relay-Token':initial.token,...headers},body:JSON.stringify(body)});
  assert.equal((await fetch(app.url+'/')).status,200);
  assert.equal((await post('/api/projects',{title:'x',brief:'y'},{'X-Relay-Token':'bad'})).status,403);
  assert.equal((await post('/api/projects',{title:'x',brief:'y'},{Origin:'https://evil.example'})).status,403);
  const p=await post('/api/projects',{title:'test',brief:'hello <script>bad</script>'}).then(r=>r.json());
  const doc=await fetch(app.url+`/api/projects/${p.id}/documents/${p.documents[0].id}?download`);assert.match(doc.headers.get('content-type'),/markdown/);assert.match(await doc.text(),/script/);
  assert.equal((await post('/api/rules',{content:'rules'})).status,200);
  assert.equal((await post('/api/workspace',{path:second,create:true})).status,200);
  const switched=await fetch(app.url+'/api/state').then(r=>r.json());assert.equal(switched.workspace,second);assert.equal(switched.projects.length,0);assert.equal(switched.rules.workspace,'');
  assert.equal((await post('/api/workspace',{path:root})).status,200);const back=await fetch(app.url+'/api/state').then(r=>r.json());assert.equal(back.projects.length,1);assert.equal(back.rules.workspace,'rules');assert(scans>=3);
});

test('topic intake has its own folder and requires explicit confirmation before pipeline',async t=>{
  const root=temp(t),store=new Store(root);t.after(()=>store.close());
  const directory=path.join(root,'separate-topic'),p=store.newProject({title:'Initial idea',directory});
  assert.equal(p.status,'defining');assert.equal(p.intakeConfirmed,false);assert(fs.existsSync(path.join(store.folder(p.id),'project.json')));
  const runner=new Runner(store);let round=0;
  runner.run=async args=>({job:{id:args.id,sessionId:args.sessionId||(args.reviewerId&&args.reviewerId!=='cc'?`session-${args.reviewerId}`:'mentor-id')},structured:args.kind==='intake'?(++round===1?{phase:'clarifying',message:'What data is available?',direction:'',ideas:[],researchTopic:'',pipeline:[]}:{phase:'proposal',message:'Please confirm.',direction:'A testable direction',ideas:['A hypothesis'],researchTopic:'Confirmed topic',pipeline:[{title:'Baseline',description:'Implement and verify'}]}):{...councilResult(args.kind,args.reviewerId),...(args.kind==='proposal-synthesis'?{researchTopic:'Confirmed topic'}:{})}});
  const flow=new Workflow(store,runner,()=>({clis:{cc:{available:true,path:'test'}}}));
  assert.throws(()=>flow.brainstorm(p.id),/确认科研/);assert.throws(()=>flow.activate(p.id),/先与/);
  await flow.chat(p.id,'My initial idea');assert.equal(p.status,'defining');assert.equal(p.conversation.length,2);
  await flow.chat(p.id,'Here is my dataset');assert.equal(p.status,'proposal');assert.equal(p.intakeConfirmed,false);
  flow.activate(p.id);assert.equal(p.status,'draft');assert.equal(p.pipeline.length,1);assert.equal(p.researchTopic,'Confirmed topic');
  assert.match(fs.readFileSync(path.join(store.folder(p.id),'00-brief.md'),'utf8'),/Confirmed topic/);
});

test('skills are selected per topic and the actual subprocess input records selected content and hash',async t=>{
  const {store,p,root}=fixture(t),skillDir=path.join(p.directory,'.agents','skills','unique-test-skill');fs.mkdirSync(skillDir,{recursive:true});
  fs.writeFileSync(path.join(skillDir,'SKILL.md'),'---\nname: unique-test-skill\ndescription: >-\n  Contract test\n  only\n---\nUse seed 13579.');
  const catalog=scanSkills(root,[path.dirname(skillDir)]),skill=catalog.find(s=>s.name==='unique-test-skill');assert(skill);assert.equal(skill.description,'Contract test only');
  const runner=new Runner(store),flow=new Workflow(store,runner,()=>({clis:{}}));t.after(()=>runner.close());
  flow.selectSkills(p.id,[skill.id]);const other=store.newProject({title:'Other',brief:'other'});assert.deepEqual(other.skillIds,[]);
  assert.throws(()=>flow.selectSkills(p.id,['unknown']),/已不存在/);assert.deepEqual(p.skillIds,[skill.id]);
  const result=await runner.run({projectId:p.id,provider:'cx',kind:'test',title:'selected skill',executable:process.execPath,cwd:root,prompt:'Test',args:['-e',`process.stdin.resume();console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'ok'}}))`]});
  assert.equal(result.job.skills.length,1);assert.equal(result.job.skills[0].hash.length,64);
  assert.match(fs.readFileSync(path.join(store.folder(p.id),'runs',result.job.id,'input.md'),'utf8'),/seed 13579/);
});

test('one CX never executes two tasks concurrently and retains its conversation',async t=>{
  const {store,p}=fixture(t),runner=new Runner(store);let active=0,max=0,previousSession;
  runner.run=async args=>{active++;max=Math.max(active,max);previousSession=args.sessionId;await new Promise(r=>setTimeout(r,25));active--;return{job:{id:Math.random()+'',sessionId:'same-cx'},text:'report'};};
  p.questions=[{id:'q1',decision:'approved'}];p.tasks=[1,2].map(index=>{const d=store.doc(p.id,`30-task-${index}.md`,'task','Approved task','task');return{id:'task'+index,index,title:'task',workerId:'cx-1',documentId:d.id,status:'ready'};});
  const flow=new Workflow(store,runner,()=>({clis:{cx:{available:true,path:'test'}}}));await flow.execute(p.id);
  assert.equal(max,1);assert.equal(previousSession,'same-cx');assert.equal(p.tasks[0].cwd,p.tasks[1].cwd);assert.equal(p.status,'executed');
});
