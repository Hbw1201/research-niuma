import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {Store} from '../src/store.mjs';
import {Workflow} from '../src/workflow.mjs';
import {Runner,cliArgs} from '../src/runner.mjs';
import {currentReview,reviewReady,validateCross,validateRevision} from '../src/proposal-review.mjs';
import {proposal,councilResult} from './fixtures/proposal-council.mjs';
import {totals} from '../public/team-ui.js';
import {startServer} from '../src/server.mjs';

function setup(t){
  const root=fs.mkdtempSync(path.join(os.tmpdir(),'niuma-council-')),store=new Store(root),p=store.newProject({title:'评委会测试'}),calls=[];
  const runner=new Runner(store),flow=new Workflow(store,runner,()=>({clis:{cc:{available:true,path:'fixture'}}}));
  const result=args=>({job:{id:args.id||'intake',sessionId:args.sessionId||`session-${args.reviewerId||'cc'}`},structured:councilResult(args.kind,args.reviewerId)});
  runner.run=async args=>{calls.push(args);return result(args);};
  t.after(async()=>{await runner.close();store.close();assert(fs.realpathSync(root).startsWith(fs.realpathSync(os.tmpdir())+path.sep));fs.rmSync(root,{recursive:true,force:true});});
  return {root,store,p,runner,flow,calls,result};
}

test('revised proposals loop until all three reviewers pass the exact version; user approval cannot bypass a dissent',async t=>{
  const {p,flow,runner,calls,result}=setup(t);let veto=true;
  runner.run=async a=>{calls.push(a);const value=result(a);if(a.kind==='proposal-verification'&&a.reviewerId==='cc-r2'&&veto){veto=false;value.structured={summary:'修订仍缺验证标准',strengths:[],concerns:[{title:'遗漏标准',severity:'major',reason:'未落实',recommendation:'补齐标准'}],verdict:'revise'};}return value;};
  await flow.chat(p.id,'Review this proposal');assert.equal(p.proposalReviews.length,2);assert.equal(p.proposalReviews[0].status,'changes_requested');assert(reviewReady(p));
  assert.equal(calls.filter(a=>a.kind==='proposal-verification').length,6);
  assert.throws(()=>flow.activate(p.id,{reviewRoundId:p.proposalReviews[0].id,sourceHash:p.proposalReviews[0].finalHash}),/版本已变化/);
  assert.equal(p.intakeConfirmed,false);
});

