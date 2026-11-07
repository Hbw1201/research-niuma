import {createHash} from 'node:crypto';
import {assert,text,uid,now} from './store.mjs';
import {researchStages,stageIds} from '../public/research-stages.js';

export const meetingHash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const str={type:'string',minLength:1};
export const meetingSchema={type:'object',additionalProperties:false,required:['summary','work','evidence','direction','risks','nextStep','verdict','revisionInstructions'],properties:{summary:str,work:str,evidence:str,direction:str,risks:str,nextStep:str,verdict:{enum:['proceed','revise','blocked']},revisionInstructions:{type:'string'}}};
export function validateMeeting(d){
  for(const k of ['summary','work','evidence','direction','risks','nextStep'])text(d?.[k],20000);
  assert(['proceed','revise','blocked'].includes(d.verdict),'导师组会判断无效。');
  assert(typeof d.revisionInstructions==='string','导师修改指令格式错误。');
  if(d.verdict!=='proceed')text(d.revisionInstructions,20000);
  return d;
}
const verdictNames={proceed:'认可方向，允许继续',revise:'退回修改后再汇报',blocked:'缺少材料，暂停推进'};
export class MentorMeetings {
  constructor(flow){this.flow=flow;}
  source(p,stage,key,documentId){const d=this.flow.store.readDoc(p.id,documentId);return {stage,key,documentId,path:d.path,content:d.content,goal:p.brief,requirementsRevision:p.steering?.revision||0};}
  latest(p,stage,key){return p.mentorMeetings?.filter(m=>m.stage===stage&&(!key||m.source.key===key)).at(-1);}
  accepted(p,stage,key,documentId){try{const m=this.latest(p,stage,key);return Boolean(m?.status==='completed'&&m.data.verdict==='proceed'&&m.sourceHash===meetingHash(this.source(p,stage,key,documentId)));}catch{return false;}}
  pause(p,token,reason){p.status='paused';p.collaboration.state='paused';p.collaboration.pauseReason=reason;token.preflightBlocked=true;this.flow.runner.changed();return false;}
  async review(p,stage,key,documentId,token){
    if(this.accepted(p,stage,key,documentId))return this.latest(p,stage,key);
    const {runner,store}=this.flow,source=this.source(p,stage,key,documentId),sourceHash=meetingHash(source),prior=this.latest(p,stage,key);
    if(p.collaboration.reviewsUsed>=p.collaboration.maxReviews){this.pause(p,token,'达到本轮导师复核上限，组会进度已保存；继续研究后补齐。');return null;}
    const m={id:uid(),stage,number:(p.mentorMeetings?.filter(m=>m.stage===stage).length||0)+1,status:'running',createdAt:now(),source,sourceHash,jobId:uid()};
    (p.mentorMeetings||=[]).push(m);p.collaboration.reviewsUsed++;runner.changed();
    const title=researchStages.find(s=>s.id===stage)?.title||stage;
    const check=()=>{if(token.cancelled||runner.closing)throw Object.assign(new Error('导师组会已暂停，材料与已完成记录保留。'),{cancelled:true});assert(sourceHash===meetingHash(this.source(p,stage,key,documentId)),'组会材料或研究要求已变化，不能沿用旧结论。',409);};
    try{
      check();
      const prompt=`你是主 CC 科研导师。现在召开一次步骤组会，审视刚完成的“${title}”，确认研究方向再放行后续工作。不是自动复述生成者的结论，也不能把程序退出成功当作科学正确。\n课题目标：${p.brief}\n本步骤判断标准：${researchStages.find(s=>s.id===stage)?.gate}\n冻结的汇报材料：${source.path}\n${source.content}\n上次组会意见：${JSON.stringify(prior?.data||null)}\n\n按 schema 汇报：work=实际做了什么；evidence=真实证据位置、核对过的内容及尚未验证的主张；direction=是否回答课题问题、当前假设是否仍成立、是否值得投入下一步；risks=局限、失败原因与替代解释；nextStep=下一步做什么及验收/停止条件。verdict=proceed 才允许进入下一步；有问题则 revise 并给具体 revisionInstructions；必要材料无法获取则 blocked，说明缺什么。不要为了得到正结果无限修改。\n文献阶段核查来源、经典与近期方法覆盖、研究缺口依据。评测阶段核查比较对象是否公平、指标是否对应研究目标、样本独立性、防泄漏、预算及成功/失败条件。设计阶段核查任务是否建立在已获认可的评测上，任务顺序和规模是否合理。可以读取证据，不修改项目、不代替 CX 实验、不生成问卷，不替用户通过正式评委会后的审核。`;
      const result=await runner.run({id:m.jobId,projectId:p.id,provider:'cc',kind:'mentor-meeting',title:`主 CC 组会 · ${title} · 第 ${m.number} 次`,executable:this.flow.cli('cc'),cwd:store.folder(p.id),prompt,schema:meetingSchema,sessionId:p.ccSessionId||undefined});
      check();const data=validateMeeting(result.structured||JSON.parse(result.text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,'')));
      p.ccSessionId=result.job.sessionId||p.ccSessionId;
      const doc=store.doc(p.id,`26-mentor-${m.id}.md`,`${title} · 导师组会 ${m.number}`,`# ${title} · 导师组会\n\n材料版本：${sourceHash}\n\n## 做了什么\n\n${data.work}\n\n## 证据与核验边界\n\n${data.evidence}\n\n## 导师对方向的判断\n\n${data.direction}\n\n## 问题与风险\n\n${data.risks}\n\n## 下一步与验收\n\n${data.nextStep}\n\n## 组会结论\n\n${verdictNames[data.verdict]}\n\n${data.summary}\n\n${data.revisionInstructions}`,'mentor-meeting');
      Object.assign(m,{status:'completed',data,documentId:doc.id,completedAt:now()});
      this.flow.collaboration.message(p,'主 CC 导师','研究者与团队',`${title}组会：${verdictNames[data.verdict]}\n${data.summary}\n方向判断：${data.direction}\n下一步：${data.nextStep}`,{kind:'mentor-meeting',meetingId:m.id,researchStage:stage,documentId:doc.id});
      return m;
    }catch(e){m.status=token.cancelled||e.cancelled?'interrupted':'failed';m.error=e.message;throw e;}finally{runner.changed();}
  }
  taskHash(p,t){return meetingHash({taskId:t.id,instructions:t.instructions,acceptance:t.acceptance,stage:t.researchStage,reportId:t.reportId,content:this.flow.store.readDoc(p.id,t.reportId).content,requirementsRevision:p.steering?.revision||0,benchmarkId:p.benchmarkResearch?.runs?.at(-1)?.id});}
  reviewed(p,t){if(!t?.reportId||!t.reviewId)return false;const r=p.collaboration.reviews.find(r=>r.id===t.reviewId);if(!r)return false;try{return !r.sourceHash||r.sourceHash===this.taskHash(p,t);}catch{return false;}}
  resolved(p,t,seen=new Set()){
    if(t.status==='superseded')return true;
    if(seen.has(t.id)||!this.reviewed(p,t))return false;
    if(t.assessment==='passed')return true;
    seen.add(t.id);const r=p.collaboration.reviews.find(r=>r.id===t.reviewId);
    const corrections=p.tasks.filter(x=>r?.createdTaskIds?.includes(x.id)&&(x.relation!=='next'||r.userDecision?.action==='approve')&&stageIds.indexOf(x.researchStage)<=stageIds.indexOf(t.researchStage));
    return corrections.length>0&&corrections.every(x=>this.resolved(p,x,new Set(seen)));
  }
  canRun(p,t){
    if(p.executionPlan?.meetingStatus&&p.executionPlan.meetingStatus!=='proceed')return false;
    if((t.dependsOn||[]).some(id=>{const parent=p.tasks.find(x=>x.id===id);if(!parent)return true;if(parent.status==='superseded')return false;if(!this.reviewed(p,parent))return true;const r=p.collaboration.reviews.find(r=>r.id===parent.reviewId),correction=t.parentReviewId===r?.id&&(t.relation!=='next'||r?.userDecision?.action==='approve');return !correction&&!this.resolved(p,parent);}))return false;
    const rank=stageIds.indexOf(t.researchStage);
    return p.tasks.filter(x=>x.id!==t.id&&x.status!=='superseded'&&stageIds.indexOf(x.researchStage)>=0&&stageIds.indexOf(x.researchStage)<rank).every(x=>this.resolved(p,x));
  }
}
