import {meetingState} from './mentor-ui.js';
import {benchmarkCurrent} from './benchmark-ui.js';

export const mapStages=[
 ['question','研究方向','CC · 提案与三位评委'],['literature','文献与方法','CC · 经典与近期方法'],['benchmark','基线与评测','CC · 比较对象与指标'],
 ['design','方案与分工','CC · 安排团队与步骤'],['data','数据与环境','CX · 准备研究材料'],['pilot','最小验证','CX · 复现基线与试验'],
 ['experiments','正式实验','CX · 对照、消融与重复'],['analysis','结果分析与评审','CC + 评委 · 核查证据'],['writing','论文与评审','CX + CC 评委 · 修改与复审'],
].map(([id,title,hint],i)=>({id,title,hint,index:i,x:40+(Math.floor(i/3)%2?2-i%3:i%3)*328,y:40+Math.floor(i/3)*184}));
const active=s=>['running','queued','cancelling'].includes(s);
const liveTask=t=>t.status!=='superseded';
const councilStage=r=>r?.kind==='manuscript'?'writing':r?.kind==='results'?'analysis':'question';
const stageOfTask=(p,id)=>p.tasks?.find(t=>t.id===id)?.researchStage;
export function nodeStage(node){if(node?.task)return mapStages.some(s=>s.id===node.task.researchStage)?node.task.researchStage:'unclassified';return node?.researchStage||node?.benchmarkStages?.[0]||node?.council&&(node.council.kind==='proposal'?'question':councilStage(node.council))||node?.notice&&'design'||'question';}
function jobStage(p,j){
 if(j.kind==='mentor-meeting')return p.mentorMeetings?.find(m=>m.jobId===j.id)?.stage;
 if(j.taskId)return stageOfTask(p,j.taskId);
 if(j.kind==='literature-research')return 'literature';
 if(j.kind==='benchmark-design')return 'benchmark';
 if(j.kind==='intake'||j.kind.startsWith('proposal-'))return 'question';
 if(j.kind.startsWith('stage-'))return councilStage(p.stageReviews?.find(r=>r.id===j.reviewRoundId));
 if(j.kind==='plan'||j.kind==='team-chat')return 'design';
 if(j.kind==='leadership')return p.tasks?.filter(t=>t.reportId).at(-1)?.researchStage||'design';
 return null; // A side conversation is not a research-stage transition.
}
function councilFresh(p,r){
 const source=r?.source;if(!source)return false;
 if(r.kind==='manuscript'){const results=p.stageReviews?.filter(x=>x.kind==='results').at(-1);if(results&&(!(results.status==='approved'&&results.userDecision?.action==='approve'&&councilFresh(p,results))||source.upstream!==results.id))return false;}
 const scope=(p.tasks||[]).filter(t=>liveTask(t)&&(t.councilScopes?.includes(r.kind)||(r.kind==='results'?['experiments','analysis']:['writing']).includes(t.researchStage)));
 return benchmarkCurrent(p)&&p.benchmarkResearch.runs.at(-1).status==='ready'&&source.requirementsRevision===(p.steering?.revision||0)&&(source.revision||0)===(p.stageReviewRevisions?.[r.kind]||0)&&(source.benchmarkRunId||'')===(p.benchmarkResearch?.runs?.at(-1)?.id||'')&&scope.length===(source.evidence||[]).length&&scope.every(t=>source.evidence.some(e=>e.taskId===t.id&&e.reportId===t.reportId&&e.status===t.status));
}
export function pipelineOverview(p,jobs=[]){
 const tasks=(p.tasks||[]).filter(liveTask),reviews=p.collaboration?.reviews||[],r=p.benchmarkResearch?.runs?.at(-1),valid=benchmarkCurrent(p);
 const nodes=mapStages.map(s=>{
  const items=tasks.filter(t=>t.researchStage===s.id),returned=items.filter(t=>t.reportId).length;
  let status='pending',label='待开展';
  if(items.length){
   if(items.some(t=>active(t.status))){status='running';label='执行中';}
   else if(items.some(t=>!t.reportId)){status=items.some(t=>['failed','interrupted','cancelled'].includes(t.status))?'paused':'ready';label=status==='paused'?'待继续':'待执行';}
   else if(items.some(t=>!t.reviewId)){status='ready';label='待 CC 复核';}
   else {status='evidence';label='已有回报';if(items.every(t=>t.assessment==='passed')){status='done';label='已复核';}}
  }
  return {...s,status,label,detail:items.length?`${returned} / ${items.length} 项回报`:s.hint,iterations:items.filter(t=>['retry','alternative'].includes(t.relation)).length};
 });
 const get=id=>nodes.find(n=>n.id===id),set=(id,status,label,detail)=>Object.assign(get(id),{status,label,...(detail?{detail}:{})});
 if(p.intakeConfirmed)set('question','done','方向已确认');
 else {const proposal=p.proposalReviews?.at(-1);set('question',p.status==='proposal_reviewing'?'running':proposal?.status==='completed'?'ready':'pending',p.status==='proposal_reviewing'?'评委审查中':proposal?.status==='completed'?'待确认方向':'待讨论');}
 for(const [id,step] of [['literature',r?.literature],['benchmark',r?.protocol]]){
  if(!valid){if(r)set(id,'ready','要求已更新');continue;}
  const labels={completed:['done',id==='literature'?'调研已记录':'协议已形成'],running:['running','CC 正在整理'],blocked:['blocked','缺少必要材料'],failed:['paused','调用失败'],interrupted:['paused','待继续']};
  if(labels[step?.status])set(id,...labels[step.status],id==='literature'&&step.data?`${step.data.papers.length} 篇来源 · ${step.data.methods.length} 个方法`:id==='benchmark'&&step.data?`${step.data.baselines.length} 个对照 · ${step.data.metrics.length} 项指标`:undefined);
 }
 if(p.executionPlan&&!tasks.some(t=>t.researchStage==='design')){
  const current=p.executionPlan.benchmarkRunId===r?.id&&p.executionPlan.requirementsRevision===(p.steering?.revision||0)&&valid;
  set('design',current?'done':'evidence',current?'安排已说明':'已有历史安排');
 }
 const councils={};
 for(const kind of ['results','manuscript']){
  const review=p.stageReviews?.filter(x=>x.kind===kind).at(-1);councils[kind]=review;if(!review)continue;
  const id=councilStage(review),labels={running:['running','三位评委审查中'],paused:['paused','评审待继续'],interrupted:['paused','评审待继续'],failed:['paused','评审调用失败'],changes_requested:['ready','修改后复审'],waiting_user:['blocked','等待你的判断']};
  if(['approved','awaiting_approval'].includes(review.status)){const fresh=councilFresh(p,review),passed=fresh&&review.status==='approved'&&review.userDecision?.action==='approve';set(id,passed?'done':fresh?'blocked':'ready',passed?'用户通过 · 已出环':fresh?'委员通过 · 待你审核':'材料已更新 · 待复审');}
  else if(labels[review.status])set(id,...labels[review.status]);
 }
 for(const id of ['literature','benchmark','design']){const m=meetingState(p,id);if((id==='design'||valid)&&(m.meeting||get(id).status==='done'))set(id,m.status==='proceed'?'done':m.status==='running'?'running':'ready',m.label);}
 const reopened=(p.research?.decisions||[]).filter(d=>d.action==='reopened'&&get(d.stageId)).filter(d=>!reviews.some(v=>v.at>d.at&&stageOfTask(p,v.taskId)===d.stageId));
 for(const d of reopened)set(d.stageId,'ready','已返回此阶段');
 let currentIds=[...new Set(jobs.filter(j=>j.projectId===p.id&&active(j.status)).map(j=>jobStage(p,j)).filter(id=>get(id)))];
 let mode=currentIds.length?'进行中':'当前';
 if(!currentIds.length){
  const decision=p.collaboration?.pendingDecision,review=reviews.find(x=>x.id===decision?.reviewId),round=p.stageReviews?.find(x=>x.id===decision?.councilRoundId);
  if(!p.intakeConfirmed)currentIds=['question'];
  else if(decision){currentIds=[round?councilStage(round):stageOfTask(p,review?.taskId)||'design'];mode='待你处理';}
  else if(!valid||r?.status!=='ready')currentIds=[valid&&r?.literature.status==='completed'&&r.literature.mentorReview?.verdict==='proceed'?'benchmark':'literature'];
  else {
   const unreviewed=tasks.find(t=>t.reportId&&!t.reviewId),pending=tasks.filter(t=>!t.reportId).sort((a,b)=>(b.priority||0)-(a.priority||0));
   const results=tasks.filter(t=>['experiments','analysis'].includes(t.researchStage)||t.councilScopes?.includes('results'));
   const resultsNeedReview=results.length&&results.every(t=>t.reportId&&t.reviewId)&&!(councils.results?.status==='approved'&&councils.results.userDecision?.action==='approve'&&councilFresh(p,councils.results));
   const heldCouncil=Object.values(councils).find(x=>x&&['running','paused','interrupted','failed','waiting_user','awaiting_approval'].includes(x.status)&&councilFresh(p,x));
   if(unreviewed)currentIds=[unreviewed.researchStage];
   else if(heldCouncil)currentIds=[councilStage(heldCouncil)];
   else if(pending.length){const t=pending[0];currentIds=[t.researchStage==='writing'&&resultsNeedReview?'analysis':t.researchStage];}
   else if(reopened.length)currentIds=[reopened.at(-1).stageId];
   else if(resultsNeedReview)currentIds=['analysis'];
   else if(tasks.length){currentIds=[tasks.at(-1).researchStage];mode=['completed','cycle_complete'].includes(p.status)?'本轮停在':'当前';}
   else currentIds=['design'];
  }
  if(mode==='当前'&&['interrupted','failed','paused'].includes(p.status))mode='待继续';
  if(mode==='当前'&&currentIds.some(id=>get(id)?.status==='pending'))mode='下一步';
 }
 currentIds=currentIds.filter(id=>get(id));
 for(const n of nodes){n.current=currentIds.includes(n.id);if(n.current&&mode==='进行中'){n.status='running';n.label='进行中';}}
 const loops=['question','analysis','writing'].map(id=>{
  const proposal=id==='question',r=proposal?p.proposalReviews?.at(-1):councils[id==='analysis'?'results':'manuscript'];
  const fresh=proposal?r?.requirementsRevision===(p.steering?.revision||0)&&!p.proposalReviewRequired:councilFresh(p,r);
  const votes=r?.reviewers?.filter(m=>(proposal?m.verification:m.independent)?.data?.verdict==='ready').length||0;
  const released=proposal?p.intakeConfirmed:r?.status==='approved'&&r.userDecision?.action==='approve'&&fresh;
  const waiting=!released&&fresh&&(proposal?r?.status==='completed'&&votes===3:['awaiting_approval','approved'].includes(r?.status));
  const phase=released?'已出环':waiting?'待你审核':r?.status==='changes_requested'?'修改中':r?.stage==='verification'?'修订稿复审':r?.status==='running'?'委员评审':'循环待继续';
  const n=get(id);n.loop=true;if(r&&!released)n.detail=`第 ${r.number} 轮 · ${votes}/3 委员通过 · ${phase}`;
  if(waiting){n.status='blocked';n.label='委员通过 · 待你审核';}
  return {id,x:n.x+24,y:n.y+118,status:released?'released':waiting?'waiting':'locked',label:released?'✓ 用户通过 · 已出环':waiting?'用户审核 · 等待你':'用户审核 · 委员通过后开放',round:r?.number||0};
 });
 return {nodes,loops,currentIds,mode,currentLabel:currentIds.length?currentIds.map(id=>get(id).title).join(' / '):'历史任务（未分类）',legacyTasks:tasks.filter(t=>!get(t.researchStage)).length};
}

