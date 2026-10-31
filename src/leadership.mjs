import {assert,text,uid,now} from './store.mjs';
import {modelName,teamMarkdown,recordModelChange} from './team.mjs';
import {loadSelectedSkills} from './skills.mjs';

export const isAuto=p=>p.autonomy?.mode==='auto';
export const activeWorkers=p=>p.architecture.workers.filter(w=>w.active!==false);
export function availableModels(p,models){
  if(p.modelPolicy.allowedModels.length)return [...p.modelPolicy.allowedModels];
  return [...new Set(['',models.defaults?.cx||'',...models.cx.map(m=>m.id),...activeWorkers(p).map(w=>w.model||'')])].filter(id=>{try{modelName(id);return true;}catch{return false;}});
}
export function validateAutonomy(input){
  assert(['auto','assisted'].includes(input.mode),'请选择 Auto Research 或手动确认模式。');
  for(const [key,max] of [['maxWorkers',32],['maxParallel',16],['maxReviews',1000]])assert(Number.isInteger(input[key])&&input[key]>=1&&input[key]<=max,`${key} 必须为 1–${max}。`);
  assert(input.maxParallel<=input.maxWorkers,'并发上限不能超过 CX 数量上限。');
  assert(typeof input.brief==='string'&&input.brief.length<=12000,'Leader 补充要求过长。');
  return {mode:input.mode,maxWorkers:input.maxWorkers,maxParallel:input.maxParallel,maxReviews:input.maxReviews,brief:input.brief.trim()};
}
const str={type:'string'};
export const leadershipSchema={type:'object',additionalProperties:false,required:['summary','parallel','workers'],properties:{summary:str,parallel:{type:'integer',minimum:1,maximum:16},workers:{type:'array',minItems:1,maxItems:32,items:{type:'object',additionalProperties:false,required:['id','role','model','language','skillIds','reason'],properties:{id:str,role:str,model:str,language:str,skillIds:{type:'array',items:str,maxItems:30},reason:str}}}}};
leadershipSchema.required.push('taskUpdates');
leadershipSchema.properties.taskUpdates={type:'array',maxItems:32,items:{type:'object',additionalProperties:false,required:['taskId','action','workerId','dependsOn','priority','reason'],properties:{taskId:str,action:{type:'string',enum:['update','cancel']},workerId:str,dependsOn:{type:'array',items:str,maxItems:32},priority:{type:'integer',minimum:0,maximum:1000},reason:str}}};
const settings=w=>JSON.stringify({role:w.role,model:w.model||'',language:w.language||'',skillIds:[...(w.skillIds||[])].sort()});
function queueChanges(p,updates,workers){
  assert(Array.isArray(updates)&&updates.length<=32,'CC 队列调整格式错误。');
  const seen=new Set(),next=p.tasks.map(t=>({...t}));
  for(const update of updates){
    const task=next.find(t=>t.id===update.taskId);assert(task&&!seen.has(task.id),'CC 队列调整引用了不存在或重复的任务。');seen.add(task.id);
    assert(['ready','queued','interrupted','cancelled','failed'].includes(task.status)&&!task.reportId,'CC 只能调整尚未执行的待办，不能修改运行中任务或已有结果。');
    text(update.reason,5000);assert(['cancel','update'].includes(update.action),'CC 队列调整动作无效。');
    if(update.action==='cancel'){task.status='superseded';continue;}
    assert(workers.some(w=>w.id===update.workerId),'待办必须分配给活跃 CX。');
    assert(Array.isArray(update.dependsOn)&&update.dependsOn.length<=32&&update.dependsOn.every(id=>id!==task.id&&p.tasks.some(t=>t.id===id)),'CC 队列依赖引用无效。');
    assert(Number.isInteger(update.priority)&&update.priority>=0&&update.priority<=1000,'任务优先级必须为 0–1000。');
    Object.assign(task,{workerId:update.workerId,dependsOn:[...new Set(update.dependsOn)],priority:update.priority});
  }
  const visiting=new Set(),visited=new Set();
  const visit=task=>{if(visited.has(task.id))return;assert(!visiting.has(task.id),'CC 队列调整产生循环依赖。');visiting.add(task.id);for(const id of task.dependsOn||[]){const dep=next.find(t=>t.id===id);if(dep)visit(dep);}visiting.delete(task.id);visited.add(task.id);};
  next.forEach(visit);
  assert(!next.length||next.some(t=>t.reportId||t.status!=='superseded'),'不能在尚无任何结果时取消全部待办。');
  return next;
}

