import {seedBenchmark} from './fixtures/benchmark-research.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Store} from '../src/store.mjs';
import {Runner,cliArgs} from '../src/runner.mjs';
import {Workflow} from '../src/workflow.mjs';
import {usageTracker,summarizeUsage} from '../src/usage.mjs';
import {scanSkills} from '../src/skills.mjs';
import {startServer} from '../src/server.mjs';

function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'relay-team-')),store=new Store(root),p=store.newProject({title:'Fixture',brief:'test only'}),runner=new Runner(store),flow=new Workflow(store,runner,()=>({clis:{cc:{available:true,path:'cc'},cx:{available:true,path:'cx'}}}));t.after(async()=>{await runner.close();store.close();assert(fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});seedBenchmark(p,store);p.autonomy.mode='assisted';p.modelPolicy.allowCCSwitch=false;return{root,store,p,runner,flow};}
function addTask(store,p,index=1){p.questions=[{id:'q1',decision:'approved'}];const d=store.doc(p.id,`30-task-${index}.md`,'approved task','Approved fixture task','task');const task={id:'t'+index,index,title:'Task '+index,instructions:'test fixture',acceptance:'return fixture',workerId:p.architecture.workers[0].id,documentId:d.id,status:'ready'};p.tasks.push(task);return task;}