export function pipelinePage(c){
 const {p,esc,noProject}=c;if(!p)return noProject();const model=pipelineOverview(p,c.state.jobs);
 const checkpoints=model.nodes.filter(n=>!model.loops.some(g=>g.id===n.id)).map(n=>({...n,...meetingState(p,n.id)}));
 const connections=model.nodes.slice(1).map((n,i)=>{
  const a=model.nodes[i],same=a.y===n.y,right=n.x>a.x;
  const gate=model.loops.find(g=>g.id===a.id)||checkpoints.find(g=>g.id===a.id);
  const d=same?`M ${a.x+(right?272:0)} ${a.y+66} H ${n.x+(right?0:272)}`:`M ${a.x+136} ${a.y+138} V ${n.y}`;
  return `<path d="${d}" class="map-edge ${gate&&!['released','proceed'].includes(gate.status)?'locked':a.status==='done'?'done':''}" marker-end="url(#stage-arrow)"/>`;
 }).join('');
 const cycles=`<path class="map-return" d="M 64 40 V 20 H 332 V 92 H 312" marker-end="url(#return-arrow)"/><text class="map-loop-label" x="176" y="12">提案修改 ↺ 三位委员复审</text><path class="map-return" d="M 504 408 V 382 H 176 V 408" marker-end="url(#return-arrow)"/><text class="map-loop-label" x="340" y="372">未通过 → 主 CC 安排 CX 修改 → 复审</text><path class="map-return" d="M 720 408 V 382 H 992 V 460 H 968" marker-end="url(#return-arrow)"/><text class="map-loop-label" x="832" y="372">论文修改 ↺ 三位委员复审</text>`;
 return `<section class="pipeline-map" aria-label="科研流程画布"><div class="map-toolbar"><div class="map-current" role="status"><span class="map-live-dot"></span><span>${esc(model.mode)}<strong>${esc(model.currentLabel)}</strong></span></div><div class="map-controls" aria-label="画布控制"><button type="button" data-map-control="out" aria-label="缩小画布">−</button><output class="map-scale" aria-label="当前缩放">100%</output><button type="button" data-map-control="in" aria-label="放大画布">＋</button><button type="button" data-map-control="fit">适应画布</button><button type="button" data-map-control="current" ${model.currentIds.length?'':'disabled'}>定位当前</button></div></div>
 <div class="map-viewport" tabindex="0" role="region" aria-label="流程画布，可拖动或用方向键移动，点击步骤进入详情"><div class="map-world"><svg width="1008" height="570" aria-hidden="true"><defs><marker id="stage-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z"/></marker><marker id="return-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z"/></marker></defs>${connections}${cycles}</svg>
 ${model.nodes.map(n=>{const gate=model.loops.find(g=>g.id===n.id)||checkpoints.find(g=>g.id===n.id);const checkpoint=gate.status==='released'?'用户审核通过':gate.status==='waiting'?'等你审核':model.loops.some(g=>g.id===n.id)?'委员评审 → 用户审核':gate.status==='proceed'?'导师组会通过':gate.status==='revise'?'导师要求修改':gate.status==='blocked'?'等待补充材料':gate.status==='running'?'导师正在判断':'完成后向导师汇报';return `<button type="button" class="map-step ${n.status}${n.current?' is-current':''}" data-x="${n.x}" data-y="${n.y}" data-action="open-stage" data-id="${n.id}" data-current="${n.current}" ${n.current?'aria-current="step"':''} aria-label="${esc(n.title)} · ${n.current?'当前步骤 · ':''}${esc(n.label)} · ${checkpoint}，查看详情"><span class="map-step-top"><span>${String(n.index+1).padStart(2,'0')}</span><span class="map-step-status">${n.current?'● 当前':n.status==='done'?'已完成':esc(n.label)}</span></span><strong>${esc(n.title)}</strong><span class="map-step-bottom"><span>${esc(n.iterations?`${n.iterations} 次调整 · ${n.detail}`:n.detail)}</span></span><span class="map-checkpoint ${gate.status}"><span>${checkpoint}</span><span aria-hidden="true">↗</span></span></button>`;}).join('')}</div></div>
 <div class="map-foot"><span>点击步骤查看详情 · 虚线表示修改与复审</span><span>${model.legacyTasks?`<button type="button" data-action="open-stage" data-id="unclassified">${model.legacyTasks} 项历史未分类任务 ↗</button>`:'拖动画布 · 滚轮平移'}</span></div></section>`;
}