// Validate a complete candidate before changing state. Busy and user-pinned workers are immutable.
export function prepareLeadership(p,data,catalog,models){
  text(data.summary,20000);
  assert(Array.isArray(data.workers)&&data.workers.length>=1&&data.workers.length<=p.autonomy.maxWorkers,'CC 团队方案超出 CX 数量上限。');
  assert(Number.isInteger(data.parallel)&&data.parallel>=1&&data.parallel<=Math.min(p.autonomy.maxParallel,data.workers.length),'CC 团队方案超出并发上限。');
  const allowed=availableModels(p,models),seen=new Set(),busy=new Set(p.tasks.filter(t=>t.status==='running').map(t=>t.workerId));
  let number=Math.max(0,...p.architecture.workers.map(w=>Number(w.name.match(/\d+$/)?.[0])||0))+1;
  const workers=data.workers.map(w=>{
    const old=w.id?p.architecture.workers.find(x=>x.id===w.id):null;
    assert(!w.id||old,'CC 引用了不存在的 CX。新增 CX 的 id 应留空。');
    const id=old?.id||`cx-${uid().slice(0,8)}`;assert(!seen.has(id),'CC 团队方案包含重复 CX。');seen.add(id);
    const model=modelName(w.model),reason=text(w.reason,5000);
    assert(Array.isArray(w.skillIds)&&w.skillIds.length<=30&&w.skillIds.every(id=>typeof id==='string'),'CX Skills 格式错误。');
    const skillIds=[...new Set(w.skillIds)];loadSelectedSkills({skillIds:[...new Set([...p.skillIds,...skillIds])]},catalog);
    const next={...old,id,name:old?.name||`CX-${String(number++).padStart(2,'0')}`,role:text(w.role,2000),model,language:typeof w.language==='string'&&w.language.trim()?text(w.language,80):'',skillIds,active:true,pinned:old?.pinned||false,sessionId:old?.sessionId||'',reason};
    if(old&&(old.pinned||busy.has(id)))assert(settings(next)===settings(old),'CC 不能更改用户固定或正在运行的 CX；应在任务结束后调整。');
    else if(!p.modelPolicy.allowCCSwitch)assert(model===(old?.model||''),'用户已关闭 CC 动态模型选择。');
    else assert(allowed.includes(model),'CC 选择的模型超出用户允许范围。');
    return next;
  });
  const taskUpdates=data.taskUpdates||[],tasks=queueChanges(p,taskUpdates,workers),retired=[];
  for(const old of p.architecture.workers)if(!seen.has(old.id)){
    assert(!old.pinned&&!busy.has(old.id),'CC 不能停用用户固定或正在运行的 CX。');
    assert(!tasks.some(t=>t.workerId===old.id&&(t.status==='running'||!t.reportId&&!['completed','superseded'].includes(t.status))),'CX 仍有待办任务，CC 需要先完成、重新分配或取消这些任务再停用。');
    retired.push({...old,active:false});
  }
  return {mentor:'CC Leader',confirmed:true,parallel:data.parallel,workers:[...workers,...retired],taskUpdates};
}

