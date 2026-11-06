import {councilNodes,stageCouncilSummary,councilNodeDetails} from './stage-council-ui.js';
import {researchStages} from './research-stages.js';
import {usagePanel} from './team-ui.js';
const stageName=id=>researchStages.find(s=>s.id===id)?.title||'历史任务 / 未分类';
const relations={retry:'修正重试',alternative:'替代方案',next:'推进下一步',verify:'独立验证'};
const assessments={passed:'CC 复核通过',retry:'需要调整',blocked:'等待材料或决策'};

export function collaborationPage(c) {
  const {p,state,panel,esc,button,busy,badge,noProject}=c;
  if(!p)return noProject();
  const co=p.collaboration,auto=p.autonomy?.mode==='auto';
  const jobs=state.jobs.filter(j=>j.projectId===p.id);
  const active=jobs.filter(j=>['running','queued','cancelling'].includes(j.status));
  const last=co.reviews.at(-1),pending=co.pendingDecision;
  const reviewed=p.questions.length>0&&p.questions.every(q=>['approved','rejected'].includes(q.decision))&&p.questions.some(q=>q.decision==='approved');
  const ccReady=state.scan?.clis?.cc?.available;
  let next;
  if(busy(p)) {
    next=`<div class="status-banner"><div><strong>${esc(c.label(p.status))}</strong><p>${esc(active[0]?.title||'等待本轮调用返回。')}</p></div>${button('stop-project','停止本轮','danger')}</div>`;
  } else if(pending) {
    next=panel('CC 需要你的判断',`<form id="decision-form" data-decision="${esc(pending.id)}" class="panel-body"><p class="message-text">${esc(pending.question)}</p>
      ${last?.nextTasks?.length?`<details><summary>查看拟执行的步骤（${last.nextTasks.length}）</summary>${last.nextTasks.map(t=>`<p class="proposal-item"><strong>${esc(t.title)}</strong><br>${esc(t.instructions)}<br>验收 · ${esc(t.acceptance)}</p>`).join('')}</details>`:''}
      <label class="field section-gap"><span>你的决定或补充材料</span><textarea name="message" required maxlength="20000" rows="2"></textarea></label>
      <div class="actions"><button class="primary" name="action" value="approve">确认并继续</button><button name="action" value="revise">请 CC 调整</button></div></form>`);
  } else if(!p.questions.length && !p.tasks.length) {
    next=`<div class="next-action"><strong>下一步 · 形成研究方案</strong><p>CC 将把研究设计中需要你决定的问题整理成问卷。</p>${ccReady?button('brainstorm','请 CC 生成问卷','primary'):'<button type="button" data-view="settings">检查 CC 连接</button>'}</div>`;
  } else if(!reviewed && !p.tasks.length) {
    const count=p.questions.filter(q=>['approved','rejected'].includes(q.decision)).length;
    next=`<div class="next-action"><strong>研究问卷待批阅</strong><p>已确定 ${count} / ${p.questions.length} 项。批阅后即可交给团队执行。</p>${button('goto-review','打开研究问卷','primary')}</div>`;
  } else if(!auto && !p.architecture.confirmed) {
    next=`<div class="next-action"><strong>确认团队分工</strong><p>当前使用辅助模式。与 CC 讨论成员职责后，保存团队分工即可执行。</p>${button('goto-architecture','进入团队','primary')}</div>`;
  } else {
    const complete=co.state==='completed'||['completed','cycle_complete'].includes(p.status);
    const resume=Boolean(p.tasks.length)||['paused','failed','interrupted'].includes(p.status);
    const controls=`<form id="collaborate-form" class="next-action"><strong>${complete?'继续下一轮':resume?'从上次进展继续':'开始研究执行'}</strong>
      <p>${esc(co.pauseReason||(auto?'CC 将按获批方案组队、派工，并在 CX 回报后复核。':'CC 将按已确认的团队分工执行方案。'))}</p>
      <div class="loop-controls"><button class="primary" type="submit">${resume?'继续研究':'开始执行'}</button>
      <details><summary>本轮上限</summary><label class="field"><span>最多自动复核次数</span><input type="number" required name="maxReviews" min="1" max="1000" value="${auto?p.autonomy.maxReviews:co.maxReviews||8}"></label></details></div></form>`;
    next=complete?`<details class="disclosure"><summary>继续此课题</summary>${controls}</details>`:controls;
  }
  const feedback=last?panel(last.checkpoint?'CC 的整项研究复核':'最近一次 CC 反馈',`<div class="recent-feedback"><strong>${esc(last.summary)}</strong><details><summary>查看证据与判断依据</summary><p>${esc(last.evidence)}</p><p>${esc(last.reason)}</p></details>${last.documentId?button('doc','打开反馈文档','',`data-id="${esc(last.documentId)}"`):''}</div>`):'';
  const feed=co.messages.slice(-80).map(m=>`<article class="message"><div class="message-who"><strong class="${m.from==='CC'?'amber':m.from==='研究者'?'green':'cyan'}">${esc(m.from)} → ${esc(m.to)}</strong><time>${new Date(m.at).toLocaleTimeString('zh-CN',{hour12:false})}</time></div><div class="message-text">${esc(m.content)}</div>
    ${m.documentId?button('doc','交接文档','',`data-id="${esc(m.documentId)}"`):''}${m.kind==='user'?`<small class="hint">${m.seenAt?'CC 已读取':'等待 CC 在复核时读取'}</small>`:''}</article>`).join('');
  const stream=panel('团队通信',`<div class="conversation collaboration-messages">${feed||'<p class="hint">执行开始后，这里会显示 CC 的派工、CX 的回报和 CC 的复核。</p>'}</div><div class="panel-body">${button('control-chat','与 CC 实时对话')}</div>`);
  const context=panel('课题记录',`<div class="panel-body"><div class="actions">${p.questions.length?button('goto-review','查看问卷'):''}${p.tasks.length?button('goto-execution','查看 '+p.tasks.length+' 项任务'):''}${button('goto-mentor','立项讨论')}</div></div>`);
  const running=active.length?panel('当前调用',active.map(j=>`<div class="panel-body"><strong>${esc(j.title)}</strong> ${badge(j.status)}<p class="hint">${esc(j.log.at(-1)||'等待 CLI 输出…')}</p>${button('log','查看日志','',`data-id="${esc(j.id)}"`)}</div>`).join('')):'';
  return `${p.proposalReviews?.length||p.proposal&&!p.tasks.length?'<div class="actions section-gap"><button type="button" data-view="mentor">提案与评委会</button></div>':''}${p.error?`<div class="work-notice">${esc(p.error)}</div>`:''}${next}${feedback}${p.stageReviews?.length?'<div class="actions section-gap"><button type="button" data-view="pipeline">查看三位评委的评审、修改与复审轨迹</button></div>':''}<div class="collaboration-layout section-gap"><section>${stream}</section><aside>${running}${context}<details class="disclosure"><summary>CC 与 CX 的 Token 用量</summary>${usagePanel(c,jobs)}</details></aside></div>`;
}

