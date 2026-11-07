import {executionScope,scopeContext} from './execution-scope.mjs';
import fs from 'node:fs';
import path from 'node:path';
import {assert,text,uid,now} from './store.mjs';
import {stageIds,researchStages} from '../public/research-stages.js';
import {isAuto,activeWorkers} from './leadership.mjs';

const str={type:'string'};
export const feedbackSchema={type:'object',additionalProperties:false,required:['summary','assessment','evidence','decision','reason','question','handoff','nextTasks'],properties:{summary:str,assessment:{type:'string',enum:['passed','retry','blocked']},evidence:str,decision:{type:'string',enum:['continue','ask_user','finish']},reason:str,question:str,handoff:str,nextTasks:{type:'array',maxItems:6,items:{type:'object',additionalProperties:false,required:['title','instructions','acceptance','workerId','questionIds','dependsOn','researchStage','relation'],properties:{title:str,instructions:str,acceptance:str,workerId:str,questionIds:{type:'array',minItems:1,items:str},dependsOn:{type:'array',items:str},researchStage:{type:'string',enum:stageIds},relation:{type:'string',enum:['retry','alternative','next','verify']}}}}}};
const terminal=t=>['completed','failed','cancelled','interrupted','superseded'].includes(t.status);
const parse=r=>r.structured||JSON.parse(r.text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
export function validateFeedback(p,data){
  for(const field of ['summary','evidence','reason'])text(data?.[field],20000);
  assert(['passed','retry','blocked'].includes(data.assessment)&&['continue','ask_user','finish'].includes(data.decision),'CC 反馈决策无效。');
  assert(typeof data.handoff==='string'&&data.handoff.length<=20000&&typeof data.question==='string','CC 交接格式错误。');
  assert(Array.isArray(data.nextTasks)&&data.nextTasks.length<=6,'每次反馈最多追加 6 个任务。');
  if(data.decision==='ask_user')text(data.question,10000);
  if(data.assessment==='blocked')assert(data.decision==='ask_user','阻塞必须交给研究者处理。');
  if(data.decision==='finish')assert(data.assessment==='passed'&&!data.nextTasks.length,'仅证据满足本项验收后可结束此分支。');
  if(data.assessment==='retry'&&data.decision==='continue')assert(data.nextTasks.length,'需要重做时必须给出下一步或询问研究者。');
  const approved=new Set(executionScope(p).map(q=>q.id));
  for(const task of data.nextTasks){
    text(task.title,300);text(task.instructions,30000);text(task.acceptance,10000);
    assert(activeWorkers(p).some(w=>w.id===task.workerId),'后续任务指定了不存在或已归档的 CX。');
    assert(Array.isArray(task.questionIds)&&task.questionIds.length&&task.questionIds.every(id=>approved.has(id)),'后续任务引用了未知或已否决的研究目标。');
    assert(Array.isArray(task.dependsOn)&&task.dependsOn.every(id=>p.tasks.some(t=>t.id===id&&terminal(t))),'依赖必须指向已有且已返回结果的任务。');
    assert(stageIds.includes(task.researchStage)&&['retry','alternative','next','verify'].includes(task.relation),'后续任务的科研阶段或分支类型无效。');
  }
  return data;
}

export class Collaboration {
  constructor(flow){this.flow=flow;this.active=new Map();this.runningCX=0;}
  get store(){return this.flow.store;} get runner(){return this.flow.runner;}
  message(p,from,to,content,extra={}){const m={id:uid(),at:now(),from,to,content,...extra};p.collaboration.messages.push(m);this.write(p);this.runner.changed();return m;}
  write(p){this.store.doc(p.id,'60-collaboration.md','CC 与 CX 持续协作记录',`# ${p.title}：协作记录\n\n`+p.collaboration.messages.map(m=>`## ${m.from} → ${m.to} · ${m.at}\n\n${m.content}`).join('\n\n'),'conversation');}
  addTasks(p,review){
    const created=[];
    for(const [position,next] of review.nextTasks.entries()){
      const councilTaskKey=review.councilRoundId?`${review.id}-${position}`:'';
      const existing=councilTaskKey&&p.tasks.find(t=>t.councilTaskKey===councilTaskKey);
      if(existing){created.push(existing.id);continue;}
      const t={...next,benchmarkRunId:p.benchmarkResearch?.runs?.at(-1)?.id,id:uid(),index:Math.max(0,...p.tasks.map(t=>t.index))+1,status:'ready',sessionId:'',error:'',priority:['retry','alternative'].includes(next.relation)?Math.min(1000,(p.tasks.find(t=>t.id===review.taskId)?.priority||0)+1):0,parentReviewId:review.id,dependsOn:[...new Set([review.taskId,...next.dependsOn])],createdAt:now()};
      const w=p.architecture.workers.find(w=>w.id===t.workerId);
      if(review.councilRoundId){t.councilTaskKey=councilTaskKey;t.councilRoundId=review.councilRoundId;t.councilScopes=[review.councilKind];}
      else if(next.relation!=='next'){const parent=p.tasks.find(x=>x.id===review.taskId);t.councilScopes=this.flow.stageCouncil.scopes(parent);t.councilRoundId=parent?.councilRoundId||'';}
      if(review.councilRoundId)t.instructions+=`\n\n这是评委会第 ${p.stageReviews.find(r=>r.id===review.councilRoundId)?.number||'?'} 轮修改。对应意见：${next.issueIds.join(', ')}。完整评审与主导师修改计划：${this.store.readDoc(p.id,review.documentId).path}。逐条提供修改位置、实际验证与证据；回报后将由三位评委复审。`;
      const d=this.store.doc(p.id,`30-task-${t.index}.md`,`${w.name} / T${t.index} · ${t.title}`,`# ${t.title}\n\n科研阶段：${t.researchStage}\n分支：${t.relation}\n研究目标：${t.questionIds.join(', ')}\n\n## CC 的判断\n${review.reason}\n\n## 执行要求\n${t.instructions}\n\n## 验收标准\n${t.acceptance}\n\n## 性能衡量依据\n${this.flow.benchmark.context(p)}\n\n## 共享交接\n${review.handoff}\n\n只修改本 CX 工作目录；其它 CX 的产物只读。缺少材料时报告阻塞，不伪造结果。`,'task');
      t.documentId=d.id;p.tasks.push(t);created.push(t.id);review.createdTaskIds=[...created];
      this.message(p,'CC',w.name,`T${t.index} · ${t.title}\n${t.instructions}`,{taskId:t.id,documentId:d.id,kind:'dispatch'});
    }
    review.createdTaskIds=created;this.runner.changed();return created;
  }
  start(id,{maxReviews,taskId}={}){
    const p=this.store.project(id);this.flow.idle(id);this.flow.cli('cc');this.flow.cli('cx');
    assert(p.intakeConfirmed&&(isAuto(p)||p.architecture.confirmed),'请先确认研究主题和 CX 分工。',409);
    assert(!p.collaboration.pendingDecision,'请先回复 CC 提出的待确认问题。',409);
    const limit=Number(maxReviews??(isAuto(p)?p.autonomy.maxReviews:p.collaboration.maxReviews)??8);assert(Number.isInteger(limit)&&limit>=1&&limit<=1000,'每轮自动复核次数为 1–1000。');
    if(taskId)assert(p.tasks.some(t=>t.id===taskId),'任务不存在。',404);
    const token={cancelled:false,teamRevision:p.steering.revision},preparation=Promise.resolve().then(async()=>{
      if(token.cancelled||this.runner.closing)return;
      if(!await this.flow.benchmark.ensure(p,token))return;
      if(isAuto(p)&&!taskId)await this.flow.leadership.organize(p,token,'研究者启动/继续 Auto Research。请根据当前研究阶段自主组织团队。');
      if(token.cancelled||this.runner.closing)return;
      if(!p.tasks.length)await this.flow.plan(id,token);
    });
    this.active.set(id,token);p.status='collaborating';p.collaboration.maxReviews=limit;p.collaboration.reviewsUsed=0;p.collaboration.state='running';p.collaboration.pauseReason='';
    const work=preparation.then(async()=>{if(token.cancelled||this.runner.closing||token.preflightBlocked)return;if(!p.tasks.length)throw new Error(p.error||'CC 尚未生成执行计划。');await this.loop(p,token,taskId);}).catch(e=>{if(this.store.state.jobs.find(j=>j.id===e.jobId)?.status==='cancelled'){token.cancelled=true;this.flow.stopProject(id);}p.collaboration.state=token.cancelled?'paused':'failed';p.collaboration.pauseReason=e.message;p.status=token.cancelled?'interrupted':'failed';p.error=e.message;this.store.log(e.message,id,'error');}).finally(()=>{if(token.cancelled||this.runner.closing){p.collaboration.state='paused';p.collaboration.pauseReason='协作已停止，可检查记录后继续。';p.status='interrupted';}this.active.delete(id);this.runner.changed();});
    token.promise=work;this.runner.changed();return work;
  }
  async loop(p,token,taskId){
    const c=p.collaboration,running=new Map();let checkpointDone=false;p.status='collaborating';p.error='';
    // Existing returned reports are reviewed first; interrupted calls never silently repeat.
    const selected=t=>{
      if(!taskId)return true;const seen=new Set();let current=t;
      while(current&&!seen.has(current.id)){if(current.id===taskId)return true;seen.add(current.id);const parent=c.reviews.find(r=>r.id===current.parentReviewId)?.taskId;current=p.tasks.find(x=>x.id===parent);}
      return false;
    };
    const needsReview=t=>selected(t)&&terminal(t)&&t.status!=='superseded'&&t.reportId&&!this.flow.meetings.reviewed(p,t);
    const ready=t=>selected(t)&&['ready','queued','interrupted','cancelled','failed'].includes(t.status)&&!t.reportId&&!t.reviewId&&(t.dependsOn||[]).every(id=>terminal(p.tasks.find(x=>x.id===id)||{}));
    try{
      while(!token.cancelled&&!this.runner.closing){
        if(!this.flow.benchmark.ready(p)){if(running.size){await Promise.all([...running.values()].map(x=>x.promise));continue;}if(!await this.flow.benchmark.ensure(p,token))break;checkpointDone=false;}
        if(!c.pendingDecision&&isAuto(p)&&token.teamRevision!==p.steering.revision){
          await this.flow.leadership.organize(p,token,'研究者已更新课题要求。请在派发下一项任务前重新检查分工、顺序和过时的待办。');
          checkpointDone=false;
          continue;
        }
        let waiting=p.tasks.find(needsReview);
        if(!waiting&&!running.size&&c.messages.some(m=>m.from==='研究者'&&m.kind==='user'&&!m.seenAt)){
          const previous=p.tasks.filter(t=>selected(t)&&t.reportId).at(-1);if(previous){previous.reviewId='';waiting=previous;}
        }
        const atLimit=c.reviewsUsed>=c.maxReviews&&Boolean(waiting||running.size||p.tasks.some(ready));
        if(!taskId&&!waiting&&!running.size&&!c.pendingDecision){
          const next=this.flow.stageCouncil.next(p);
          if(next){
            if(next.blocked){c.state='paused';c.pauseReason=next.blocked;p.status='paused';break;}
            try{await this.flow.stageCouncil.run(p,next.kind,token);checkpointDone=false;}
            catch(e){if(e.reviewStale)continue;if(e.reviewPause){c.state='paused';c.pauseReason=e.message;p.status='paused';break;}throw e;}
            continue;
          }
        }
        if(!c.pendingDecision&&!atLimit&&!waiting){
          const limit=Math.min(this.store.state.settings.concurrency,p.architecture.parallel,isAuto(p)?p.autonomy.maxParallel:Infinity);
          for(const t of p.tasks.filter(ready).sort((a,b)=>(b.priority||0)-(a.priority||0))){
            if(!this.flow.stageCouncil.canRun(p,t)||!this.flow.meetings.canRun(p,t))continue;
            if(running.size>=limit||this.runningCX>=this.store.state.settings.concurrency)break;
            if([...running.values()].some(x=>x.workerId===t.workerId))continue;
            if(t.researchStage==='writing'){const approved=p.stageReviews.filter(r=>r.kind==='results'&&r.status==='approved').at(-1);if(approved)t.councilApprovalIds=[approved.leadReviewId,`council-${approved.id}-user`];}
            t.status='queued';this.runningCX++;
            const entry={workerId:t.workerId,promise:null};running.set(t.id,entry);
            entry.promise=this.runTask(p,t,token).finally(()=>{running.delete(t.id);this.runningCX--;this.runner.changed();});
          }
        }
        if(waiting&&!c.pendingDecision&&!atLimit){await this.review(p,waiting,token);checkpointDone=false;continue;}
        if(c.pendingDecision||atLimit){
          if(running.size){await Promise.all([...running.values()].map(x=>x.promise));continue;}
          c.state=c.pendingDecision?'waiting_user':'paused';c.pauseReason=c.pendingDecision?.question||`已完成 ${c.maxReviews} 次自动复核。可检查证据后继续下一轮。`;p.status=c.pendingDecision?'awaiting_decision':'paused';break;
        }
        if(!running.size&&!p.tasks.some(needsReview)){
          if(p.tasks.some(ready)){if(!p.tasks.some(t=>ready(t)&&this.flow.stageCouncil.canRun(p,t)&&this.flow.meetings.canRun(p,t))){c.state='paused';c.pauseReason='后续阶段等待导师认可前序步骤；请先完成当前步骤的汇报、修改及所需评委会和用户审核。';p.status='paused';break;}await new Promise(r=>setTimeout(r,40));continue;}
          const blocked=p.tasks.filter(t=>selected(t)&&(!terminal(t)||!this.flow.meetings.resolved(p,t)));
          if(isAuto(p)&&!taskId&&!blocked.length&&!checkpointDone){
            if(c.reviewsUsed>=c.maxReviews){c.state='paused';c.pauseReason=`已达到本轮 ${c.maxReviews} 次复核上限，研究进度已保存。`;p.status='paused';break;}
            const last=p.tasks.filter(t=>t.reportId).at(-1);
            if(last){checkpointDone=await this.review(p,last,token,{checkpoint:true});continue;}
          }
          c.state=blocked.length?'paused':'completed';p.status=blocked.length?'paused':'cycle_complete';c.pauseReason=blocked.length?'存在尚未满足的任务依赖，请检查 Pipeline。':'本轮协作及所需审核已完成。';
          if(isAuto(p)&&!blocked.length)c.pauseReason='CC Leader 已复核全项目目标并提交本轮研究结论与证据；可继续提问或安排新目标。';
          this.store.doc(p.id,`69-cycle-${uid()}.md`,'本轮协作结果',`# 本轮协作结果\n\n${c.pauseReason}\n\n`+c.reviews.map(r=>`## ${r.summary}\n\n${r.evidence}\n\n${r.reason}`).join('\n\n'),'summary');break;
        }
        await Promise.race([...running.values()].map(x=>x.promise).concat(new Promise(r=>setTimeout(r,50))));
      }
    }finally{await Promise.allSettled([...running.values()].map(x=>x.promise));this.runner.changed();}
  }
  async runTask(p,t,token){
    const w=p.architecture.workers.find(w=>w.id===t.workerId),cwd=path.join(this.store.folder(p.id),'work',w.id);fs.mkdirSync(cwd,{recursive:true});t.cwd=cwd;t.status='running';t.error='';
    const doc=this.store.readDoc(p.id,t.documentId);fs.writeFileSync(path.join(cwd,'TASK.md'),doc.content);
    const handoffs=p.tasks.filter(x=>(t.dependsOn||[]).includes(x.id)&&x.reportId).map(x=>{const d=this.store.readDoc(p.id,x.reportId);return `## ${x.id} / ${x.title}\n只读产物目录：${x.cwd||'未记录'}\n报告：${d.path}\n${d.content.slice(-15000)}`;}).join('\n\n');
    this.message(p,'CC',w.name,`开始 T${t.index}：${t.title}。完成或遇到阻塞后向 CC 回报。`,{taskId:t.id,kind:'start'});
    const prompt=`你是 ${w.name}，分工：${w.role}。本次是持续科研协作中的一个小步骤，完成后即返回，由 CC 复核再决定下一步。\n当前调度优先于原任务文档中的旧成员名称；本任务由 ${w.name} 执行。\n最新待办调整：${JSON.stringify(t.leaderChanges||[])}\n读取 TASK.md：\n${doc.content}\n\n## 依赖的 CX 报告（只读共享）\n${handoffs||'无'}\n\n## 最近的团队沟通\n${p.collaboration.messages.slice(-12).map(m=>`${m.from} → ${m.to}: ${m.content}`).join('\n')}\n\n只修改当前工作目录。不要向其它 CX 目录写入，不自行扩展研究范围。用 Markdown 回报：实际操作/命令、结果与证据路径、指标与不确定性、遇到的问题、需要 CC 或其它 CX 回答的问题、建议下一步。程序成功退出不等于研究假设成立。未运行的实验与未核验的文献不得声称完成。`;
    try{
      // Auto mode already obtained model decisions from the leader at this scheduling boundary.
      if(p.modelPolicy.allowCCSwitch){
        if(isAuto(p)&&p.teamChanges.length){t.model=w.model||'';t.modelReason=w.pinned?'用户固定此 CX 配置。':w.reason||'CC Leader 的当前模型安排';}
        else await this.flow.chooseModel(p,w,t,token);
      }
      if(token.cancelled||this.runner.closing)throw new Error('任务已停止。');
      if(!this.flow.benchmark.ready(p)||(isAuto(p)&&token.teamRevision!==p.steering.revision)){t.status='ready';return;}
      if(!this.flow.stageCouncil.canRun(p,t)||!this.flow.meetings.canRun(p,t)){t.status='ready';return;}
      t.benchmarkRunId=p.benchmarkResearch.runs.at(-1).id;
      const r=await this.runner.run({projectId:p.id,provider:'cx',kind:'execution',title:`${w.name} · T${t.index} ${t.title}`,executable:this.flow.cli('cx'),cwd,prompt:prompt+'\n\n'+this.flow.benchmark.context(p),workerId:w.id,taskId:t.id,sessionId:t.sessionId||w.sessionId||undefined});
      t.sessionId=r.job.sessionId||t.sessionId;w.sessionId=t.sessionId;t.jobId=r.job.id;t.status='completed';
      const d=this.store.doc(p.id,`40-report-${t.index}.md`,`${w.name} / T${t.index} 回报`,r.text||'没有最终文本。需要检查日志与产物，不能视为验收通过。','report');t.reportId=d.id;
      this.message(p,w.name,'CC',r.text||'未返回最终文本报告。',{taskId:t.id,documentId:d.id,kind:'report'});
    }catch(e){
      const j=this.store.state.jobs.find(j=>j.id===e.jobId);t.jobId=e.jobId||t.jobId;t.sessionId=j?.sessionId||t.sessionId;if(t.sessionId)w.sessionId=t.sessionId;
      if(j?.status==='cancelled'){token.cancelled=true;this.flow.stopProject(p.id);}
      t.status=token.cancelled||this.runner.closing?'interrupted':'failed';t.error=e.message;
      if(t.status==='failed'){const d=this.store.doc(p.id,`40-report-${t.index}.md`,`${w.name} / T${t.index} 错误回报`,`# 执行未完成\n\n${e.message}\n\n不得把此错误当作实验结果。`,'report');t.reportId=d.id;this.message(p,w.name,'CC',e.message,{taskId:t.id,documentId:d.id,kind:'error'});}
    }
  }
  async review(p,t,token,{checkpoint=false}={}){
    const c=p.collaboration,report=this.store.readDoc(p.id,t.reportId),messages=c.messages.filter(m=>m.from==='研究者'&&!m.seenAt),reviewId=uid();
    if(isAuto(p))await this.flow.leadership.organize(p,token,checkpoint?'当前待办均已返回，请检查整个研究目标还缺哪些证据，并为下一阶段组织团队。':`T${t.index} 已返回：${report.content.slice(-18000)}。根据结果评估是否需要调整 CX 人数、职责、模型和 Skills。`);
    if(token.cancelled||this.runner.closing)return;
    const revision=p.steering.revision,sourceHash=this.flow.meetings.taskHash(p,t);
    c.reviewsUsed++;this.message(p,'CC','团队',`正在复核 T${t.index}：${t.title}`,{taskId:t.id,kind:'reviewing'});
    const prompt=`你是 CC 科研导师。现在复核 CX 返回的一个步骤，并为团队决定后续动作。\n课题：${p.title}\n${p.brief}\n科研流程：${researchStages.map(s=>`${s.id}: ${s.title}，${s.gate}`).join('\n')}\n\n研究目标与明确约束：${scopeContext(p)}\n团队：${JSON.stringify(p.architecture.workers)}\n全部任务状态（id 用于依赖）：${JSON.stringify(p.tasks.map(x=>({id:x.id,title:x.title,status:x.status,review:x.reviewId,workerId:x.workerId,researchStage:x.researchStage,cwd:x.cwd})))}\n\n当前回报任务：${t.id} / T${t.index} ${t.title}\n要求：${t.instructions||''}\n验收：${t.acceptance||''}\n真实报告文件：${report.path}\n${report.content}\n\n研究者的新消息：${messages.map(m=>m.content).join('\n')||'无'}\n最近复核：${JSON.stringify(c.reviews.slice(-3).map(r=>({summary:r.summary,evidence:r.evidence,reason:r.reason})))}\n\n请按 schema 返回。assessment=passed/retry/blocked；decision=continue/ask_user/finish。明确证据路径、实际读过/验证过的内容、仅 CX 自报的内容。CLI 退出成功不等于科研结论成立；结果未达到预期也不必然是实现错误。失败时区分代码、数据、设计和假设，保留阴性结果。可交由另一 CX 独立验证或提出替代方法，nextTasks 必须是小而可验的步骤，并引用上述研究目标标识 questionIds 和已有已返回的 dependsOn 任务 id。研究阶段用规定 id；relation=retry/alternative/next/verify。handoff 是给其它 CX 的共享信息或需要它们回答的问题。若改变核心假设、指标、数据范围、资源预算或缺少用户材料，必须 ask_user 并写清问题；nextTasks 只作为待确认方案。不要无限追求正结果。证据足够且本分支无需再执行时 finish（不代表整项研究完成）。不调用实现工具。`;
    const instructionBase=isAuto(p)?prompt.replace('若改变核心假设、指标、数据范围、资源预算或缺少用户材料，必须 ask_user 并写清问题；nextTasks 只作为待确认方案。','在已确认研究目标、数据权限与资源边界内，你自主调整实现、替代方法、辅助假设、实验顺序、验证策略和研究阶段，不要为常规技术决策反复请示。只有违背用户明确决定、需要新授权/额外预算或缺少无法自行获取的必要材料时 ask_user；nextTasks 此时作为待确认方案。').replace('不调用实现工具。','可以使用 Read/Glob/Grep 核对实际文件，或让 CX 进行独立验证。不要把自报内容当成已经独立验证；实现和实验通过下发 CX 任务完成。')+`\n\n你是 Auto Research 的负责人。研究者的 Leader 要求：${p.autonomy.brief||'自主推进至研究目标完成'}。当前活跃团队 id：${activeWorkers(p).map(w=>w.id).join(', ')}，已归档成员不得分派任务。${checkpoint?'这是全项目检查点，全部现有任务已经返回。对照最初目标、执行说明和科研流程检查证据缺口。如果还需要数据、实验、分析或写作，decision=continue 并创建具体 nextTasks，自动进入下一阶段；如果所有目标已经达到或证据支持有意义的阴性结论，才 decision=finish，明确已完成项、结论、限制与产物路径。不能因为一个 CX 结束就停止全项目，也不要为了正结果无限返工。':'此处 finish 仅表示本分支完成，工作台仍将进行全项目检查。'}`:prompt;
    const instruction=instructionBase+'\n这是每个执行步骤结束后的导师组会。summary 写做了什么；evidence 写实际证据及未核验的部分；reason 必须判断当前方向是否仍能回答课题问题、失败属于实现还是假设/设计，以及继续投入是否合理；handoff 写下一步、验收和停止条件。最小验证结束时必须明确是否值得扩大到正式实验，不能只判断代码能运行。assessment=passed 代表导师认可本步骤方向和证据，retry 必须先安排当前或前序步骤的修改，blocked 等待必要材料。结合同阶段已有回报给出判断，不因单个漂亮指标忽略其他失败证据。\n同阶段已回报：'+JSON.stringify(p.tasks.filter(x=>x.researchStage===t.researchStage&&x.reportId).map(x=>({title:x.title,assessment:x.assessment,report:this.store.readDoc(p.id,x.reportId).content.slice(-6000)})))+'\n阶段出环规则：提案、实验结果与论文必须三位委员全票通过后提交用户审核，用户通过才可推进。你可以提前列出后续待办，但不得将待审核阶段宣称已完成。用户退回则修改、重新送审。\n\n'+this.flow.benchmark.context(p)+'\n当前任务的协议版本：'+(t.benchmarkRunId||'历史未记录')+'。核对实际回报采用的 baseline、指标、数据划分与预算。若版本/设置不一致，不直接比较性能；安排必要的重跑或说明不可比。';
    this.store.doc(p.id,`61-review-request-${reviewId}.md`,`${checkpoint?'CC 全项目检查':'CC 复核指令'} / T${t.index}`,instruction,'request');
    const r=await this.runner.run({projectId:p.id,provider:'cc',kind:'feedback',title:checkpoint?'CC Leader · 检查研究目标并推进下一阶段':`主 CC 组会 · T${t.index} 汇报与方向判断`,executable:this.flow.cli('cc'),cwd:this.store.folder(p.id),prompt:instruction,schema:feedbackSchema,sessionId:p.ccSessionId||undefined,taskId:t.id});
    if(token.cancelled||this.runner.closing||revision!==p.steering.revision||sourceHash!==this.flow.meetings.taskHash(p,t))return false;
    p.ccSessionId=r.job.sessionId||p.ccSessionId;
    const data=validateFeedback(p,parse(r)),review={...data,id:reviewId,taskId:t.id,at:now(),jobId:r.job.id,checkpoint,meeting:true,researchStage:t.researchStage,sourceHash,reportId:t.reportId,requirementsRevision:revision,benchmarkRunId:p.benchmarkResearch?.runs?.at(-1)?.id,createdTaskIds:[]};
    if(data.assessment==='retry'&&data.decision==='continue')assert(data.nextTasks.some(n=>n.relation!=='next'&&stageIds.indexOf(n.researchStage)<=stageIds.indexOf(t.researchStage)),'导师要求修改时，必须先安排当前或前序步骤的修正，不能直接跳到下一阶段。');
    if(checkpoint&&data.decision==='continue')assert(data.nextTasks.length,'CC 全项目检查决定继续，但没有给出后续任务。');
    const d=this.store.doc(p.id,`62-feedback-${reviewId}.md`,`CC 反馈 / T${t.index}`,`# ${data.summary}\n\n判断：${data.assessment}\n决策：${data.decision}\n\n## 证据\n${data.evidence}\n\n## 导师对方向的判断\n${data.reason}\n\n## 下一步与验收\n${data.handoff}\n\n## 待研究者确认\n${data.question}\n\n## 下一步\n${data.nextTasks.map(x=>`### ${x.title}\n${x.instructions}\n验收：${x.acceptance}`).join('\n\n')}`,'feedback');review.documentId=d.id;
    c.reviews.push(review);t.reviewId=review.id;t.assessment=data.assessment;messages.forEach(m=>m.seenAt=now());
    this.message(p,'CC','研究者与所有 CX',`${data.summary}\n${data.reason}\n${data.handoff}`,{taskId:t.id,reviewId,documentId:d.id,kind:'feedback'});
    if(data.decision==='ask_user'){c.pendingDecision={id:reviewId,question:data.question,reviewId};this.message(p,'CC','研究者',data.question,{reviewId,kind:'question'});}
    else if(data.nextTasks.length)this.addTasks(p,review);
    this.runner.changed();return true;
  }
  send(id,content){
    this.flow.steering.submit(id,{message:content});
    return this.flow.steering.active.get(id);
  }
  decide(id,input){
    const p=this.store.project(id);this.flow.idle(id);const c=p.collaboration,pending=c.pendingDecision;
    assert(pending&&pending.id===input.decisionId,'待确认问题已变化，请刷新。',409);assert(['approve','revise'].includes(input.action),'请选择确认或要求调整。');
    if(pending.councilRoundId){this.flow.stageCouncil.decide(p,pending,input);return this.start(id,{maxReviews:c.maxReviews});}
    const content=text(input.message,20000),review=c.reviews.find(r=>r.id===pending.reviewId);
    this.message(p,'研究者','CC',content,{kind:'decision',decisionId:pending.id,action:input.action});
    if(input.action==='approve'&&review.nextTasks.length){validateFeedback(p,review);this.addTasks(p,review);}
    else {const task=p.tasks.find(t=>t.id===review.taskId);task.reviewId='';}
    c.pendingDecision=null;review.userDecision={action:input.action,content,at:now()};this.runner.changed();
    return this.start(id,{maxReviews:c.maxReviews});
  }
  stop(id){const token=this.active.get(id);if(token)token.cancelled=true;}
}
