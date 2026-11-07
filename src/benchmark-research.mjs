import {createHash} from 'node:crypto';
import {assert,text,uid,now} from './store.mjs';
import {meetingHash} from './mentor-meetings.mjs';

const str={type:'string',minLength:1};
const strings={type:'array',items:str};
const object=properties=>({type:'object',additionalProperties:false,required:Object.keys(properties),properties});
const list=(items,maxItems=24)=>({type:'array',items,maxItems});
const status={type:'string',enum:['ready','blocked']};
export const literatureSchema=object({status,summary:str,searchScope:str,coverage:str,gaps:strings,
 papers:list(object({id:str,title:str,year:{type:'integer',minimum:1800,maximum:2200},url:str,access:{type:'string',enum:['fulltext','abstract','unavailable']},location:str,evidence:str,relevance:str})),
 methods:list(object({id:str,name:str,category:{type:'string',enum:['classic','recent','reference']},paperIds:strings,role:{type:'string',enum:['proposed','baseline']},paperBenchmark:str,implementation:str,limitations:str})),
 reason:str,
});
export const benchmarkSchema=object({status,summary:str,rationale:str,
 baselines:list(object({methodId:str,reason:str,implementation:str,adaptation:str})),
 metrics:list(object({name:str,primary:{type:'boolean'},definition:str,direction:{type:'string',enum:['higher','lower','target']},unit:str,aggregation:str,paperIds:strings,reason:str})),
 dataset:object({name:str,paperIds:strings,split:str,leakageControls:str,preprocessing:str}),
 protocol:object({tuning:str,resources:str,repetitions:str,uncertainty:str,successCriteria:str,failureCriteria:str,reporting:str}),
 limitations:strings,reason:str,
});
export const benchmarkHash=p=>createHash('sha256').update(JSON.stringify({title:p.title,goal:p.brief,requirements:p.steering?.revision||0,revision:p.benchmarkResearch?.revision||0})).digest('hex');
export const currentBenchmark=p=>p.benchmarkResearch?.runs?.at(-1);
export const benchmarkReady=p=>{const r=currentBenchmark(p);return Boolean(r?.status==='ready'&&r.sourceHash===benchmarkHash(p)&&[r.literature,r.protocol].every(s=>s.mentorReview?.verdict==='proceed'&&s.mentorReview.dataHash===meetingHash(s.data)));};
function unique(items,label){assert(Array.isArray(items)&&items.length<=24,`${label}格式错误。`);const ids=items.map(x=>text(x.id,120));assert(new Set(ids).size===ids.length,`${label}标识重复。`);}
function refs(ids,allowed,label){assert(Array.isArray(ids)&&ids.length>0&&new Set(ids).size===ids.length&&ids.every(id=>allowed.has(id)),`${label}缺少可追溯来源，或引用了未知/未读原文。`);}
function url(value){try{const u=new URL(value);assert(['https:','http:'].includes(u.protocol)&&!u.username&&!u.password,'文献链接必须为不含凭据的 HTTP(S) 地址。');}catch{assert(false,'文献链接格式错误。');}}
function state(data){assert(['ready','blocked'].includes(data?.status),'调研状态无效。');text(data.summary);text(data.reason);}
export function validateLiterature(data){
 state(data);text(data.searchScope);text(data.coverage);unique(data.papers,'文献');unique(data.methods,'方法');
 for(const p of data.papers){text(p.title);url(p.url);assert(Number.isInteger(p.year)&&p.year>=1800&&p.year<=new Date().getFullYear()+1,'文献年份无效。');assert(['fulltext','abstract','unavailable'].includes(p.access),'原文读取状态无效。');for(const k of ['location','evidence','relevance'])text(p[k]);}
 const read=new Set(data.papers.filter(p=>p.access==='fulltext').map(p=>p.id));
 for(const m of data.methods){for(const k of ['name','paperBenchmark','implementation','limitations'])text(m[k]);assert(['classic','recent','reference'].includes(m.category)&&['proposed','baseline'].includes(m.role),'方法分类无效。');refs(m.paperIds,read,'方法与论文实验设置');}
 assert(Array.isArray(data.gaps)&&data.gaps.every(x=>typeof x==='string'),'文献缺口格式错误。');
 if(data.status==='ready')assert(read.size>0&&data.methods.length>0,'尚未读取相关原文与方法依据，不能完成文献调研。');
 return data;
}
export function validateBenchmark(data,literature){
 state(data);text(data.rationale);assert(Array.isArray(data.baselines)&&Array.isArray(data.metrics)&&Array.isArray(data.limitations),'评测方案格式错误。');
 const methods=new Set(literature.methods.map(m=>m.id)),read=new Set(literature.papers.filter(p=>p.access==='fulltext').map(p=>p.id));
 for(const b of data.baselines){assert(methods.has(b.methodId),'Baseline 必须来自已读取文献的方法清单。');for(const k of ['reason','implementation','adaptation'])text(b[k]);}
 assert(new Set(data.baselines.map(b=>b.methodId)).size===data.baselines.length,'Baseline 重复。');
 for(const m of data.metrics){for(const k of ['name','definition','unit','aggregation','reason'])text(m[k]);assert(typeof m.primary==='boolean'&&['higher','lower','target'].includes(m.direction),'指标方向或主指标标记无效。');refs(m.paperIds,read,'评价指标');}
 for(const k of ['name','split','leakageControls','preprocessing'])text(data.dataset?.[k]);
 if(data.status==='ready'||data.dataset.paperIds?.length)refs(data.dataset.paperIds,read,'数据与评测协议');
 for(const k of ['tuning','resources','repetitions','uncertainty','successCriteria','failureCriteria','reporting'])text(data.protocol?.[k]);
 if(data.status==='ready')assert(data.baselines.length>0&&data.metrics.some(m=>m.primary),'评测方案至少需要一个有依据的 baseline 和一个主指标。');
 return data;
}
const parse=r=>r.structured||JSON.parse(r.text.trim().replace(/^```(?:json)?\s*/,'').replace(/\s*```$/,''));
export function literatureMarkdown(d){return `# 文献与方法对照\n\n${d.summary}\n\n## 检索范围与覆盖\n\n${d.searchScope}\n\n${d.coverage}\n\n## 原文与依据\n\n`+d.papers.map(p=>`### ${p.id} · ${p.title} (${p.year})\n\n来源：${p.url}\n读取范围（CC 报告）：${p.access}\n原文位置：${p.location}\n相关性：${p.relevance}\n\n${p.evidence}`).join('\n\n')+'\n\n## 经典、近期方法与论文中的对照\n\n'+d.methods.map(m=>`### ${m.id} · ${m.name}\n\n类别：${m.category}；论文角色：${m.role}\n来源：${m.paperIds.join(', ')}\n\n原论文如何评测：${m.paperBenchmark}\n\n实现与版本：${m.implementation}\n\n适用限制：${m.limitations}`).join('\n\n')+'\n\n## 缺口\n\n'+d.gaps.map(x=>'- '+x).join('\n')+'\n\n'+d.reason;}
export function benchmarkMarkdown(d,l){return `# 文献驱动的评测方案\n\n${d.summary}\n\n## 为什么这样比较\n\n${d.rationale}\n\n## Baseline 选择\n\n`+d.baselines.map(b=>`### ${l.methods.find(m=>m.id===b.methodId)?.name||b.methodId}\n\n选择依据：${b.reason}\n实现：${b.implementation}\n与原论文的差异：${b.adaptation}`).join('\n\n')+'\n\n## 性能指标\n\n'+d.metrics.map(m=>`### ${m.primary?'主指标':'辅助指标'} · ${m.name}\n\n定义：${m.definition}\n方向：${m.direction}；单位：${m.unit}\n统计单位与汇总：${m.aggregation}\n依据：${m.paperIds.join(', ')}\n理由：${m.reason}`).join('\n\n')+`\n\n## 数据与划分\n\n${d.dataset.name}\n来源：${d.dataset.paperIds.join(', ')}\n划分：${d.dataset.split}\n防泄漏：${d.dataset.leakageControls}\n预处理：${d.dataset.preprocessing}\n\n## 公平比较与判断标准\n\n`+Object.entries(d.protocol).map(([k,v])=>`### ${{tuning:'调参与训练条件',resources:'资源预算',repetitions:'重复试验',uncertainty:'不确定性与统计',successCriteria:'性能判断标准',failureCriteria:'失败与停止标准',reporting:'结果记录与展示'}[k]}\n\n${v}`).join('\n\n')+'\n\n## 限制与不可直接比较之处\n\n'+d.limitations.map(x=>'- '+x).join('\n')+'\n\n'+d.reason;}

