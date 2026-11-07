import {seedBenchmark,benchmarkResponse} from './fixtures/benchmark-research.mjs';
import {controlPreview} from '../src/steering.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {Runner} from '../src/runner.mjs';
import {Workflow} from '../src/workflow.mjs';

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'research-control-'));
  const store=new Store(root),p=store.newProject({title:'Control fixture',brief:'Compare two baselines'});
seedBenchmark(p,store);  const runner=new Runner(store),cli={available:true,path:process.execPath};
  const flow=new Workflow(store,runner,()=>({clis:{cc:cli,cx:cli}}));
  t.after(async()=>{await runner.close();store.close();fs.rmSync(root,{recursive:true,force:true});});
  return {root,store,p,runner,flow,channel:flow.steering};
}
const answer=(id,reply,isRequirement)=>({job:{id,sessionId:'control-session'},structured:{reply,isRequirement}});
test('control chat responds while research is busy, resumes its own session and keeps FIFO order',async t=>{
  const {p,store,runner,flow,channel}=fixture(t),called=[];
  p.status='collaborating';p.ccSessionId='research-session';flow.busy.add(p.id);
  const gate=Promise.withResolvers();
  runner.run=async args=>{
    called.push(args);
    if(called.length===1)await gate.promise;
    return answer('job-'+called.length,'Reply '+called.length,called.length===1);
  };
  const a=channel.submit(p.id,{requestId:'a',message:'Use seed 42'});
  const b=channel.submit(p.id,{requestId:'b',message:'Which seed?'});
  await Promise.resolve();assert.equal(a.status,'replying');assert.equal(b.status,'queued');
  gate.resolve();await channel.active.get(p.id);
  assert.equal(called.length,2);assert.equal(called[0].sessionId,undefined);assert.equal(called[1].sessionId,'control-session');
  assert.match(called[1].prompt,/Reply 1/);assert.equal(a.revision,1);assert.equal(b.revision,undefined);
  assert.equal(p.status,'collaborating');assert.equal(p.ccSessionId,'research-session');
  assert.equal(channel.submit(p.id,{requestId:'a',message:'Use seed 42'}),a);
  assert.equal(p.steering.turns.length,2);assert.equal(called.length,2);
  assert.match(fs.readFileSync(path.join(store.folder(p.id),'65-control-chat.md'),'utf8'),/Reply 2/);
});
test('explicit direction survives reply failure and retry and is delivered to the actual next CX input',async t=>{
  const {p,runner,store,channel}=fixture(t),run=runner.run.bind(runner);
  runner.run=async()=>{throw Error('Offline fixture');};
  const turn=channel.submit(p.id,{requestId:'change',message:'Report the sample count',mode:'requirement'});
  assert.equal(turn.revision,1);await channel.active.get(p.id);assert.equal(turn.status,'failed');
  runner.run=async()=>answer('retry','Saved',true);
  channel.submit(p.id,{requestId:'change',retry:true});await channel.active.get(p.id);
  assert.equal(p.steering.revision,1);assert.equal(p.steering.turns.length,1);assert.equal(turn.status,'answered');
  const result=await run({projectId:p.id,provider:'cx',kind:'execution',title:'Check input',cwd:store.folder(p.id),executable:process.execPath,args:['-e',"process.stdin.resume();process.stdin.on('end',()=>console.log('ok'))"],prompt:'Original task'});
  const input=fs.readFileSync(path.join(store.folder(p.id),'runs',result.job.id,'input.md'),'utf8');
  assert.match(input,/Original task/);assert.match(input,/Report the sample count/);assert.equal(result.job.steeringRevision,1);
});
test('auto research recomputes the team before dispatching again after a control change',async t=>{
  const {p,store,flow,runner,channel}=fixture(t),calls=[];
  p.questions=[{id:'q',decision:'approved',answer:'baseline'}];
  const w=p.architecture.workers[0];p.architecture.parallel=1;
  for(let i=1;i<=2;i++){
    const doc=store.doc(p.id,'30-task-'+i+'.md','Fixture task '+i,'Run a baseline');
    p.tasks.push({id:'t'+i,index:i,title:'baseline '+i,workerId:w.id,status:'ready',instructions:'Run',documentId:doc.id,dependsOn:[]});
  }
  const held=Promise.withResolvers(),started=Promise.withResolvers();
  flow.models=()=>({cx:[]});flow.catalog=()=>[];
  runner.run=async a=>{
    calls.push(a.kind);
    if(benchmarkResponse(a.kind))return {job:{id:a.kind},structured:benchmarkResponse(a.kind)};
    if(a.kind==='execution'){if(a.taskId==='t1'){started.resolve();await held.promise;}return{job:{id:a.taskId},text:'report'};}
    if(a.kind==='control-chat')return answer('chat','Changed',true);
    if(a.kind==='leadership'){
      const workers=p.architecture.workers.filter(x=>x.active!==false).map(x=>({id:x.id,role:x.role,model:x.model||'',language:x.language||'',skillIds:[],reason:'keep'}));
      return {job:{id:'lead'},structured:{summary:'organize',workers,parallel:1,taskUpdates:[]}};
    }
    return {job:{id:'review'},structured:{summary:'Reviewed',assessment:'passed',evidence:'report',reason:'measured',decision:'finish',question:'',handoff:'',nextTasks:[]}};
  };
  const run=flow.collaborate(p.id);await started.promise;
  channel.submit(p.id,{message:'New baseline requirement',mode:'requirement'});await channel.active.get(p.id);
  await new Promise(r=>setTimeout(r,130));
  assert.equal(calls.filter(x=>x==='execution').length,1);
  assert.equal(calls.filter(x=>x==='literature-research').length,0); // Let the in-flight old-protocol report return first.
  held.resolve();await run;assert.equal(p.status,'cycle_complete',p.error);
  assert.ok(calls.indexOf('literature-research')>calls.indexOf('control-chat'));
  assert.ok(calls.lastIndexOf('leadership')>calls.indexOf('benchmark-design'));
  assert.equal(calls.filter(x=>x==='execution').length,2);
});

test('live chat reveals only public reply text and tolerates incomplete JSON escapes',()=>{
  const preview=controlPreview();
  const event=(type,fields)=>preview({type:'stream_event',event:{type,index:0,...fields}});
  event('content_block_start',{content_block:{name:'Read'}});
  assert.equal(event('content_block_delta',{delta:{type:'input_json_delta',partial_json:'{"reply":"Private tool input'}}),undefined);
  event('content_block_start',{content_block:{name:'StructuredOutput'}});
  const chunk=v=>event('content_block_delta',{delta:{type:'input_json_delta',partial_json:v}});
  assert.equal(chunk('{"isRequirement":true,"reply":"基线\\'),'基线');
  assert.equal(chunk('n报告\\u4e'),'基线\n报告');
  assert.equal(chunk('66"}'),'基线\n报告书');
  assert.equal(preview({type:'assistant',parent_tool_use_id:'nested',message:{content:[{type:'tool_use',name:'StructuredOutput',input:{reply:'hidden'}}]}}),undefined);
});
