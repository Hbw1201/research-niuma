import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import {Store} from '../src/store.mjs';
import {Workflow} from '../src/workflow.mjs';
import {Runner,cliArgs} from '../src/runner.mjs';
import {stageResult} from './fixtures/stage-council.mjs';
import {latestStageReview,validateStageDecision} from '../src/stage-council.mjs';
import {graphData} from '../public/pipeline-ui.js';
import {totals} from '../public/team-ui.js';
const feedback={summary:'已初核回报',assessment:'passed',evidence:'测试报告文件',decision:'finish',reason:'完成当前小步骤',question:'',handoff:'交给阶段评委会',nextTasks:[]};
function setup(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'stage-council-')),store=new Store(root),p=store.newProject({title:'阶段评审联调',brief:'仅运行隔离测试，不是实际研究'}),runner=new Runner(store),calls=[];
  p.autonomy.mode='assisted';p.modelPolicy.allowCCSwitch=false;p.questions=[{id:'q1',title:'fixture',decision:'approved',answer:'test'}];
  const flow=new Workflow(store,runner,()=>({clis:{cc:{available:true,path:'fixture'},cx:{available:true,path:'fixture'}}}));
  const add=stage=>{const index=p.tasks.length+1,document=store.doc(p.id,`30-task-${index}.md`,'fixture','执行隔离测试并回报','task');const task={id:'task-'+index,index,title:stage+' fixture',instructions:'fixture',acceptance:'可核验报告',workerId:'cx-1',questionIds:['q1'],researchStage:stage,status:'ready',dependsOn:[],documentId:document.id};p.tasks.push(task);return task;};
  const response=args=>({job:{id:args.id||'job-'+calls.length,sessionId:args.sessionId||(args.reviewerId&&args.reviewerId!=='cc'?'session-'+args.reviewerId:args.provider==='cc'?'mentor':'worker')},structured:args.kind.startsWith('stage-')?stageResult(args,p):args.kind==='feedback'?structuredClone(feedback):undefined,text:`# 实际测试回报\n${args.taskId||''} 的测试产物，非科学结论。`});
  runner.run=async args=>{calls.push(args);return response(args);};
  t.after(async()=>{await runner.close();store.close();assert(fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  return {root,store,p,runner,flow,add,calls,response};
}
test('results and paper each loop through three CC reviewers, actual CX fixes, and resubmission; writing is gated',async t=>{
  const {store,p,flow,add,calls}=setup(t);const experiment=add('experiments'),paper=add('writing');
  await flow.collaborate(p.id,{maxReviews:100});assert.equal(p.status,'cycle_complete',p.error);
  assert.deepEqual(p.stageReviews.map(r=>[r.kind,r.status]),[['results','changes_requested'],['results','approved'],['manuscript','changes_requested'],['manuscript','approved']]);
  assert.equal(p.tasks.length,4);assert(p.tasks.every(t=>t.reportId&&t.reviewId));assert.equal(calls.filter(c=>c.kind==='stage-independent').length,12);
  const paperStart=calls.findIndex(c=>c.taskId===paper.id&&c.kind==='execution'),resultsPass=calls.findIndex(c=>c.reviewRoundId===p.stageReviews[1].id&&c.kind==='stage-synthesis');assert(paperStart>resultsPass);
  assert.equal(paper.councilApprovalIds[0],p.stageReviews[1].leadReviewId);
  for(const r of p.stageReviews){assert.equal(new Set(r.reviewers.map(m=>m.sessionId)).size,3);assert(r.reviewers.every(m=>m.sessionId!=='mentor'));assert(r.sourceDocumentId&&r.synthesis.documentId);for(const id of r.createdTaskIds){const task=p.tasks.find(t=>t.id===id);assert.equal(task.parentReviewId,r.leadReviewId);assert.equal(task.issueIds.length,3);assert.match(store.readDoc(p.id,task.documentId).content,/三位评委复审/);}}
  assert.equal(p.stageReviews[0].reviewers[0].sessionId,p.stageReviews[3].reviewers[0].sessionId);
  const g=graphData(p);assert(g.nodes.filter(n=>n.council).length===32);assert(g.edges.some(e=>e.from.id===p.stageReviews[0].leadReviewId&&e.to.id===p.stageReviews[0].createdTaskIds[0]));assert(g.edges.some(e=>e.to.id===`council-${p.stageReviews[1].id}-source`&&e.from.id===p.stageReviews[0].leadReviewId));assert(g.edges.some(e=>e.to.id===paper.id&&e.from.id===p.stageReviews[1].leadReviewId));
  const filtered=graphData(p,'writing');assert(filtered.nodes.some(n=>n.council?.kind==='manuscript'));assert(filtered.nodes.some(n=>n.id===p.stageReviews[1].leadReviewId));assert(!g.nodes.some(n=>n.parents.includes(n.id)));assert.equal(experiment.status,'completed');
});
test('failed reviewer resumes only missing opinions, and never launches writing early',async t=>{
  const {p,flow,add,runner,calls,response}=setup(t);add('analysis');const paper=add('writing');let fail=true;
  runner.run=async args=>{calls.push(args);if(fail&&args.kind==='stage-independent'&&args.reviewerId==='cc-r2')throw Error('reviewer connection failure');return response(args);};
  await flow.collaborate(p.id,{maxReviews:100});assert.equal(p.status,'failed');assert.equal(paper.status,'ready');assert.equal(p.stageReviews[0].reviewers.filter(m=>m.independent.status==='completed').length,2);
  fail=false;await flow.collaborate(p.id,{maxReviews:100});assert.equal(p.status,'cycle_complete',p.error);assert.equal(calls.filter(c=>c.kind==='stage-independent'&&c.reviewRoundId===p.stageReviews[0].id).length,4);
});
test('CC review budget pauses a partial round without allocating premature fixes, then resumes',async t=>{
  const {p,flow,add,calls}=setup(t);add('experiments');await flow.collaborate(p.id,{maxReviews:4});assert.equal(p.status,'paused');assert.equal(p.stageReviews[0].reviewers.filter(m=>m.independent.status==='completed').length,3);assert.equal(p.tasks.length,1);assert.equal(calls.filter(c=>c.kind==='stage-cross').length,0);
  await flow.collaborate(p.id,{maxReviews:100});assert.equal(p.status,'cycle_complete',p.error);assert.equal(calls.filter(c=>c.kind==='stage-independent'&&c.reviewRoundId===p.stageReviews[0].id).length,3);assert.equal(p.tasks.length,2);
});
test('stopping parallel reviewers waits for all calls and cannot create modification tasks',async t=>{
  const {p,flow,add,runner,response,calls}=setup(t);add('experiments');const releases=[];
  runner.run=async args=>{calls.push(args);if(args.kind==='stage-independent')await new Promise(resolve=>releases.push(resolve));return response(args);};
  const pending=flow.collaborate(p.id,{maxReviews:100});while(releases.length<3)await new Promise(resolve=>setImmediate(resolve));flow.stopProject(p.id);releases.forEach(r=>r());await pending;
  assert.equal(p.status,'interrupted');assert.equal(p.stageReviews[0].status,'interrupted');assert.equal(p.tasks.length,1);assert(!calls.some(c=>c.kind==='stage-cross'));
});
test('changed requirements during review supersede that round and trigger a fresh review automatically',async t=>{
  const {p,flow,add,runner,response,calls}=setup(t);add('experiments');let changed=false;
  runner.run=async args=>{calls.push(args);const result=response(args);if(!changed&&args.kind==='stage-cross'){changed=true;p.steering.revision++;}return result;};
  await flow.collaborate(p.id,{maxReviews:100});assert.equal(p.status,'cycle_complete',p.error);assert.equal(p.stageReviews[0].status,'superseded');assert.equal(p.stageReviews.at(-1).status,'approved');assert(!calls.some(c=>c.kind==='stage-synthesis'&&c.reviewRoundId===p.stageReviews[0].id));
});
test('human decision retains the council issue mapping; approval dispatches fixes once and resumes review',async t=>{
  const {p,flow,add,runner,response,calls}=setup(t);add('writing');
  runner.run=async args=>{calls.push(args);const r=response(args);if(args.kind==='stage-synthesis')r.structured=stageResult(args,p,{askUser:true});return r;};
  await flow.collaborate(p.id,{maxReviews:100});assert.equal(p.status,'awaiting_decision',p.error);assert.equal(p.tasks.length,1);const pending=p.collaboration.pendingDecision;assert(pending.councilRoundId);
  await flow.collaboration.decide(p.id,{decisionId:pending.id,action:'approve',message:'同意此修改方案'});assert.equal(p.status,'cycle_complete',p.error);assert.equal(p.tasks.length,2);assert.equal(p.stageReviews[0].createdTaskIds.length,1);
});
test('leader cannot bypass revision or omit an issue, and scheduling repeated application is idempotent',async t=>{
  const {p,flow,add}=setup(t);add('analysis');await flow.collaborate(p.id,{maxReviews:100});const r=p.stageReviews[0],data=structuredClone(r.synthesis.data);
  data.decision='finish';data.assessment='passed';data.nextTasks=[];data.dispositions=data.dispositions.map(d=>({...d,action:'dismiss'}));assert.throws(()=>validateStageDecision(p,r,data),/主要问题/);
  const missing=structuredClone(r.synthesis.data);missing.nextTasks[0].issueIds=missing.nextTasks[0].issueIds.slice(1);assert.throws(()=>validateStageDecision(p,r,missing),/遗漏/);
  const count=p.tasks.length;flow.stageCouncil.apply(p,r);assert.equal(p.tasks.length,count);assert.equal(r.createdTaskIds.length,1);
});
test('new experiment evidence invalidates an approved result review and the paper must wait again',async t=>{
  const {p,flow,add}=setup(t);add('experiments');add('writing');await flow.collaborate(p.id,{maxReviews:100});assert(flow.stageCouncil.approved(p,'results'));const extra=add('experiments');assert(!flow.stageCouncil.approved(p,'results'));assert(!flow.stageCouncil.canRun(p,{researchStage:'writing'}));
  await flow.collaborate(p.id,{maxReviews:100});assert.equal(p.status,'cycle_complete',p.error);assert.equal(latestStageReview(p,'results').number,3);assert.equal(latestStageReview(p,'manuscript').number,3);assert.equal(extra.status,'completed');
});
test('interruption halfway through dispatch finishes the original correction plan without duplicate tasks',async t=>{
  const {store,p,flow,runner,add,response,calls}=setup(t);add('analysis');let fail=true;
  runner.run=async args=>{calls.push(args);const result=response(args);if(args.kind==='stage-synthesis'&&p.stageReviews.find(r=>r.id===args.reviewRoundId).number===1){const one=result.structured.nextTasks[0];result.structured.nextTasks=[{...one,issueIds:[one.issueIds[0]]},{...one,title:'第二项验证修改',issueIds:one.issueIds.slice(1)}];}return result;};
  const original=flow.collaboration.addTasks.bind(flow.collaboration);
  flow.collaboration.addTasks=(project,review)=>{if(fail&&review.councilRoundId){fail=false;const all=review.nextTasks;review.nextTasks=[all[0]];original(project,review);review.nextTasks=all;store.save();throw Error('fixture dispatch interruption');}return original(project,review);};
  await flow.collaborate(p.id,{maxReviews:100});assert.equal(p.status,'failed');assert.equal(p.stageReviews[0].phase,'dispatch');assert.equal(p.tasks.length,2);
  await flow.collaborate(p.id,{maxReviews:100});assert.equal(p.status,'cycle_complete',p.error);assert.equal(p.tasks.length,3);assert.equal(new Set(p.tasks.map(t=>t.id)).size,3);assert.equal(p.stageReviews[0].createdTaskIds.length,2);assert.equal(calls.filter(c=>c.kind==='stage-synthesis'&&c.reviewRoundId===p.stageReviews[0].id).length,1);
});
test('restart retains completed reviews and restores an interrupted peer-review phase',async t=>{
  const {root,store,p,flow,add}=setup(t);add('analysis');await flow.collaborate(p.id,{maxReviews:4});const r=p.stageReviews[0];r.status='running';r.phase='cross';r.reviewers[0].cross.status='running';p.collaboration.state='running';store.save();store.close();
  const restored=new Store(root);t.after(()=>restored.close());const q=restored.project(p.id);assert.equal(q.stageReviews[0].status,'interrupted');assert.equal(q.stageReviews[0].reviewers[0].cross.status,'interrupted');assert(q.stageReviews[0].reviewers.every(m=>m.independent.status==='completed'));
  const runner=new Runner(restored),resumed=new Workflow(restored,runner,()=>({clis:{cc:{available:true,path:'fixture'},cx:{available:true,path:'fixture'}}})),calls=[];
  runner.run=async args=>{calls.push(args);return {job:{id:args.id||'job',sessionId:args.sessionId||(args.reviewerId&&args.reviewerId!=='cc'?'session-'+args.reviewerId:args.provider==='cc'?'mentor':'worker')},structured:args.kind.startsWith('stage-')?stageResult(args,q):args.kind==='feedback'?feedback:undefined,text:'# Revised evidence'};};
  await resumed.collaborate(q.id,{maxReviews:100});assert.equal(q.status,'cycle_complete',q.error);assert(!calls.some(c=>c.kind==='stage-independent'&&c.reviewRoundId===r.id));
});
test('native subprocesses record reviewer tokens and resume IDs across an actual correction loop',async t=>{
  const {root,p,store,flow,runner,add,response}=setup(t);add('experiments');const file=path.join(root,'cli-fixture.mjs');
  fs.writeFileSync(file,`const data=JSON.parse(process.argv[2]);process.stdin.resume();process.stdin.on('end',()=>{if(data.provider==='cx')console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'# Actual fixture report'}}));else{console.log(JSON.stringify({type:'system',session_id:data.sid}));console.log(JSON.stringify({type:'result',subtype:'success',session_id:data.sid,structured_output:data.structured,result:'fixture',usage:{input_tokens:10,output_tokens:5,cache_creation_input_tokens:0,cache_read_input_tokens:0}}));}});`);
  runner.run=args=>{const result=response(args);return Runner.prototype.run.call(runner,{...args,executable:process.execPath,args:[file,JSON.stringify({provider:args.provider,sid:result.job.sessionId,structured:result.structured}),...cliArgs(args.provider,args)]});};
  await flow.collaborate(p.id,{maxReviews:100});assert.equal(p.status,'cycle_complete',p.error);const jobs=store.state.jobs.filter(j=>j.kind.startsWith('stage-'));assert.equal(jobs.length,14);assert.equal(totals(jobs).total,210);assert.equal(totals(jobs).missing,0);assert(jobs.every(j=>j.reviewRoundId&&j.reviewerId));assert(jobs.filter(j=>j.kind==='stage-cross').every(j=>j.requestedSessionId===j.sessionId));
});
