import {usageText} from './team-ui.js';
const titles={proposal:'提案',results:'实验结果',manuscript:'论文初稿'};
const statusNames={pending:'等待评审',running:'评委会进行中',paused:'评审已暂停',interrupted:'评审已中断',failed:'评审调用失败',changes_requested:'CX 修改后复审',waiting_user:'等待研究者判断',approved:'评委会通过',completed:'已完成',superseded:'材料已更新'};
const actions={fix:'安排 CX 修改',dismiss:'说明不需修改的依据',ask_user:'研究者判断',adopted:'采纳',partial:'部分采纳',deferred:'暂缓',rejected:'不采纳'};
const positions={agree:'同意',disagree:'不同意',refine:'补充修正'};
export function councilNodes(p){
  const nodes=[],rounds=[...(p.proposalReviews||[]).map(r=>({...r,kind:'proposal'})),...(p.stageReviews||[])];
  for(const r of rounds){
    const proposal=r.kind==='proposal',prefix=`council-${r.id}`,prior=rounds.find(x=>x.id===r.previousRoundId),sourceParents=proposal?[]:(r.source?.evidence||[]).map(e=>e.reviewId||e.taskId);
    const upstream=rounds.find(x=>x.id===r.source?.upstream);
    if(prior)sourceParents.push(prior.leadReviewId||`council-${prior.id}-lead`);
    if(upstream)sourceParents.push(upstream.leadReviewId);
    const stages=proposal?['design']:r.kind==='results'?['experiments','analysis']:['writing'];
    const add=node=>nodes.push({...node,council:r,councilStages:stages,kind:'council'});
    add({id:prefix+'-source',title:`${titles[r.kind]} R${r.number} · 送审材料`,owner:'主 CC',status:'returned',parents:[...new Set(sourceParents)],relation:prior?'修改回报 → 再次送审':'材料齐备 → 送审',detail:'本轮冻结的送审材料与版本，后续轮次保留独立记录。',councilPhase:'source',documentId:r.sourceDocumentId||r.sourceDocId});
    const independent=r.reviewers.map(m=>`${prefix}-${m.id}-independent`);
    const cross=r.reviewers.map(m=>`${prefix}-${m.id}-cross`);
    for(const [i,m] of r.reviewers.entries()){
      add({id:independent[i],title:`${titles[r.kind]} R${r.number} · ${m.role}`,owner:m.name,status:m.independent.status,parents:[prefix+'-source'],relation:'独立评审',detail:m.independent.data?.summary||m.independent.error||'等待该评委审查本轮材料。',councilPhase:'independent',member:m,step:m.independent});
      add({id:cross[i],title:`${titles[r.kind]} R${r.number} · ${m.name} 互评`,owner:m.name,status:m.cross.status,parents:independent,relation:'三份意见 → 交叉互评',detail:m.cross.data?.summary||m.cross.error||'三位独立评审完成后，回应另外两位评委的意见。',councilPhase:'cross',member:m,step:m.cross});
    }
    add({id:r.leadReviewId||prefix+'-lead',title:`${titles[r.kind]} R${r.number} · ${proposal?'主导师修订':r.status==='approved'?'评委会通过':'主 CC 修改决策'}`,owner:'主 CC',status:({approved:'passed',changes_requested:'retry',waiting_user:'blocked',superseded:'superseded'}[r.status]||r.synthesis.status),parents:cross,relation:'综合意见 → 指导与派工',detail:r.synthesis.data?.summary||r.synthesis.data?.message||r.error||'主 CC 将逐条回应评审意见并决定下一步。',councilPhase:'synthesis',step:r.synthesis});
  }
  return nodes;
}
export function stageCouncilSummary(c){
  const {p,esc,button,busy,panel}=c;
  const cards=['results','manuscript'].map(kind=>{
    const rounds=(p.stageReviews||[]).filter(r=>r.kind===kind),r=rounds.at(-1);
    const hint=r?`${statusNames[r.status]||r.status} · 第 ${r.number} 轮`:kind==='results'?'正式实验与分析回报齐备后自动送审':'论文初稿及相关修改回报齐备后自动送审';
    const tasks=r?(r.createdTaskIds||[]).map(id=>p.tasks.find(t=>t.id===id)).filter(Boolean):[];
    const progress=tasks.length?`修改回报 ${tasks.filter(t=>t.reportId).length} / ${tasks.length}`:'';
    return `<article class="stage-council-card"><h3>${titles[kind]} · 三位 CC 评委</h3><p>${esc(hint)}</p>${progress?`<p class="hint">${progress} · 完成后重新评审</p>`:''}${r?.error?`<p class="hint red">${esc(r.error)}</p>`:''}<div class="actions">${r?button('council-node','查看本轮意见与修改','',`data-id="${esc(r.leadReviewId)}"`):''}${rounds.length>1?`<details><summary>${rounds.length} 轮历史</summary>${rounds.map(x=>button('council-node',`第 ${x.number} 轮 · ${statusNames[x.status]||x.status}`,'',`data-id="${esc(x.leadReviewId)}"`)).join('')}</details>`:''}</div></article>`;
  }).join('');
  const ready=p.intakeConfirmed&&p.questions.length&&p.questions.every(q=>['approved','rejected'].includes(q.decision))&&p.questions.some(q=>q.decision==='approved');
  return panel('阶段评委会 · 评审 → CX 修改 → 复审',`<div class="panel-body"><div class="stage-council-cards">${cards}</div><p class="hint section-gap">评委意见、主导师处理、修改任务和新版本送审都会出现在下方流程图。每轮三份独立评审、三份互评和一份主导师决策，计入本轮 CC 复核上限；停止后可继续。</p><div class="actions">${busy(p)?button('stop-project','暂停协作与评审','danger'):p.collaboration.pendingDecision?'<button data-view="collaboration">答复评审中的待确认问题</button>':ready?button('continue-council','启动 / 继续评审与修改','primary'):''}</div></div>`);
}
export function councilNodeDetails(c,n){
  const {p,state,esc,button}=c,r=n.council,s=n.step,d=s?.data;
  const jobs=state.jobs.filter(j=>j.reviewRoundId===r.id&&(!n.member||j.reviewerId===n.member.id));
  let content=`<p class="hint">${titles[r.kind]} · 第 ${r.number} 轮 · ${esc(statusNames[r.status]||r.status)} · ${n.member?'本评委':'本轮'} ${esc(usageText(jobs))}</p>`;
  if(n.councilPhase==='source')content+=`<p>此轮材料版本固定，修改后另建一轮。</p>${r.sourceHash?`<p class="path">${esc(r.sourceHash)}</p>`:''}${(r.source?.evidence||[]).map(e=>`<p>T${e.index} · ${esc(e.title)}<br><span class="path">${esc(e.reportPath)}</span></p>`).join('')}`;
  if(d&&n.councilPhase==='independent')content+=`<p>评委判断：${d.verdict==='ready'?'可通过':'需要修改'}</p>${d.concerns.map(i=>`<article class="council-issue"><strong>${esc(i.id)} · ${esc(i.title)}</strong><small>${i.severity==='major'?'主要问题':'次要问题'}</small><p>${esc(i.reason)}</p><p>建议：${esc(i.recommendation)}</p></article>`).join('')||'<p class="hint">本轮未提出需修改的问题。</p>'}`;
  if(d&&n.councilPhase==='cross')content+=d.responses.map(x=>`<article class="council-issue"><strong>${esc(x.issueId)} · ${positions[x.position]}</strong><p>${esc(x.reason)}</p><p>${esc(x.suggestion)}</p></article>`).join('')+`<p>建议方向：${esc(d.direction)}</p>`;
  if(d&&n.councilPhase==='synthesis'){
    content+=(d.dispositions||d.decisions||[]).map(x=>`<article class="council-issue"><strong>${esc(x.issueId)} · ${actions[x.action]||esc(x.action)}</strong><p>${esc(x.reason)}</p>${x.change?`<p>修改：${esc(x.change)}</p>`:''}</article>`).join('');
    content+=`<div class="actions">${(r.createdTaskIds||[]).map(id=>{const t=p.tasks.find(t=>t.id===id);return t?button('council-node',`T${t.index} · ${t.title}`,'',`data-id="${esc(t.id)}"`):'';}).join('')}</div>`;
    if(d.question)content+=`<p>待研究者判断：${esc(d.question)}</p><button data-view="collaboration">到协作台答复</button>`;
    if(r.userDecision)content+=`<p>研究者：${esc(r.userDecision.content)}</p>`;
  }
  const documentId=n.documentId||s?.documentId;
  return content+`<div class="actions section-gap">${documentId?button('doc','查看评审 Markdown','',`data-id="${esc(documentId)}"`):''}${s?.jobId&&state.jobs.some(j=>j.id===s.jobId)?button('log','查看会话日志','',`data-id="${esc(s.jobId)}"`):''}</div>`;
}
