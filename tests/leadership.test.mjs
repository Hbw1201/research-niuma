import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store,upgradeProject} from '../src/store.mjs';
import {Workflow} from '../src/workflow.mjs';
import {Runner} from '../src/runner.mjs';
import {activeWorkers,prepareLeadership} from '../src/leadership.mjs';
import {startServer} from '../src/server.mjs';

function fixture(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'niuma-leader-')),store=new Store(root),p=store.newProject({title:'Autonomous fixture',brief:'Compare approaches and deliver an evidence-based analysis.'}),runner=new Runner(store),flow=new Workflow(store,runner,()=>({clis:{cc:{available:true,path:'cc'},cx:{available:true,path:'cx'}}}));
  p.questions=[{id:'q1',decision:'approved',answer:'Approved fixture scope'}];p.architecture.confirmed=false;
  flow.models=()=>({cx:[{id:'small'},{id:'large'}],defaults:{cx:'small'}});flow.catalog=()=>[];
  t.after(async()=>{await runner.close();store.close();assert(fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});return{root,store,p,runner,flow};
}
const config=(w,extra={})=>({id:w.id,role:w.role,model:w.model||'',language:w.language||'',skillIds:w.skillIds||[],reason:'Allocate according to evidence',...extra});
const team=(p,workers=activeWorkers(p).map(w=>config(w)),parallel=1)=>({summary:'Leader team decision',parallel,workers});
const answer=(args,structured)=>({job:{id:'job-'+Math.random(),sessionId:args.provider==='cc'?'mentor':'session-'+args.workerId},structured,text:'Fixture evidence only'});
const feedback=extra=>({summary:'Fixture evidence review',assessment:'passed',decision:'finish',evidence:'Synthetic fixture evidence, no real scientific result',reason:'Test decision',question:'',handoff:'Share evidence',nextTasks:[],...extra});
const task=(workerId,extra={})=>({title:'Verify fixture',instructions:'Run isolated fixture',acceptance:'Return reproducible fixture evidence',workerId,questionIds:['q1'],researchStage:'pilot',...extra});

test('new projects default to Auto Research, migration preserves legacy assistance and explicit settings',t=>{
  const {p}=fixture(t);assert.equal(p.autonomy.mode,'auto');assert.equal(p.autonomy.maxReviews,100);assert.equal(p.modelPolicy.allowCCSwitch,true);
  const legacy=structuredClone(p);delete legacy.autonomy;delete legacy.teamChanges;upgradeProject(legacy);assert.equal(legacy.autonomy.mode,'assisted');
  p.autonomy.maxWorkers=12;upgradeProject(p);assert.equal(p.autonomy.maxWorkers,12);
});

test('leader chooses team, adds CX after results, changes models, archives used workers and advances beyond an empty queue',async t=>{
  const {p,store,runner,flow}=fixture(t);let organizations=0,executions=0,checkpoints=0;const calls=[];
  runner.run=async args=>{
    calls.push(args);
    if(args.kind==='leadership'){
      organizations++;
      if(organizations===1)return answer(args,team(p,[config(p.architecture.workers[0],{model:'small'}),config(p.architecture.workers[1])],2));
      if(organizations===2)return answer(args,team(p,[...activeWorkers(p).map(w=>config(w)),config({id:'',role:'Independent validator'},{model:'large'})],2));
      return answer(args,team(p,[config(activeWorkers(p).at(-1),{model:'large'})]));
    }
    if(args.kind==='plan')return answer(args,{summary:'Pilot first',tasks:[task(activeWorkers(p)[0].id)]});
    if(args.kind==='model-selection')return answer(args,{model:executions?'large':'small',reason:'Use pilot evidence and task complexity'});
    if(args.kind==='execution'){executions++;return answer(args);}
    assert.equal(args.kind,'feedback');
    if(args.title.includes('检查研究目标')){
      checkpoints++;
      return answer(args,checkpoints===1?feedback({decision:'continue',nextTasks:[task(activeWorkers(p)[0].id,{title:'Analyze evidence',researchStage:'analysis',relation:'next',dependsOn:[p.tasks.at(-1).id]})]}):feedback());
    }
    return answer(args,executions===1?feedback({assessment:'retry',decision:'continue',nextTasks:[task(activeWorkers(p).at(-1).id,{relation:'alternative',dependsOn:[p.tasks[0].id]})]}):feedback());
  };
  await flow.collaborate(p.id);
  assert.equal(p.error,'');assert.equal(p.status,'cycle_complete');assert.equal(executions,3);assert.equal(checkpoints,2);
  assert.equal(p.tasks[2].researchStage,'analysis');assert.deepEqual(p.tasks.map(t=>t.model),['small','large','large']);
  assert.equal(activeWorkers(p).length,1);assert(p.architecture.workers.find(w=>w.id==='cx-1').sessionId);assert.equal(p.architecture.workers.find(w=>w.id==='cx-1').active,false);
  assert.equal(p.teamChanges[0].after.workers.filter(w=>w.active).length,2);assert.equal(p.teamChanges[1].after.workers.filter(w=>w.active).length,3);
  assert(p.teamChanges.every(x=>x.documentId));assert(p.modelChanges.some(x=>x.model==='large'));
  const runs=calls.filter(x=>x.kind==='execution');assert.equal(runs[2].sessionId,'session-'+runs[1].workerId);
  assert.match(store.readDoc(p.id,p.teamChanges.at(-1).documentId).content,/已归档/);
});