// Store the camera independently of DOM refreshes and detail-page navigation.
const cameras=new Map();
export function mountPipelineMap(root,key){
 if(!root)return()=>{};
 const viewport=root.querySelector('.map-viewport'),world=root.querySelector('.map-world'),scale=root.querySelector('.map-scale');
 for(const node of root.querySelectorAll('[data-x]')){node.style.left=node.dataset.x+'px';node.style.top=node.dataset.y+'px';}
 const saved=cameras.get(key),camera=saved?{...saved}:{x:0,y:0,k:1,fit:false};let drag=null,ignoreClick=false;
 const clamp=k=>Math.max(.3,Math.min(1.8,k));
 const draw=()=>{world.style.transform=`translate(${camera.x}px,${camera.y}px) scale(${camera.k})`;scale.textContent=Math.round(camera.k*100)+'%';cameras.set(key,{...camera});};
 const focusCurrent=()=>{const node=root.querySelector('.map-step[data-current="true"]');if(!node)return;camera.fit=false;camera.k=Math.max(.85,camera.k);camera.x=viewport.clientWidth/2-(node.offsetLeft+136)*camera.k;camera.y=viewport.clientHeight/2-(node.offsetTop+52)*camera.k;draw();};
 const fit=()=>{camera.fit=true;camera.k=clamp(Math.min((viewport.clientWidth-24)/1008,(viewport.clientHeight-24)/570,1.1));camera.x=(viewport.clientWidth-1008*camera.k)/2;camera.y=(viewport.clientHeight-570*camera.k)/2;draw();};
 const zoom=(factor,x=viewport.clientWidth/2,y=viewport.clientHeight/2)=>{const k=clamp(camera.k*factor),ratio=k/camera.k;camera.x=x-(x-camera.x)*ratio;camera.y=y-(y-camera.y)*ratio;camera.k=k;camera.fit=false;draw();};
 const controls=e=>{const b=e.target.closest('[data-map-control]');if(!b)return;({in:()=>zoom(1.2),out:()=>zoom(1/1.2),fit,current:focusCurrent})[b.dataset.mapControl]?.();};
 const down=e=>{if(e.button!==0||e.target.closest('button'))return;drag={id:e.pointerId,x:e.clientX,y:e.clientY,startX:camera.x,startY:camera.y,moved:false};viewport.setPointerCapture(e.pointerId);viewport.classList.add('dragging');};
 const move=e=>{if(!drag||drag.id!==e.pointerId)return;const dx=e.clientX-drag.x,dy=e.clientY-drag.y;drag.moved||=Math.abs(dx)+Math.abs(dy)>4;camera.x=drag.startX+dx;camera.y=drag.startY+dy;camera.fit=false;draw();};
 const up=e=>{if(!drag||drag.id!==e.pointerId)return;ignoreClick=drag.moved;drag=null;viewport.classList.remove('dragging');if(viewport.hasPointerCapture(e.pointerId))viewport.releasePointerCapture(e.pointerId);};
 const preventClick=e=>{if(ignoreClick){e.preventDefault();e.stopPropagation();ignoreClick=false;}};
 const wheel=e=>{e.preventDefault();camera.fit=false;if(e.ctrlKey||e.metaKey){const b=viewport.getBoundingClientRect();zoom(Math.exp(-e.deltaY*.006),e.clientX-b.left,e.clientY-b.top);}else{camera.x-=e.shiftKey?e.deltaY:e.deltaX;camera.y-=e.shiftKey?0:e.deltaY;draw();}};
 const keyboard=e=>{if(e.target!==viewport)return;const shifts={ArrowLeft:[60,0],ArrowRight:[-60,0],ArrowUp:[0,60],ArrowDown:[0,-60]};if(shifts[e.key]){e.preventDefault();camera.fit=false;camera.x+=shifts[e.key][0];camera.y+=shifts[e.key][1];draw();}else if(['+','=','-','0','Home'].includes(e.key)){e.preventDefault();if(e.key==='0')fit();else if(e.key==='Home')focusCurrent();else zoom(e.key==='-'?1/1.2:1.2);}};
 const focus=e=>{const n=e.target.closest('.map-step,.map-gate');if(!n)return;const a=n.getBoundingClientRect(),b=viewport.getBoundingClientRect();if(a.left<b.left||a.right>b.right||a.top<b.top||a.bottom>b.bottom){camera.fit=false;camera.x=viewport.clientWidth/2-(n.offsetLeft+136)*camera.k;camera.y=viewport.clientHeight/2-(n.offsetTop+52)*camera.k;draw();}};
 root.addEventListener('click',controls);viewport.addEventListener('pointerdown',down);viewport.addEventListener('pointermove',move);viewport.addEventListener('pointerup',up);viewport.addEventListener('pointercancel',up);viewport.addEventListener('click',preventClick,true);viewport.addEventListener('wheel',wheel,{passive:false});viewport.addEventListener('keydown',keyboard);viewport.addEventListener('focusin',focus);
 if(saved)draw();else if(viewport.clientWidth<640)focusCurrent();else fit();
 const observer=new ResizeObserver(()=>{if(camera.fit)fit();});observer.observe(viewport);
 return()=>{observer.disconnect();root.removeEventListener('click',controls);viewport.removeEventListener('pointerdown',down);viewport.removeEventListener('pointermove',move);viewport.removeEventListener('pointerup',up);viewport.removeEventListener('pointercancel',up);viewport.removeEventListener('click',preventClick,true);viewport.removeEventListener('wheel',wheel);viewport.removeEventListener('keydown',keyboard);viewport.removeEventListener('focusin',focus);};
}
