import {assert,text,uid,now} from './store.mjs';
import {loadSelectedSkills} from './skills.mjs';
import {modelCatalog} from './models.mjs';

const string={type:'string'};
export const teamSchema={type:'object',additionalProperties:false,required:['message','phase','parallel','workers'],properties:{message:string,phase:{type:'string',enum:['clarifying','proposal']},parallel:{type:'integer',minimum:1,maximum:16},workers:{type:'array',maxItems:32,items:{type:'object',additionalProperties:false,required:['id','role','model','language','skillIds','reason'],properties:{id:string,role:string,model:string,language:string,skillIds:{type:'array',items:string,maxItems:30},reason:string}}}}};
export const modelName=value=>{assert(typeof value==='string'&&value.length<=160&&!/[\r\n\0]/.test(value)&&(!value||/^[A-Za-z0-9][A-Za-z0-9._:/@+\[\]-]*$/.test(value)),'模型名称格式无效。');return value.trim();};
export function validateTeam(p,input,catalog) {
  assert(Array.isArray(input.workers)&&input.workers.length>=1&&input.workers.length<=32,'CX 数量应为 1–32。');
  assert(Number.isInteger(input.parallel)&&input.parallel>=1&&input.parallel<=16,'并行执行数量应为 1–16。');
  const seen=new Set();
  let nextNumber=Math.max(0,...p.architecture.workers.map(w=>Number(w.name.match(/\d+$/)?.[0])||0))+1;
  const workers=input.workers.map((w,i)=>{
    const old=w.id?p.architecture.workers.find(x=>x.id===w.id):null;
    assert(!w.id||old,'不能指定不存在的 CX 标识。');
    const id=old?.id||`cx-${uid().slice(0,8)}`;assert(!seen.has(id),'CX 标识不能重复。');seen.add(id);
    assert(w.skillIds===undefined||Array.isArray(w.skillIds),'Skill 选择必须是列表。');
    const skillIds=[...new Set(w.skillIds||[])];assert(skillIds.length<=30&&skillIds.every(x=>typeof x==='string'),'最多选择 30 个 Skills。');
    loadSelectedSkills({skillIds:[...new Set([...p.skillIds,...skillIds])]},catalog);
    return {active:true,pinned:w.pinned===true,id,name:old?.name||`CX-${String(nextNumber++).padStart(2,'0')}`,role:text(w.role,2000),model:modelName(w.model??old?.model??''),language:typeof w.language==='string'&&w.language.trim()?text(w.language,80):'',skillIds,sessionId:old?.sessionId||''};
  });
  for(const old of p.architecture.workers)if(old.active!==false&&!workers.some(w=>w.id===old.id))assert(!old.sessionId&&!p.tasks.some(t=>t.workerId===old.id),'有任务或会话记录的 CX 不能移除，请保留以便追溯。',409);
  return {mentor:'CC Leader',confirmed:true,parallel:input.parallel,workers:[...workers,...p.architecture.workers.filter(w=>w.active===false&&!workers.some(x=>x.id===w.id))]};
}
export function teamPrompt(p,message,catalog) {
  const models=modelCatalog();
  return `你是 CC 导师，和研究者讨论本课题的 CX 团队，不执行实现。课题：${p.researchTopic||p.title}\n${p.brief}\n\n现有架构：${JSON.stringify(p.architecture)}\n用户模型策略：${JSON.stringify(p.modelPolicy)}\n模型目录（仅配置/缓存，不保证网关权限）：${JSON.stringify(models)}\n本机 Skills（只能使用列出的 id；无合适项可以为空）：${JSON.stringify(catalog.map(s=>({id:s.id,name:s.name,description:s.description.slice(0,250)})))}\n\n讨论记录：\n${p.teamConversation.map(m=>(m.role==='user'?'研究者':'CC')+'：'+m.content).join('\n\n')}\n\n先与用户明确开几个 CX（1–32 个）、分工边界、交接关系和并发上限（1–16）。给出每个 CX 的模型、输出语言、推荐 Skills 及理由。不要只因为有 Skill 就推荐。不要捏造模型价格、性能或权限；不确定时用空 model 沿用本机默认，说明假设。已有 CX 使用现有 id，新增 CX id 留空；${p.autonomy?.mode==='auto'?'运行中、有待办或用户固定的 CX 必须保留；其余成员可归档，历史不会删除。':'有任务或会话记录的 CX 必须保留。'}\n信息不足时 phase=clarifying，提 1–3 个问题，workers=[]。足够时 phase=proposal，输出完整 workers（每个包含 id,role,model,language,skillIds,reason）和 parallel，message 说明方案与权衡。${p.autonomy?.mode==='auto'?'研究者已授权自主带队，方案直接生效，不需要额外采纳。':'研究者可以继续讨论，必须点击采纳才更改架构。'}最后一条用户输入：${message}`;
}
export function teamMarkdown(p) {
  return `# ${p.title}：当前 CX 团队\n\n并发上限：${p.architecture.parallel}\n\n`+p.architecture.workers.map(w=>`## ${w.name}\n\n- 状态：${w.active===false?'已归档':'活跃'}${w.pinned?' / 用户固定':''}\n- 标识：${w.id}\n- 分工：${w.role}\n- 模型：${w.model||'CLI 默认'}\n- 输出语言：${w.language||p.mentor.language}\n- 专用 Skills：${w.skillIds.join(', ')||'无'}\n`).join('\n');
}
export function recordModelChange(p,worker,model,reason,source,taskId) {
  const previous=worker.model||'';worker.model=model;
  p.modelChanges.push({id:uid(),at:now(),workerId:worker.id,previous,model,reason,source,taskId});
}