test('invalid models, unknown skills, limits and pinned/busy workers reject a candidate before any team mutation',t=>{
  const {p,flow}=fixture(t);const w=p.architecture.workers[0],before=JSON.stringify(p.architecture);p.modelPolicy.allowedModels=['small'];
  assert.throws(()=>flow.leadership.apply(p,team(p,[config(w,{model:'forbidden'})])),/超出用户允许/);assert.equal(JSON.stringify(p.architecture),before);
  assert.throws(()=>prepareLeadership(p,team(p,[config(w,{model:'small',skillIds:['missing']})]),[],flow.models()),/所选技能已不存在/);
  w.pinned=true;assert.throws(()=>prepareLeadership(p,team(p,[config(w,{role:'changed'})]),[],flow.models()),/固定/);
  assert.throws(()=>prepareLeadership(p,team(p,[config(p.architecture.workers[1],{model:'small'})]),[],flow.models()),/固定/);
  w.pinned=false;p.tasks=[{workerId:w.id,status:'running'}];assert.throws(()=>prepareLeadership(p,team(p,[config(w,{model:'small'})]),[],flow.models()),/正在运行/);
  p.tasks=[];p.autonomy.maxWorkers=1;assert.throws(()=>prepareLeadership(p,team(p,[config(w),config(p.architecture.workers[1])]),[],flow.models()),/数量上限/);
});

test('applying team changes preserves references and session updates for a concurrently running CX',t=>{
  const {p,flow}=fixture(t),w=p.architecture.workers[0];p.tasks=[{workerId:w.id,status:'running'}];
  flow.leadership.apply(p,team(p,[config(w),config(p.architecture.workers[1],{role:'Revised idle role'})]));
  w.sessionId='returned-while-leader-working';assert.equal(p.architecture.workers[0],w);assert.equal(p.architecture.workers[0].sessionId,'returned-while-leader-working');
});

test('leader waits for in-flight model choices before capturing a busy worker configuration',async t=>{
  const {p,flow,runner}=fixture(t),w=p.architecture.workers[0];let release,entered;const wait=new Promise(r=>release=r),ready=new Promise(r=>entered=r);let leaderCalled=false;
  runner.run=async args=>{if(args.kind==='model-selection'){entered();await wait;return answer(args,{model:'large',reason:'Fixture choice'});}leaderCalled=true;assert.match(args.prompt,/"model":"large"/);return answer(args,team(p));};
  const t1={...task(w.id),id:'selecting',status:'running'};p.tasks.push(t1);
  const choose=flow.chooseModel(p,w,t1,{cancelled:false});await ready;const organize=flow.leadership.organize(p,{cancelled:false},'Concurrent fixture');await new Promise(r=>setImmediate(r));assert.equal(leaderCalled,false);
  release();await Promise.all([choose,organize]);assert.equal(w.model,'large');assert.equal(p.architecture.workers[0],w);
});

test('stopping during leader planning prevents late team changes, task creation and CX launch',async t=>{
  const {p,flow,runner}=fixture(t);let release,entered;const wait=new Promise(r=>release=r),started=new Promise(r=>entered=r);let calls=0;
  runner.run=async args=>{calls++;assert.equal(args.kind,'leadership');entered();await wait;return answer(args,team(p));};
  const work=flow.collaborate(p.id);await started;flow.stopProject(p.id);release();await work;assert.equal(calls,1);assert.equal(p.status,'interrupted');assert.equal(p.teamChanges.length,0);assert.equal(p.tasks.length,0);
});

test('budget pauses Auto Research with its next step intact, then continues without rerunning previous CX work',async t=>{
  const {p,flow,runner}=fixture(t);let executions=0,reviewCount=0;
  runner.run=async args=>{if(args.kind==='leadership')return answer(args,team(p));if(args.kind==='plan')return answer(args,{summary:'First',tasks:[task('cx-1')]});if(args.kind==='model-selection')return answer(args,{model:'small',reason:'fixture'});if(args.kind==='execution'){executions++;return answer(args);}return answer(args,++reviewCount===1?feedback({decision:'continue',nextTasks:[task('cx-1',{dependsOn:[p.tasks[0].id],relation:'next'})]}):feedback());};
  await flow.collaborate(p.id,{maxReviews:1});assert.equal(executions,1);assert.equal(p.status,'paused');assert.equal(p.tasks[1].status,'ready');
  await flow.collaborate(p.id,{maxReviews:10});assert.equal(executions,2);assert.equal(p.status,'cycle_complete');
});

