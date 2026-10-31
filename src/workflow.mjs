import fs from 'node:fs';
import path from 'node:path';
import { capture, invocation } from './platform.mjs';
import { assert, text, uid, now } from './store.mjs';
import { scanSkills, loadSelectedSkills } from './skills.mjs';
import {teamSchema,modelName,validateTeam,teamPrompt,teamMarkdown,recordModelChange} from './team.mjs';
import {Collaboration} from './collaboration.mjs';
import {researchStages,stageIds} from '../public/research-stages.js';

export const roles = [
  { key: 'novelty', title: '创新与定位', prompt: '检查研究问题、新颖性、已有工作与研究缺口。不得捏造文献或把未核实来源写成事实。' },
  { key: 'methods', title: '方法与实现', prompt: '提出可实现的方法、技术路线、必要资源与最小原型。明确假设和依赖。' },
  { key: 'experiments', title: '实验与验证', prompt: '设计基线、数据划分、评价指标、消融与可复现实验。不编造实验结果。' },
  { key: 'skeptic', title: '质疑与风险', prompt: '主动寻找失败条件、替代解释、证据缺口与最可能被审稿人否定的环节。' }
];
const str = { type: 'string' };
export const brainstormSchema = { type: 'object', additionalProperties: false, required: ['summary','perspectives','questions'], properties: {
  summary: str,
  perspectives: { type: 'array', minItems: 4, maxItems: 4, items: { type: 'object', additionalProperties: false, required: ['role','analysis'], properties: { role: { type:'string', enum: roles.map(r=>r.key) }, analysis: str } } },
  questions: { type: 'array', minItems: 1, maxItems: 12, items: { type: 'object', additionalProperties: false, required: ['title','why','options','recommendation'], properties: { title: str, why: str, options: { type:'array', minItems:2, maxItems:5, items:str }, recommendation: str } } }
} };
export const planSchema = { type: 'object', additionalProperties: false, required: ['summary','tasks'], properties: {
  summary: str, tasks: { type: 'array', minItems:1, maxItems:8, items: { type:'object', additionalProperties:false, required:['title','instructions','acceptance','questionIds','workerId','researchStage'], properties:{title:str,instructions:str,acceptance:str,workerId:str,researchStage:{type:'string',enum:stageIds},questionIds:{type:'array', minItems:1, items:str}} } }
} };
export const intakeSchema={type:'object',additionalProperties:false,required:['message','phase','direction','ideas','researchTopic','pipeline'],properties:{message:str,phase:{type:'string',enum:['clarifying','proposal']},direction:str,ideas:{type:'array',items:str},researchTopic:str,pipeline:{type:'array',items:{type:'object',additionalProperties:false,required:['title','description'],properties:{title:str,description:str}}}}};

function structured(result) {
  if (result.structured) return result.structured;
  const cleaned = result.text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch { throw new Error('CC 未返回有效结构化结果。原始输出已保留在运行记录中，可以重试。'); }
}
export function validateBrainstorm(data) {
  assert(data && typeof data.summary === 'string' && Array.isArray(data.perspectives) && data.perspectives.length === 4, 'CC 的讨论结果缺少四个视角。');
  assert(new Set(data.perspectives.map(p => p.role)).size === 4 && data.perspectives.every(p => roles.some(r => r.key === p.role) && typeof p.analysis === 'string' && p.analysis.trim()), 'CC 返回的讨论视角不完整。');
  assert(Array.isArray(data.questions) && data.questions.length > 0 && data.questions.length <= 12, 'CC 问卷格式错误。');
  for (const q of data.questions) { text(q.title, 2000); text(q.why); text(q.recommendation); assert(Array.isArray(q.options) && q.options.length >= 2 && q.options.length <= 5 && q.options.every(x => typeof x === 'string' && x.trim() && x.length <= 2000), '问卷选项格式错误。'); }
  return data;
}
export function validatePlan(data, questions, workers) {
  assert(data && Array.isArray(data.tasks) && data.tasks.length > 0 && data.tasks.length <= 8, 'CC 任务计划为空或格式错误。');
  const approved = new Set(questions.filter(q=>q.decision === 'approved').map(q=>q.id));
  for (const t of data.tasks) { text(t.title, 300); text(t.instructions, 30000); text(t.acceptance); assert(Array.isArray(t.questionIds) && t.questionIds.length && t.questionIds.every(id=>approved.has(id)), '计划包含未经你批准的问题，已阻止下发。');if(workers)assert(workers.some(w=>w.id===t.workerId),'CC 分配了不在本课题架构中的 CX。'); }
  for (const id of approved) assert(data.tasks.some(t => t.questionIds.includes(id)), '计划遗漏已批准的问题，已阻止下发。');
  return data;
}

