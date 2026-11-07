import {mentorPanel,meetingNodes,meetingDetails} from './mentor-ui.js';
import {pipelineOverview,mapStages} from './pipeline-map.js';
export {pipelinePage} from './pipeline-map.js';
import {benchmarkSummary,benchmarkNodes,benchmarkNodeDetails,benchmarkCurrent} from './benchmark-ui.js';
import {councilNodes,stageCouncilSummary,councilNodeDetails,decisionPanel} from './stage-council-ui.js';
import {researchStages} from './research-stages.js';
import {usagePanel} from './team-ui.js';
const stageName=id=>researchStages.find(s=>s.id===id)?.title||'历史任务 / 未分类';
const relations={retry:'修正重试',alternative:'替代方案',next:'推进下一步',verify:'独立验证'};
const assessments={passed:'CC 复核通过',retry:'需要调整',blocked:'等待材料或决策'};

export function collaborationPage(c) {
 const {p,state,panel,esc,button,busy,noProject}=c;if(!p)return noProject();
 const co=p.collaboration,auto=p.autonomy?.mode==='auto',jobs=state.jobs.filter(j=>j.projectId===p.id),active=jobs.filter(j=>['running','queued','cancelling'].includes(j.status));
 const overview=pipelineOverview(p,jobs),stage=overview.currentIds[0]||'question',pending=co.pendingDecision,complete=co.state==='completed'||['completed','cycle_complete'].includes(p.status);
 const resume=Boolean(p.tasks.length)||['paused','failed','interrupted'].includes(p.status),last=co.reviews.at(-1),meeting=p.mentorMeetings?.filter(m=>m.status==='completed').at(-1);
 const cut=(s,n=180)=>{s=String(s||'');return s.length>n?s.slice(0,n)+'…':s;};
 let title,description,action;
 if(busy(p)){title='研究进行中';description=active[0]?.title||'CC 正在安排下一步工作。';action=button('stop-project','暂停研究');}
 else if(pending){title='有一项决定需要你';description=pending.type==='stage-approval'?'三位委员已通过，请审核当前材料。':'CC 需要你的意见，才能继续推进。';action=button('reveal-panel','查看并回复','primary','data-id="research-decision"');}
 else if(!p.intakeConfirmed){title='先和导师明确研究方向';description='说说你的想法，CC 会帮你完善研究方案。';action=button('goto-mentor','讨论研究方向','primary');}
 else if(!state.scan?.clis?.cc?.available||!state.scan?.clis?.cx?.available){title='连接你的研究助手';description='连接本机 Claude Code 和 Codex 后即可开始。';action='<button type="button" class="primary" data-view="settings">连接设置</button>';}
 else if(!auto&&!p.architecture.confirmed){title='先确定团队分工';description='确认 CX 的数量和职责，或让 CC 自主安排。';action=button('goto-architecture','设置团队','primary');}
 else{title=complete?'这一轮已完成':resume?'继续这项研究':'从第一步开始';description=complete?'查看导师判断，也可以继续讨论和补充要求。':cut(co.pauseReason||'CC 会先说明安排，再组织团队执行并逐步汇报。');action='<form id="collaborate-form"><button class="primary" type="submit">'+(resume||complete?'继续研究':'开始研究')+'</button><details class="run-options"><summary>运行选项</summary><label class="field"><span>本轮最多复核次数</span><input type="number" name="maxReviews" required min="1" max="1000" value="'+(auto?p.autonomy.maxReviews:co.maxReviews||8)+'"></label></details></form>';}
 const primary='<section class="research-focus" aria-label="当前研究与下一步"><div class="focus-label"><span class="status-dot '+(busy(p)?'active':'')+'"></span>当前步骤 · '+esc(overview.currentLabel)+'</div><h2>'+title+'</h2><p>'+esc(description)+'</p><div class="focus-actions">'+action+button('control-chat','和 CC 聊聊','quiet-button')+'</div></section>';
 const latest=[last&&{summary:last.summary,detail:last.reason,documentId:last.documentId,at:last.at},meeting&&{summary:meeting.data.summary,detail:meeting.data.direction,documentId:meeting.documentId,at:meeting.completedAt}].filter(Boolean).sort((a,b)=>String(a.at||'').localeCompare(String(b.at||''))).at(-1);
 const focusReport='<section class="overview-note"><div class="section-label">导师最新判断</div><h3>'+esc(latest?cut(latest.summary,85):'每一步，都和导师对齐方向')+'</h3><p>'+esc(latest?cut(latest.detail):'完成一步后，CC 核对证据并决定继续或修改。汇报和判断会保存在这里。')+'</p>'+(latest?.documentId?button('doc','查看完整汇报 →','quiet-button','data-id="'+esc(latest.documentId)+'"'):button('open-stage','查看当前步骤 →','quiet-button','data-id="'+esc(stage)+'"'))+'</section>';
 const notice=p.executionPlan?'<details class="simple-disclosure"><summary>CC 的执行安排</summary><div class="detail-body"><h3>接下来做什么</h3><p class="message-text">'+esc(p.executionPlan.summary)+'</p><h3>为什么这样做</h3><p class="message-text">'+esc(p.executionPlan.rationale)+'</p>'+button('doc','完整执行说明','quiet-button','data-id="'+esc(p.executionPlan.documentId)+'"')+'</div></details>':'';
 const activity=co.messages.filter(m=>!['feedback','reviewing','mentor-meeting','leadership'].includes(m.kind)).slice(-3).reverse().map(m=>'<article class="activity-row"><span class="activity-mark">'+esc(m.from.startsWith('CX')?'CX':m.from.includes('CC')?'CC':'你')+'</span><div><div class="activity-meta"><strong>'+esc(m.from)+'</strong><time>'+new Date(m.at).toLocaleTimeString('zh-CN',{hour12:false,hour:'2-digit',minute:'2-digit'})+'</time></div><p>'+esc(cut(String(m.content||'').replace(/^#{1,6}\s+/gm,'').replace(/\*\*/g,''),135))+'</p>'+(m.documentId?button('doc','查看记录','quiet-button','data-id="'+esc(m.documentId)+'"'):'')+'</div></article>').join('');
 const feed=co.messages.slice(-80).map(m=>'<article class="message"><div class="message-who"><strong>'+esc(m.from)+' → '+esc(m.to)+'</strong><time>'+new Date(m.at).toLocaleString('zh-CN',{hour12:false})+'</time></div><div class="message-text">'+esc(m.content)+'</div>'+(m.documentId?button('doc','查看文档','quiet-button','data-id="'+esc(m.documentId)+'"'):'')+'</article>').join('');
 const recent='<section class="activity-section"><div class="section-heading"><h2>最近动态</h2>'+button('goto-pipeline','查看研究流程 →','quiet-button')+'</div>'+(activity||'<div class="empty-activity">还没有执行记录。研究开始后，这里会显示团队的最新进展。</div>')+'</section>';
 const records='<div class="research-records">'+notice+'<details class="simple-disclosure"><summary>研究依据与评测方案</summary>'+benchmarkSummary(c)+'</details><details class="simple-disclosure"><summary>完整通信记录'+(co.messages.length?' · '+co.messages.length:'')+'</summary><div class="conversation collaboration-messages">'+(feed||'<p class="hint">暂无通信记录。</p>')+'</div></details><details class="simple-disclosure"><summary>用量与运行日志</summary>'+usagePanel(c,jobs)+jobs.slice(0,12).map(j=>'<div class="compact-job"><span>'+esc(j.title)+'</span>'+button('log','日志','quiet-button','data-id="'+esc(j.id)+'"')+'</div>').join('')+'</details></div>';
 const links='<nav class="secondary-links" aria-label="更多课题内容">'+button('goto-mentor','研究提案','quiet-button')+button('goto-execution','全部任务','quiet-button')+(p.questions.length?button('goto-review','历史决定','quiet-button'):'')+'</nav>';
 return '<div class="research-overview">'+primary+(pending?'<section id="research-decision" class="decision-area">'+decisionPanel(c)+'</section>':'')+(p.error&&!['interrupted','cancelled'].includes(p.status)?'<p class="work-notice">'+esc(p.error)+'</p>':'')+focusReport+recent+records+links+'</div>';
}

export function graphData(p,filter='all'){
  const allReviews=p.collaboration?.reviews||[];
  const notices=p.executionPlans?.length?p.executionPlans:p.executionPlan?[p.executionPlan]:[];
  let nodes=[{id:'brief',title:'确认研究方向',kind:'approval',owner:'研究者',status:p.intakeConfirmed?'approved':'pending',parents:[],detail:p.researchTopic||'研究者与 CC 澄清目标、材料与约束。'}];
  const evidenceNodes=benchmarkNodes(p);nodes.push(...evidenceNodes);
  const benchmarkParent=id=>id&&evidenceNodes.some(n=>n.id===`benchmark-${id}-protocol`)?`benchmark-${id}-protocol`:evidenceNodes.at(-1)?.id||'brief';
  for(const n of notices)nodes.push({id:'plan-'+n.id,title:'CC 说明执行安排与理由',kind:'feedback',owner:'CC',status:'returned',parents:[n.benchmarkRunId?benchmarkParent(n.benchmarkRunId):'brief'],detail:n.summary+'\n\n为什么这样做：\n'+n.rationale,notice:n});
  if(!notices.length&&!p.tasks.length)nodes.push({id:'execution-plan',title:'CC 说明安排后推进',kind:'feedback',owner:'CC',status:['collaborating','planning'].includes(p.status)&&p.benchmarkResearch?.runs?.at(-1)?.status==='ready'?'running':'pending',parents:[benchmarkParent()],detail:'说明接下来做什么、为什么这样做和验证方式，随后组织 CX 执行。'});
  const reviewSources=new Map(allReviews.map(r=>[r.id,r.taskId]));
  for(const t of p.tasks){
    const dependencies=(t.dependsOn||[]).filter(id=>!t.parentReviewId||id!==reviewSources.get(t.parentReviewId));
    const parents=[...new Set([...(t.parentReviewId?[t.parentReviewId]:[]),...(t.councilApprovalIds||[]),...dependencies])];
    nodes.push({id:t.id,title:`T${t.index} · ${t.title}`,kind:'task',status:t.status==='completed'?'returned':t.status,
      parents:[...new Set([...(parents.length?parents:[notices.find(n=>n.taskIds?.includes(t.id))?'plan-'+notices.find(n=>n.taskIds?.includes(t.id)).id:'brief']),...(t.benchmarkRunId&&!notices.some(n=>n.taskIds?.includes(t.id)&&n.benchmarkRunId===t.benchmarkRunId)?[benchmarkParent(t.benchmarkRunId)]:[])])],relation:relations[t.relation]||'执行',owner:p.architecture.workers.find(w=>w.id===t.workerId)?.name||'CX',detail:t.instructions||'',task:t});
  }
  for(const r of allReviews.filter(r=>!r.councilRoundId))nodes.push({id:r.id,title:r.checkpoint?'整项研究复核':`导师组会 T${p.tasks.find(t=>t.id===r.taskId)?.index||'?'} · ${assessments[r.assessment]||r.assessment}`,kind:'feedback',researchStage:p.tasks.find(t=>t.id===r.taskId)?.researchStage||'unclassified',status:r.assessment,parents:[r.taskId],owner:'CC',relation:r.checkpoint?'整体检查':'回报 → 复核',detail:r.summary+'\n\n'+r.reason,review:r});
  nodes.push(...councilNodes(p),...meetingNodes(p));
  const proposalRound=p.proposalReviews?.at(-1);if(proposalRound)nodes.find(n=>n.id==='brief').parents=[`council-${proposalRound.id}-lead`];
  if(filter!=='all'){
    const ids=new Set(p.tasks.filter(t=>(t.researchStage||'unclassified')===filter).map(t=>t.id));
    const visible=new Set([...ids,...allReviews.filter(r=>ids.has(r.taskId)).map(r=>r.id),...nodes.filter(n=>n.researchStage===filter||n.councilStages?.includes(filter)||n.benchmarkStages?.includes(filter)).map(n=>n.id)]);
    const parents=new Set(nodes.filter(n=>visible.has(n.id)).flatMap(n=>n.parents));
    nodes=nodes.filter(n=>visible.has(n.id)||parents.has(n.id));
    for(const n of nodes)if(!visible.has(n.id)){n.context=true;n.parents=[];}
  }
  const map=new Map(nodes.map(n=>[n.id,n]));
  for(const n of nodes)n.parents=n.parents.filter(id=>map.has(id));
  const depth=(n,visited=new Set())=>{if(n.depth!==undefined)return n.depth;if(visited.has(n.id))return 0;visited.add(n.id);n.depth=!n.parents.length?0:1+Math.max(0,...n.parents.filter(id=>map.has(id)).map(id=>depth(map.get(id),new Set(visited))));return n.depth;};
  for(const n of nodes)depth(n);
  const levels=[];for(const n of nodes)(levels[n.depth]||=[]).push(n);
  const width=Math.max(284,...levels.map(l=>(l?.length||0)*276+40));
  for(const level of levels)if(level)level.forEach((n,i)=>{n.x=(width-level.length*276)/2+i*276+8;n.y=n.depth*164+24;});
  const edges=nodes.flatMap(n=>n.parents.map(id=>({from:map.get(id)||map.get('brief'),to:n,label:n.relation||''}))).filter(e=>e.from!==e.to);
  return{nodes,edges,width,height:Math.max(200,levels.length*164+24)};
}

export function stageDetailPage(c,selected='',filter='question'){
 const {p,panel,button,esc,badge,busy,noProject}=c;if(!p)return noProject();
 const stage=researchStages.find(s=>s.id===filter),overview=pipelineOverview(p,c.state.jobs),step=overview.nodes.find(s=>s.id===filter);
 if(!stage&&filter!=='unclassified')return stageDetailPage(c,selected,'question');
 const g=graphData(p,filter),chosen=g.nodes.find(n=>n.id===selected),title=step?.title||'历史未分类任务';
 let part='';
 if(filter==='question')part=panel('研究方向与提案',`<div class="panel-body"><p class="message-text">${esc(p.researchTopic||p.brief||'与 CC 讨论研究目标、已有材料与边界。')}</p><div class="actions section-gap"><button data-view="mentor">打开立项讨论与提案评审 ↗</button></div></div>`);
 if(['literature','benchmark'].includes(filter))part=benchmarkSummary(c,filter);
 if(filter==='design')part=panel('CC 的执行安排',`<div class="panel-body">${p.executionPlan?`<h3>接下来做什么</h3><p class="message-text">${esc(p.executionPlan.summary)}</p><h3>为什么这样做</h3><p class="message-text">${esc(p.executionPlan.rationale)}</p>${button('doc','完整执行说明','',`data-id="${esc(p.executionPlan.documentId)}"`)}`:'<p class="hint">文献和评测方案形成后，CC 说明执行安排并组织团队。</p>'}<div class="actions section-gap"><button data-view="architecture">团队、模型与技能 ↗</button><button data-view="collaboration">进入协作台 ↗</button></div></div>`);
 if(['analysis','writing'].includes(filter))part=stageCouncilSummary(c,filter==='analysis'?'results':'manuscript');
 const records=g.nodes.filter(n=>!n.context),contextNodes=g.nodes.filter(n=>n.context);
 const row=n=>`<button type="button" class="stage-record ${n.id===selected?'selected':''}" data-action="pipeline-node" data-id="${esc(n.id)}" ${n.id===selected?'aria-current="true"':''}><span><strong>${esc(n.title)}</strong><small>${esc(n.owner||'CC')} · ${esc(n.relation||'阶段记录')}</small></span>${badge(n.status)}<span aria-hidden="true">↗</span></button>`;
 const history=panel('本步骤的任务、反馈与版本',records.length?records.map(row).join(''):'<p class="panel-body hint">此步骤还没有实际执行记录。开始后，任务、回报和评审会保存在这里。</p>');
 let detail='';
 if(chosen){
  let body=`<div class="flex"><h2>${esc(chosen.title)}</h2>${badge(chosen.status)}</div><p class="message-text">${esc(chosen.detail)}</p>`;
  if(chosen.notice)body+=button('doc','执行说明 MD','',`data-id="${esc(chosen.notice.documentId)}"`);
  if(chosen.benchmark)body+=benchmarkNodeDetails(c,chosen);
  if(chosen.council)body+=councilNodeDetails(c,chosen);
  if(chosen.meeting)body+=meetingDetails(c,chosen.meeting);
  if(chosen.task){const t=chosen.task;body+=`<p class="hint">${esc(stageName(t.researchStage))} · ${esc(chosen.owner)}</p><p>验收：${esc(t.acceptance||'见任务文档')}</p>${t.error?`<p class="red">${esc(t.error)}</p>`:''}<div class="actions">${t.documentId?button('doc','任务 MD','',`data-id="${esc(t.documentId)}"`):''}${t.reportId?button('doc','结果 MD','',`data-id="${esc(t.reportId)}"`):''}${t.jobId?button('log','运行日志','',`data-id="${esc(t.jobId)}"`):''}${button('open-session','进入 CX 会话','',`data-id="${esc(t.workerId)}"`)}</div>`;}
  if(chosen.review){const r=chosen.review;body+=`<p><strong>证据：</strong>${esc(r.evidence)}</p><p><strong>共享交接：</strong>${esc(r.handoff)}</p>${r.question?`<p>${esc(r.question)}</p>`:''}${r.userDecision?`<p class="green">研究者：${esc(r.userDecision.content)}</p>`:''}${r.documentId?button('doc','反馈 MD','',`data-id="${esc(r.documentId)}"`):''}`;}
  detail=panel('记录详情',`<div class="panel-body node-inspector" tabindex="-1">${body}</div>`);
 }
 const links=g.edges.filter(e=>!e.to.context).map(e=>`<li>${button('pipeline-node',esc(e.from.title),'',`data-id="${esc(e.from.id)}"`)}<span>→ ${esc(e.label||'下一步')} →</span>${button('pipeline-node',esc(e.to.title),'',`data-id="${esc(e.to.id)}"`)}</li>`).join('');
 return `<div class="stage-breadcrumb"><button type="button" data-view="pipeline">← 返回研究流程</button><span>${step?`STEP ${String(step.index+1).padStart(2,'0')} / ${mapStages.length}`:'历史记录'}</span></div><div class="heading"><div><h2>${esc(title)}</h2><p class="page-intro">${esc(stage?.output||'保留历史任务，不根据名称猜测科研阶段。')}</p></div><span class="stage-detail-status">${step?.current?'● 当前步骤 · ':''}${esc(step?.label||'历史记录')}</span></div>
 ${filter!=='question'&&filter!=='unclassified'?mentorPanel(c,filter):''}${part}<div class="stage-records">${detail}${history}</div>${links?`<details class="disclosure"><summary>查看本步骤的交接、调整与返回关系</summary><ul class="stage-relations">${links}</ul></details>`:''}${contextNodes.length?`<details class="disclosure"><summary>关联的前置记录</summary>${contextNodes.map(row).join('')}</details>`:''}
 ${stage?`<details class="disclosure"><summary>阶段说明与研究者判断</summary><div class="panel-body"><p>进入下一步的依据：${esc(stage.gate)}</p><p class="hint">${esc(stage.back)}</p><form id="stage-review-form" data-stage="${stage.id}"><label class="field"><span>记录判断依据或返回原因（可选）</span><textarea name="comment" required maxlength="10000" rows="3"></textarea></label><div class="actions"><button name="action" value="confirmed" ${busy(p)?'disabled':''}>记录本阶段判断</button><button name="action" value="reopened" ${busy(p)?'disabled':''}>返回此阶段继续研究</button></div></form></div></details>`:''}`;
}