test('Auto Research still presents a real external blocker to the researcher and resumes after the answer',async t=>{
  const {p,flow,runner}=fixture(t);let executions=0,asked=false;
  runner.run=async args=>{if(args.kind==='leadership')return answer(args,team(p));if(args.kind==='plan')return answer(args,{summary:'First',tasks:[task('cx-1')]});if(args.kind==='model-selection')return answer(args,{model:'small',reason:'fixture'});if(args.kind==='execution'){executions++;return answer(args);}if(!asked){asked=true;return answer(args,feedback({assessment:'blocked',decision:'ask_user',question:'Please provide access to the missing fixture dataset.',nextTasks:[task('cx-1',{dependsOn:[p.tasks[0].id],relation:'next'})]}));}return answer(args,feedback());};
  await flow.collaborate(p.id);assert.equal(p.status,'awaiting_decision');assert.equal(executions,1);
  await flow.collaboration.decide(p.id,{decisionId:p.collaboration.pendingDecision.id,action:'approve',message:'The required fixture dataset is now available.'});assert.equal(executions,2);assert.equal(p.status,'cycle_complete');
});

test('team discussion applies a valid CC proposal directly in auto mode',async t=>{
  const {p,flow,runner}=fixture(t);runner.run=async args=>answer(args,{phase:'proposal',message:'One focused executor',parallel:1,workers:[config(p.architecture.workers[0])]});
  await flow.teamChat(p.id,'Use one executor for this step');assert.equal(p.error,'');assert.equal(activeWorkers(p).length,1);assert.equal(p.teamProposal.accepted,true);assert.equal(p.teamChanges.length,1);
});

test('leader can cancel obsolete work, reassign interrupted work and retire its old CX without losing history',t=>{
  const {p,flow}=fixture(t);
  p.tasks=[{...task('cx-1'),id:'done',status:'completed',reportId:'report'},{...task('cx-2'),id:'obsolete',status:'ready'},{...task('cx-2'),id:'retry',status:'interrupted',sessionId:'old-worker-session',cwd:'old-location'}];
  const update={...team(p,[config(p.architecture.workers[0])]),taskUpdates:[{taskId:'obsolete',action:'cancel',workerId:'',dependsOn:[],priority:0,reason:'Superseded by new evidence'},{taskId:'retry',action:'update',workerId:'cx-1',dependsOn:['done'],priority:10,reason:'Reuse the verified implementation'}]};
  flow.leadership.apply(p,update);assert.equal(p.tasks[1].status,'superseded');assert.equal(p.tasks[2].workerId,'cx-1');assert.equal(p.tasks[2].sessionId,'');assert.equal(p.tasks[2].priority,10);assert.equal(p.tasks[2].leaderChanges[0].previousWorkerId,'cx-2');assert.equal(p.architecture.workers.find(w=>w.id==='cx-2').active,false);
});

test('cyclic queue changes and cancelling every task without evidence leave the project unchanged',t=>{
  const {p,flow}=fixture(t);p.tasks=[{...task('cx-1'),id:'a',status:'ready',dependsOn:[]},{...task('cx-1'),id:'b',status:'ready',dependsOn:['a']}];const before=JSON.stringify(p);
  assert.throws(()=>flow.leadership.apply(p,{...team(p),taskUpdates:[{taskId:'a',action:'update',workerId:'cx-1',dependsOn:['b'],priority:0,reason:'Invalid cycle'}]}),/循环依赖/);assert.equal(JSON.stringify(p),before);
  assert.throws(()=>flow.leadership.apply(p,{...team(p),taskUpdates:p.tasks.map(t=>({taskId:t.id,action:'cancel',reason:'No evidence yet'}))}),/取消全部/);assert.equal(JSON.stringify(p),before);
});

test('autonomy endpoint validates policy and requires the existing mutation token',async t=>{
  const {root,store,p}=fixture(t);store.close();const server=await startServer({workspace:root,port:0,scanner:async()=>({clis:{},processes:[],sessions:[]})});t.after(()=>server.close());
  const state=await fetch(server.url+'/api/state').then(r=>r.json()),route=server.url+`/api/projects/${p.id}/autonomy`,body={mode:'auto',maxWorkers:12,maxParallel:6,maxReviews:250,brief:'Prioritize independent validation'};
  const send=(data,token)=>fetch(route,{method:'POST',headers:{'Content-Type':'application/json',...(token?{'X-Relay-Token':token}:{})},body:JSON.stringify(data)});
  assert.equal((await send(body)).status,403);assert.equal((await send({...body,maxWorkers:0},state.token)).status,400);assert.equal((await send(body,state.token)).status,200);
  assert.equal(server.store.project(p.id).autonomy.maxWorkers,12);assert.equal((await fetch(server.url+'/leader-ui.js')).status,200);
});
