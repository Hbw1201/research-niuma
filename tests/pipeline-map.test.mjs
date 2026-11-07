import test from 'node:test';
import assert from 'node:assert/strict';
import {pipelineOverview,pipelinePage,nodeStage} from '../public/pipeline-map.js';
import {stageDetailPage,graphData} from '../public/pipeline-ui.js';
import {literatureFixture,protocolFixture,meetingFixture} from './fixtures/benchmark-research.mjs';

function project(){return {id:'fixture',title:'Canvas fixture',brief:'Test progress, not a scientific claim',intakeConfirmed:true,status:'draft',steering:{revision:0},benchmarkResearch:{revision:0,runs:[]},tasks:[],architecture:{workers:[{id:'cx-1',name:'CX-01'}]},collaboration:{state:'idle',reviews:[],messages:[],pendingDecision:null},stageReviews:[],questions:[]};}
function prepare(p){p.benchmarkResearch.runs.push({id:'protocol-1',number:1,title:p.title,goal:p.brief,requirementsRevision:0,revision:0,status:'ready',literature:{status:'completed',data:literatureFixture(),documentId:'literature-doc',mentorReview:{verdict:'proceed'}},protocol:{status:'completed',data:protocolFixture(),documentId:'protocol-doc',mentorReview:{verdict:'proceed'}}});p.mentorMeetings=['literature','benchmark'].map(stage=>({id:'meeting-'+stage,stage,number:1,status:'completed',source:{key:'protocol-1:'+(stage==='literature'?'literature':'protocol'),goal:p.brief,requirementsRevision:0},data:meetingFixture()}));return p;}
function context(p){const esc=s=>String(s??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');return {p,esc,state:{jobs:[],scan:{clis:{cc:{available:true},cx:{available:true}}}},panel:(t,b)=>`<section><h3>${t}</h3>${b}</section>`,badge:s=>`<span>${s}</span>`,label:s=>s,busy:()=>false,noProject:()=>'<p>No project</p>',button:(a,t,cl='',extra='')=>`<button data-action="${a}" ${extra}>${t}</button>`};}
const task=(id,stage,status='ready')=>({id,index:1,title:'Fixture '+id,workerId:'cx-1',researchStage:stage,status,dependsOn:[]});
const passed=t=>({...t,status:'completed',reportId:t.id+'-report',reviewId:t.id+'-review',assessment:'passed'});

test('canvas indicates the real pending prerequisite without fabricating completed research stages',()=>{
 const p=project();p.intakeConfirmed=false;assert.deepEqual(pipelineOverview(p).currentIds,['question']);p.intakeConfirmed=true;p.status='interrupted';const view=pipelineOverview(p);assert.deepEqual(view.currentIds,['literature']);assert.equal(view.mode,'待继续');assert.equal(view.nodes.filter(n=>n.status==='done').length,1);
 prepare(p);p.benchmarkResearch.runs[0].status='failed';p.benchmarkResearch.runs[0].protocol.status='failed';const partial=pipelineOverview(p);assert.deepEqual(partial.currentIds,['benchmark']);assert.equal(partial.nodes.find(n=>n.id==='literature').status,'done');assert.equal(partial.nodes.find(n=>n.id==='benchmark').status,'paused');
 p.steering.revision++;assert.deepEqual(pipelineOverview(p).currentIds,['literature']);assert.notEqual(pipelineOverview(p).nodes.find(n=>n.id==='literature').status,'done');
});
test('parallel CX work highlights both active steps and a side conversation does not move research progress',()=>{
 const p=prepare(project());p.tasks=[task('a','data','running'),task('b','pilot','running')];const jobs=p.tasks.map(t=>({projectId:p.id,kind:'execution',taskId:t.id,status:'running'}));jobs.push({projectId:p.id,kind:'control-chat',status:'running'});const view=pipelineOverview(p,jobs);assert.deepEqual(view.currentIds,['data','pilot']);assert.equal(view.mode,'进行中');assert.equal(view.nodes.filter(n=>n.current).length,2);
 p.tasks=[];assert.deepEqual(pipelineOverview(p,[jobs.at(-1)]).currentIds,['design']);
});
test('a completed pilot cycle does not imply that formal experiments or writing are complete',()=>{
 const p=prepare(project());p.tasks=[passed(task('pilot','pilot'))];p.status='cycle_complete';p.collaboration.state='completed';const view=pipelineOverview(p);assert.equal(view.mode,'本轮停在');assert.deepEqual(view.currentIds,['pilot']);for(const id of ['experiments','analysis','writing'])assert.equal(view.nodes.find(n=>n.id===id).status,'pending');
});
test('returned work is highlighted for CC review, and queued writing waits for results review',()=>{
 const p=prepare(project());p.tasks=[{...passed(task('e','experiments')),reviewId:''},task('w','writing')];assert.deepEqual(pipelineOverview(p).currentIds,['experiments']);p.tasks[0].reviewId='review';assert.deepEqual(pipelineOverview(p).currentIds,['analysis']);
 p.collaboration.pendingDecision={id:'ask',reviewId:'ask'};p.collaboration.reviews=[{id:'ask',taskId:'e'}];const waiting=pipelineOverview(p);assert.equal(waiting.mode,'待你处理');assert.deepEqual(waiting.currentIds,['experiments']);
});
test('supplementary experiments reopen results and manuscript indicators instead of retaining a false completion',()=>{
 const p=prepare(project());p.tasks=[passed(task('e','experiments')),passed(task('w','writing'))];
 const source=items=>({requirementsRevision:0,benchmarkRunId:'protocol-1',evidence:items.map(t=>({taskId:t.id,reportId:t.reportId,status:t.status}))});
 p.stageReviews=[{id:'results',kind:'results',status:'approved',userDecision:{action:'approve'},source:source([p.tasks[0]])},{id:'paper',kind:'manuscript',status:'approved',userDecision:{action:'approve'},source:{...source([p.tasks[1]]),upstream:'results'}}];
 assert.equal(pipelineOverview(p).nodes.find(n=>n.id==='writing').status,'done');
 p.tasks.push({...task('extra','experiments'),relation:'retry'});const v=pipelineOverview(p);assert.deepEqual(v.currentIds,['experiments']);assert.equal(v.nodes.find(n=>n.id==='analysis').status,'ready');assert.equal(v.nodes.find(n=>n.id==='writing').status,'ready');assert.equal(v.nodes.find(n=>n.id==='experiments').iterations,1);
});
test('overview contains only stage navigation, while details retain the relevant documents and feedback links',()=>{
 const p=prepare(project()),c=context(p),canvas=pipelinePage(c);assert.equal((canvas.match(/data-action="open-stage"/g)||[]).length,9);assert.match(canvas,/map-viewport/);assert.doesNotMatch(canvas,/<form|<details|先确定怎么比较|节点详情|阶段评委会/);
 const literature=stageDetailPage(c,'','literature'),benchmark=stageDetailPage(c,'','benchmark');assert.match(literature,/data-id="literature-doc"/);assert.doesNotMatch(literature,/data-id="protocol-doc"/);assert.match(benchmark,/data-id="protocol-doc"/);assert.doesNotMatch(benchmark,/data-id="literature-doc"/);assert.match(benchmark,/返回研究流程/);
 p.tasks=[{...passed(task('a','pilot')),documentId:'task-a'},{...task('b','pilot'),relation:'alternative',parentReviewId:'review-a',dependsOn:['a']}];p.collaboration.reviews=[{id:'review-a',taskId:'a',assessment:'retry',summary:'Try B',reason:'A failed'}];const detail=stageDetailPage(c,'a','pilot');assert.match(detail,/任务 MD/);assert.match(detail,/结果 MD/);assert.match(detail,/替代方案/);assert.match(detail,/交接、调整与返回关系/);
});
test('deep links resolve reviewers, benchmark documents, feedback and unclassified historical tasks to the right part',()=>{
 const p=prepare(project());p.tasks=[passed(task('t','analysis'))];p.collaboration.reviews=[{id:'r',taskId:'t',summary:'Review',assessment:'passed',reason:'Evidence'}];const nodes=graphData(p).nodes;
 assert.equal(nodeStage(nodes.find(n=>n.id==='r')),'analysis');assert.equal(nodeStage(nodes.find(n=>n.id==='benchmark-protocol-1-protocol')),'benchmark');assert.equal(nodeStage({council:{kind:'proposal'}}),'question');assert.equal(nodeStage({task:{id:'legacy'}}),'unclassified');
});
