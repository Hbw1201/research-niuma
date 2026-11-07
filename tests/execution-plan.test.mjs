import {seedBenchmark,benchmarkResponse} from './fixtures/benchmark-research.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {Runner} from '../src/runner.mjs';
import {Workflow} from '../src/workflow.mjs';
import {councilResult} from './fixtures/proposal-council.mjs';
import {phaseOf} from '../public/workspace-ui.js';
import {collaborationPage,graphData} from '../public/pipeline-ui.js';

function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'niuma-execution-plan-')),store=new Store(root),p=store.newProject({title:'Plan notice fixture',brief:'Validate a measurement using fixture files only'}),runner=new Runner(store),flow=new Workflow(store,runner,()=>({clis:{cc:{available:true,path:'fixture'},cx:{available:true,path:'fixture'}}}));
seedBenchmark(p,store); p.autonomy.mode='assisted';p.modelPolicy.allowCCSwitch=false;flow.catalog=()=>[];flow.models=()=>({cx:[],defaults:{cx:''}});
 t.after(async()=>{await runner.close();store.close();assert(fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});return{root,store,p,runner,flow};
}
const plan=()=>({summary:'Run a minimal measurement',rationale:'Check the measurement before spending resources on full experiments',tasks:[{title:'Pilot',instructions:'Check fixture values',acceptance:'Return actual evidence',questionIds:['research-goal'],workerId:'cx-1',researchStage:'pilot'}]});
const feedback=()=>({summary:'Fixture goal satisfied',assessment:'passed',evidence:'Fixture report',decision:'finish',reason:'Sufficient fixture evidence',question:'',handoff:'Keep the report',nextTasks:[]});
const answer=(a,data)=>({job:{id:a.kind+'-'+Math.random(),sessionId:a.sessionId||'session-'+(a.reviewerId||a.provider)},text:'Fixture evidence',structured:data});

test('confirming a reviewed direction automatically announces and executes without a second approval',async t=>{
 const {p,runner,flow}=setup(t);p.intakeConfirmed=false;p.autonomy.mode='auto';const calls=[];
 runner.run=async a=>{
  calls.push(a.kind);
  if(benchmarkResponse(a.kind))return answer(a,benchmarkResponse(a.kind));
  if(a.kind==='leadership')return answer(a,{summary:'Use the existing fixture team',parallel:1,workers:p.architecture.workers.map(w=>({...w,reason:'Retain fixture assignment'}))});
  if(a.kind==='plan')return answer(a,plan());
  if(a.kind==='feedback')return answer(a,feedback());
  if(a.kind==='execution'){assert(p.executionPlan?.documentId);return answer(a);}
  return answer(a,councilResult(a.kind,a.reviewerId));
 };
 await flow.chat(p.id,'Use the fixture to define the goal');assert.equal(p.intakeConfirmed,false);
 await flow.activate(p.id,{reviewRoundId:p.proposalReviews.at(-1)?.id,sourceHash:p.proposalReviews.at(-1)?.finalHash});assert.equal(p.status,'cycle_complete',p.error);assert.equal(p.questions.length,0);
 assert.equal(calls.filter(k=>k==='execution').length,1);assert(!calls.includes('brainstorm'));
 assert(p.collaboration.messages.findIndex(m=>m.kind==='execution-plan')<p.collaboration.messages.findIndex(m=>m.kind==='start'));
});

test('stopping while CC explains the plan cannot dispatch CX or invent an announcement',async t=>{
 const {p,runner,flow}=setup(t);let entered,release;const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r);let executions=0;
 runner.run=async a=>{if(a.kind==='plan'){entered();await wait;return answer(a,plan());}executions++;return answer(a);};
 const running=flow.collaborate(p.id);await started;flow.stopProject(p.id);release();await running;
 assert.equal(executions,0);assert.equal(p.tasks.length,0);assert.equal(p.executionPlan,undefined);assert.equal(p.status,'interrupted');
 runner.run=async a=>answer(a,a.kind==='plan'?plan():a.kind==='feedback'?feedback():benchmarkResponse(a.kind));
 await flow.collaborate(p.id);assert.equal(p.executionPlans.length,1);assert.equal(p.status,'cycle_complete',p.error);
});

test('requirements changed during planning invalidate that plan before any CX executes',async t=>{
 const {p,runner,flow}=setup(t);let executions=0;
 runner.run=async a=>{if(a.kind==='plan'){p.steering.revision++;return answer(a,plan());}executions++;return answer(a);};
 await flow.collaborate(p.id);assert.equal(executions,0);assert.equal(p.tasks.length,0);assert.equal(p.executionPlan,undefined);assert.match(p.error,/研究要求已更新/);
});

test('missing rationale or failed notice persistence cannot leave runnable tasks',async t=>{
 const {p,runner,flow,store}=setup(t);let executions=0;
 runner.run=async a=>{if(a.kind==='plan')return answer(a,{...plan(),rationale:''});executions++;return answer(a);};
 await flow.collaborate(p.id);assert.equal(executions,0);assert.equal(p.tasks.length,0);
 runner.run=async a=>{if(a.kind==='plan')return answer(a,plan());executions++;return answer(a);};
 const write=store.doc.bind(store);store.doc=(...args)=>{if(args[1].startsWith('28-execution-plan-'))throw new Error('Fixture storage failure');return write(...args);};
 await flow.collaborate(p.id);assert.equal(executions,0);assert.equal(p.tasks.length,0);assert.equal(p.executionPlan,undefined);assert.match(p.error,/storage failure/);
});

test('legacy pending answers remain archived but do not become a UI gate or a fake approval',async t=>{
 const {p,runner,flow,store}=setup(t);p.questions=[{id:'old',title:'Old undecided question',decision:'pending'}];p.status='awaiting_review';
 const context={p,state:{jobs:[],scan:{clis:{cc:{available:true},cx:{available:true}}}},panel:(t,b)=>t+b,esc:s=>String(s??''),button:(a,t)=>`<button data-action="${a}">${t}</button>`,busy:()=>false,badge:s=>s,label:s=>s,noProject:()=>''};
 assert.match(phaseOf(p).hint,/说明安排/);p.status='interrupted';assert.equal(phaseOf(p).step,1);p.status='awaiting_review';const page=collaborationPage(context);assert.match(page,/开始研究/);assert.doesNotMatch(page,/生成问卷|待批阅|打开研究问卷/);
 runner.run=async a=>answer(a,a.kind==='plan'?plan():a.kind==='feedback'?feedback():benchmarkResponse(a.kind));await flow.collaborate(p.id);
 assert.equal(p.questions[0].decision,'pending');assert.match(collaborationPage(context),/为什么这样做/);
 const graph=graphData(p),notice=graph.nodes.find(n=>n.notice);assert(notice);assert(graph.edges.some(e=>e.from===notice&&e.to.task));
 assert.equal(store.readDoc(p.id,p.executionPlan.documentId).kind,'execution-plan');
});
