import {BenchmarkResearch} from './benchmark-research.mjs';
import {executionScope,scopeContext} from './execution-scope.mjs';
import {Steering} from './steering.mjs';
import {ProposalCouncil,reviewReady,proposalText} from './proposal-review.mjs';
import {MentorMeetings} from './mentor-meetings.mjs';
import {StageCouncil} from './stage-council.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { capture, invocation } from './platform.mjs';
import { assert, text, uid, now } from './store.mjs';
import { scanSkills, loadSelectedSkills } from './skills.mjs';
import {teamSchema,modelName,validateTeam,teamPrompt,teamMarkdown,recordModelChange} from './team.mjs';
import {Collaboration} from './collaboration.mjs';
import {Leadership,isAuto,activeWorkers,availableModels,validateAutonomy} from './leadership.mjs';
import {modelCatalog} from './models.mjs';
import {researchStages,stageIds} from '../public/research-stages.js';

const str = { type: 'string' };
export const planSchema = { type: 'object', additionalProperties: false, required: ['summary','rationale','tasks'], properties: {
  summary: str, rationale: str, tasks: { type: 'array', minItems:1, maxItems:8, items: { type:'object', additionalProperties:false, required:['title','instructions','acceptance','questionIds','workerId','researchStage'], properties:{title:str,instructions:str,acceptance:str,workerId:str,researchStage:{type:'string',enum:stageIds},questionIds:{type:'array', minItems:1, items:str}} } }
} };
export const intakeSchema={type:'object',additionalProperties:false,required:['message','phase','direction','ideas','researchTopic','pipeline','proposal'],properties:{message:str,phase:{type:'string',enum:['clarifying','proposal']},direction:str,proposal:str,ideas:{type:'array',items:str},researchTopic:str,pipeline:{type:'array',items:{type:'object',additionalProperties:false,required:['title','description'],properties:{title:str,description:str}}}}};

function structured(result) {
  if (result.structured) return result.structured;
  const cleaned = result.text.trim().replace(/^```(?:json)?\s*/, '').replace(/\s*```$/, '');
  try { return JSON.parse(cleaned); } catch { throw new Error('CC 未返回有效结构化结果。原始输出已保留在运行记录中，可以重试。'); }
}
export function validatePlan(data, project, workers) {
  text(data?.summary);text(data?.rationale,20000);
  assert(Array.isArray(data.tasks) && data.tasks.length > 0 && data.tasks.length <= 8, 'CC 任务计划为空或格式错误。');
  const scope = new Set(executionScope(project).map(q=>q.id));
  for (const t of data.tasks) {
    text(t.title,300);text(t.instructions,30000);text(t.acceptance);
    assert(Array.isArray(t.questionIds)&&t.questionIds.length&&t.questionIds.every(id=>scope.has(id)), '任务引用了未知或已否决的研究目标。');
    assert(stageIds.includes(t.researchStage),'任务的科研阶段无效。');
    if(workers)assert(workers.some(w=>w.id===t.workerId),'CC 分配了不在本课题架构中的 CX。');
  }
  return data;
}