test('nonconvergent proposal review pauses without exposing human approval and resumes preserved history',async t=>{
  const {p,flow,runner,result}=setup(t);let veto=true;
  runner.run=async a=>{const value=result(a);if(veto&&a.kind==='proposal-verification')value.structured={summary:'仍需修改',strengths:[],concerns:[{title:'未解决',severity:'major',reason:'尚未解决',recommendation:'补充方案'}],verdict:'revise'};return value;};
  await flow.chat(p.id,'Review');assert.equal(p.status,'paused');assert.equal(p.proposalReviews.length,3);assert(!reviewReady(p));assert.throws(()=>flow.activate(p.id),/三位 CC/);
  veto=false;await flow.reviewProposal(p.id);assert.equal(p.proposalReviews.length,4);assert(reviewReady(p));
});
test('lead proposal → three independent sessions → cross reviews → revision → explicit human confirmation',async t=>{
  const {store,p,flow,calls}=setup(t);
  await flow.chat(p.id,'请起草方案并请三位评委审查。');
  assert.equal(p.status,'proposal',p.error);assert.equal(p.intakeConfirmed,false);assert.equal(calls.length,11);assert(calls.every(c=>c.provider==='cc'));
  const independent=calls.filter(c=>c.kind==='proposal-independent'),cross=calls.filter(c=>c.kind==='proposal-cross');
  assert.equal(independent.length,3);assert(independent.every(c=>!c.sessionId));assert.equal(new Set(cross.map(c=>c.sessionId)).size,3);
  for(const c of cross){assert.equal(c.sessionId,`session-${c.reviewerId}`);for(const other of independent.filter(x=>x.reviewerId!==c.reviewerId))assert(c.prompt.includes(other.reviewerId+' 的独立判断'));}
  const lead=calls.find(c=>c.kind==='proposal-synthesis');assert.equal(lead.sessionId,'session-cc');assert.match(lead.prompt,/交叉互评/);
  assert.equal(currentReview(p).reviewers.length,3);assert(reviewReady(p));assert.equal(p.proposal.decisions.length,3);
  const files=p.documents.filter(d=>d.kind==='proposal-review');assert.equal(files.length,10);assert(files.every(d=>store.readDoc(p.id,d.id).content.length>40));
  assert.throws(()=>flow.brainstorm(p.id),/确认科研/);
  flow.activate(p.id,{reviewRoundId:p.proposalReviews.at(-1)?.id,sourceHash:p.proposalReviews.at(-1)?.finalHash});assert.equal(p.intakeConfirmed,true);assert.match(p.brief,/冻结测试集/);
  assert.equal(p.questions.length,0);assert.equal(p.perspectives.length,0);assert.equal(calls.length,11);assert.match(p.error,/连接 CC 与 CX/);
});
test('a failed reviewer blocks cross-review; retry retains successful reviewers',async t=>{
  const {p,runner,flow,calls,result}=setup(t);let fail=true;
  p.proposal=structuredClone(proposal);p.ccSessionId='session-cc';
  assert.throws(()=>flow.activate(p.id,{reviewRoundId:p.proposalReviews.at(-1)?.id,sourceHash:p.proposalReviews.at(-1)?.finalHash}),/三位 CC/);
  runner.run=async args=>{calls.push(args);if(fail&&args.reviewerId==='cc-r2'&&args.kind==='proposal-independent')throw Error('fixture connection failure');return result(args);};
  await flow.reviewProposal(p.id);assert.equal(p.status,'failed');assert.equal(calls.length,3);assert.equal(currentReview(p).reviewers.filter(m=>m.independent.status==='completed').length,2);assert(!reviewReady(p));
  fail=false;await flow.reviewProposal(p.id);assert.equal(p.status,'proposal',p.error);assert.equal(p.proposalReviews.length,1);assert.equal(calls.filter(c=>c.kind==='proposal-independent').length,4);assert(reviewReady(p));
});
test('pause waits for every independent review and launches no downstream sessions; resume finishes',async t=>{
  const {p,runner,flow,calls,result}=setup(t);const releases=[];
  p.proposal=structuredClone(proposal);p.ccSessionId='session-cc';
  runner.run=async args=>{calls.push(args);await new Promise(resolve=>releases.push(resolve));return result(args);};
  const pending=flow.reviewProposal(p.id);await new Promise(resolve=>setImmediate(resolve));assert.equal(releases.length,3);
  flow.stopProject(p.id);assert(flow.busy.has(p.id));releases[0]();await new Promise(resolve=>setImmediate(resolve));assert(flow.busy.has(p.id));releases.slice(1).forEach(r=>r());await pending;
  assert.equal(p.status,'interrupted');assert.equal(currentReview(p).status,'interrupted');assert.equal(calls.length,3);assert.equal(flow.busy.size,0);
  runner.run=async args=>{calls.push(args);return result(args);};await flow.reviewProposal(p.id);assert(reviewReady(p));
});
test('requirements updates invalidate the completed proposal and preserve the older review round',async t=>{
  const {p,flow}=setup(t);await flow.chat(p.id,'初始研究想法');assert(reviewReady(p));
  p.steering.revision++;assert(!reviewReady(p));assert.throws(()=>flow.activate(p.id,{reviewRoundId:p.proposalReviews.at(-1)?.id,sourceHash:p.proposalReviews.at(-1)?.finalHash}),/三位 CC/);
  await flow.reviewProposal(p.id);assert.equal(p.proposalReviews.length,2);assert(reviewReady(p));
  p.proposal.direction='改用另一种研究方法';assert.throws(()=>flow.activate(p.id,{reviewRoundId:p.proposalReviews.at(-1)?.id,sourceHash:p.proposalReviews.at(-1)?.finalHash}),/三位 CC/);
});
test('new requirements during review stop synthesis and cannot silently approve a stale proposal',async t=>{
  const {p,flow,runner,result,calls}=setup(t);p.proposal=structuredClone(proposal);
  runner.run=async args=>{calls.push(args);if(args.kind==='proposal-cross'&&args.reviewerId==='cc-r2')p.steering.revision++;return result(args);};
  await flow.reviewProposal(p.id);assert.equal(p.status,'failed');assert.match(p.error,/研究要求或提案已更新/);assert(!calls.some(c=>c.kind==='proposal-synthesis'));assert(!reviewReady(p));
});
test('restart recovers partial cross-review and retains independent session IDs and documents',async t=>{
  const {root,store,p,flow}=setup(t);await flow.chat(p.id,'研究提案');
  const r=currentReview(p);p.proposal=r.source;r.status='running';r.stage='cross';r.reviewers[2].cross={status:'running'};r.synthesis={status:'pending'};p.status='proposal_reviewing';store.save();store.close();
  const restored=new Store(root);t.after(()=>restored.close());const q=restored.project(p.id),saved=currentReview(q);assert.equal(q.status,'interrupted');assert.equal(saved.status,'interrupted');assert.equal(saved.reviewers[2].cross.status,'interrupted');assert(saved.reviewers.every(m=>m.independent.status==='completed'));
  const runner=new Runner(restored),calls=[];runner.run=async args=>{calls.push(args);return {job:{id:args.id,sessionId:args.sessionId||'session-cc'},structured:councilResult(args.kind,args.reviewerId)};};
  const continued=new Workflow(restored,runner,()=>({clis:{cc:{available:true,path:'fixture'}}}));await continued.reviewProposal(q.id);assert(reviewReady(q));assert.deepEqual(calls.map(c=>c.kind),['proposal-cross','proposal-synthesis']);assert.equal(calls[0].sessionId,'session-cc-r3');
});
test('restart before the first reviewer starts cannot leave the project permanently busy',t=>{
  const {root,store,p}=setup(t);p.proposal=structuredClone(proposal);p.status='proposal_reviewing';store.save();store.close();const restored=new Store(root);t.after(()=>restored.close());assert.equal(restored.project(p.id).status,'interrupted');assert.equal(restored.project(p.id).proposalReviews.length,0);
});
test('incomplete or invented issue references cannot pass review validation',()=>{
  const cross=councilResult('proposal-cross','cc-r1');assert.throws(()=>validateCross(cross,['cc-r2-c1']),/逐条回应/);
  const revision=councilResult('proposal-synthesis');revision.decisions[2].issueId='invented';assert.throws(()=>validateRevision(revision,['cc-r1-c1','cc-r2-c1','cc-r3-c1']),/逐条回应/);
});
test('existing projects without experiments archive the original decisions before entering council review',async t=>{
  const {p,flow,store}=setup(t);p.proposal=structuredClone(proposal);p.intakeConfirmed=true;p.brief='原已确认方案';p.questions=[{title:'原问卷',decision:'approved',answer:'原决定'}];p.pipeline=proposal.pipeline;
  await flow.reviewProposal(p.id);assert.equal(p.intakeConfirmed,false);assert.equal(p.questions.length,0);assert.equal(p.proposalHistory.length,1);assert.equal(p.proposalHistory[0].questions[0].answer,'原决定');assert.equal(p.pipeline.length,0);assert(reviewReady(p));
  const archive=p.documents.find(d=>d.kind==='proposal-history');assert.match(store.readDoc(p.id,archive.id).content,/原决定/);
  flow.activate(p.id,{reviewRoundId:p.proposalReviews.at(-1)?.id,sourceHash:p.proposalReviews.at(-1)?.finalHash});assert.equal(p.pipeline.length,1);assert.equal(p.questions.length,0);
  p.tasks.push({id:'existing',status:'completed'});p.proposalReviewRequired=true;assert.throws(()=>flow.reviewProposal(p.id),/已有实验任务/);
});
test('a reviewer returning the mentor session cannot pass as an independent reviewer',async t=>{
  const {p,runner,flow,result}=setup(t);p.proposal=structuredClone(proposal);p.ccSessionId='session-cc';runner.run=async args=>{const r=result(args);if(args.reviewerId==='cc-r1')r.job.sessionId=p.ccSessionId;return r;};
  await flow.reviewProposal(p.id);assert.equal(p.status,'failed');assert.match(p.error,/会话发生冲突/);assert.equal(currentReview(p).reviewers[0].sessionId,'');assert(!reviewReady(p));
});
test('real subprocess contract records distinct review sessions, Markdown, metadata, and all CC token usage',async t=>{
  const {root,store,p,flow,runner}=setup(t);p.proposal=structuredClone(proposal);p.ccSessionId='session-cc';p.mentor={model:'test-cc-model',language:'简体中文'};
  const fixture=path.join(root,'fake-claude.mjs'),fixtureUrl=new URL('./fixtures/proposal-council.mjs',import.meta.url).href;
  fs.writeFileSync(fixture,`import {councilResult} from ${JSON.stringify(fixtureUrl)};const [kind,reviewer,...args]=process.argv.slice(2);let input='';process.stdin.on('data',s=>input+=s);process.stdin.on('end',()=>{if(!input.includes('输出语言：简体中文'))process.exit(2);const i=args.indexOf('--resume'),session=i<0?'session-'+reviewer:args[i+1];console.log(JSON.stringify({type:'system',session_id:session}));console.log(JSON.stringify({type:'result',subtype:'success',session_id:session,result:'fixture',structured_output:councilResult(kind,reviewer),usage:{input_tokens:10,output_tokens:5}}));});`);
  runner.run=args=>Runner.prototype.run.call(runner,{...args,executable:process.execPath,args:[fixture,args.kind,args.reviewerId,...cliArgs('cc',args)]});
  await flow.reviewProposal(p.id);assert(reviewReady(p),p.error);assert.equal(store.state.jobs.length,10);assert(store.state.jobs.every(j=>j.model==='test-cc-model'&&j.reviewRoundId===currentReview(p).id&&j.reviewerId&&j.provider==='cc'));
  const usage=totals(store.state.jobs);assert.equal(usage.missing,0);assert.equal(usage.total,150);assert.equal(new Set(store.state.jobs.filter(j=>j.kind==='proposal-independent').map(j=>j.sessionId)).size,3);
  const lead=store.state.jobs.find(j=>j.kind==='proposal-synthesis');assert.equal(lead.requestedSessionId,'session-cc');assert.match(fs.readFileSync(path.join(store.folder(p.id),'runs',lead.id,'input.md'),'utf8'),/cc-r3-c1/);
});
test('HTTP review endpoint requires mutation token and human confirmation gate',async t=>{
  const {root}=setup(t),app=await startServer({workspace:path.join(root,'http'),port:0,scanner:async()=>({clis:{cc:{available:true,path:'fixture'}},sessions:[],processes:[],warnings:[]})});t.after(()=>app.close());await app.refresh();
  const state=await fetch(app.url+'/api/state').then(r=>r.json()),p=app.store.newProject({title:'HTTP test'});p.proposal=structuredClone(proposal);
  const post=(verb,token=state.token)=>fetch(`${app.url}/api/projects/${p.id}/${verb}`,{method:'POST',headers:{'Content-Type':'application/json','X-Relay-Token':token},body:JSON.stringify(verb==='activate'?{reviewRoundId:p.proposalReviews.at(-1)?.id,sourceHash:p.proposalReviews.at(-1)?.finalHash}:{})});
  assert.equal((await post('proposal-review','bad')).status,403);assert.equal((await post('activate')).status,409);
  app.runner.run=async args=>({job:{id:args.id,sessionId:args.sessionId||'s-'+args.reviewerId},structured:councilResult(args.kind,args.reviewerId)});
  assert.equal((await post('proposal-review')).status,200);await app.workflow.operations.get(p.id)?.promise;assert(reviewReady(p),p.error);assert.equal(p.intakeConfirmed,false);assert.equal((await post('activate')).status,200);
});