export class BenchmarkResearch {
 constructor(flow){this.flow=flow;}
 ready(p){const r=currentBenchmark(p);return benchmarkReady(p)&&this.flow.meetings.accepted(p,'literature',r.id+':literature',r.literature.documentId)&&this.flow.meetings.accepted(p,'benchmark',r.id+':protocol',r.protocol.documentId);}
 context(p){const r=currentBenchmark(p);if(!this.ready(p))return '尚未形成当前研究要求下的文献与评测方案。先完成原文调研和性能衡量设计，暂不派发实现或实验。';return `本课题当前评测方案版本：${r.id}\n\n${benchmarkMarkdown(r.protocol.data,r.literature.data)}\n\n来源原文：${r.literature.data.papers.map(p=>p.id+' '+p.title+' '+p.url+' '+p.location).join('\n')}\n\n实施时保留协议版本；文献报告值和本地复跑值分开记录。不得用测试集选择模型，不得把不同数据划分或预算下的数值直接排名。新要求导致评测方案变化时，旧结果保留，并说明是否需要重跑。`;}
 check(p,r,token){if(token.cancelled||this.flow.runner.closing)throw Object.assign(new Error('文献与评测准备已暂停，已完成步骤保留。'),{cancelled:true});assert(r.sourceHash===benchmarkHash(p),'研究要求已变化，请按新要求继续文献与评测准备。',409);}
 async ensure(p,token){
  for(let attempt=0;attempt<3;attempt++){
   const ok=await this.ensureRound(p,token);if(ok||token.preflightBlocked||token.cancelled||this.flow.runner.closing)return ok;
  }
  return this.flow.meetings.pause(p,token,'导师已连续审视并要求修改 3 次，尚未认可方向。组会记录已保留，可继续修改与汇报。');
 }
 async ensureRound(p,token){
  if(this.ready(p))return true;
  const {store,runner}=this.flow; p.benchmarkResearch||={revision:0,runs:[]};
  let r=currentBenchmark(p);
  if(!r||r.sourceHash!==benchmarkHash(p)){r={id:uid(),number:p.benchmarkResearch.runs.length+1,createdAt:now(),goal:p.brief,title:p.title,requirementsRevision:p.steering?.revision||0,revision:p.benchmarkResearch.revision||0,sourceHash:benchmarkHash(p),status:'pending',literature:{status:'pending'},protocol:{status:'pending'}};p.benchmarkResearch.runs.push(r);}
  const check=()=>this.check(p,r,token);
  const blocked=reason=>{r.status='blocked';r.reason=reason;p.status='paused';p.collaboration.state='paused';p.collaboration.pauseReason=reason;token.preflightBlocked=true;this.flow.collaboration.message(p,'CC','研究者',reason,{kind:'benchmark-blocked'});return false;};
  try{
   r.status='running';r.error='';runner.changed();check();
   if(r.literature.status!=='completed'){
    r.literature.attempt=(r.literature.attempt||0)+1;
    r.literature.status='running';runner.changed();
    const prompt=`你是研究负责人 CC。先基于真实文献建立方法与评测依据，不开始实现。课题：${p.title}\n已确认目标：${p.brief}\n项目目录：${p.directory}\n检索日期：${now().slice(0,10)}\n先读取项目已有调研、论文和参考文献，再补充检索原始论文、出版方/arXiv 原文及作者官方代码。按相关性、实验严谨程度、方法代表性和可复现性选择参考论文，不以期刊名气代替证据质量。\n必须查找经典代表方法、近期相关方法，并追踪有参考价值的论文实际使用的 baselines。明确哪个是论文提出的方法，哪个是比较对象。逐篇提取实验设置：任务定义、数据集与划分、预处理、评价指标及方向、基线实现/版本、训练与调参预算、重复试验、统计单位、可比性限制。paperBenchmark 记录这些实际读取的信息，缺失项明确标注。\n使用 WebSearch/WebFetch/Read 等核对原文。每个 paper 提供真实 URL、年份、原文节/表/页位置、关键证据摘要（不用长篇引用）和与你课题的关系。仅看到摘要时 access=abstract；未能读取为 unavailable，不能据此填造实验设置。methods 只能引用 fulltext 论文；官方代码不可访问时说明，不编造仓库。fulltext 表示你实际读到相关全文片段，而非仅看到搜索摘要。\n用 searchScope 说明检索词、时间范围、已有材料与截至日期。coverage 解释经典、近期方法的覆盖；找不到某类方法时说明检索范围及原因，不凑数、不宣称完整 SOTA。gaps 列未核实事项。无足够原文时 status=blocked，reason 说明缺什么材料或访问条件；没有实质依据不返回 ready。你负责告知做什么和理由，不生成问卷。`;
    const job=await runner.run({projectId:p.id,provider:'cc',kind:'literature-research',title:'CC · 调研经典、近期方法与论文 Baseline',executable:this.flow.cli('cc'),cwd:store.folder(p.id),prompt:prompt+'\n导师上次组会的修改要求：'+(r.literature.revisionInstructions||'首次调研'),schema:literatureSchema,sessionId:p.ccSessionId||undefined});r.literature.jobId=job.job.id;check();
    const data=validateLiterature(parse(job));p.ccSessionId=job.job.sessionId||p.ccSessionId;r.literature.data=data;r.literature.jobId=job.job.id;
    const doc=store.doc(p.id,`24-literature-${r.id}-${r.literature.attempt}.md`,'文献与方法对照 · 第 '+r.number+' 版',literatureMarkdown(data),'literature-research');r.literature.documentId=doc.id;r.literature.status=data.status==='ready'?'completed':'blocked';runner.changed();
    this.flow.collaboration.message(p,'CC','研究者',data.summary+'\n'+data.coverage,{kind:'literature-research',documentId:doc.id});
    if(data.status!=='ready')return blocked(data.reason);
   }
   if(!await this.supervise(p,r,'literature','literature',token))return false;
   if(r.protocol.status!=='completed'){
    r.protocol.attempt=(r.protocol.attempt||0)+1;
    r.protocol.status='running';runner.changed();check();
    const prompt=`你是研究负责人 CC。依据下列实际文献调研，确定“做出来如何衡量性能”，先形成评测方案，再安排实现。\n研究目标：${p.brief}\n文献与方法清单：${JSON.stringify(r.literature.data)}\n\n选择经典、近期和论文中有参考价值的对照方法，选择/排除都解释适用性；不是默认越新越好，不为凑数量增加昂贵实现。baselines.methodId 只能引用清单中的方法。优先作者官方实现或说明忠实复现步骤、版本和必要适配。\n从原论文的 benchmark 提炼适合本课题的协议：数据集/本地数据对应关系；按患者、样本、实验批次或其他真实独立单位划分训练/验证/测试，避免泄漏；输入、预处理、训练、调参和算力预算可比；定义主指标与必要辅助指标，写出方向、计算定义、统计单位/汇总、为何能反映目标；需要时补充实际任务效用、效率/资源与稳健性，不能只看单一漂亮分数。指标和数据协议引用已读取全文的 paperIds，新增或改造部分明确解释与原论文差异。\n事先写清重复次数/随机种子安排、不确定性与统计策略、成功/失败/停止标准及结果表如何记录。论文报告值与本地复跑值分开，数据/划分/预算不同不能直接宣布优胜。不捏造精确预算或改进阈值：若用户未给出，把合理方案标为计划假设，并给出依据。缺少必要数据规格或可信方法依据时 status=blocked，reason 说明具体缺口（字段可解释待补事项，不能冒充已确定）。status=ready 表示可开始按此方案实施，不表示科学正确性已经被外部核验。向用户解释做什么和为什么，不出问卷，不增加逐项审批。`;
    const job=await runner.run({projectId:p.id,provider:'cc',kind:'benchmark-design',title:'CC · 确定 Baseline、指标与公平评测协议',executable:this.flow.cli('cc'),cwd:store.folder(p.id),prompt:prompt+'\n导师上次组会的修改要求：'+(r.protocol.revisionInstructions||'首次设计'),schema:benchmarkSchema,sessionId:p.ccSessionId||undefined});r.protocol.jobId=job.job.id;check();
    const data=validateBenchmark(parse(job),r.literature.data);p.ccSessionId=job.job.sessionId||p.ccSessionId;r.protocol.data=data;r.protocol.jobId=job.job.id;
    const doc=store.doc(p.id,`25-benchmark-${r.id}-${r.protocol.attempt}.md`,'评测方案与性能判断 · 第 '+r.number+' 版',benchmarkMarkdown(data,r.literature.data),'benchmark-protocol');r.protocol.documentId=doc.id;r.protocol.status=data.status==='ready'?'completed':'blocked';runner.changed();
    this.flow.collaboration.message(p,'CC','研究者',data.summary+'\n'+data.rationale,{kind:'benchmark-design',documentId:doc.id});
    if(data.status!=='ready')return blocked(data.reason);
   }
   if(!await this.supervise(p,r,'protocol','benchmark',token))return false;
   check();r.status='ready';r.reason='文献与评测方案已形成，CC 将依据这些约束安排实现与实验。';r.completedAt=now();token.preflightBlocked=false;runner.changed();return true;
  }catch(e){r.status=token.cancelled||e.cancelled?'interrupted':'failed';r.error=e.message;for(const s of [r.literature,r.protocol])if(s.status==='running'){s.status=r.status;if(e.jobId)s.jobId=e.jobId;}runner.changed();throw e;}
 }
 async supervise(p,r,phase,stage,token){
  const s=r[phase],meeting=await this.flow.meetings.review(p,stage,r.id+':'+phase,s.documentId,token);
  if(!meeting){r.status='paused';r.reason=p.collaboration.pauseReason;this.flow.runner.changed();return false;}
  s.mentorReview={meetingId:meeting.id,verdict:meeting.data.verdict,dataHash:meetingHash(s.data)};
  if(meeting.data.verdict==='proceed')return true;
  s.revisionInstructions=meeting.data.revisionInstructions;
  if(meeting.data.verdict==='blocked'){r.status='blocked';return this.flow.meetings.pause(p,token,meeting.data.revisionInstructions);}
  s.status='pending';r.status='revising';
  if(phase==='literature'){r.protocol.status='pending';r.protocol.mentorReview=null;}
  this.flow.runner.changed();return false;
 }
}