export class Workflow {
  constructor(store, runner, getScan) { this.store = store; this.runner = runner; this.getScan = getScan; this.busy = new Set(); this.pumps = new Map(); this.modelSelections=new Map();this.operations=new Map();this.council=new ProposalCouncil(this);this.stageCouncil=new StageCouncil(this);this.benchmark=new BenchmarkResearch(this);this.meetings=new MentorMeetings(this);this.models=modelCatalog;this.collaboration=new Collaboration(this);this.leadership=new Leadership(this);this.steering=new Steering(this); }
  prepareBenchmark(id){const p=this.store.project(id);this.idle(id);this.cli('cc');assert(p.intakeConfirmed,'请先确认研究方向。',409);p.benchmarkResearch.revision++;p.collaboration.reviewsUsed=0;return this.launch(id,'researching',async token=>{if(await this.benchmark.ensure(p,token)){p.status=p.tasks.length?'ready':'draft';p.collaboration.state='paused';p.collaboration.pauseReason='文献与评测方案已更新，继续研究后按新版本检查已有结果并安排下一步。';}});}
  cli(provider) { const cli = this.getScan()?.clis?.[provider]; assert(cli?.available, `${provider === 'cc' ? 'Claude Code' : 'Codex'} 尚未就绪，请先完成本机扫描或在设置中指定程序路径。`, 409); return cli.path; }
  idle(id) { assert(!this.busy.has(id) && !this.pumps.has(id)&&!this.collaboration.active.has(id), '此课题已有任务运行中。', 409); }
  collaborate(id,input={}){return this.collaboration.start(id,input);}
  configureAutonomy(id,input){
    const p=this.store.project(id);this.idle(id);const next=validateAutonomy(input);
    assert(p.architecture.workers.filter(w=>w.pinned).length<=next.maxWorkers,'数量上限不能少于用户固定的 CX 数量。');
    const retained=new Set(p.architecture.workers.filter(w=>w.pinned||p.tasks.some(t=>t.workerId===w.id&&!t.reportId&&!['completed','superseded'].includes(t.status))).map(w=>w.id));
    assert(retained.size<=next.maxWorkers,'仍有待办或固定配置的 CX 超过此数量上限，请先完成待办或调整固定成员。');
    p.autonomy=next;p.collaboration.maxReviews=next.maxReviews;
    this.store.doc(id,'10-leader-policy.md','CC Leader 自主研究设置',`# CC Leader\n\n模式：${next.mode}\n活跃 CX 上限：${next.maxWorkers}\n并发上限：${next.maxParallel}\n单轮复核上限：${next.maxReviews}\n\n${next.brief}\n\n研究者确认目标后，CC 说明做什么、为什么这样做，然后推进。CC 自主组织团队、调节未固定成员的模型、复核证据、安排替代实验与阶段推进；超出已确认边界或缺少必要输入时请求研究者处理。所有组织调整留存 Markdown。`,'settings');
    this.runner.changed();
  }
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
    p.mentor={model,language};p.modelPolicy={allowCCSwitch:input.allowCCSwitch,allowedModels};
    this.store.doc(id,'07-model-policy.md','模型与输出语言',`# 本课题模型设置\n\nCC：${model||'CLI 默认'}\n\n默认输出语言：${language}\n\n允许 CC 在任务间选择 CX 模型：${input.allowCCSwitch?'是':'否'}\n\n允许范围：${allowedModels.join(', ')||'无'}\n`,'settings');this.runner.changed();
  }
  teamChat(id,message) {
    const p=this.store.project(id),executable=this.cli('cc');this.idle(id);
    const content=text(message,12000),previousStatus=p.status;
    p.teamConversation.push({id:uid(),role:'user',content,at:now()});this.writeTeamConversation(p);
    const catalog=this.catalog(p),prompt=teamPrompt(p,content,catalog)+(isAuto(p)?'\n当前已启用 Auto Research：方案会直接执行，不需要另行采纳。遵守本项目上限 '+JSON.stringify(p.autonomy)+'；用户固定成员必须原样保留。可用模型标识：'+JSON.stringify(availableModels(p,this.models())):'');
    return this.launch(id,'team_chatting',async()=>{
      const result=await this.runner.run({projectId:id,provider:'cc',kind:'team',title:'CC 导师 · 讨论 CX 分工与 Skills',executable,cwd:this.store.folder(id),prompt,schema:teamSchema,sessionId:p.ccSessionId||undefined});
      const data=structured(result);text(data.message,30000);assert(['clarifying','proposal'].includes(data.phase),'团队讨论阶段无效。');
      if(data.phase==='proposal'&&!isAuto(p))validateTeam(p,data,catalog);
      p.teamProposal=data.phase==='proposal'?{...data,id:uid()}:null;
      if(p.teamProposal&&isAuto(p)){this.leadership.apply(p,{...data,summary:data.message},{catalog,jobId:result.job.id});p.teamProposal.accepted=true;}
      p.teamConversation.push({id:uid(),role:'assistant',content:data.message,at:now()});
      p.ccSessionId=result.job.sessionId||p.ccSessionId;p.status=previousStatus==='failed'?'draft':previousStatus;
      this.writeTeamConversation(p);
      if(p.teamProposal)this.store.doc(id,'08-team-proposal.md','CC 推荐的团队与 Skills',`# ${isAuto(p)?'CC Leader 已应用的团队方案':'待用户确认的团队方案'}\n\n${data.message}\n\n`+data.workers.map((w,i)=>`## CX-${i+1}\n\n${w.role}\n\n模型：${w.model||'CLI 默认'}\n语言：${w.language||p.mentor.language}\nSkills：${w.skillIds.map(id=>catalog.find(s=>s.id===id)?.name||id).join(', ')||'无'}\n\n理由：${w.reason}`).join('\n\n'),'proposal');
      this.store.log(isAuto(p)?'CC Leader 已根据讨论更新团队。':'CC 已回复团队讨论；推荐方案由研究者确认后生效。',id);
    });
  }
  writeTeamConversation(p){this.store.doc(p.id,'09-team-conversation.md','CX 分工讨论',`# ${p.title}：团队讨论\n\n`+p.teamConversation.map(m=>`## ${m.role==='user'?'研究者':'CC 导师'} · ${m.at}\n\n${m.content}`).join('\n\n'),'conversation');}
  acceptTeam(id,proposalId){const p=this.store.project(id);assert(p.teamProposal?.id===proposalId,'方案已更新，请刷新后查看最新方案。',409);this.configure(id,p.teamProposal);p.teamProposal.accepted=true;this.runner.changed();}
  selectSkills(id,ids) {
    const p=this.store.project(id);this.idle(id);assert(Array.isArray(ids)&&ids.length<=30&&ids.every(x=>typeof x==='string'),'每个课题最多选择 30 项技能。');
    const previous=p.skillIds;p.skillIds=[...new Set(ids)];
    let selected;try{const catalog=this.catalog(p);selected=loadSelectedSkills(p,catalog);for(const w of p.architecture.workers)loadSelectedSkills({skillIds:[...new Set([...p.skillIds,...w.skillIds])]},catalog);}catch(e){p.skillIds=previous;throw e;}
    this.store.doc(id,'05-selected-skills.md','本课题 Skills',`# ${p.title}：显式选择的 Skills\n\n`+selected.map(s=>`## ${s.name}\n\n来源：${s.path}\n\n${s.content}`).join('\n\n'),'skills');
    this.store.log(`本课题已选择 ${selected.length} 项技能。`,id);this.runner.changed();
  }
  chat(id,message) {
    const p=this.store.project(id),executable=this.cli('cc');this.idle(id);assert(!p.intakeConfirmed,'课题已进入 pipeline。请在原课题中执行，或新建课题讨论新方向。',409);
    const content=text(message,20000);p.proposalReviewRequired=true;p.conversation.push({id:uid(),role:'user',content,at:now()});
    this.writeConversation(p);
    const history=p.conversation.map(m=>`${m.role==='user'?'研究者':'CC 导师'}：${m.content}`).join('\n\n');
    const prompt=`你是这个课题的科研导师 CC。课题初始 title：${p.title}。课题文件夹：${p.directory}。\n\n请和研究者逐步澄清 idea、目标、已有工作、数据、算力、评价标准和边界，每轮只追问最关键的 1–3 个问题，避免上来要求一份完整方案。不要调用 CX，不执行实现。\n完整讨论记录：\n${history}\n\n当目标还不清晰时 phase=clarifying，message 是你自然的回复和追问，其他字段可为空字符串或空数组。当已有足够信息时 phase=proposal，给出 direction、ideas、researchTopic 和可操作的科研 pipeline（3–8 步）。提案作为初步方向：先规划查阅原始文献，寻找经典、近期方法与论文实际使用的 baseline，提取数据、划分、指标、训练条件和公平比较协议；不能凭记忆捏造已完成的调研或指标。正式实施前工作台会让你完成文献—方法对照和评测方案，再细化设计。覆盖本课题适用的问题/文献、假设与研究设计、数据/实验准备、最小验证、正式实验、分析复核、写作与复现归档；每步写明产出、判断证据和失败时返回哪里，不将 CC/CX 调用阶段当作科研阶段；message 解释方向依据和待确认事项。pipeline 每步含 title 和 description。不得编造文献、数据与实验结果。所有内容中文。研究者明确点击确认前不得自动立项。`;
    return this.launch(id,'chatting',async token=>{
      const result=await this.runner.run({projectId:id,provider:'cc',kind:'intake',title:'主导师 CC · 澄清目标与起草提案',executable,cwd:this.store.folder(id),prompt:prompt+'\n当 phase=proposal 时，proposal 字段提供 Markdown 提案初稿，说明问题、假设、方法、实验与资源约束、证据缺口和失败标准。初稿之后由三位独立 CC 评委审查并互评，你再逐条回应修订，三位委员复审修订稿全票通过并经研究者审核后，你说明执行步骤和理由，随后组织 CX 推进，不再生成问卷。clarifying 时 proposal 可为空。若这是新一轮修改，结合此前修订稿与评委意见继续完善：'+JSON.stringify(p.proposal||null),schema:intakeSchema,sessionId:p.ccSessionId||undefined});
      if(token.cancelled)throw Object.assign(new Error('立项讨论已停止。'),{cancelled:true});
      const data=structured(result);text(data.message,30000);assert(['clarifying','proposal'].includes(data.phase),'CC 讨论阶段格式错误。');
      if(data.phase==='proposal'){text(data.direction);text(data.researchTopic);assert(Array.isArray(data.ideas)&&data.ideas.every(i=>typeof i==='string')&&Array.isArray(data.pipeline)&&data.pipeline.length>=1&&data.pipeline.length<=12,'CC 尚未提供完整科研主题和 pipeline。');for(const s of data.pipeline){text(s.title,500);text(s.description,10000);}p.proposal=data;}
      else p.proposal=null;
      p.conversation.push({id:uid(),role:'assistant',content:data.message,at:now()});p.ccSessionId=result.job.sessionId||p.ccSessionId;p.status=data.phase==='proposal'?'proposal':'defining';this.writeConversation(p);
      if(p.proposal)this.store.doc(id,'06-research-proposal.md','待确认的科研主题与 pipeline',this.proposalMarkdown(p),'proposal');
      this.store.log(data.phase==='proposal'?'主 CC 已形成初稿，开始三位独立 CC 评委的评审与互评。':'CC 导师已回复，等待补充研究想法。',id);
      if(p.proposal)await this.council.run(id,token);
    });
  }
  writeConversation(p){this.store.doc(p.id,'03-mentor-conversation.md','与 CC 导师的讨论',`# ${p.title}：立项讨论\n\n`+p.conversation.map(m=>`## ${m.role==='user'?'研究者':'CC 导师'} · ${m.at}\n\n${m.content}`).join('\n\n'),'conversation');}
  proposalMarkdown(p){return proposalText(p.proposal);}
  reviewProposal(id){
    const p=this.store.project(id);this.idle(id);assert(p.proposal,'请先与主导师讨论并形成提案。',409);assert(!p.tasks.length,'已有实验任务的课题保留当前记录；请新建课题评审新提案。',409);assert(!reviewReady(p),'当前提案已完成评审，可确认或继续与主导师讨论修改。',409);this.cli('cc');
    if(p.intakeConfirmed){
      p.proposalHistory||=[];const previous={id:uid(),at:now(),proposal:p.proposal,brief:p.brief,pipeline:p.pipeline||[],questions:p.questions,round:p.round||0};p.proposalHistory.push(previous);
      this.store.doc(id,`06-before-council-${previous.id}.md`,'提交评委会前的已确认方案与决策',`${p.brief}\n\n## 原有问卷与决定\n\n${p.questions.map(q=>`### ${q.title}\n\n${q.decision} · ${q.answer||''}\n\n${q.comment||''}`).join('\n\n')}`,'proposal-history');
      p.intakeConfirmed=false;p.proposalReviewRequired=true;p.questions=[];p.perspectives=[];p.pipeline=[];
    }
    return this.launch(id,'proposal_reviewing',token=>this.council.run(id,token));
  }
  activate(id,input={}){
    const p=this.store.project(id);this.idle(id);
    assert(p.proposal&&!p.intakeConfirmed,'请先与 CC 澄清目标并得到研究方向。',409);
    assert(reviewReady(p),'请先完成三位 CC 评委的评审、互评与主导师修订，再确认提案。',409);
    const round=p.proposalReviews.at(-1);assert(input.reviewRoundId===round.id&&input.sourceHash===round.finalHash,'提案审核版本已变化，请刷新后审核当前版本。',409);
    p.researchTopic=p.proposal.researchTopic;p.pipeline=p.proposal.pipeline;
    p.brief=this.proposalMarkdown(p)+'\n\n## 评审回应\n\n'+p.proposal.decisions.map(x=>'- '+x.issueId+' / '+x.action+'：'+x.reason+'；修改：'+x.change).join('\n')+'\n\n## 尚需关注的问题\n\n'+p.proposal.openQuestions.map(x=>'- '+x).join('\n');
    p.intakeConfirmed=true;p.status='draft';p.error='';
    const approved=this.council&&p.proposalReviews.at(-1);if(approved)approved.userDecision={action:'approve',sourceHash:approved.finalHash,content:'用户确认当前提案，允许出环。',at:now()};
    this.store.doc(id,'00-brief.md','已确认的科研主题',p.brief,'brief');
    this.store.log('研究方向已确认。CC 将说明执行安排和理由，随后组织 CX 推进。',id);this.runner.changed();
    if(isAuto(p)||p.architecture.confirmed){
      if(!this.getScan()?.clis?.cc?.available||!this.getScan()?.clis?.cx?.available){p.error='研究方向已保存。请连接 CC 与 CX 后继续，CC 将说明安排并执行。';this.runner.changed();return;}
      return this.collaborate(id);
    }
  }
  launch(id, stage, action) {
    const p = this.store.project(id); this.idle(id); this.busy.add(id); p.status = stage; p.error = ''; this.runner.changed();
    const token={cancelled:false};this.operations.set(id,token);
    const promise = Promise.resolve().then(()=>{if(token.cancelled)throw Object.assign(new Error('任务已停止。'),{cancelled:true});return action(token);}).catch(e => { const job=this.store.state.jobs.find(j=>j.id===e.jobId);p.status = token.cancelled||e.cancelled||job?.status==='cancelled'?'interrupted':'failed'; p.error = e.message; this.store.log(e.message, id, 'error'); }).finally(()=>{ this.busy.delete(id);this.operations.delete(id); this.runner.changed(); });
    token.promise=promise;
    return promise;
  }
  // Old clients can still request the next step, but never create another questionnaire.
  brainstorm(id) {assert(this.store.project(id).intakeConfirmed,'请先确认科研主题。',409);return this.collaborate(id);}
  review(id) {this.store.project(id);assert(false,'历史问卷为只读记录；请通过 CC 对话更新要求。',409);}
  plan(id,token=null) {
    const p = this.store.project(id), executable = this.cli('cc'); if(!token)this.idle(id);else assert(this.collaboration.active.get(id)===token,'无效的内部调度。',409);
    assert(!p.tasks.length,'已存在任务计划；请继续执行现有计划。',409);
    assert(p.architecture.confirmed,'请先在课题架构中与 CC 讨论并确认 CX 分工。',409);
    assert(p.intakeConfirmed,'请先确认科研主题。',409);
    const revision=p.steering.revision;
    const prompt = `你是 CC 导师与调度者。课题：${p.title}\n${scopeContext(p)}\n\n本课题 CX 架构：\n${activeWorkers(p).map(w=>w.id+' ('+w.name+'): '+w.role).join('\n')}\n\n请直接说明接下来做什么、为什么这样做，然后给团队分派 1–8 个小而可检查的步骤。summary 用用户能理解的语言说明本轮做什么；rationale 解释方案依据、顺序、必要假设、预期产出和验证方式。此说明用于告知，不等待用户批准，不生成问题、选项或问卷。遵循问题、文献、baseline 与评测协议、设计、数据、最小验证、正式实验、分析、写作的适用顺序。每个步骤返回后 CC 会复核并调度后续，不要求一次完成全部目标。每个任务包含 title、instructions、acceptance、questionIds（引用上述目标标识，通常为 research-goal）、workerId（活跃 CX 的 id）和 researchStage（question/literature/benchmark/design/data/pilot/experiments/analysis/writing）。不同 CX 使用独立目录，同一 CX 顺序执行；首轮不要安排依赖其他并行 CX 尚未产出文件的任务。说明必要输入与停止条件，缺少材料时报告，不伪造结果。你负责安排，实现交给 CX。中文，严格按 Schema 输出。`;
    this.store.doc(id,'29-dispatch-request.md','CC 任务拆解指令',prompt,'request');
    const action=async operation=>{
      if(!token)p.collaboration.reviewsUsed=0;
      if(!await this.benchmark.ensure(p,token||operation))return;
      for(let attempt=0;attempt<3;attempt++){
      const result = await this.runner.run({projectId:id,provider:'cc',kind:'plan',title:'CC · 说明执行安排与理由',executable,cwd:this.store.folder(id),prompt:prompt+'\n导师上次对安排的修改要求：'+(p.executionPlan?.revisionInstructions||'首次安排')+'\n\n'+this.benchmark.context(p),schema:planSchema,sessionId:p.ccSessionId || undefined});
      if((token||operation)?.cancelled||this.runner.closing)return;
      assert(revision===p.steering.revision,'研究要求已更新，已停止旧计划；继续后 CC 将按新要求重新安排。',409);
      const data=validatePlan(structured(result),p,activeWorkers(p)); p.ccSessionId=result.job.sessionId||p.ccSessionId;
      const tasks=data.tasks.map((t,i)=>({...t,benchmarkRunId:p.benchmarkResearch.runs.at(-1).id,id:uid(),index:i+1,status:'ready',sessionId:'',error:'',dependsOn:[],researchStage:t.researchStage||'unclassified'}));
      const noticeId=uid(),notice='# CC 的执行说明\n\n## 接下来做什么\n\n'+data.summary+'\n\n## 为什么这样做\n\n'+data.rationale+'\n\n## 具体步骤\n\n'+tasks.map(t=>'### T'+t.index+' · '+t.title+'\n\n'+t.instructions+'\n\n验收：'+t.acceptance).join('\n\n')+'\n\n常规安排经导师认可后推进；你可以随时通过项目对话调整要求或暂停。';
      const document=this.store.doc(id,'28-execution-plan-'+noticeId+'.md','CC 执行安排与理由',notice,'execution-plan');
      p.executionPlan={id:noticeId,summary:data.summary,rationale:data.rationale,at:now(),documentId:document.id,jobId:result.job.id,taskIds:tasks.map(t=>t.id),benchmarkRunId:p.benchmarkResearch.runs.at(-1).id,requirementsRevision:revision,meetingStatus:'pending'};
      p.executionPlans||=[];p.executionPlans.push({...p.executionPlan});
      const meeting=await this.meetings.review(p,'design','plan:'+noticeId,document.id,token||operation);
      if(!meeting)return;
      Object.assign(p.executionPlan,{meetingStatus:meeting.data.verdict,meetingId:meeting.id,revisionInstructions:meeting.data.revisionInstructions});
      Object.assign(p.executionPlans.at(-1),p.executionPlan);
      if(meeting.data.verdict==='blocked')return this.meetings.pause(p,token||operation,meeting.data.revisionInstructions);
      if(meeting.data.verdict==='revise')continue;
      for(const task of tasks) {
        const name=`30-task-${task.index}.md`;
        const worker=p.architecture.workers.find(w=>w.id===task.workerId);
        const d=this.store.doc(id,name,`${worker.name} / T${task.index} · ${task.title}`,`# ${worker.name} / T${task.index}：${task.title}\n\n## CX 分工\n\n${worker.role}\n\n## 研究目标\n\n${task.questionIds.join(', ')}\n\n## 执行要求\n\n${task.instructions}\n\n## 验收标准\n\n${task.acceptance}\n\n## 已确认目标与约束\n\n${scopeContext(p)}\n\n## 性能衡量依据\n\n${this.benchmark.context(p)}\n\n## 本课题规则\n\n${this.store.rulesText(id)}\n\n## Skills\n\n本课题显式选中的 Skill 指令保存在同目录 05-selected-skills.md（若存在）；执行时读取并遵循适用内容。\n\n## 回报约定\n\n只在分配给你的工作目录创建或修改产物；最终用 Markdown 汇报文件、验证过程、结果和未解决的问题。不要声称未运行的实验或测试已通过。\n`,'task');
        task.documentId=d.id;
      }
      p.tasks=tasks;
      this.collaboration.message(p,'CC','研究者',notice,{kind:'execution-plan',documentId:document.id});
      p.status='ready'; this.store.log(`CC 已分派 ${p.tasks.length} 个 CX 任务。`,id);return;
      }
      return this.meetings.pause(p,token||operation,'执行安排已修改 3 次，仍需导师组会认可；进度已保存，可继续。');
    };
    return token?action(token):this.launch(id,'planning',action);
  }
  execute(id, taskId) {
    const p=this.store.project(id),executable=this.cli('cx'); this.idle(id);
    assert(p.intakeConfirmed&&p.tasks.length,'请先确认研究目标并生成执行安排。',409);
    assert(this.benchmark.ready(p),'请先在协作台完成当前研究要求下的文献调研与评测方案。',409);
    const tasks=p.tasks.filter(t=>(!taskId||t.id===taskId)&&['ready','failed','interrupted','cancelled'].includes(t.status));
    assert(tasks.length,'没有可以运行的任务。',409);
    assert(tasks.every(t=>this.stageCouncil.canRun(p,t)&&this.meetings.canRun(p,t)),'请先完成前序步骤的导师组会，以及本阶段所需的三位委员与用户审核。',409);
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
          assert(this.benchmark.ready(p),'研究要求已变化，请先更新评测方案再执行。',409);t.benchmarkRunId=p.benchmarkResearch.runs.at(-1).id;
          assert(this.stageCouncil.canRun(p,t)&&this.meetings.canRun(p,t),'阶段审核尚未通过，任务保持在当前循环。',409);
          const result=await this.runner.run({projectId:id,provider:'cx',kind:'execution',title:`${worker?.name||workerId} · ${t.title}`,executable,cwd,prompt:prompt+'\n\n'+this.benchmark.context(p),workerId,taskId:t.id,sessionId:t.sessionId||worker?.sessionId||undefined});
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
    const operation=this.operations.get(id);if(operation)operation.cancelled=true;
    this.collaboration.stop(id);this.steering.stop(id);
    this.store.project(id); const token=this.pumps.get(id);if(token)token.cancelled=true;
    for(const j of this.store.state.jobs.filter(j=>j.projectId===id&&j.status==='running')) {try{this.runner.cancel(j.id);}catch{}}
    this.runner.changed();
  }
  chooseModel(p,worker,task,token){
    const pending=this.modelSelections.get(p.id)||new Set();this.modelSelections.set(p.id,pending);
    const work=this.selectModel(p,worker,task,token).finally(()=>{pending.delete(work);if(!pending.size)this.modelSelections.delete(p.id);});pending.add(work);return work;
  }
  async selectModel(p,worker,task,token) {
    assert(worker,'动态模型策略缺少 CX。');
    if(worker.pinned){task.model=worker.model;task.modelReason='用户固定此 CX 配置。';return;}
    const allowed=availableModels(p,this.models());assert(allowed.length,'动态模型策略缺少可选模型。');
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
    assert(p.tasks.length&&p.tasks.every(t=>['completed','superseded'].includes(t.status)),'请先完成全部 CX 任务。',409);
    assert(p.tasks.every(t=>this.meetings.resolved(p,t)),'请先继续协作，完成每一步的导师汇报与方向判断，修改通过后再汇总。',409);
    for(const kind of ['results','manuscript'])assert(!this.stageCouncil.scope(p,kind).length||this.stageCouncil.approved(p,kind),'请先继续协作，完成实验结果或论文初稿的三位评委评审与复审。',409);
    const reports=p.tasks.filter(t=>t.status!=='superseded').map(t=>`## CX-${t.index}\n验收要求：${t.acceptance}\n\n${this.store.readDoc(id,t.reportId).content}`).join('\n\n');
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
    assert(this.benchmark.ready(p),'请先在协作台完成文献调研与评测方案。',409);
    assert(p.intakeConfirmed&&task&&doc.kind==='task','只允许发送已确认课题中由 CC 生成的任务文档。');
    assert(this.stageCouncil.canRun(p,task)&&this.meetings.canRun(p,task),'请先完成三位委员与用户审核，再交接后续任务。',409);
    const help=invocation(executable,['queue','--help']);
    let output;try{output=await capture(help.command,help.args,{env:help.env});}catch{throw new Error('此 Codex 版本不支持 queue；可使用工作台创建的 CX 执行任务。');}
    assert(output.includes('--thread')&&output.includes('--message'),'此 Codex 版本不支持向已有会话发送消息。');
    assert(this.benchmark.ready(p),'研究要求已变化，请先更新评测方案。',409);
    assert(this.stageCouncil.canRun(p,task)&&this.meetings.canRun(p,task),'阶段审核已变化，请先处理待审核事项。',409);
    const protocol=this.store.readDoc(id,p.benchmarkResearch.runs.at(-1).protocol.documentId);
    const message=`CC 已下发本课题的任务。请先读取当前评测方案：${protocol.path}，采用协议版本 ${p.benchmarkResearch.runs.at(-1).id}，它优先于旧任务中的评测设置。请读取 Markdown 文件：${doc.path}。只执行该文件中授权的工作。若当前会话工作目录不合适，先告知研究者。`;
    const result=await this.runner.run({projectId:id,provider:'cx',kind:'handoff',title:'向已有 CX 发送 MD 交接',executable,cwd:this.store.folder(id),prompt:'',args:['queue','--thread',sessionId,'--message',message]});
    this.store.log('任务 MD 已加入已有 CX 的消息队列；执行状态请在原终端查看。',id);return result.job;
  }
}
