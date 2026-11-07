import {scopeContext} from './execution-scope.mjs';
import {createHash} from 'node:crypto';
import {assert,text,uid,now} from './store.mjs';
import {reviewers,reviewSchema,crossReviewSchema,validateReview,validateCross} from './proposal-review.mjs';
import {feedbackSchema,validateFeedback} from './collaboration.mjs';
import {isAuto} from './leadership.mjs';

export const councilStages={results:{title:'实验结果',stages:['experiments','analysis']},manuscript:{title:'论文初稿',stages:['writing']}};
const parse=r=>r.structured||JSON.parse(r.text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
const hash=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const copy=x=>JSON.parse(JSON.stringify(x));
const str={type:'string',minLength:1};
const taskSchema=feedbackSchema.properties.nextTasks.items;
export const stageDecisionSchema={...feedbackSchema,required:[...feedbackSchema.required,'dispositions'],properties:{...feedbackSchema.properties,
  dispositions:{type:'array',maxItems:24,items:{type:'object',additionalProperties:false,required:['issueId','action','reason'],properties:{issueId:str,action:{enum:['fix','dismiss','ask_user']},reason:str}}},
  nextTasks:{type:'array',maxItems:6,items:{...taskSchema,required:[...taskSchema.required,'issueIds'],properties:{...taskSchema.properties,issueIds:{type:'array',minItems:1,maxItems:24,items:str}}}}
}};
export const latestStageReview=(p,kind)=>p.stageReviews?.filter(r=>r.kind===kind).at(-1);
export function taskCouncilScopes(t){return [...new Set([...(t.councilScopes||[]),...Object.entries(councilStages).filter(([,v])=>v.stages.includes(t.researchStage)).map(([k])=>k)])];}
export function validateStageDecision(p,r,data){
  validateFeedback(p,data);
  const issues=[...r.reviewers.flatMap(m=>m.independent.data.concerns),...(r.userRevision?[r.userRevision]:[])],ids=issues.map(i=>i.id);
  assert(Array.isArray(data.dispositions)&&data.dispositions.length===ids.length&&new Set(data.dispositions.map(x=>x.issueId)).size===ids.length&&data.dispositions.every(x=>ids.includes(x.issueId)),'主 CC 必须逐条处理本轮全部评审意见。');
  for(const d of data.dispositions){text(d.reason);assert(['fix','dismiss','ask_user'].includes(d.action),'评审意见处理方式无效。');if(issues.find(i=>i.id===d.issueId).severity==='major')assert(d.action!=='dismiss','主要问题必须修改或交给研究者判断，不能直接略过。');}
  const fixes=data.dispositions.filter(d=>d.action==='fix').map(d=>d.issueId);
  for(const t of data.nextTasks){
    assert(Array.isArray(t.issueIds)&&t.issueIds.length&&t.issueIds.every(id=>fixes.includes(id)),'修改任务必须关联本轮需要修正的评审意见。');
    if(r.kind==='results')assert(t.researchStage!=='writing','实验结果未通过评审前，请先补齐实验与分析，不提前下发论文写作。');
  }
  for(const id of fixes)assert(data.nextTasks.some(t=>t.issueIds.includes(id)),'主 CC 遗漏了评审意见对应的 CX 修改任务。');
  const mustRevise=r.reviewers.some(m=>m.independent.data.verdict==='revise')||fixes.length>0;
  if(mustRevise)assert(data.decision==='ask_user'||data.assessment==='retry'&&data.decision==='continue'&&fixes.length>0,'评委要求修改时必须安排 CX 修改并复审，不能直接宣布通过。');
  if(data.dispositions.some(d=>d.action==='ask_user'))assert(data.decision==='ask_user','待研究者判断的意见必须明确提出问题。');
  if(data.decision==='continue')assert(data.nextTasks.length&&data.assessment==='retry','阶段评审继续时必须给出修改任务。');
  if(data.decision==='finish')assert(r.reviewers.every(m=>m.independent.data.verdict==='ready')&&!fixes.length&&data.dispositions.every(d=>d.action==='dismiss'),'只有三位评委均认可且无待修改意见时才能通过本阶段评审。');
  return data;
}

export class StageCouncil {
  constructor(flow){this.flow=flow;}
  get store(){return this.flow.store;}
  get runner(){return this.flow.runner;}
  scopes(t){return taskCouncilScopes(t||{});}
  scope(p,kind){return p.tasks.filter(t=>t.status!=='superseded'&&taskCouncilScopes(t).includes(kind));}
  material(p,kind){
    const scope=this.scope(p,kind);
    if(!scope.length||scope.some(t=>!t.reportId||!t.reviewId))return null;
    if(kind==='manuscript'&&this.scope(p,'results').length&&!this.approved(p,'results'))return null;
    // Reports and decisions are copied into an immutable per-round evidence manifest.
    const evidence=scope.map(t=>{const d=this.store.readDoc(p.id,t.reportId);return {taskId:t.id,benchmarkRunId:t.benchmarkRunId||'',index:t.index,title:t.title,stage:t.researchStage,status:t.status,assessment:t.assessment,reviewId:t.reviewId,reportId:d.id,reportPath:d.path,content:d.content,cwd:t.cwd||'',issueIds:t.issueIds||[]};});
    const upstream=kind==='manuscript'?latestStageReview(p,'results')?.id||'':'';
    const source={kind,benchmarkRunId:p.benchmarkResearch?.runs?.at(-1)?.id||'',brief:p.brief,questions:copy(p.questions),requirementsRevision:p.steering.revision,revision:p.stageReviewRevisions?.[kind]||0,upstream,evidence};
    return {source,sourceHash:hash({...source,evidence:evidence.map(({reviewId,...e})=>e)})};
  }
  approved(p,kind){const m=this.material(p,kind),r=latestStageReview(p,kind);return Boolean(m&&r?.status==='approved'&&r.userDecision?.action==='approve'&&r.userDecision.sourceHash===m.sourceHash&&r.sourceHash===m.sourceHash);}
  next(p){
    for(const kind of Object.keys(councilStages)){
      const pending=latestStageReview(p,kind);
      if(pending?.phase==='dispatch'&&['running','failed','interrupted'].includes(pending.status))return {kind};
      const m=this.material(p,kind);if(!m)continue;
      const r=latestStageReview(p,kind);
      if(this.approved(p,kind))continue;
      if(r?.sourceHash===m.sourceHash&&['approved','awaiting_approval'].includes(r.status))return {kind,approval:true};
      if(r?.sourceHash===m.sourceHash&&r.status==='changes_requested')return {kind,blocked:'评审要求的修改尚未形成新材料；请检查被取消或未完成的修改任务。'};
      return {kind,...m};
    }
    return null;
  }
  canRun(p,t){return !p.collaboration.pendingDecision&&(t.researchStage!=='writing'||!this.scope(p,'results').length||this.approved(p,'results'));}
  check(p,r,token){
    if(token.cancelled||this.runner.closing)throw Object.assign(new Error('阶段评委会已暂停，已完成意见保留。'),{cancelled:true});
    if(this.material(p,r.kind)?.sourceHash!==r.sourceHash)throw Object.assign(new Error('送审材料或研究要求已变化，旧轮次停止，重新送审当前版本。'),{reviewStale:true});
  }
  reserve(p,r,count){
    if(p.collaboration.reviewsUsed+count>p.collaboration.maxReviews)throw Object.assign(new Error('已达到本轮 CC 复核上限；评委会进度已保存，继续协作后补齐。'),{reviewPause:true});
    p.collaboration.reviewsUsed+=count;this.runner.changed();
  }
  async run(p,kind,token){
    const ready=latestStageReview(p,kind);
    if(ready&&['approved','awaiting_approval'].includes(ready.status)&&ready.sourceHash===this.material(p,kind)?.sourceHash&&!this.approved(p,kind)){
      this.requestApproval(p,ready);this.runner.changed();return ready;
    }
    const interrupted=latestStageReview(p,kind);
    if(interrupted?.phase==='dispatch'&&['running','failed','interrupted'].includes(interrupted.status)){
      if(token.cancelled||this.runner.closing)throw Object.assign(new Error('阶段评委会已暂停。'),{cancelled:true});
      const source=interrupted.source;
      const unchanged=(source.benchmarkRunId||'')===(p.benchmarkResearch?.runs?.at(-1)?.id||'')&&source.requirementsRevision===p.steering.revision&&source.revision===(p.stageReviewRevisions?.[kind]||0)&&source.brief===p.brief&&JSON.stringify(source.questions)===JSON.stringify(p.questions)&&source.evidence.every(e=>{const t=p.tasks.find(t=>t.id===e.taskId);return t&&t.reportId===e.reportId&&this.store.readDoc(p.id,e.reportId).content===e.content;});
      if(unchanged){this.apply(p,interrupted);this.runner.changed();return interrupted;}
      interrupted.status='superseded';interrupted.error='派工恢复前研究要求或材料已更新，原修改计划保留记录并重新评审。';
      for(const task of p.tasks.filter(t=>t.councilRoundId===interrupted.id&&!t.reportId))task.status='superseded';
      this.runner.changed();return interrupted;
    }
    const material=this.material(p,kind);assert(material,'本阶段仍有任务或回报未完成，不能提前送审。',409);
    p.stageReviews||=[];let r=latestStageReview(p,kind);
    if(!r||r.sourceHash!==material.sourceHash||['approved','changes_requested','superseded'].includes(r.status)){
      const previous=r,prior=p.stageReviews.at(-1)||p.proposalReviews?.at(-1);
      r={id:uid(),kind,number:p.stageReviews.filter(r=>r.kind===kind).length+1,previousRoundId:previous?.id||'',status:'pending',phase:'independent',createdAt:now(),...material,model:p.mentor.model,language:p.mentor.language,
        reviewers:reviewers.map(m=>({...m,sessionId:(previous||prior)?.reviewers?.find(x=>x.id===m.id)?.sessionId||'',independent:{status:'pending'},cross:{status:'pending'}})),synthesis:{status:'pending'},leadReviewId:uid(),createdTaskIds:[]};
      p.stageReviews.push(r);
      if(previous?.userDecision?.action==='revise')r.userRevision={id:'user-revision',title:'用户退回修改',severity:'major',reason:previous.userDecision.content,recommendation:'按用户审核意见修改实际产物并提供验证证据，再次送审。'};
    }
    if(!r.sourceDocumentId){
      const content=`# ${councilStages[kind].title}送审材料 · 第 ${r.number} 轮\n\n研究要求版本：${r.source.requirementsRevision}\n材料校验：${r.sourceHash}\n\n`+r.source.evidence.map(e=>`## T${e.index} · ${e.title}\n\n实际报告：${e.reportPath}\n产物目录（只读）：${e.cwd}\n主 CC 初核：${e.assessment||'未标注'}\n\n${e.content}`).join('\n\n');
      r.sourceDocumentId=this.store.doc(p.id,`72-council-${r.id}-source.md`,`${councilStages[kind].title} · 第 ${r.number} 轮送审材料`,content,'council-source').id;
    }
    r.status='running';r.error='';this.runner.changed();
    const title=councilStages[kind].title;
    const evidenceDoc=this.store.readDoc(p.id,r.sourceDocumentId);
    const previous=p.stageReviews.find(x=>x.id===r.previousRoundId);
    const context=`当前性能衡量依据：${this.flow.benchmark.context(p)}\n核对报告中的协议版本与当前版本，区分原论文报告值、本地复跑值、预算及划分不一致的结果。\n课题：${p.title}\n已确认研究目标：${r.source.brief}\n获批决策：${JSON.stringify(r.source.questions)}\n本轮送审清单：${evidenceDoc.path}\n${evidenceDoc.content}\n\n上一轮意见与修改任务：${JSON.stringify(previous?{dispositions:previous.synthesis.data?.dispositions,tasks:previous.createdTaskIds,userDecision:previous.userDecision}:null)}`;
    const common=`这是${title}阶段的正式内部评审。读取送审清单及实际证据文件；报告中的描述只是待核验主张。明确你实际读取了哪些证据、哪些结论尚未验证。不得编造结果、引用或运行记录，不执行实现，不另行调用评委/CX。关注真实研究质量，可靠阴性结果可以通过，不能为正结果无限重做。论文阶段逐项核对主张—实验/图表—引用的一致性、方法可复现性和结论边界；实验阶段检查基线、划分、泄漏、指标、消融、重复性和证据缺口。复审时核对上一轮问题是否由新的实际产物解决，不仅核对回复文字。任何需要修正的问题写入 concerns；verdict=revise 必须给出具体问题。输出符合 JSON Schema。\n`;
    const call=async(member,phase,prompt,schema,validate)=>{
      const step=member[phase];if(step.status==='completed')return;
      this.check(p,r,token);const jobId=uid();Object.assign(step,{status:'running',jobId,error:''});this.runner.changed();
      try{
        const result=await this.runner.run({id:jobId,projectId:p.id,provider:'cc',kind:`stage-${phase}`,title:`${title} R${r.number} · ${member.name} · ${phase==='independent'?'独立评审':phase==='cross'?'交叉互评':'修改决策'}`,reviewerId:member.id,reviewRoundId:r.id,executable:this.flow.cli('cc'),cwd:this.store.folder(p.id),prompt,schema,sessionId:member.sessionId||undefined,model:r.model,language:r.language});
        this.check(p,r,token);const data=validate(parse(result)),sid=result.job.sessionId||member.sessionId;
        assert(sid&&(!member.sessionId||sid===member.sessionId),'评委会会话 ID 缺失或发生变化，已暂停以保留会话连续性。');
        if(member.id!=='cc')assert(sid!==p.ccSessionId&&!r.reviewers.some(m=>m.id!==member.id&&m.sessionId===sid),'评委必须使用各自独立的 CC 会话。');
        member.sessionId=sid;if(phase==='independent')data.concerns=data.concerns.map((c,i)=>({...c,id:`${member.id}-c${i+1}`}));
        const md=phase==='independent'?`${data.summary}\n\n优点：${data.strengths.join('；')}\n\n${data.concerns.map(c=>`## ${c.id} · ${c.title}\n\n${c.severity==='major'?'主要问题':'次要问题'}\n\n${c.reason}\n\n修改建议：${c.recommendation}`).join('\n\n')}\n\n评委结论：${data.verdict==='ready'?'可通过':'需修改'}`:phase==='cross'?`${data.summary}\n\n${data.responses.map(x=>`## ${x.issueId} · ${{agree:'同意',disagree:'不同意',refine:'补充修正'}[x.position]}\n\n${x.reason}\n\n${x.suggestion}`).join('\n\n')}\n\n指导方向：${data.direction}`:`${data.summary}\n\n证据：${data.evidence}\n\n判断：${data.reason}\n\n${data.dispositions.map(d=>`## ${d.issueId} · ${{fix:'交给 CX 修改',dismiss:'说明不需修改的依据',ask_user:'请求研究者判断'}[d.action]}\n\n${d.reason}`).join('\n\n')}\n\n## 修改任务\n\n${data.nextTasks.map(t=>`### ${t.title}\n\n对应意见：${t.issueIds.join(', ')}\n执行者：${t.workerId}\n\n${t.instructions}\n\n验收：${t.acceptance}`).join('\n\n')}\n\n待确认问题：${data.question}`;
        const doc=this.store.doc(p.id,`73-council-${r.id}-${member.id}-${phase}.md`,`${title} R${r.number} · ${member.name} ${phase==='independent'?'评审':phase==='cross'?'互评':'修改计划'}`,`# ${title} R${r.number} · ${member.name}\n\n${md}`,'stage-council');
        Object.assign(step,{status:'completed',data,documentId:doc.id,completedAt:now()});
      }catch(e){if(this.store.state.jobs.find(j=>j.id===e.jobId)?.status==='cancelled'){token.cancelled=true;this.flow.stopProject(p.id);}Object.assign(step,{status:token.cancelled?'interrupted':'failed',error:e.message});throw e;}finally{this.runner.changed();}
    };
    const phase=async(key,action)=>{r.phase=key;this.check(p,r,token);this.reserve(p,r,r.reviewers.filter(m=>m[key].status!=='completed').length);const results=await Promise.allSettled(r.reviewers.map(action));this.check(p,r,token);const failure=results.find(x=>x.status==='rejected');if(failure)throw failure.reason;};
    try{
      await phase('independent',m=>call(m,'independent',`${common}你是 ${m.name}，负责${m.role}。${m.focus}\n独立评审本轮新材料，暂不读取其他评委本轮意见。\n${context}`,reviewSchema,d=>{validateReview(d);assert(d.verdict!=='revise'||d.concerns.length,'要求修改时必须给出具体问题。');return d;}));
      const independent=r.reviewers.map(m=>({id:m.id,role:m.role,...m.independent.data}));
      await phase('cross',m=>{const ids=independent.filter(x=>x.id!==m.id).flatMap(x=>x.concerns.map(i=>i.id));return call(m,'cross',`${common}继续担任 ${m.name}，逐条回应另外两位评委的意见，指出同意、不同意、补充修正及依据，不强求共识。必须回应的 issueId：${JSON.stringify(ids)}\n${context}\n本轮独立评审：${JSON.stringify(independent)}`,crossReviewSchema,d=>validateCross(d,ids));});
      this.check(p,r,token);r.phase='synthesis';
      if(r.synthesis.status!=='completed'){
        // Organize only after reviews are available, so the leader can assign the actual fixes.
        this.reserve(p,r,1);
        if(isAuto(p))await this.flow.leadership.organize(p,token,`${title}评委会已返回意见，请为修正这些问题配置 CX 团队：${JSON.stringify(independent)}`);
        this.check(p,r,token);
      }
      const lead={id:'cc',name:'主导师 CC',sessionId:p.ccSessionId,synthesis:r.synthesis};
      await call(lead,'synthesis',`你是研究负责人 CC，处理${title}评委会意见。必须逐条输出 dispositions（issueId、action=fix/dismiss/ask_user、reason）。主要问题不能 dismiss；任何评委 verdict=revise 时都必须安排实际修改并复审，不能凭解释直接宣布通过。每条 fix 必须被 nextTasks 中至少一项任务的 issueIds 覆盖。任务指令引用需要修改的文件、对应意见、可验证验收标准；工作台会在修改回报与初核后重新召集三位评委。复审全票通过后工作台会提交用户审核，用户通过才能出环进入后续阶段，不能自行宣布完成。三位评委均 ready 且没有待修正问题时，assessment=passed、decision=finish、nextTasks=[]；需要修改则 assessment=retry、decision=continue；确实超出获批目标、数据权限、预算或缺少必要材料时 decision=ask_user，明确问题。不得为常规修改反复请求批准。不得执行实现。\n${context}\n当前团队：${JSON.stringify(p.architecture.workers.filter(w=>w.active!==false))}\n用户退回意见（若有则必须作为额外的主要问题纳入 dispositions 并派发修改任务）：${JSON.stringify(r.userRevision||null)}\n本轮评审与互评：${JSON.stringify(r.reviewers.map(m=>({id:m.id,independent:m.independent.data,cross:m.cross.data})))}\n${scopeContext(p)}\nnextTasks 沿用正式任务格式，必须引用上述目标标识 questionIds；dependsOn 仅指向已返回的任务 ID：${JSON.stringify(p.tasks.filter(t=>t.reportId).map(t=>t.id))}。${kind==='results'?'结果修改任务使用 experiments/analysis 或必要的前序科研阶段，不能使用 writing。':''}`,stageDecisionSchema,d=>validateStageDecision(p,r,d));
      this.check(p,r,token);p.ccSessionId=lead.sessionId;r.phase='dispatch';this.runner.changed();
      this.apply(p,r);
    }catch(e){r.status=token.cancelled||e.cancelled?'interrupted':e.reviewStale?'superseded':e.reviewPause?'paused':'failed';r.error=e.message;throw e;}finally{this.runner.changed();}
    return r;
  }
  apply(p,r){
    const data=validateStageDecision(p,r,r.synthesis.data),c=p.collaboration;
    let review=c.reviews.find(x=>x.id===r.leadReviewId);
    if(!review){review={...copy(data),id:r.leadReviewId,taskId:r.source.evidence.at(-1).taskId,at:now(),jobId:r.synthesis.jobId,documentId:r.synthesis.documentId,councilRoundId:r.id,councilKind:r.kind,createdTaskIds:[]};c.reviews.push(review);}
    if(data.decision==='ask_user'){r.status='waiting_user';c.pendingDecision={id:review.id,question:data.question,reviewId:review.id,councilRoundId:r.id};}
    else if(data.nextTasks.length){r.createdTaskIds=this.flow.collaboration.addTasks(p,review);r.status='changes_requested';}
    else this.requestApproval(p,r);
    r.completedAt=now();this.flow.collaboration.message(p,'主 CC','研究者与 CX',`${councilStages[r.kind].title}第 ${r.number} 轮评审：${r.status==='awaiting_approval'?'三位委员通过，等待用户审核出环':r.status==='waiting_user'?'需要研究者判断':'已安排修改，回报后复审'}。\n${data.summary}`,{reviewId:review.id,councilRoundId:r.id,documentId:r.synthesis.documentId,kind:'council'});
  }
  requestApproval(p,r){
    assert(r.reviewers.length===3&&r.reviewers.every(m=>m.independent.status==='completed'&&m.independent.data.verdict==='ready'&&m.cross.status==='completed'),'三位委员尚未全票通过，不能提交用户审核。',409);
    validateStageDecision(p,r,r.synthesis.data);
    assert(r.synthesis.data.decision==='finish','仍有待修改任务，不能提交用户审核。',409);
    r.status='awaiting_approval';r.committeeApprovedAt||=now();
    p.collaboration.pendingDecision={id:r.leadReviewId,type:'stage-approval',reviewId:r.leadReviewId,councilRoundId:r.id,sourceHash:r.sourceHash,question:`${councilStages[r.kind].title}第 ${r.number} 轮已获三位 CC 委员通过。请审阅本轮材料与意见，审核通过后出环${r.kind==='results'?'进入下一阶段':'完成论文阶段'}；退回则由主 CC 安排修改并重新送审。`};
  }
  decide(p,pending,input){
    const r=p.stageReviews.find(x=>x.id===pending.councilRoundId),review=p.collaboration.reviews.find(x=>x.id===r.leadReviewId);
    const gate=pending.type==='stage-approval';
    if(gate&&this.material(p,r.kind)?.sourceHash!==pending.sourceHash){
      r.status='superseded';p.collaboration.pendingDecision=null;p.status='paused';p.collaboration.state='paused';p.collaboration.pauseReason='送审材料已更新，请继续研究以重新评审。';this.runner.changed();
      assert(false,'送审材料已更新，本次审核已失效，请重新评审。',409);
    }
    const content=gate&&input.action==='approve'&&!input.message?.trim()?'审核通过，允许出环。':text(input.message,20000);
    if(gate&&input.action==='approve'){this.requestApproval(p,r);r.status='approved';r.approvedAt=now();}
    r.userDecision={action:input.action,content,at:now(),sourceHash:r.sourceHash};review.userDecision=r.userDecision;
    if(gate){
      const doc=this.store.doc(p.id,`74-council-${r.id}-user.md`,`${councilStages[r.kind].title} · 用户审核`,`# 用户审核\n\n材料版本：${r.sourceHash}\n\n决定：${input.action==='approve'?'通过并出环':'退回修改'}\n\n${content}`,'council-approval');r.userDecision.documentId=doc.id;
      if(input.action==='revise'){p.stageReviewRevisions[r.kind]=(p.stageReviewRevisions[r.kind]||0)+1;r.status='superseded';}
    }
    else if(input.action==='approve'&&review.nextTasks.length){validateStageDecision(p,r,review);r.createdTaskIds=this.flow.collaboration.addTasks(p,review);r.status='changes_requested';}
    else {p.stageReviewRevisions[r.kind]=(p.stageReviewRevisions[r.kind]||0)+1;r.status='superseded';}
    this.flow.collaboration.message(p,'研究者','评委会与主 CC',content,{councilRoundId:r.id,kind:'decision'});p.collaboration.pendingDecision=null;this.runner.changed();
  }
}
