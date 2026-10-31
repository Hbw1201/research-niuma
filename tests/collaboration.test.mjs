import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {Runner} from '../src/runner.mjs';
import {Workflow} from '../src/workflow.mjs';
import {graphData} from '../public/pipeline-ui.js';
import {validateFeedback} from '../src/collaboration.mjs';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'research-loop-')),store=new Store(root),p=store.newProject({title:'Isolated test',brief:'Test only'}),runner=new Runner(store),flow=new Workflow(store,runner,()=>({clis:{cc:{available:true,path:'cc'},cx:{available:true,path:'cx'}}}));p.questions=[{id:'q1',decision:'approved',answer:'Validate fixture only'}];t.after(async()=>{await runner.close();store.close();assert(fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});p.autonomy.mode='assisted';p.modelPolicy.allowCCSwitch=false;return{root,store,p,runner,flow};}
function add(store,p,worker='cx-1'){const index=p.tasks.length+1,d=store.doc(p.id,`30-task-${index}.md`,'Fixture task','Return fixture evidence only','task'),task={id:'task-'+index,index,title:'Attempt '+index,instructions:'Fixture',acceptance:'Evidence',questionIds:['q1'],workerId:worker,documentId:d.id,status:'ready',researchStage:'pilot',dependsOn:[]};p.tasks.push(task);return task;}
function feedback(extra={}){return{summary:'Review actual fixture',assessment:'passed',evidence:'Fixture report, not an actual experiment',decision:'finish',reason:'Explicit test evidence',question:'',handoff:'Share fixture findings',nextTasks:[],...extra};}
function next(t,worker='cx-2'){return{title:'Alternative B',instructions:'Use prior report to verify fixture',acceptance:'Return evidence',questionIds:['q1'],workerId:worker,dependsOn:[t.id],researchStage:'pilot',relation:'alternative'};}
const response=(args,data)=>({job:{id:args.kind+'-'+Math.random(),sessionId:args.provider==='cc'?'mentor':'session-'+args.workerId},text:'# Report\nFixture evidence',...(data?{structured:data}:{})});

