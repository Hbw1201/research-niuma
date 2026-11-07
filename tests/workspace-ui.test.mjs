import test from 'node:test';
import assert from 'node:assert/strict';
import { graphData,collaborationPage } from '../public/pipeline-ui.js';
import { phaseOf } from '../public/workspace-ui.js';

test('stage filters keep the actual review and independent prerequisites of a follow-up', () => {
  const p = {
    intakeConfirmed: true, questions: [{decision:'approved'}], architecture: {workers:[]},
    tasks: [
      {id:'pilot', index:1, researchStage:'pilot', status:'completed'},
      {id:'data', index:2, researchStage:'data', status:'completed'},
      {id:'retry', index:3, researchStage:'analysis', status:'ready', relation:'alternative', parentReviewId:'review', dependsOn:['pilot','data']},
    ],
    collaboration: {reviews:[{id:'review', taskId:'pilot', assessment:'retry', summary:'Use the alternative', reason:'Pilot failed'}]},
  };
  const filtered = graphData(p,'analysis');
  assert.deepEqual(filtered.nodes.map(n=>n.id).sort(), ['data','retry','review']);
  assert.deepEqual(filtered.edges.map(e=>[e.from.id,e.to.id]).sort(), [['data','retry'],['review','retry']]);
  assert.equal(filtered.nodes.find(n=>n.id==='review').context,true);
  assert.equal(graphData(p,'writing').nodes.length,0);
  assert.ok(graphData(p).edges.some(e=>e.from.id==='pilot'&&e.to.id==='review'));
});

test('the workspace points to a pending human decision or completed evidence for an existing project', () => {
  const p = {intakeConfirmed:true, questions:[{decision:'approved'}], tasks:[{}], autonomy:{mode:'auto'}, collaboration:{state:'waiting_user',pendingDecision:{id:'r'}}};
  assert.deepEqual([phaseOf(p).step,phaseOf(p).attention],[2,true]);
  p.collaboration={state:'completed'};
  assert.equal(phaseOf(p).step,3);
  p.intakeConfirmed=false;
  p.proposal={};
  assert.deepEqual([phaseOf(p).step,phaseOf(p).attention],[0,true]);
});

test('the simplified overview keeps required human decisions visible and does not offer to bypass them',()=>{
  const p={id:'p',title:'Fixture',brief:'Test',intakeConfirmed:true,status:'awaiting_decision',autonomy:{mode:'auto'},questions:[],tasks:[],architecture:{confirmed:true,workers:[]},collaboration:{reviews:[],messages:[],pendingDecision:{id:'decision',question:'Confirm access to the missing fixture data'}}};
  const esc=s=>String(s??'').replaceAll('<','&lt;'),c={p,state:{jobs:[],scan:{clis:{cc:{available:true},cx:{available:true}}}},esc,panel:(t,b)=>`<section>${t}${b}</section>`,button:(a,t,cl='',extra='')=>`<button data-action="${a}" ${extra}>${t}</button>`,busy:()=>false,noProject:()=>''};
  const page=collaborationPage(c);
  assert.match(page,/id="research-decision"[\s\S]*id="decision-form"/);
  assert.match(page,/Confirm access to the missing fixture data/);
  assert.doesNotMatch(page,/id="collaborate-form"/);
  assert(page.indexOf('id="decision-form"')<page.indexOf('<details'));
  assert.match(page,/data-action="control-chat"/);
});