export class Leadership {
  constructor(flow){this.flow=flow;}
  async organize(p,token,reason){
    if(!isAuto(p))return;
    // Finish per-task model choices before taking the leader's immutable busy-worker snapshot.
    await Promise.allSettled([...(this.flow.modelSelections.get(p.id)||[])]);
    if(token.cancelled||this.flow.runner.closing)return;
    const {store,runner}=this.flow,catalog=this.flow.catalog(p),models=this.flow.models();
    const running=p.tasks.filter(t=>t.status==='running').map(t=>t.workerId);
    const prompt=`你是本项目的研究负责人 CC Leader，负责自主组织多个 Codex (CX)，不是仅提供建议的顾问。研究者已经允许你在下列边界内直接决定团队，不需要逐次采纳。
研究目标：${p.researchTopic||p.title}\n${p.brief}
已确认问卷：${JSON.stringify(p.questions)}
调度原因：${reason}
权限：最多 ${p.autonomy.maxWorkers} 个活跃 CX、项目并发最多 ${p.autonomy.maxParallel}；全工作区同时执行上限 ${store.state.settings.concurrency}。
研究者的 Leader 要求：${p.autonomy.brief||'自主安排数量、分工、交接和模型，以获得可核验的研究证据。'}
当前团队（active=false 为历史成员，可按原 id 重新启用）：${JSON.stringify(p.architecture.workers)}
正在工作的 CX（保留原配置，不能打断）：${JSON.stringify(running)}
全部任务：${JSON.stringify(p.tasks.map(t=>({id:t.id,title:t.title,workerId:t.workerId,status:t.status,assessment:t.assessment,researchStage:t.researchStage,error:t.error,dependsOn:t.dependsOn||[],priority:t.priority||0,hasReport:!!t.reportId})))}
最近回报和研究者反馈：${p.collaboration.messages.slice(-16).map(m=>`${m.from} → ${m.to}: ${m.content}`).join('\n').slice(-45000)}
最近团队决策：${JSON.stringify(p.teamChanges.slice(-3).map(x=>({reason:x.reason,at:x.at})))}
模型目录：${JSON.stringify(models)}
本次允许选择的模型标识：${JSON.stringify(availableModels(p,models))}。空字符串表示本机默认。
允许动态模型：${p.modelPolicy.allowCCSwitch}。关闭时保留原模型，新增成员使用空模型。用户 pinned=true 的成员必须原样保留。
本机 Skills：${JSON.stringify(catalog.map(s=>({id:s.id,name:s.name,description:s.description.slice(0,250)})))}
输出完整的下一版活跃团队 workers 和 parallel。自主决定合理人数，按研究瓶颈、任务依赖、能力和独立验证需求扩编、缩编或改分工，不要机械保留四个固定角色，也不要为凑人数增加调用。现有成员使用原 id，新增成员 id 留空。省略的成员会归档，不删除会话、工作目录或用量。正在工作、有待办任务或用户固定的成员不得省略；忙碌成员的 role/model/language/skillIds 必须原样保留。可以更改空闲成员的职责、模型、语言和 Skills。优先复用已有会话。每个成员写清职责边界、与谁交接和配置原因。
taskUpdates 用于直接调整未执行的待办：action=update 可改派到有现有 id 的活跃 CX、修改 dependsOn 和 priority（0–1000，越大越先执行）；action=cancel 可取消已被新证据淘汰或重复的待办，历史保留，并将 workerId 留空、dependsOn 设为空数组。没有调整则返回 []。不能改动运行中任务或已有报告。发现前序失败时，可先撤销不再适用的排队任务，再交给反馈步骤创建修复任务，避免先跑依赖错误产物的后续步骤。取消或改派待办后，其原 CX 可以归档。不要在这里声称创建了下一步任务，新增实验由随后反馈的 nextTasks 下发。
根据任务难度和实际失败/成功证据规划模型，候选目录不保证网关权限，不捏造价格、性能或可用性。不确定时沿用当前/默认模型。可读取项目 Markdown 与 CX 产物以核对证据；不要调用实现工具或自行启动外部 CX，工作台会应用团队方案并执行。`;
    const id=uid();store.doc(p.id,`63-leader-request-${id}.md`,'CC Leader 团队调度指令',prompt,'request');
    const r=await runner.run({projectId:p.id,provider:'cc',kind:'leadership',title:'CC Leader · 自主编排 CX 数量、分工与模型',executable:this.flow.cli('cc'),cwd:store.folder(p.id),sessionId:p.ccSessionId||undefined,prompt,schema:leadershipSchema});
    if(token.cancelled||runner.closing)return;
    p.ccSessionId=r.job.sessionId||p.ccSessionId;
    const data=r.structured||JSON.parse(r.text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
    this.apply(p,data,{catalog,models,jobId:r.job.id,id});
  }
  apply(p,data,{catalog=this.flow.catalog(p),models=this.flow.models(),jobId,id=uid()}={}){
    const {store,runner}=this.flow;
    const next=prepareLeadership(p,data,catalog,models),before=structuredClone(p.architecture),updates=next.taskUpdates;delete next.taskUpdates;
    for(const w of next.workers){const old=p.architecture.workers.find(x=>x.id===w.id);if(w.active!==false&&(!old||old.model!==w.model))recordModelChange(p,old||{id:w.id,model:''},w.model,w.reason,'cc');}
    // Keep worker identity while concurrent CX calls still hold a reference to it.
    next.workers=next.workers.map(w=>{const old=p.architecture.workers.find(x=>x.id===w.id);return old?Object.assign(old,w):w;});
    p.architecture=next;
    for(const update of updates){const task=p.tasks.find(t=>t.id===update.taskId);task.leaderChanges||=[];task.leaderChanges.push({...update,previousWorkerId:task.workerId,at:now(),changeId:id});if(update.action==='cancel'){task.status='superseded';task.cancelReason=update.reason;}else {if(task.workerId!==update.workerId){task.sessionId='';task.cwd='';}Object.assign(task,{workerId:update.workerId,dependsOn:[...new Set(update.dependsOn)],priority:update.priority});}}
    const change={id,at:now(),reason:data.summary,before,after:structuredClone(next),taskUpdates:updates,jobId};p.teamChanges.push(change);
    store.doc(p.id,'04-architecture.md','CC Leader 当前团队',teamMarkdown(p),'architecture');
    const doc=store.doc(p.id,`64-leadership-${id}.md`,'CC Leader 团队调度',`# ${data.summary}\n\n${teamMarkdown(p)}\n\n## 配置理由\n${next.workers.filter(w=>w.active).map(w=>`- ${w.name}: ${w.reason}`).join('\n')}\n\n## 待办调整\n${updates.map(u=>`- ${u.taskId} / ${u.action}: ${u.reason}`).join('\n')||'保留当前队列。'}`,'leadership');change.documentId=doc.id;
    this.flow.collaboration.message(p,'CC','团队',`${data.summary}\n活跃 CX：${activeWorkers(p).length}，项目并发：${next.parallel}。`,{kind:'leadership',documentId:doc.id,changeId:id});runner.changed();
  }
}