test('A → CC feedback → alternative B → independent C; history, dependencies and shared evidence persist',async t=>{
 const {store,p,runner,flow}=fixture(t);const a=add(store,p);let review=0;const calls=[];
 runner.run=async args=>{calls.push({...args});if(args.kind==='feedback'){review++;return response(args,review===1?feedback({assessment:'retry',decision:'continue',nextTasks:[next(a)]}):review===2?feedback({decision:'continue',nextTasks:[{...next(p.tasks[1],'cx-1'),title:'Independent C',relation:'verify'}]}):feedback());}return response(args);};
 await flow.collaborate(p.id);assert.equal(p.status,'cycle_complete');assert.equal(p.tasks.length,3);assert.equal(p.collaboration.reviews.length,3);assert.equal(p.tasks[0].assessment,'retry');assert(p.tasks.every(t=>t.reportId&&t.reviewId));
 const executions=calls.filter(c=>c.kind==='execution');assert.equal(executions[2].sessionId,'session-cx-1');assert.match(executions[1].prompt,/Fixture evidence/);assert.match(executions[1].prompt,/只读产物目录/);assert(calls.filter(c=>c.kind==='feedback').slice(1).every(c=>c.sessionId==='mentor'));
 const g=graphData(p);assert(g.edges.some(e=>e.from.id===p.tasks[1].parentReviewId&&e.to.id===p.tasks[1].id&&e.label==='替代方案'));assert(g.nodes.some(n=>n.status==='retry'));assert(g.nodes.some(n=>n.status==='passed'));
 assert(fs.existsSync(path.join(p.dataDirectory,'60-collaboration.md')));assert.equal(p.research?.decisions?.length||0,0);
});
test('pending CC question stops dispatch and requires matching user decision before proposed work',async t=>{
 const {store,p,runner,flow}=fixture(t),a=add(store,p);let executions=0,reviews=0;
 runner.run=async args=>{if(args.kind==='execution')executions++;return response(args,args.kind==='feedback'?(++reviews===1?feedback({assessment:'blocked',decision:'ask_user',question:'Allow the proposed data repair?',nextTasks:[next(a)]}):feedback()):null);};
 await flow.collaborate(p.id);assert.equal(executions,1);assert.equal(p.tasks.length,1);assert.equal(p.status,'awaiting_decision');assert.throws(()=>flow.collaborate(p.id),/待确认/);
 assert.throws(()=>flow.collaboration.decide(p.id,{decisionId:'stale',action:'approve',message:'yes'}),/已变化/);
 const id=p.collaboration.pendingDecision.id;await flow.collaboration.decide(p.id,{decisionId:id,action:'approve',message:'Approved fixture repair'});
 assert.equal(executions,2);assert.equal(p.status,'cycle_complete');assert.equal(p.collaboration.reviews[0].userDecision.action,'approve');
});
test('iteration budget pauses without discarding queued alternatives and resumes only remaining work',async t=>{
 const {store,p,runner,flow}=fixture(t),a=add(store,p);let executions=0,reviews=0;
 runner.run=async args=>{if(args.kind==='execution')executions++;return response(args,args.kind==='feedback'?(++reviews===1?feedback({assessment:'retry',decision:'continue',nextTasks:[next(a)]}):feedback()):null);};
 await flow.collaborate(p.id,{maxReviews:1});assert.equal(p.status,'paused');assert.equal(executions,1);assert.equal(p.tasks[1].status,'ready');
 await flow.collaborate(p.id,{maxReviews:1});assert.equal(executions,2);assert.equal(p.status,'cycle_complete');
});
test('a finished CX is reviewed while a different CX is still running; one worker never overlaps',async t=>{
 const {store,p,runner,flow}=fixture(t);add(store,p,'cx-1');add(store,p,'cx-2');let releaseSlow,seenReview;const slow=new Promise(r=>releaseSlow=r),reviewed=new Promise(r=>seenReview=r);let secondRunning=false,reviewDuringOther=false;
 runner.run=async args=>{if(args.kind==='execution'&&args.workerId==='cx-2'){secondRunning=true;await slow;secondRunning=false;}if(args.kind==='feedback'){reviewDuringOther ||= secondRunning;seenReview();return response(args,feedback());}return response(args);};
 const run=flow.collaborate(p.id);await reviewed;assert.equal(reviewDuringOther,true);releaseSlow();await run;assert.equal(p.status,'cycle_complete');
});
test('stopping during CC feedback prevents another CX launch; resume reviews existing report',async t=>{
 const {store,p,runner,flow}=fixture(t),a=add(store,p);let entered,release,executions=0;const started=new Promise(r=>entered=r),wait=new Promise(r=>release=r);let block=true;
 runner.run=async args=>{if(args.kind==='execution')executions++;if(args.kind==='feedback'){if(block){entered();await wait;return response(args,feedback({decision:'continue',nextTasks:[next(a)]}));}return response(args,feedback());}return response(args);};
 const run=flow.collaborate(p.id);await started;flow.stopProject(p.id);release();await run;assert.equal(executions,1);assert.equal(p.status,'interrupted');assert.equal(p.tasks[0].reviewId,undefined);
 block=false;await flow.collaborate(p.id);assert.equal(executions,1);assert.equal(p.status,'cycle_complete');
});
test('out-of-scope feedback never launches proposed task and CLI failure is sent back as an error report',async t=>{
 const {store,p,runner,flow}=fixture(t),a=add(store,p);let executions=0;
 runner.run=async args=>{if(args.kind==='execution'){executions++;throw new Error('Fixture tool failure');}assert.match(args.prompt,/Fixture tool failure/);return response(args,feedback({assessment:'retry',decision:'continue',nextTasks:[{...next(a),questionIds:['unapproved']}]}));};
 await flow.collaborate(p.id);assert.equal(executions,1);assert.equal(p.status,'failed');assert.match(p.error,/未经批准/);assert.equal(p.tasks.length,1);assert.equal(p.tasks[0].status,'failed');
});
test('new researcher message after a completed cycle invokes CC again without repeating previous CX work',async t=>{
 const {store,p,runner,flow}=fixture(t);add(store,p);let executions=0,reviews=0;
 runner.run=async args=>{if(args.kind==='execution')executions++;else{reviews++;if(reviews===2)assert.match(args.prompt,/Check a different explanation/);}return response(args,args.kind==='feedback'?feedback():null);};
 await flow.collaborate(p.id);await flow.collaboration.send(p.id,'Check a different explanation');assert.equal(executions,1);assert.equal(reviews,2);assert(p.collaboration.messages.find(m=>m.from==='研究者').seenAt);
});
test('confirmed questionnaire can plan and enter feedback loop in one action; no approval cannot start',async t=>{
 const {p,runner,flow}=fixture(t);p.questions[0].decision='pending';assert.throws(()=>flow.collaborate(p.id),/批阅/);p.questions[0].decision='approved';
 runner.run=async args=>response(args,args.kind==='plan'?{summary:'Fixture plan',tasks:[{title:'Pilot',instructions:'Fixture',acceptance:'Evidence',questionIds:['q1'],workerId:'cx-1',researchStage:'pilot'}]}:args.kind==='feedback'?feedback():null);
 await flow.collaborate(p.id);assert.equal(p.tasks.length,1);assert.equal(p.status,'cycle_complete');assert.equal(p.tasks[0].researchStage,'pilot');
});
test('restart pauses collaboration and preserves feedback; stage confirmation is an explicit human record',async t=>{
 const {root,store,p,flow}=fixture(t);p.collaboration.state='running';p.status='collaborating';store.save();store.close();const restored=new Store(root);t.after(()=>restored.close());assert.equal(restored.project(p.id).status,'interrupted');assert.equal(restored.project(p.id).collaboration.state,'paused');
 assert.throws(()=>validateFeedback(p,feedback({decision:'finish',assessment:'retry'})),/结束/);
 const flow2=new Workflow(restored,new Runner(restored),()=>({}));flow2.stageReview(p.id,{stageId:'pilot',action:'confirmed',comment:'Reviewed the fixture evidence'});assert.equal(restored.project(p.id).research.decisions.length,1);
});
test('researcher can keep talking to CC after topic confirmation before any execution exists',async t=>{
 const {p,runner,flow}=fixture(t);runner.run=async args=>{assert.equal(args.kind,'research-chat');assert.match(args.prompt,/Question the measurement/);return response(args);};
 await flow.collaboration.send(p.id,'Question the measurement');assert.equal(p.tasks.length,0);assert.equal(p.collaboration.messages.at(-1).from,'CC');assert(p.collaboration.messages[0].seenAt);
});
test('stopping an individual CX call stops scheduling instead of restarting the cancelled task',async t=>{
 const {store,p,runner,flow}=fixture(t);add(store,p);let calls=0;runner.run=async()=>{calls++;store.state.jobs.push({id:'cancelled-job',status:'cancelled'});throw Object.assign(new Error('任务已停止。'),{jobId:'cancelled-job'});};
 await flow.collaborate(p.id);assert.equal(calls,1);assert.equal(p.status,'interrupted');assert.equal(p.tasks[0].reportId,undefined);
});
test('running one branch cannot dispatch a ready follow-up belonging to a different branch',async t=>{
 const {store,p,runner,flow}=fixture(t);const a=add(store,p),other=add(store,p,'cx-2'),follow=add(store,p,'cx-2');other.status='completed';other.reviewId='other-review';follow.parentReviewId='other-review';p.collaboration.reviews.push({id:'other-review',taskId:other.id,summary:'Prior branch',evidence:'fixture',reason:'fixture'});
 const ran=[];runner.run=async args=>{if(args.kind==='execution')ran.push(args.taskId);return response(args,args.kind==='feedback'?feedback():null);};
 await flow.collaborate(p.id,{taskId:a.id});assert.deepEqual(ran,[a.id]);assert.equal(follow.status,'ready');
});
