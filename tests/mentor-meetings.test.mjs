import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {Runner} from '../src/runner.mjs';
import {Workflow} from '../src/workflow.mjs';
import {benchmarkResponse,seedBenchmark,meetingFixture} from './fixtures/benchmark-research.mjs';
import {meetingState} from '../public/mentor-ui.js';

const passed={summary:'Checked synthetic work',assessment:'passed',evidence:'Fixture evidence only',reason:'The fixture direction supports its test goal',decision:'finish',question:'',handoff:'Preserve evidence',nextTasks:[]};
const task=(stage,extra={})=>({title:stage+' fixture',instructions:'Use synthetic fixtures only',acceptance:'Return actual fixture evidence',workerId:'cx-1',questionIds:['research-goal'],researchStage:stage,...extra});
function setup(t,seed=true){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'niuma-meetings-')),store=new Store(root),p=store.newProject({title:'Mentor meeting fixture',brief:'Check software, not real scientific conclusions'}),runner=new Runner(store),flow=new Workflow(store,runner,()=>({clis:{cc:{available:true,path:'fixture'},cx:{available:true,path:'fixture'}},sessions:[{id:'external',provider:'cx'}]}));
 p.autonomy.mode='assisted';p.modelPolicy.allowCCSwitch=false;if(seed)seedBenchmark(p,store);
 const calls=[],answer=(a,data)=>({job:{id:a.id||'fixture-'+calls.length,sessionId:a.provider+'-fixture'},text:'Synthetic evidence',structured:data??benchmarkResponse(a.kind)??(a.kind==='feedback'?structuredClone(passed):a.kind==='plan'?{summary:'Pilot first',rationale:'Validate before expanding',tasks:[task('pilot')]}:undefined)});
 runner.run=async a=>{calls.push(a);return answer(a);};
 const add=(stage,extra={})=>{const n=p.tasks.length+1,d=store.doc(p.id,`30-task-${n}.md`,'Fixture','Isolated fixture','task'),v={...task(stage),id:'task-'+n,index:n,status:'ready',dependsOn:[],documentId:d.id,...extra};p.tasks.push(v);return v;};
 t.after(async()=>{await runner.close();store.close();assert(fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});return {root,store,p,runner,flow,calls,answer,add};
}

test('literature revision is regenerated and re-presented before benchmark; all CC material gets a mentor report',async t=>{
 const {store,p,runner,flow,calls,answer}=setup(t,false);let rejected=false;
 runner.run=async a=>{calls.push(a);if(a.kind==='mentor-meeting'&&!rejected){rejected=true;return answer(a,{...meetingFixture(),verdict:'revise',revisionInstructions:'Clarify the classic reference evidence'});}if(a.kind==='literature-research'&&rejected)assert.match(a.prompt,/Clarify the classic reference/);return answer(a);};
 await flow.collaborate(p.id);assert.equal(p.status,'cycle_complete',p.error);
 assert.deepEqual(calls.map(a=>a.kind),['literature-research','mentor-meeting','literature-research','mentor-meeting','benchmark-design','mentor-meeting','plan','mentor-meeting','execution','feedback']);
 assert.equal(p.mentorMeetings.length,4);assert(p.mentorMeetings.every(m=>m.documentId));const first=p.mentorMeetings[0],second=p.mentorMeetings[1];assert.notEqual(first.source.documentId,second.source.documentId);assert.equal(store.readDoc(p.id,first.source.documentId).content,first.source.content);
 assert.equal(meetingState(p,'literature').status,'proceed');
});

test('benchmark mentor blocker and review budget preserve artifacts without starting CX',async t=>{
 const {p,runner,flow,calls,answer}=setup(t,false);let blocked=true;
 runner.run=async a=>{calls.push(a);const m=p.mentorMeetings?.at(-1);return answer(a,a.kind==='mentor-meeting'&&m.stage==='benchmark'&&blocked?{...meetingFixture(),verdict:'blocked',revisionInstructions:'Need a verified independent split'}:undefined);};
 await flow.collaborate(p.id);assert.equal(p.status,'paused');assert.equal(p.benchmarkResearch.runs[0].status,'blocked');assert(!calls.some(a=>['plan','execution'].includes(a.kind)));
 blocked=false;await flow.collaborate(p.id,{maxReviews:1});assert.equal(p.status,'paused');assert.equal(p.tasks.length,0);assert.equal(p.executionPlan.meetingStatus,'pending');assert.equal(calls.filter(a=>a.kind==='literature-research').length,1);assert.equal(calls.filter(a=>a.kind==='benchmark-design').length,1);
 await flow.collaborate(p.id,{maxReviews:8});assert.equal(p.status,'cycle_complete',p.error);assert.equal(calls.filter(a=>a.kind==='execution').length,1);
});

test('repeated direction objections pause after three rounds instead of pretending acceptance',async t=>{
 const {p,runner,flow,calls,answer}=setup(t,false);runner.run=async a=>{calls.push(a);return answer(a,a.kind==='mentor-meeting'?{...meetingFixture(),verdict:'revise',revisionInstructions:'The source does not support this conclusion'}:undefined);};
 await flow.collaborate(p.id);assert.equal(p.status,'paused');assert.equal(p.mentorMeetings.length,3);assert.equal(p.tasks.length,0);assert(!calls.some(a=>a.kind==='benchmark-design'));assert.match(p.collaboration.pauseReason,/3 次/);
});