test('usage includes CC subagents but subtracts restored totals across resume, ignoring duplicate assistant messages',()=>{
  const baseline={opus:{inputTokens:10,outputTokens:20,cacheReadInputTokens:30,cacheCreationInputTokens:40}};
  const tracker=usageTracker('cc',{baseline,continued:true});
  const message={type:'assistant',message:{id:'one',model:'opus',usage:{input_tokens:4,output_tokens:1,cache_read_input_tokens:5}}};
  tracker.observe(message);assert.equal(tracker.observe(message).usage.input,9);
  const final=tracker.observe({type:'result',usage:{input_tokens:4,output_tokens:5},modelUsage:{opus:{inputTokens:14,outputTokens:25,cacheReadInputTokens:35,cacheCreationInputTokens:42},haiku:{inputTokens:100,outputTokens:20,cacheReadInputTokens:0,cacheCreationInputTokens:0}}});
  assert.equal(final.usage.input,111);assert.equal(final.usage.output,25);assert.equal(final.usage.total,136);assert.equal(final.usage.complete,true);
});
test('usage never attributes unknown external history and treats interrupted partial output honestly',()=>{
  const tracker=usageTracker('cc',{continued:true});
  const usage=tracker.observe({type:'result',usage:{input_tokens:4,output_tokens:5},modelUsage:{opus:{inputTokens:9999,outputTokens:9999}}}).usage;
  assert.equal(usage.total,9);assert.equal(usage.complete,false);assert.equal(usage.scope,'main-only');
  const partial=usageTracker('cc').observe({type:'assistant',message:{id:'one',usage:{input_tokens:7,output_tokens:1}}}).usage;
  assert.equal(partial.output,0);assert.equal(partial.complete,false);
});
test('Codex cached input is a subset, and totals retain missing reports',()=>{
  const u=usageTracker('cx').observe({type:'turn.completed',usage:{input_tokens:100,cached_input_tokens:80,output_tokens:20}}).usage;
  assert.equal(u.total,120);assert.equal(u.cacheRead,80);
  const totals=summarizeUsage([{usage:u},{usage:null},{kind:'handoff'}]);assert.equal(totals.total,120);assert.equal(totals.unreportedJobs,1);
});
test('resuming after interruption does not count already-recorded input twice',()=>{
  const first={opus:{inputTokens:100,outputTokens:10}};
  const partial=usageTracker('cc',{baseline:first,continued:true}).observe({type:'assistant',message:{id:'partial',model:'opus',usage:{input_tokens:50,output_tokens:1}}});
  const next=usageTracker('cc',{baseline:partial.sessionModelUsage,continued:true}).observe({type:'result',modelUsage:{opus:{inputTokens:200,outputTokens:30}}});
  assert.equal(110+partial.usage.total+next.usage.total,230);
  assert.equal(partial.usage.complete,false);
});
test('per-call model arguments remain separate arguments for initial and resumed CLI sessions',()=>{
  for(const provider of ['cc','cx'])for(const sessionId of [undefined,'old-session']){const args=cliArgs(provider,{model:'chosen-model',sessionId});const index=args.indexOf('--model');assert.equal(args[index+1],'chosen-model');if(sessionId)assert(args.includes('old-session'));}
});
test('team proposals require explicit acceptance, preserve stable workers, and reject removal of used CX',async t=>{
  const {p,store,flow,runner}=fixture(t);const original=p.architecture.workers[0];
  const proposal={phase:'proposal',message:'Recommend two executors.',parallel:2,workers:[{...original,role:'implement',model:'m1',language:'English',skillIds:[],reason:'implementation'},{id:'',role:'validate',model:'m2',language:'简体中文',skillIds:[],reason:'validation'}]};
  runner.run=async()=>({job:{sessionId:'cc-session'},structured:proposal});
  await flow.teamChat(p.id,'Please recommend a team.');assert.equal(p.architecture.workers.length,4);assert.equal(p.teamProposal.workers.length,2);
  assert.throws(()=>flow.acceptTeam(p.id,'stale'),/方案已更新/);
  flow.acceptTeam(p.id,p.teamProposal.id);assert.equal(p.architecture.workers.length,2);assert.equal(p.architecture.workers[0].id,original.id);assert.equal(p.architecture.workers[0].language,'English');
  addTask(store,p);assert.throws(()=>flow.configure(p.id,{parallel:1,workers:[p.architecture.workers[1]]}),/不能移除/);
});
test('CX-specific skill content, language and model are captured per real subprocess run',async t=>{
  const {root,p,runner}=fixture(t),worker=p.architecture.workers[0];
  const dir=path.join(p.directory,'.agents','skills','worker-skill');fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'SKILL.md'),'---\nname: worker-skill\n---\nWorker marker 24816');
  const skill=scanSkills(root,[path.dirname(dir)]).find(x=>x.name==='worker-skill');worker.skillIds=[skill.id];worker.language='English';worker.model='model-x';
  const result=await runner.run({projectId:p.id,provider:'cx',workerId:worker.id,kind:'test',title:'Worker',executable:process.execPath,cwd:root,prompt:'test',args:['-e',`process.stdin.resume();console.log(JSON.stringify({type:'turn.completed',usage:{input_tokens:17,cached_input_tokens:8,output_tokens:3}}))`]});
  assert.equal(result.job.skills.length,1);assert.equal(result.job.model,'model-x');assert.equal(result.job.language,'English');assert.equal(result.job.usage.total,20);
  const input=fs.readFileSync(path.join(p.dataDirectory,'runs',result.job.id,'input.md'),'utf8');assert.match(input,/24816/);assert.match(input,/输出语言设置：English/);
});
test('CC dynamic selection follows the allowlist between tasks and resumes the same CX session',async t=>{
  const {p,store,flow,runner}=fixture(t);addTask(store,p,1);addTask(store,p,2);
  flow.configureModels(p.id,{model:'cc-model',language:'简体中文',allowCCSwitch:true,allowedModels:['small','large']});
  const calls=[];let turn=0;
  runner.run=async args=>{calls.push({...args});if(args.kind==='model-selection')return{job:{id:'choose-'+turn},structured:{model:turn++?'large':'small',reason:'Choose according to previous report'}};return{job:{id:'run-'+turn,sessionId:'same-worker'},text:'verified fixture report'};};
  await flow.execute(p.id);
  assert.deepEqual(calls.map(x=>x.kind),['model-selection','execution','model-selection','execution']);
  assert.equal(calls[3].sessionId,'same-worker');assert.equal(p.modelChanges[0].model,'small');assert.equal(p.modelChanges[1].model,'large');assert.equal(p.tasks[1].model,'large');assert.equal(p.status,'executed');
});
test('out-of-policy CC model prevents CX launch, and disabled policy makes no selector call',async t=>{
  const {p,store,flow,runner}=fixture(t);addTask(store,p);
  flow.configureModels(p.id,{model:'',language:'简体中文',allowCCSwitch:true,allowedModels:['allowed']});
  let executions=0;runner.run=async args=>{if(args.kind==='execution')executions++;return{job:{id:'bad'},structured:{model:'not-allowed',reason:'bad'}};};
  await flow.execute(p.id);assert.equal(executions,0);assert.equal(p.tasks[0].status,'failed');assert.match(p.tasks[0].error,/超出/);
  flow.configureModels(p.id,{model:'',language:'简体中文',allowCCSwitch:false,allowedModels:[]});
  runner.run=async args=>{assert.equal(args.kind,'execution');return{job:{id:'good',sessionId:'cx'},text:'done'};};await flow.execute(p.id);assert.equal(p.status,'executed');
});
test('history migration restores per-call usage instead of adding session cumulative snapshots',t=>{
  const {store,p,root}=fixture(t);for(const [i,amount] of [[1,100],[2,150]]){const id='job-'+i,dir=path.join(p.dataDirectory,'runs',id);fs.mkdirSync(dir,{recursive:true});fs.writeFileSync(path.join(dir,'events.jsonl'),JSON.stringify({type:'result',session_id:'same',modelUsage:{opus:{inputTokens:amount,outputTokens:amount/10}}})+'\n');store.state.jobs.push({id,projectId:p.id,provider:'cc',kind:'intake',status:'completed',sessionId:'same',startedAt:String(i)});}
  store.save();store.close();const restored=new Store(root);t.after(()=>restored.close());assert.deepEqual(restored.state.jobs.map(j=>j.usage.total),[110,55]);
});
test('new team/model routes retain HTTP mutation protection',async t=>{
  const {root,store}=fixture(t);store.close();const server=await startServer({workspace:root,port:0,scanner:async()=>({clis:{},processes:[],sessions:[]})});t.after(()=>server.close());const s=await fetch(server.url+'/api/state').then(r=>r.json());const id=s.projects[0].id;
  const bad=await fetch(server.url+`/api/projects/${id}/models`,{method:'POST',headers:{'Content-Type':'application/json'},body:'{}'});assert.equal(bad.status,403);assert(Array.isArray(s.models.cx));
});
test('user-stopped mentor work is interrupted instead of reported as a model failure',async t=>{
  const {p,store,runner,flow}=fixture(t);p.intakeConfirmed=false;
  runner.run=async()=>{store.state.jobs.push({id:'stopped',status:'cancelled'});throw Object.assign(new Error('任务已停止。'),{jobId:'stopped'});};
  await flow.chat(p.id,'test');assert.equal(p.status,'interrupted');assert.equal(p.error,'任务已停止。');
});