export class Workflow {
  constructor(store, runner, getScan) { this.store = store; this.runner = runner; this.getScan = getScan; this.busy = new Set(); this.pumps = new Map(); this.collaboration=new Collaboration(this); }
  cli(provider) { const cli = this.getScan()?.clis?.[provider]; assert(cli?.available, `${provider === 'cc' ? 'Claude Code' : 'Codex'} 尚未就绪，请先完成本机扫描或在设置中指定程序路径。`, 409); return cli.path; }
  idle(id) { assert(!this.busy.has(id) && !this.pumps.has(id)&&!this.collaboration.active.has(id), '此课题已有任务运行中。', 409); }
  collaborate(id,input={}){return this.collaboration.start(id,input);}
  stageReview(id,input){
    const p=this.store.project(id);this.idle(id);assert(stageIds.includes(input.stageId),'科研阶段无效。');assert(['confirmed','reopened'].includes(input.action),'阶段操作无效。');
    const comment=text(input.comment,10000);p.research ||= {decisions:[]};
    p.research.decisions.push({id:uid(),stageId:input.stageId,action:input.action,comment,at:now()});
    this.store.doc(id,'70-research-decisions.md','研究者科研阶段判断',`# 科研阶段判断\n\n`+p.research.decisions.map(d=>`## ${d.stageId} · ${d.action} · ${d.at}\n\n${d.comment}`).join('\n\n'),'decisions');this.runner.changed();
  }
  configure(id,input) {
    const p=this.store.project(id);this.idle(id);
    const next=validateTeam(p,input,this.catalog(p));
    for(const w of next.workers){const old=p.architecture.workers.find(x=>x.id===w.id);if(old&&old.model!==w.model)recordModelChange(p,old,w.model,'用户在架构设置中调整','user');}
    p.architecture=next;
    this.store.doc(id,'04-architecture.md','课题协作架构',teamMarkdown(p),'architecture');
    this.store.log(`研究者确认团队：${next.workers.length} 个 CX，并发 ${next.parallel}。`,id);this.runner.changed();
  }
  catalog(p){return scanSkills(this.store.workspace,[...(this.store.state.settings.skillRoots||[]),...['.claude','.codex','.agents'].map(dir=>path.join(p.directory,dir,'skills'))]);}
  configureModels(id,input) {
    const p=this.store.project(id);this.idle(id);
    const model=modelName(input.model||''),language=text(input.language,80);
    assert(typeof input.allowCCSwitch==='boolean','动态模型开关无效。');
    assert(Array.isArray(input.allowedModels)&&input.allowedModels.length<=20,'最多允许 20 个动态模型。');
    const allowedModels=[...new Set(input.allowedModels.map(modelName))].filter(Boolean);
    assert(!input.allowCCSwitch||allowedModels.length,'启用动态切换前，请至少指定一个允许的 CX 模型。');
    p.mentor={model,language};p.modelPolicy={allowCCSwitch:input.allowCCSwitch,allowedModels};
    this.store.doc(id,'07-model-policy.md','模型与输出语言',`# 本课题模型设置\n\nCC：${model||'CLI 默认'}\n\n默认输出语言：${language}\n\n允许 CC 在任务间选择 CX 模型：${input.allowCCSwitch?'是':'否'}\n\n允许范围：${allowedModels.join(', ')||'无'}\n`,'settings');this.runner.changed();
  }
  teamChat(id,message) {
    const p=this.store.project(id),executable=this.cli('cc');this.idle(id);
    const content=text(message,12000),previousStatus=p.status;
    p.teamConversation.push({id:uid(),role:'user',content,at:now()});this.writeTeamConversation(p);
    const catalog=this.catalog(p),prompt=teamPrompt(p,content,catalog);
    return this.launch(id,'team_chatting',async()=>{
      const result=await this.runner.run({projectId:id,provider:'cc',kind:'team',title:'CC 导师 · 讨论 CX 分工与 Skills',executable,cwd:this.store.folder(id),prompt,schema:teamSchema,sessionId:p.ccSessionId||undefined});
      const data=structured(result);text(data.message,30000);assert(['clarifying','proposal'].includes(data.phase),'团队讨论阶段无效。');
      if(data.phase==='proposal')validateTeam(p,data,catalog);
      p.teamProposal=data.phase==='proposal'?{...data,id:uid()}:null;
      p.teamConversation.push({id:uid(),role:'assistant',content:data.message,at:now()});
      p.ccSessionId=result.job.sessionId||p.ccSessionId;p.status=previousStatus==='failed'?'draft':previousStatus;
      this.writeTeamConversation(p);
      if(p.teamProposal)this.store.doc(id,'08-team-proposal.md','CC 推荐的团队与 Skills',`# 待用户确认的团队方案\n\n${data.message}\n\n`+data.workers.map((w,i)=>`## CX-${i+1}\n\n${w.role}\n\n模型：${w.model||'CLI 默认'}\n语言：${w.language||p.mentor.language}\nSkills：${w.skillIds.map(id=>catalog.find(s=>s.id===id)?.name||id).join(', ')||'无'}\n\n理由：${w.reason}`).join('\n\n'),'proposal');
      this.store.log('CC 已回复团队讨论；推荐方案由研究者确认后生效。',id);
    });
  }
  writeTeamConversation(p){this.store.doc(p.id,'09-team-conversation.md','CX 分工讨论',`# ${p.title}：团队讨论\n\n`+p.teamConversation.map(m=>`## ${m.role==='user'?'研究者':'CC 导师'} · ${m.at}\n\n${m.content}`).join('\n\n'),'conversation');}
  acceptTeam(id,proposalId){const p=this.store.project(id);assert(p.teamProposal?.id===proposalId,'方案已更新，请刷新后查看最新方案。',409);this.configure(id,p.teamProposal);p.teamProposal.accepted=true;this.runner.changed();}
  selectSkills(id,ids) {
    const p=this.store.project(id);this.idle(id);assert(Array.isArray(ids)&&ids.length<=30&&ids.every(x=>typeof x==='string'),'最多选择 30 个 Skills。');
    const previous=p.skillIds;p.skillIds=[...new Set(ids)];
    let selected;try{const catalog=this.catalog(p);selected=loadSelectedSkills(p,catalog);for(const w of p.architecture.workers)loadSelectedSkills({skillIds:[...new Set([...p.skillIds,...w.skillIds])]},catalog);}catch(e){p.skillIds=previous;throw e;}
    this.store.doc(id,'05-selected-skills.md','本课题 Skills',`# ${p.title}：显式选择的 Skills\n\n`+selected.map(s=>`## ${s.name}\n\n来源：${s.path}\n\n${s.content}`).join('\n\n'),'skills');
    this.store.log(`本课题已选择 ${selected.length} 个 Skills。`,id);this.runner.changed();
  }
  chat(id,message) {
    const p=this.store.project(id),executable=this.cli('cc');this.idle(id);assert(!p.intakeConfirmed,'课题已进入 pipeline。请在原课题中执行，或新建课题讨论新方向。',409);
    const content=text(message,20000);p.conversation.push({id:uid(),role:'user',content,at:now()});
    this.writeConversation(p);
    const history=p.conversation.map(m=>`${m.role==='user'?'研究者':'CC 导师'}：${m.content}`).join('\n\n');
    const prompt=`你是这个课题的科研导师 CC。课题初始 title：${p.title}。课题文件夹：${p.directory}。\n\n请和研究者逐步澄清 idea、目标、已有工作、数据、算力、评价标准和边界，每轮只追问最关键的 1–3 个问题，避免上来要求一份完整方案。不要调用 CX，不执行实现。\n完整讨论记录：\n${history}\n\n当目标还不清晰时 phase=clarifying，message 是你自然的回复和追问，其他字段可为空字符串或空数组。当已有足够信息时 phase=proposal，给出 direction、ideas、researchTopic 和可操作的科研 pipeline（3–8 步）。覆盖本课题适用的问题/文献、假设与研究设计、数据/实验准备、最小验证、正式实验、分析复核、写作与复现归档；每步写明产出、判断证据和失败时返回哪里，不将 CC/CX 调用阶段当作科研阶段；message 解释方向依据和待确认事项。pipeline 每步含 title 和 description。不得编造文献、数据与实验结果。所有内容中文。研究者明确点击确认前不得自动立项。`;
    return this.launch(id,'chatting',async()=>{
      const result=await this.runner.run({projectId:id,provider:'cc',kind:'intake',title:'CC 导师 · 澄清研究目标',executable,cwd:this.store.folder(id),prompt,schema:intakeSchema,sessionId:p.ccSessionId||undefined});
      const data=structured(result);text(data.message,30000);assert(['clarifying','proposal'].includes(data.phase),'CC 讨论阶段格式错误。');
      if(data.phase==='proposal'){text(data.direction);text(data.researchTopic);assert(Array.isArray(data.ideas)&&data.ideas.every(i=>typeof i==='string')&&Array.isArray(data.pipeline)&&data.pipeline.length>=1&&data.pipeline.length<=12,'CC 尚未提供完整科研主题和 pipeline。');for(const s of data.pipeline){text(s.title,500);text(s.description,10000);}p.proposal=data;}
      else p.proposal=null;
      p.conversation.push({id:uid(),role:'assistant',content:data.message,at:now()});p.ccSessionId=result.job.sessionId||p.ccSessionId;p.status=data.phase==='proposal'?'proposal':'defining';this.writeConversation(p);
      if(p.proposal)this.store.doc(id,'06-research-proposal.md','待确认的科研主题与 pipeline',this.proposalMarkdown(p),'proposal');
      this.store.log(data.phase==='proposal'?'CC 已提出方向，等待你确认科研主题。':'CC 导师已回复，等待补充研究想法。',id);
    });
  }
  writeConversation(p){this.store.doc(p.id,'03-mentor-conversation.md','与 CC 导师的讨论',`# ${p.title}：立项讨论\n\n`+p.conversation.map(m=>`## ${m.role==='user'?'研究者':'CC 导师'} · ${m.at}\n\n${m.content}`).join('\n\n'),'conversation');}
  proposalMarkdown(p){const x=p.proposal;return `# ${x.researchTopic}\n\n## 研究方向\n\n${x.direction}\n\n## Ideas\n\n${x.ideas.map(i=>'- '+i).join('\n')}\n\n## Pipeline\n\n${x.pipeline.map((s,i)=>`### ${i+1}. ${s.title}\n\n${s.description}`).join('\n\n')}`;}
  activate(id){const p=this.store.project(id);this.idle(id);assert(p.proposal&&!p.intakeConfirmed,'请先与 CC 澄清目标并得到研究方向。',409);p.researchTopic=p.proposal.researchTopic;p.pipeline=p.proposal.pipeline;p.brief=this.proposalMarkdown(p);p.intakeConfirmed=true;p.status='draft';this.store.doc(id,'00-brief.md','已确认的科研主题',p.brief,'brief');this.store.log('研究者已确认科研主题，课题进入 pipeline。',id);this.runner.changed();}
  launch(id, stage, action) {
    const p = this.store.project(id); this.idle(id); this.busy.add(id); p.status = stage; p.error = ''; this.runner.changed();
    const promise = Promise.resolve().then(action).catch(e => { const job=this.store.state.jobs.find(j=>j.id===e.jobId);p.status = job?.status==='cancelled'?'interrupted':'failed'; p.error = e.message; this.store.log(e.message, id, 'error'); }).finally(()=>{ this.busy.delete(id); this.runner.changed(); });
    return promise;
  }
  brainstorm(id, revise = false) {
    const p = this.store.project(id), executable = this.cli('cc'); this.idle(id);
    assert(p.intakeConfirmed,'请先与 CC 讨论并确认科研主题。',409);
    assert(!p.tasks.some(t=>t.status === 'completed'), '已有执行产物，请新建课题以保留当前批阅和执行记录。', 409);
    const dir = this.store.folder(id), brief = fs.readFileSync(path.join(dir,'00-brief.md'),'utf8');
    const agents = Object.fromEntries(roles.map(r=>[r.key,{description:r.title,prompt:r.prompt,tools:['Read','Glob','Grep','WebSearch','WebFetch']} ]));
    const review = revise ? '\n研究者批阅（必须据此重做问卷，保留有用结论）：\n' + JSON.stringify(p.questions) : '';
    const prompt = `你是科研协调者 CC。研究目标如下（完整原文来自 00-brief.md）：\n${brief}\n\n请调用四个已定义的原生子智能体 novelty、methods、experiments、skeptic，分别完成独立讨论。收齐结果后交叉比较，保留分歧，输出 summary、4 个 perspectives 和 1–12 个需要研究者决定的 questions。每题给 2–5 个选项、理由和建议。不要代替研究者批准，不要实施代码。区分已知事实、假设和待验证事项。不编造论文、数据或实验结果。所有内容中文。输出必须符合 JSON Schema。科研流程不是 AI 调用顺序：先厘清问题与文献证据，再设计可检验假设、数据和实验、基线、正式实验、分析与复现。问卷只包含当前必须由研究者决定的研究设计与边界，后续证据可触发新一轮决策。你的结果由工作台写成 Markdown 交接文档。${review}`;
    const round = (p.round || 0) + 1;
    this.store.doc(id, `01-cc-request-r${round}.md`, `CC 讨论指令 · 第 ${round} 轮`, prompt, 'request');
    return this.launch(id, 'brainstorming', async()=>{
      const result = await this.runner.run({projectId:id,provider:'cc',kind:'brainstorm',title:'CC · 四视角头脑风暴',executable,cwd:dir,prompt,schema:brainstormSchema,agents,sessionId:p.ccSessionId || undefined});
      const data = validateBrainstorm(structured(result));
      p.ccSessionId = result.job.sessionId || p.ccSessionId; p.round = round;
      p.summary = data.summary; p.perspectives = data.perspectives;
      p.questions = data.questions.map((q,i)=>({...q,id:`q${i+1}`,decision:'pending',answer:'',comment:''}));
      p.tasks = [];
      for (const [i,r] of roles.entries()) this.store.doc(id, `1${i}-${r.key}-r${round}.md`, r.title, `# ${r.title}\n\n${data.perspectives.find(p=>p.role===r.key).analysis}\n`, 'discussion');
      this.store.doc(id, `20-questionnaire-r${round}.md`, `研究决策问卷 · 第 ${round} 轮`, `# ${p.title}：决策问卷\n\n${data.summary}\n\n`+p.questions.map((q,i)=>`## ${i+1}. ${q.title}\n\n${q.why}\n\n${q.options.map((o,j)=>`- ${String.fromCharCode(65+j)}. ${o}`).join('\n')}\n\n**CC 建议：** ${q.recommendation}\n`).join('\n'), 'questionnaire');
      p.status = 'awaiting_review'; this.store.log('CC 已完成讨论，等待你逐项批阅。', id);
    });
  }
  review(id, input) {
    const p = this.store.project(id); this.idle(id);
    assert(['awaiting_review','failed','interrupted'].includes(p.status) && !p.tasks.length, '当前阶段不能修改问卷。',409);
    const q = p.questions.find(q=>q.id===input.questionId); assert(q,'问题不存在。',404);
    assert(['approved','rejected','revise','pending'].includes(input.decision),'无效批阅状态。');
    assert(typeof input.answer === 'string' && input.answer.length <= 10000 && typeof input.comment === 'string' && input.comment.length <= 10000,'批阅内容过长。');
    if(input.decision==='approved') text(input.answer,10000);
    if(input.decision==='revise') text(input.comment,10000);
    Object.assign(q,{decision:input.decision,answer:input.answer.trim(),comment:input.comment.trim(),reviewedAt:now()});
    this.writeDecisions(p); this.runner.changed(); return q;
  }
  writeDecisions(p) {
    const labels={approved:'批准',rejected:'否决',revise:'要求修改',pending:'尚未批阅'};
    return this.store.doc(p.id,`21-decisions-r${p.round || 1}.md`,'研究者批阅记录',`# ${p.title}：研究者决策\n\n`+p.questions.map(q=>`## ${q.id} · ${q.title}\n\n- 决定：${labels[q.decision]}\n- 选择：${q.answer || '—'}\n- 批注：${q.comment || '—'}\n`).join('\n'),'decisions');
  }
  plan(id) {
    const p = this.store.project(id), executable = this.cli('cc'); this.idle(id);
    assert(!p.tasks.length,'已存在任务计划；请继续执行现有计划。',409);
    assert(p.architecture.confirmed,'请先在课题架构中与 CC 讨论并确认 CX 分工。',409);
    assert(p.questions.length && p.questions.every(q=>['approved','rejected'].includes(q.decision)),'请完成所有问题的批阅；要求修改的题目需先交回 CC 重做。',409);
    assert(p.questions.some(q=>q.decision==='approved'),'没有批准的问题，不能生成执行任务。',409);
    const doc = this.writeDecisions(p), decisions = this.store.readDoc(id,doc.id);
    const prompt = `你是 CC 导师与调度者。目标：${p.title}\n${p.brief}\n\n本课题 CX 架构：\n${p.architecture.workers.map(w=>`${w.id} (${w.name}): ${w.role}`).join('\n')}\n\n以下来自已写入本地的研究者批阅文件 ${decisions.path}：\n${decisions.content}\n\n遵循正常科研过程：问题澄清、文献缺口、假设与设计、数据准备、最小验证、正式实验、分析复核、写作归档。当前只为批准的问题生成 1–4 个可独立执行的小步骤，不要一次包办全课题；每个步骤返回后 CC 会复核并调度后续。任务需给出 researchStage，取值 question/literature/design/data/pilot/experiments/analysis/writing。，不能实施已否决内容。覆盖全部已批准问题。每个任务必须包含 title、instructions、acceptance、questionIds（只能引用获批 q 编号）和 workerId（必须是上述 CX 的 id，按分工选择）。不同 CX 使用独立目录；同一 CX 的任务按顺序执行，但不要依赖其他 CX 同时产生的文件。为需要跨 CX 串行依赖的工作合并成一个任务。说明必要输入和停止条件；缺少数据、API、文献时必须报告，不得伪造。你负责计划，不执行代码。中文，严格按 Schema 输出。`;
    this.store.doc(id,'29-dispatch-request.md','CC 任务拆解指令',prompt,'request');
    return this.launch(id,'planning',async()=>{
      const result = await this.runner.run({projectId:id,provider:'cc',kind:'plan',title:'CC · 拆解获批任务',executable,cwd:this.store.folder(id),prompt,schema:planSchema,sessionId:p.ccSessionId || undefined});
      const data=validatePlan(structured(result),p.questions,p.architecture.workers); p.ccSessionId=result.job.sessionId||p.ccSessionId;
      p.tasks=data.tasks.map((t,i)=>({...t,id:uid(),index:i+1,status:'ready',sessionId:'',error:'',dependsOn:[],researchStage:t.researchStage||'unclassified'}));
      for(const task of p.tasks) {
        const name=`30-task-${task.index}.md`;
        const worker=p.architecture.workers.find(w=>w.id===task.workerId);
        const d=this.store.doc(id,name,`${worker.name} / T${task.index} · ${task.title}`,`# ${worker.name} / T${task.index}：${task.title}\n\n## CX 分工\n\n${worker.role}\n\n## 批准依据\n\n${task.questionIds.join(', ')}\n\n## 执行要求\n\n${task.instructions}\n\n## 验收标准\n\n${task.acceptance}\n\n## 批阅原文\n\n${decisions.content}\n\n## 本课题规则\n\n${this.store.rulesText(id)}\n\n## Skills\n\n本课题显式选中的 Skill 指令保存在同目录 05-selected-skills.md（若存在）；执行时读取并遵循适用内容。\n\n## 回报约定\n\n只在分配给你的工作目录创建或修改产物；最终用 Markdown 汇报文件、验证过程、结果和未解决的问题。不要声称未运行的实验或测试已通过。\n`,'task');
        task.documentId=d.id;
      }
      p.status='ready'; this.store.log(`CC 已分派 ${p.tasks.length} 个 CX 任务。`,id);
    });
  }
  execute(id, taskId) {
    const p=this.store.project(id),executable=this.cli('cx'); this.idle(id);
    assert(p.tasks.length && p.questions.every(q=>['approved','rejected'].includes(q.decision)),'任务尚未获得批准。',409);
    const tasks=p.tasks.filter(t=>(!taskId||t.id===taskId)&&['ready','failed','interrupted','cancelled'].includes(t.status));
    assert(tasks.length,'没有可以运行的任务。',409);
    const token={cancelled:false},runningWorkers=new Set(); this.pumps.set(id,token); p.status='executing'; p.error='';
    for(const t of tasks)t.status='queued'; this.runner.changed();
    const work=async()=>{
      while(tasks.length&&!token.cancelled&&!this.runner.closing) {
        const next=tasks.findIndex(t=>!runningWorkers.has(t.workerId||`cx-${t.index}`));
        if(next<0){await new Promise(resolve=>setTimeout(resolve,40));continue;}
        const t=tasks.splice(next,1)[0],worker=p.architecture.workers.find(w=>w.id===t.workerId),workerId=worker?.id||`cx-${t.index}`;
        runningWorkers.add(workerId);t.status='running'; t.error='';
        const cwd=path.join(this.store.folder(id),'work',workerId);fs.mkdirSync(cwd,{recursive:true});
        t.cwd=cwd;
        const doc=this.store.readDoc(id,t.documentId);
        fs.writeFileSync(path.join(cwd,'TASK.md'),doc.content);
        const skillFile=path.join(this.store.folder(id),'05-selected-skills.md');
        if(fs.existsSync(skillFile))fs.copyFileSync(skillFile,path.join(cwd,'05-selected-skills.md'));
        const prompt=`你是 ${worker?.name||workerId}，负责 ${worker?.role||'实现任务'}，接受 CC 导师下发的 T${t.index} 任务。读取当前目录 TASK.md（批准后的 Markdown 交接文件）。只完成其中授权的工作。所有产物写在当前工作目录内。所选 Skills 已随本次输入提供。任务全文如下：\n\n${doc.content}\n\n完成后输出 Markdown 报告，含产物路径、实际执行的验证、限制与未完成项。若必要输入不存在，明确报告阻塞。`;
        try {
          if(p.modelPolicy.allowCCSwitch)await this.chooseModel(p,worker,t,token);
          if(token.cancelled)throw new Error('任务已停止。');
          const result=await this.runner.run({projectId:id,provider:'cx',kind:'execution',title:`${worker?.name||workerId} · ${t.title}`,executable,cwd,prompt,workerId,taskId:t.id,sessionId:t.sessionId||worker?.sessionId||undefined});
          t.sessionId=result.job.sessionId||t.sessionId;t.status='completed';t.jobId=result.job.id;
          if(worker)worker.sessionId=t.sessionId;
          const d=this.store.doc(id,`40-report-${t.index}.md`,`${worker?.name||workerId} / T${t.index} 执行报告`,result.text||'CLI 正常退出，但没有返回最终报告。请检查运行日志与产物。','report');t.reportId=d.id;
          this.store.log(`${worker?.name||workerId} 的 T${t.index} 已返回执行报告。`,id);
        }catch(e){t.status=token.cancelled?'cancelled':'failed';t.error=e.message;if(e.jobId){t.jobId=e.jobId; const j=this.store.state.jobs.find(j=>j.id===e.jobId);t.sessionId=j?.sessionId||t.sessionId;if(j?.status==='cancelled')t.status='cancelled';}this.store.log(`CX-${t.index}：${e.message}`,id,'error');}
        runningWorkers.delete(workerId);this.runner.changed();
      }
    };
    return Promise.all(Array.from({length:Math.min(this.store.state.settings.concurrency,p.architecture.parallel,tasks.length)},work)).finally(()=>{
      for(const t of tasks)t.status='cancelled';
      this.pumps.delete(id);p.status=p.tasks.every(t=>t.status==='completed')?'executed':token.cancelled?'interrupted':'ready';this.runner.changed();
    });
  }
  stopProject(id) {
    this.collaboration.stop(id);
    this.store.project(id); const token=this.pumps.get(id);if(token)token.cancelled=true;
    for(const j of this.store.state.jobs.filter(j=>j.projectId===id&&j.status==='running')) {try{this.runner.cancel(j.id);}catch{}}
    this.runner.changed();
  }
  async chooseModel(p,worker,task,token) {
    const allowed=p.modelPolicy.allowedModels;assert(worker&&allowed.length,'动态模型策略缺少可选模型。');
    const schema={type:'object',additionalProperties:false,required:['model','reason'],properties:{model:{type:'string',enum:allowed},reason:{type:'string'}}};
    const recent=p.tasks.filter(t=>t.workerId===worker.id&&t.reportId).slice(-2).map(t=>this.store.readDoc(p.id,t.reportId).content.slice(-5000));
    const prompt=`在已获批的任务开始前，为 ${worker.name} 选择 CX 模型。只推荐，不调用工具、不实现任务。只能从允许列表选择：${JSON.stringify(allowed)}。当前模型：${worker.model||'CLI 默认'}。分工：${worker.role}。任务：${task.title}\n${task.instructions||''}\n验收：${task.acceptance||''}\n此前实际报告：${recent.join('\n\n')}\n根据任务复杂度与前次失败/成功证据决定是否需要调整，说明原因。不要编造价格和性能差异；信息不足时优先保持当前模型（若在允许列表）。`;
    const result=await this.runner.run({projectId:p.id,provider:'cc',kind:'model-selection',title:`CC · 选择 ${worker.name} 的执行模型`,executable:this.cli('cc'),cwd:this.store.folder(p.id),prompt,schema,taskId:task.id});
    if(token.cancelled)return;
    const choice=structured(result);assert(allowed.includes(choice.model),'CC 选择的模型超出用户允许范围，已阻止执行。');text(choice.reason,5000);
    recordModelChange(p,worker,choice.model,choice.reason,'cc',task.id);task.model=choice.model;task.modelReason=choice.reason;
    this.store.doc(p.id,`32-model-${task.id}.md`,`${worker.name} 模型选择`, `# ${worker.name} · ${task.title}\n\n模型：${choice.model}\n\nCC 理由：${choice.reason}\n\n用户允许范围：${allowed.join(', ')}\n`,'model');
    this.store.log(`CC 为 ${worker.name} 选择 ${choice.model}：${choice.reason}`,p.id);this.runner.changed();
  }
  summarize(id) {
    const p=this.store.project(id),executable=this.cli('cc');this.idle(id);
    assert(p.tasks.length&&p.tasks.every(t=>t.status==='completed'),'请先完成全部 CX 任务。',409);
    const reports=p.tasks.map(t=>`## CX-${t.index}\n验收要求：${t.acceptance}\n\n${this.store.readDoc(id,t.reportId).content}`).join('\n\n');
    const prompt=`你是 CC。请审阅以下 CX 自报的结果，与验收标准逐项比较，汇总为 Markdown 研究执行报告。指出未经独立验证的主张、未完成项与后续建议，不把 CX 自报成功当作独立验收通过。不要再启动实现任务。\n\n${reports}`;
    return this.launch(id,'reviewing',async()=>{const result=await this.runner.run({projectId:id,provider:'cc',kind:'summary',title:'CC · 汇总与复核',executable,cwd:this.store.folder(id),prompt,sessionId:p.ccSessionId||undefined});this.store.doc(id,'50-cc-summary.md','CC 最终汇总',result.text,'summary');p.status='completed';this.store.log('CC 已提交汇总报告。',id);});
  }
  bindCC(id, sessionId) {
    const p=this.store.project(id);this.idle(id);
    assert(!sessionId || this.getScan()?.sessions.some(s=>s.id===sessionId&&s.provider==='cc'),'该 CC 会话不在本次扫描结果中。');
    p.ccSessionId=sessionId||'';p.externalCCSession=!!sessionId;this.runner.changed();
  }
  async handoff(id, sessionId, docId) {
    const p=this.store.project(id),executable=this.cli('cx');
    assert(this.getScan()?.sessions.some(s=>s.id===sessionId&&s.provider==='cx'),'该 CX 会话不在本次扫描结果中。');
    const doc=this.store.readDoc(id,docId),task=p.tasks.find(t=>t.documentId===docId);
    assert(task&&doc.kind==='task'&&p.questions.every(q=>['approved','rejected'].includes(q.decision)),'只允许发送经过批阅后由 CC 生成的任务文档。');
    const help=invocation(executable,['queue','--help']);
    let output;try{output=await capture(help.command,help.args,{env:help.env});}catch{throw new Error('此 Codex 版本不支持 queue；可使用工作台创建的 CX 执行任务。');}
    assert(output.includes('--thread')&&output.includes('--message'),'此 Codex 版本不支持向已有会话发送消息。');
    const message=`CC 已下发研究者批准的任务。请读取 Markdown 文件：${doc.path}。只执行该文件中授权的工作。若当前会话工作目录不合适，先告知研究者。`;
    const result=await this.runner.run({projectId:id,provider:'cx',kind:'handoff',title:'向已有 CX 发送 MD 交接',executable,cwd:this.store.folder(id),prompt:'',args:['queue','--thread',sessionId,'--message',message]});
    this.store.log('任务 MD 已加入已有 CX 的消息队列；执行状态请在原终端查看。',id);return result.job;
  }
}
