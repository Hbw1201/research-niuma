import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {Runner} from '../src/runner.mjs';
import {Workflow} from '../src/workflow.mjs';
import {benchmarkReady,validateLiterature,validateBenchmark} from '../src/benchmark-research.mjs';
import {literatureFixture,protocolFixture,benchmarkResponse} from './fixtures/benchmark-research.mjs';
import {graphData,collaborationPage} from '../public/pipeline-ui.js';
import {summarizeUsage} from '../src/usage.mjs';
const feedback={summary:'Fixture measurement complete',assessment:'passed',decision:'finish',evidence:'Synthetic report only',reason:'Evidence returned',question:'',handoff:'Preserve the report',nextTasks:[]};
const plan={summary:'Measure the fixture',rationale:'Use the literature-derived protocol before claiming improvements',tasks:[{title:'Minimal comparison',instructions:'Compare synthetic values',acceptance:'Report actual values and uncertainty',workerId:'cx-1',questionIds:['research-goal'],researchStage:'pilot'}]};
function setup(t){
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'niuma-benchmark-')),store=new Store(root),p=store.newProject({title:'Synthetic literature workflow',brief:'Validate the workflow, no real research'}),runner=new Runner(store),flow=new Workflow(store,runner,()=>({clis:{cc:{available:true,path:'fixture'},cx:{available:true,path:'fixture'}},sessions:[{id:'external',provider:'cx'}]}));
 p.autonomy.mode='assisted';p.modelPolicy.allowCCSwitch=false;
 const calls=[];const result=a=>({job:{id:'fixture-'+calls.length,sessionId:a.provider+'-fixture'},text:'Synthetic report',structured:benchmarkResponse(a.kind)||(a.kind==='plan'?structuredClone(plan):a.kind==='feedback'?structuredClone(feedback):undefined)});
 runner.run=async a=>{calls.push(a);return result(a);};
 t.after(async()=>{await runner.close();store.close();assert(fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});return {root,store,p,runner,flow,calls,result};
}
test('real CLI subprocesses establish literature and protocol before notice and CX, retaining sources and CC usage',async t=>{
 const {root,store,p,runner,flow,calls,result}=setup(t),file=path.join(root,'fixture-cli.mjs');
 fs.writeFileSync(file,`const d=JSON.parse(process.argv[2]);process.stdin.resume();process.stdin.on('end',()=>{if(d.provider==='cx')console.log(JSON.stringify({type:'item.completed',item:{type:'agent_message',text:'Synthetic measurement report'}}));else console.log(JSON.stringify({type:'result',subtype:'success',session_id:d.sid,result:'Synthetic research',structured_output:d.structured,usage:{input_tokens:10,output_tokens:5}}));});`);
 runner.run=a=>{calls.push(a);if(a.kind==='execution'){assert(benchmarkReady(p));assert(p.executionPlan?.documentId);assert.match(a.prompt,/防泄漏|测试集/);assert.match(a.prompt,/classic|经典/);}const r=result(a);return Runner.prototype.run.call(runner,{...a,executable:process.execPath,args:[file,JSON.stringify({provider:a.provider,sid:r.job.sessionId,structured:r.structured})]});};
 await flow.collaborate(p.id);assert.equal(p.status,'cycle_complete',p.error);
 assert.deepEqual(calls.map(c=>c.kind),['literature-research','mentor-meeting','benchmark-design','mentor-meeting','plan','mentor-meeting','execution','feedback']);
 assert.equal(p.questions.length,0);assert.equal(p.benchmarkResearch.runs.length,1);const r=p.benchmarkResearch.runs[0];
 assert.match(store.readDoc(p.id,r.literature.documentId).content,/https:\/\/example.org\/fixture-paper/);assert.match(store.readDoc(p.id,r.protocol.documentId).content,/不确定性/);
 assert.equal(p.tasks[0].benchmarkRunId,r.id);assert.equal(p.executionPlan.benchmarkRunId,r.id);
 assert.equal(summarizeUsage(store.state.jobs.filter(j=>['literature-research','mentor-meeting','benchmark-design','mentor-meeting'].includes(j.kind))).total,75);
 const g=graphData(p);assert(g.edges.some(e=>e.from.id===`benchmark-${r.id}-literature`&&e.to.id===`benchmark-${r.id}-protocol`));assert(g.edges.some(e=>e.from.id===`benchmark-${r.id}-protocol`&&e.to.notice));
 assert(graphData(p,'benchmark').nodes.some(n=>n.benchmark?.documentId===r.protocol.documentId));
});
test('abstract-only evidence, unknown sources, missing main metrics and credential URLs cannot become a ready protocol',()=>{
 const l=literatureFixture();l.papers[0].access='abstract';assert.throws(()=>validateLiterature(l),/未读原文/);
 const bad=literatureFixture();
 const credentialUrl=new URL('https://example.org/paper');
 credentialUrl.username='example-user';credentialUrl.password='example-password';
 bad.papers[0].url=credentialUrl.href;assert.throws(()=>validateLiterature(bad),/链接/);
 const b=protocolFixture();b.baselines[0].methodId='invented';assert.throws(()=>validateBenchmark(b,literatureFixture()),/方法清单/);
 const m=protocolFixture();m.metrics[0].primary=false;assert.throws(()=>validateBenchmark(m,literatureFixture()),/主指标/);
 const d=protocolFixture();d.dataset.paperIds=['unknown'];assert.throws(()=>validateBenchmark(d,literatureFixture()),/可追溯/);
 const duplicate=literatureFixture();duplicate.methods.push({...duplicate.methods[0]});assert.throws(()=>validateLiterature(duplicate),/重复/);
});
test('unavailable primary evidence pauses with a concrete gap and no plan or CX dispatch',async t=>{
 const {p,runner,flow,calls,result}=setup(t);runner.run=async a=>{calls.push(a);return {...result(a),structured:{...literatureFixture(),status:'blocked',papers:[],methods:[],reason:'Cannot read the relevant full text'}};};
 await flow.collaborate(p.id);assert.equal(p.status,'paused');assert.equal(p.benchmarkResearch.runs[0].status,'blocked');assert.match(p.collaboration.pauseReason,/full text/);assert.deepEqual(calls.map(c=>c.kind),['literature-research']);assert.equal(p.tasks.length,0);
 runner.run=async a=>{calls.push(a);return result(a);};await flow.collaborate(p.id);assert.equal(p.status,'cycle_complete',p.error);assert.equal(p.benchmarkResearch.runs.length,1);
});
test('protocol failures retain completed literature and resume only the missing step',async t=>{
 const {p,runner,flow,calls,result}=setup(t);let fail=true;runner.run=async a=>{calls.push(a);if(a.kind==='benchmark-design'&&fail)throw Object.assign(Error('Fixture interruption'),{jobId:'failed-protocol-job'});return result(a);};
 await flow.collaborate(p.id);assert.equal(p.status,'failed');const r=p.benchmarkResearch.runs[0];assert.equal(r.literature.status,'completed');assert.equal(r.protocol.jobId,'failed-protocol-job');assert.equal(p.tasks.length,0);
 fail=false;await flow.collaborate(p.id);assert.equal(p.status,'cycle_complete',p.error);assert.equal(calls.filter(c=>c.kind==='literature-research').length,1);assert.equal(calls.filter(c=>c.kind==='benchmark-design').length,2);
});
test('stop during protocol generation prevents dispatch and preserves completed literature for continuation',async t=>{
 const {p,runner,flow,calls,result}=setup(t),entered=Promise.withResolvers(),held=Promise.withResolvers();let pause=true;
 runner.run=async a=>{calls.push(a);if(a.kind==='benchmark-design'&&pause){entered.resolve();await held.promise;}return result(a);};
 const running=flow.collaborate(p.id);await entered.promise;flow.stopProject(p.id);held.resolve();await running;assert.equal(p.status,'interrupted');assert.equal(p.tasks.length,0);assert.equal(p.benchmarkResearch.runs[0].literature.status,'completed');
 pause=false;await flow.collaborate(p.id);assert.equal(p.status,'cycle_complete',p.error);assert.equal(calls.filter(c=>c.kind==='literature-research').length,1);
});
test('changed requirements invalidate a protocol, preserve old reports and establish a new version before more CX work',async t=>{
 const {p,store,runner,flow,calls,result}=setup(t);await flow.collaborate(p.id);const old=p.benchmarkResearch.runs[0],report=store.readDoc(p.id,p.tasks[0].reportId).content;
 p.steering.revision++;assert.equal(benchmarkReady(p),false);const doc=store.doc(p.id,'30-new-task.md','New comparison','Use the new protocol','task');p.tasks.push({...plan.tasks[0],id:'next-task',index:2,documentId:doc.id,status:'ready',dependsOn:[]});
 const start=calls.length;runner.run=async a=>{calls.push(a);if(a.kind==='execution'){assert(benchmarkReady(p));assert.notEqual(p.benchmarkResearch.runs.at(-1).id,old.id);assert.match(a.prompt,new RegExp(p.benchmarkResearch.runs.at(-1).id));}return result(a);};
 await flow.collaborate(p.id);assert.equal(p.status,'cycle_complete',p.error);assert.deepEqual(calls.slice(start, start+4).map(c=>c.kind),['literature-research','mentor-meeting','benchmark-design','mentor-meeting']);assert.equal(p.benchmarkResearch.runs.length,2);assert.equal(store.readDoc(p.id,p.tasks[0].reportId).content,report);assert.equal(p.tasks[0].benchmarkRunId,old.id);
});
test('changes during literature lookup stop the stale result before protocol or execution',async t=>{
 const {p,runner,flow,calls,result}=setup(t);runner.run=async a=>{calls.push(a);p.steering.revision++;return result(a);};
 await flow.collaborate(p.id);assert.equal(p.tasks.length,0);assert.equal(calls.length,1);assert.match(p.error,/研究要求已变化/);assert.equal(benchmarkReady(p),false);
});
test('restart retains literature, marks unfinished protocol interrupted, and requires preparation for direct execution/handoff',async t=>{
 const {root,store,p,runner,flow,result}=setup(t);runner.run=async a=>{if(a.kind==='benchmark-design')throw Error('Fixture stop');return result(a);};await flow.collaborate(p.id);
 const r=p.benchmarkResearch.runs[0];r.status='running';r.protocol.status='running';p.status='researching';store.save();store.close();const restored=new Store(root);t.after(()=>restored.close());const q=restored.project(p.id);assert.equal(q.status,'interrupted');assert.equal(q.benchmarkResearch.runs[0].status,'interrupted');assert.equal(q.benchmarkResearch.runs[0].literature.status,'completed');assert.equal(q.benchmarkResearch.runs[0].protocol.status,'interrupted');
 const doc=restored.doc(q.id,'30-task-fixture.md','Fixture task','Fixture','task');q.tasks.push({...plan.tasks[0],id:'guard-task',index:1,status:'ready',documentId:doc.id});const f=new Workflow(restored,runner,flow.getScan);
 assert.throws(()=>f.execute(q.id),/评测方案/);await assert.rejects(f.handoff(q.id,'external',doc.id),/评测方案/);
});
test('empty projects show pending research steps without implying that literature has already been verified',t=>{
 const {p}=setup(t),nodes=graphData(p).nodes;assert(nodes.some(n=>n.benchmarkStages?.includes('literature')&&n.status==='pending'));assert(nodes.some(n=>n.benchmarkStages?.includes('benchmark')&&n.status==='pending'));
 const c={p,state:{jobs:[],scan:{clis:{cc:{available:true},cx:{available:true}}}},panel:(t,b)=>t+b,esc:s=>String(s??''),button:(a,t)=>`<button>${t}</button>`,busy:()=>false,badge:s=>s,label:s=>s,noProject:()=>''};const page=collaborationPage(c);assert.match(page,/先确定怎么比较/);assert.doesNotMatch(page,/问卷表单|待批阅/);
});
test('manual protocol refresh preserves reports, invalidates prior result approval and waits for continuation',async t=>{
 const {p,flow,calls}=setup(t);await flow.collaborate(p.id);const task=p.tasks[0],oldReport=task.reportId,oldVersion=task.benchmarkRunId;task.researchStage='analysis';
 const source=flow.stageCouncil.material(p,'results');assert(source);p.stageReviews.push({id:'prior-approval',kind:'results',status:'approved',userDecision:{action:'approve',sourceHash:source.sourceHash},...source});assert(flow.stageCouncil.approved(p,'results'));
 const count=calls.length;await flow.prepareBenchmark(p.id);assert.deepEqual(calls.slice(count).map(c=>c.kind),['literature-research','mentor-meeting','benchmark-design','mentor-meeting']);assert.equal(p.benchmarkResearch.runs.length,2);assert(benchmarkReady(p));assert.equal(task.reportId,oldReport);assert.equal(task.benchmarkRunId,oldVersion);assert.equal(flow.stageCouncil.approved(p,'results'),false);assert.equal(p.collaboration.state,'paused');
});
test('a requirement change during direct model selection cannot launch CX with an obsolete protocol',async t=>{
 const {p,flow,calls}=setup(t);await flow.plan(p.id);p.modelPolicy.allowCCSwitch=true;flow.chooseModel=async()=>{p.steering.revision++;};const count=calls.length;await flow.execute(p.id);assert(!calls.slice(count).some(c=>c.kind==='execution'));assert.match(p.tasks[0].error,/研究要求已变化/);
});