test('a rejected design never exposes runnable candidate tasks and carries instructions into revision',async t=>{
 const {p,runner,flow,calls,answer}=setup(t);let designReviews=0;
 runner.run=async a=>{calls.push(a);if(a.kind==='mentor-meeting'){assert.equal(p.tasks.length,0);if(++designReviews===1)return answer(a,{...meetingFixture(),verdict:'revise',revisionInstructions:'Reduce the pilot scope before scaling'});}if(a.kind==='plan'&&designReviews)assert.match(a.prompt,/Reduce the pilot scope/);return answer(a);};
 await flow.collaborate(p.id);assert.equal(p.status,'cycle_complete',p.error);assert.equal(p.executionPlans.length,2);assert.equal(p.executionPlans[0].meetingStatus,'revise');assert.equal(p.executionPlans[1].meetingStatus,'proceed');assert.equal(p.tasks.length,1);assert.equal(calls.filter(a=>a.kind==='execution').length,1);
});

test('preplanned later work waits for mentor judgment and pilot correction even on a free CX',async t=>{
 const {p,runner,flow,calls,answer,add}=setup(t),pilot=add('data'),later=add('pilot',{workerId:'cx-2'}),entered=Promise.withResolvers(),held=Promise.withResolvers();let reviewed=0;
 runner.run=async a=>{calls.push(a);if(a.kind==='execution'&&a.taskId===later.id){assert(flow.meetings.resolved(p,pilot));assert.equal(reviewed,2);}if(a.kind==='feedback'){reviewed++;if(a.taskId===pilot.id){entered.resolve();await held.promise;return answer(a,{...passed,assessment:'retry',decision:'continue',nextTasks:[task('data',{dependsOn:[pilot.id],relation:'retry'})]});}}return answer(a);};
 const work=flow.collaborate(p.id);await entered.promise;assert.deepEqual(calls.filter(a=>a.kind==='execution').map(a=>a.taskId),[pilot.id]);assert.equal(flow.meetings.canRun(p,later),false);held.resolve();await work;
 assert.equal(p.status,'cycle_complete',p.error);assert.deepEqual(calls.filter(a=>a.kind==='execution').map(a=>a.taskId),[pilot.id,p.tasks[2].id,later.id]);
});

test('pilot judgment cannot reject the direction then immediately send only a formal experiment',async t=>{
 const {p,runner,flow,calls,answer,add}=setup(t),pilot=add('pilot');runner.run=async a=>{calls.push(a);if(a.kind==='feedback'){assert.match(a.prompt,/是否值得扩大到正式实验/);return answer(a,{...passed,assessment:'retry',decision:'continue',nextTasks:[task('experiments',{dependsOn:[pilot.id],relation:'next'})]});}return answer(a);};
 await flow.collaborate(p.id);assert.equal(p.status,'failed');assert.match(p.error,/不能直接跳到下一阶段/);assert.equal(p.tasks.length,1);assert.equal(calls.filter(a=>a.kind==='execution').length,1);
});

test('changed evidence invalidates a mentor judgment and protects direct execution, handoff and summary',async t=>{
 const {store,p,flow,add}=setup(t),pilot=add('pilot');await flow.collaborate(p.id);assert(flow.meetings.resolved(p,pilot));
 store.doc(p.id,'40-report-1.md','Changed report','New contradictory fixture evidence','report');assert.equal(flow.meetings.reviewed(p,pilot),false);assert.throws(()=>flow.summarize(p.id),/导师汇报/);
 const later=add('experiments',{workerId:'cx-2'});assert.throws(()=>flow.execute(p.id,later.id),/导师组会/);await assert.rejects(flow.handoff(p.id,'external',later.documentId),/审核/);
 const r=p.benchmarkResearch.runs[0];store.doc(p.id,store.readDoc(p.id,r.protocol.documentId).name,'Edited protocol','A materially different protocol','benchmark-protocol');assert.equal(flow.benchmark.ready(p),false);
});

test('stopping a pending mentor call preserves material and resumes its review without redoing literature',async t=>{
 const {root,store,p,runner,flow,calls,answer}=setup(t,false),entered=Promise.withResolvers(),held=Promise.withResolvers();let stop=true;
 runner.run=async a=>{calls.push(a);if(a.kind==='mentor-meeting'&&stop){entered.resolve();await held.promise;}return answer(a);};
 const work=flow.collaborate(p.id);await entered.promise;flow.stopProject(p.id);held.resolve();await work;assert.equal(p.status,'interrupted');assert.equal(p.mentorMeetings[0].status,'interrupted');assert.equal(p.tasks.length,0);
 stop=false;await flow.collaborate(p.id);assert.equal(p.status,'cycle_complete',p.error);assert.equal(calls.filter(a=>a.kind==='literature-research').length,1);
 p.mentorMeetings.at(-1).status='running';store.save();store.close();const restored=new Store(root);t.after(()=>restored.close());assert.equal(restored.project(p.id).mentorMeetings.at(-1).status,'interrupted');
});