export function graphData(p,filter='all'){
  const allReviews=p.collaboration?.reviews||[];
  const approvals=p.questions.length>0&&p.questions.every(q=>['approved','rejected'].includes(q.decision))&&p.questions.some(q=>q.decision==='approved');
  let nodes=[
    {id:'brief',title:'确认研究方向',kind:'approval',owner:'研究者',status:p.intakeConfirmed?'approved':'pending',parents:[],detail:p.researchTopic||'研究者与 CC 澄清目标、材料与约束。'},
    {id:'questionnaire',title:'生成研究问卷',kind:'feedback',owner:'CC',status:p.questions.length?'returned':p.status==='brainstorming'?'running':'pending',parents:['brief'],detail:'CC 组织讨论，形成研究设计问卷。'},
    {id:'approval',title:'批阅研究方案',kind:'approval',owner:'研究者',status:approvals?'approved':'pending',parents:['questionnaire'],detail:'研究者逐项决定哪些方案可以执行。'}
  ];
  const reviewSources=new Map(allReviews.map(r=>[r.id,r.taskId]));
  for(const t of p.tasks){
    const dependencies=(t.dependsOn||[]).filter(id=>!t.parentReviewId||id!==reviewSources.get(t.parentReviewId));
    const parents=[...new Set([...(t.parentReviewId?[t.parentReviewId]:[]),...(t.councilApprovalIds||[]),...dependencies])];
    nodes.push({id:t.id,title:`T${t.index} · ${t.title}`,kind:'task',status:t.status==='completed'?'returned':t.status,
      parents:parents.length?parents:['approval'],relation:relations[t.relation]||'执行',owner:p.architecture.workers.find(w=>w.id===t.workerId)?.name||'CX',detail:t.instructions||'',task:t});
  }
  for(const r of allReviews.filter(r=>!r.councilRoundId))nodes.push({id:r.id,title:r.checkpoint?'整项研究复核':`复核 T${p.tasks.find(t=>t.id===r.taskId)?.index||'?'} · ${assessments[r.assessment]||r.assessment}`,kind:'feedback',status:r.assessment,parents:[r.taskId],owner:'CC',relation:r.checkpoint?'整体检查':'回报 → 复核',detail:r.summary+'\n\n'+r.reason,review:r});
  nodes.push(...councilNodes(p));
  const proposalRound=p.proposalReviews?.at(-1);if(proposalRound)nodes.find(n=>n.id==='brief').parents=[`council-${proposalRound.id}-lead`];
  if(filter!=='all'){
    const ids=new Set(p.tasks.filter(t=>(t.researchStage||'unclassified')===filter).map(t=>t.id));
    const visible=new Set([...ids,...allReviews.filter(r=>ids.has(r.taskId)).map(r=>r.id),...nodes.filter(n=>n.councilStages?.includes(filter)).map(n=>n.id)]);
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
  const edges=nodes.flatMap(n=>n.parents.map(id=>({from:map.get(id)||map.get('approval'),to:n,label:n.relation||''}))).filter(e=>e.from!==e.to);
  return{nodes,edges,width,height:Math.max(200,levels.length*164+24)};
}

export function pipelinePage(c,selected='',filter='all',layout='graph'){
  const {p,head,panel,button,esc,badge,busy,noProject}=c;if(!p)return noProject();
  const g=graphData(p,filter),chosen=g.nodes.find(n=>n.id===selected),stage=researchStages.find(s=>s.id===filter);
  const stageStatus=s=>{const council=(p.stageReviews||[]).filter(r=>(s.id==='writing'?r.kind==='manuscript':['experiments','analysis'].includes(s.id)?r.kind==='results':false)).at(-1);if(council&&['running','paused','failed','interrupted','changes_requested','waiting_user'].includes(council.status))return ({running:'三位 CC 评委评审中',paused:'评审暂停 / 可继续',failed:'评审失败 / 可重试',interrupted:'评审中断 / 可继续',changes_requested:'CX 修改后复审',waiting_user:'评审等待研究者判断'}[council.status]);const decision=(p.research?.decisions||[]).filter(d=>d.stageId===s.id).at(-1),tasks=p.tasks.filter(t=>t.researchStage===s.id),changed=tasks.some(t=>(t.createdAt||'')>(decision?.at||'')||(p.collaboration?.reviews||[]).some(r=>r.taskId===t.id&&r.at>(decision?.at||'')));return decision?.action==='confirmed'&&!changed?'研究者已确认':tasks.some(t=>t.status==='running')?'进行中':council?.status==='approved'?'评委会通过 / 待研究判断':tasks.some(t=>t.reportId)?'已有证据 / 待判断':decision?.action==='reopened'?'重新研究':s.id==='question'&&p.intakeConfirmed?'已有初步方向':s.id==='question'&&p.status==='chatting'?'澄清中':s.id==='design'&&p.status==='brainstorming'?'CC 正在梳理设计':s.id==='design'&&p.questions.length?'已有决策问卷':'待开展';};
  const svg=`<div class="pipeline-canvas" tabindex="0" aria-label="实际执行流程图，可滚动并点击节点"><svg width="${g.width}" height="${g.height}" viewBox="0 0 ${g.width} ${g.height}" role="group" aria-label="真实任务与反馈分支"><defs><marker id="flow-arrow" markerWidth="7" markerHeight="7" refX="6" refY="3.5" orient="auto"><path d="M0,0 L7,3.5 L0,7 Z"/></marker></defs>${g.edges.map(e=>{const x1=e.from.x+126,y1=e.from.y+112,x2=e.to.x+126,y2=e.to.y;return `<path class="flow-edge ${e.to.task?.relation||''}" marker-end="url(#flow-arrow)" d="M${x1},${y1} C${x1},${y1+26} ${x2},${y2-26} ${x2},${y2}"/><text class="edge-label" x="${x2+8}" y="${y2-8}">${esc(e.label)}</text>`;}).join('')}${g.nodes.map(n=>`<foreignObject x="${n.x}" y="${n.y}" width="252" height="112"><button xmlns="http://www.w3.org/1999/xhtml" class="flow-node ${n.kind} ${n.status} ${chosen?.id===n.id?'selected':''}" data-action="pipeline-node" data-id="${n.id}" aria-label="展开 ${esc(n.title)}"><span class="flow-node-meta">${esc(n.owner||'研究者')}${n.context?' · 前置步骤':''} · ${esc(assessments[n.status]||({returned:'结果已回报'}[n.status])||c.badge(n.status).replace(/<[^>]+>/g,''))}</span><strong>${esc(n.title)}</strong><small>点击展开证据与下一步 ↗</small></button></foreignObject>`).join('')}</svg></div>`;
  const names=new Map(g.nodes.map(n=>[n.id,n.task?'T'+n.task.index:n.title]));
  const list=`<ol class="trace-list">${[...g.nodes].sort((a,b)=>a.depth-b.depth).map(n=>{
    const predecessors=n.parents.map(id=>names.get(id)).filter(Boolean);
    return `<li><button type="button" data-action="pipeline-node" data-id="${esc(n.id)}" aria-pressed="${chosen?.id===n.id}"><span class="trace-meta">${esc(n.owner)} · ${esc(c.label(n.status))}${n.context?' · 前置步骤':''}</span><strong>${esc(n.title)}</strong>
      ${predecessors.length?`<small>${esc(predecessors.join('、'))} → ${esc(n.relation||'下一步')}</small>`:''}</button></li>`;
  }).join('')}</ol>`;
  const layoutPicker=`<div class="layout-picker" aria-label="轨迹显示方式">${[['graph','流程图'],['list','步骤列表']].map(([id,name])=>`<button type="button" data-action="trace-layout" data-id="${id}" aria-pressed="${id===layout}">${name}</button>`).join('')}</div>`;
  const plan=p.pipeline||p.proposal?.pipeline||[];
  const filters=`<label class="graph-filters" for="pipeline-filter">科研阶段 <select id="pipeline-filter">${[['all','全部阶段'],...researchStages.map(s=>[s.id,s.title+' · '+stageStatus(s)]),['unclassified','历史未分类任务']].map(([id,name])=>`<option value="${id}" ${filter===id?'selected':''}>${esc(name)}</option>`).join('')}</select></label>`;
  return `<div class="heading"><div><h2>研究轨迹</h2><p class="page-intro">${p.tasks.length} 项任务 · ${p.collaboration?.reviews?.length||0} 次复核</p></div></div>
    ${plan.length?`<details class="disclosure"><summary>${p.intakeConfirmed?'课题研究计划':'CC 提议的研究计划'} · ${plan.length} 步</summary><div class="panel-body">${plan.map((step,i)=>`<div class="proposal-step"><span class="cyan">${i+1}</span><div><strong>${esc(step.title)}</strong><p>${esc(step.description)}</p></div></div>`).join('')}</div></details>`:''}
    ${stageCouncilSummary(c)}${filters}${layoutPicker}${stage?panel(stage.title,`<div class="panel-body"><p><strong>产出：</strong>${esc(stage.output)}</p><p><strong>进入下一步的依据：</strong>${esc(stage.gate)}</p><p class="hint">${esc(stage.back)}</p><details><summary>记录研究者对此阶段的判断</summary><form id="stage-review-form" data-stage="${stage.id}"><label class="field"><span>依据 / 证据路径 / 需要返回的原因</span><textarea name="comment" required maxlength="10000" rows="3"></textarea></label><div class="actions"><button name="action" value="confirmed" ${busy(p)?'disabled':''}>确认本阶段证据</button><button name="action" value="reopened" ${busy(p)?'disabled':''}>返回此阶段继续研究</button></div></form></details></div>`):''}<div class="section-gap flowchart-section">${panel('执行与反馈',g.nodes.length?(layout==='list'?list:svg):'<p class="panel-body muted">这个阶段还没有任务或复核记录。</p>',`<span class="hint">${g.nodes.filter(n=>n.task||n.review||n.council).length} 个任务/评审/反馈节点</span>`)}</div>${chosen?panel('节点详情',`<div class="panel-body node-inspector" tabindex="-1"><div class="flex"><h2>${esc(chosen.title)}</h2>${badge(chosen.status)}</div><p class="message-text">${esc(chosen.detail)}</p>${chosen.council?councilNodeDetails(c,chosen):''}${chosen.task?`<p class="hint">科研阶段：${esc(stageName(chosen.task.researchStage))} · ${esc(chosen.owner)}</p><p>验收：${esc(chosen.task.acceptance||'见任务文档')}</p>${chosen.task.error?`<p class="red">${esc(chosen.task.error)}</p>`:''}<div class="actions">${button('doc','任务 MD','',`data-id="${chosen.task.documentId}"`)}${chosen.task.reportId?button('doc','结果 MD','',`data-id="${chosen.task.reportId}"`):''}${chosen.task.jobId?button('log','运行日志','',`data-id="${chosen.task.jobId}"`):''}${button('open-session','进入 CX 会话','',`data-id="${chosen.task.workerId}"`)}</div>`:''}${chosen.review?`<p><strong>证据：</strong>${esc(chosen.review.evidence)}</p><p><strong>给团队的交接：</strong>${esc(chosen.review.handoff)}</p><p>${esc(chosen.review.question)}</p>${chosen.review.userDecision?`<p class="green">研究者：${esc(chosen.review.userDecision.content)}</p>`:''}${button('doc','反馈 MD','',`data-id="${chosen.review.documentId}"`)}`:''}</div>`):'<p class="hint">选择上方节点，查看原因、证据、输出和交接文件。</p>'}<details class="research-guide"><summary>展开完整科研流程说明</summary>${researchStages.map(s=>`<article class="team-proposal"><h3>${s.title}</h3><p>产出：${s.output}</p><p>判断：${s.gate}</p><p class="hint">${s.back}</p></article>`).join('')}<p class="hint">这是面向实证/计算研究的工作框架，具体课题按研究设计调整。理论证明、质性研究等不能机械套用实验分支。</p></details>`;
}
