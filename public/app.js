import {markdown} from './markdown.js';
import {ControlChat} from './control-chat.js';
import {frame, projectList} from './workspace-ui.js';
import {collaborationPage,pipelinePage} from './pipeline-ui.js';
import {workerField, sessionDetail} from './team-ui.js';
import { newProjectPage, mentorPage, architecturePage, skillsPage } from './workflow-ui.js';
const $=s=>document.querySelector(s);
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
let selectedNode='',pipelineStage='all',traceLayout='';
const traceView=()=>traceLayout||(matchMedia('(max-width:720px)').matches?'list':'graph');
let sessionWorkerId='cc',renderedKey='',renderedTeamRevision=-1,resetDrafts=false;
let state,view='overview',projectId=localStorage.getItem('relay-project')||'',selectedDoc='',doc=null,sessionFilter='all',connected=true,renderPending=false;
const statuses={collaborating:'CC ↔ CX 协作中',awaiting_decision:'等待研究者判断',paused:'协作已暂停',cycle_complete:'本轮完成 / 待研究判断',returned:'已回报',passed:'CC 复核通过',retry:'需要调整',blocked:'等待材料或判断',defining:'目标澄清中',chatting:'CC 导师回复中',team_chatting:'CC 讨论分工中',proposal:'待确认研究方向',draft:'尚未开始',brainstorming:'CC 讨论中',awaiting_review:'等待批阅',planning:'CC 拆解中',ready:'等待执行',executing:'CX 执行中',executed:'等待 CC 汇总',reviewing:'CC 复核中',completed:'已完成',failed:'失败',interrupted:'已中断',running:'运行中',queued:'排队中',cancelled:'已停止',cancelling:'停止中',approved:'已批准',rejected:'已否决',revise:'要求修改',pending:'待批阅'};
let drawer=false, listFilter='all', routed=false, lastRoute='', renderedCatalog=null, refreshSequence=0;
const reviewDrafts=new Map();
let composing=false;
const routeViews=new Set(['overview','new','settings','sessions','collaboration','pipeline','architecture','documents','session','mentor','review','execution','skills']);
function restoreRoute(){
  const params=new URLSearchParams(location.hash.slice(1)),id=params.get('project');
  const target=params.get('view')||'overview';
  view=routeViews.has(target)?target:'overview';
  if(id&&state.projects.some(p=>p.id===id))projectId=id;
  else if(!['overview','new','settings','sessions'].includes(view))view='overview';
  selectedDoc=params.get('doc')||'';sessionWorkerId=params.get('worker')||'cc';
  if(doc?.id!==selectedDoc)doc=null;
  drawer=false;selectedNode=params.get('node')||'';pipelineStage=params.get('stage')||'all';
  if(view==='pipeline')traceLayout=['graph','list'].includes(params.get('layout'))?params.get('layout'):'';
}
function routeParams(){
  const params=new URLSearchParams();
  if(view!=='overview')params.set('view',view==='progress'?'pipeline':view);
  if(!['overview','new','settings','sessions'].includes(view)&&projectId)params.set('project',projectId);
  if(view==='documents'&&selectedDoc)params.set('doc',selectedDoc);
  if(view==='session')params.set('worker',sessionWorkerId);
  if(view==='pipeline'){
    if(selectedNode)params.set('node',selectedNode);
    if(pipelineStage!=='all')params.set('stage',pipelineStage);
    if(traceLayout)params.set('layout',traceLayout);
  }
  return params.toString();
}
function updateRoute(){
  const route=routeParams();if(route===lastRoute)return;
  history.pushState(null,'',location.pathname+location.search+(route?'#'+route:''));lastRoute=route;
}
function loadRouteData(){
  if(view==='documents'&&selectedDoc&&project()?.documents.some(d=>d.id===selectedDoc))openDoc(selectedDoc).catch(e=>toast(e.message,true));
  if(['skills','architecture'].includes(view))loadSkills().catch(e=>toast(e.message,true));
}
matchMedia('(max-width:720px)').addEventListener('change',()=>{drawer=false;if(state)render();});
window.addEventListener('popstate',()=>{if(state){restoreRoute();lastRoute=routeParams();render();loadRouteData();}});
const project=()=>state?.projects.find(p=>p.id===projectId);
const busy=p=>p&&['brainstorming','planning','executing','reviewing','chatting','team_chatting','collaborating'].includes(p.status);
const label=s=>s==='superseded'?'CC 已取消 / 保留记录':statuses[s]||s;
const badge=s=>`<span class="badge ${['completed','approved'].includes(s)?'ok':['failed','rejected'].includes(s)?'bad':['running','awaiting_review','revise','brainstorming','executing','planning'].includes(s)?'warn':''}">${esc(label(s))}</span>`;
const time=s=>s?new Date(s).toLocaleTimeString('zh-CN',{hour12:false}):'--:--:--';
const date=s=>s?new Date(s).toLocaleString('zh-CN',{hour12:false}):'—';
function toast(message,error=false){const t=$('#toast');t.textContent=message;t.className=error?'error':'';t.style.display='block';clearTimeout(toast.timer);toast.timer=setTimeout(()=>t.style.display='none',error?7000:3500);}
async function request(url,body){const res=await fetch(url,body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json','X-Relay-Token':state.token},body:JSON.stringify(body)});const data=await res.json();if(!res.ok)throw new Error(data.error||'请求失败');return data;}
async function refresh(force=false){const previousWorkspace=state?.workspace;const seq=++refreshSequence;const fresh=await request('/api/state');if(seq!==refreshSequence)return;state=fresh;if(previousWorkspace&&previousWorkspace!==state.workspace){skillCatalog=null;skillDraft.clear();selectedDoc='';doc=null;reviewDrafts.clear();view='overview';}if(!routed){restoreRoute();lastRoute=routeParams();routed=true;}if(!state.projects.some(p=>p.id===projectId))projectId=state.projects[0]?.id||'';localStorage.setItem('relay-project',projectId);if(force||(!composing&&document.activeElement?.tagName!=='SELECT')){render();renderPending=false;}else renderPending=true;}
const control=new ControlChat($('#control-chat'),{request,refresh,esc});
let newDraft={title:'',directory:''},newStep=1,folderState=null,skillCatalog=null,skillDraft=new Map();
function context(){return{state,p:project(),head,panel,button,esc,badge,busy,noProject,catalog:skillCatalog,label};}
function currentSkillSelection(){const p=project();if(!p)return new Set();if(!skillDraft.has(p.id))skillDraft.set(p.id,new Set(p.skillIds||[]));return skillDraft.get(p.id);}
async function loadSkills(){const id=projectId;const data=await request('/api/skills?project='+id);if(id!==projectId)return;skillCatalog=data.skills;render();}
function head(title,subtitle,actions=''){const tag=['overview','new','settings','sessions'].includes(view)?'h1':'h2';return `<div class="heading"><div><div class="eyebrow">${esc(subtitle)}</div><${tag}>${esc(title)}</${tag}></div><div class="actions">${actions}</div></div>`;}
function button(action,title,cls='',extra=''){return `<button type="button" data-action="${action}" class="${cls}" ${extra}>${title}</button>`;}
function panel(title,content,right=''){return `<section class="panel"><div class="panel-title"><span>${title}</span>${right}</div>${content}</section>`;}
function noProject(){return `<div class="blank"><p class="blank-title">还没有研究课题</p><p>先输入目标，CC 才能开始组织讨论。</p><br>${button('new','+ 新建课题','primary')}</div>`;}
function rememberField(){
  const el=document.activeElement;
  if(!el?.closest('#work-content')||!el.matches('input,textarea,select'))return null;
  const form=el.form;
  const peers=form?[...form.elements].filter(field=>field.name===el.name):[];
  return {id:el.id,formId:form?.id,question:form?.dataset.qid,name:el.name,index:peers.indexOf(el),start:el.selectionStart,end:el.selectionEnd,top:el.scrollTop};
}
function restoreField(saved){
  if(!saved)return;
  const form=saved.formId?document.getElementById(saved.formId):[...document.querySelectorAll('.review-form')].find(f=>f.dataset.qid===saved.question);
  const el=saved.id?document.getElementById(saved.id):form&&[...form.elements].filter(field=>field.name===saved.name)[saved.index];
  if(!el||el.disabled||!el.checkVisibility())return;
  el.focus({preventScroll:true});
  if(saved.start!=null&&typeof el.setSelectionRange==='function')el.setSelectionRange(saved.start,saved.end);
  el.scrollTop=saved.top;
}
document.addEventListener('compositionstart',()=>{composing=true;});
document.addEventListener('compositionend',()=>{composing=false;if(renderPending){renderPending=false;queueMicrotask(render);}});
function render(){
  if(!state)return;
  const p=project(),key=projectId+':'+view+':'+sessionWorkerId;
  const same=key===renderedKey,scroll=$('.main')?.scrollTop||0,conversationScroll=$('.conversation')?.scrollTop||0;
  const savedField=same&&!drawer?rememberField():null;
  const search=same?$('#skill-search')?.value:'';
  const conversation=$('.conversation');const following=!same||!conversation||conversation.scrollHeight-conversation.scrollTop-conversation.clientHeight<32;
  const canvas=$('.pipeline-canvas');
  const graphPosition=same&&canvas?.dataset.stage===pipelineStage?{top:canvas.scrollTop,left:canvas.scrollLeft}:null;
  const workerDraft=same&&renderedCatalog===skillCatalog&&!resetDrafts&&!busy(p)&&renderedTeamRevision===(p?.teamChanges?.length||0)&&$('#worker-fields')?[...$('#worker-fields').children].map(row=>({id:row.querySelector('[name=workerId]').value,name:row.querySelector('legend').textContent,role:row.querySelector('[name=workerRole]').value,pinned:row.querySelector('[name=workerPinned]').checked,model:row.querySelector('[name=workerModel]').value,language:row.querySelector('[name=workerLanguage]').value,skillIds:[...row.querySelectorAll('[name=workerSkill]:checked')].map(e=>e.value)})):null;
  const drafts=same&&!resetDrafts?[...document.querySelectorAll('#autonomy-form,#architecture-form,#model-form,#team-chat-form,#mentor-form,#decision-form,#collaborate-form,#stage-review-form,#rules-form,#settings-form')].filter(form=>!['architecture-form','model-form','autonomy-form'].includes(form.id)||!busy(p)&&renderedTeamRevision===(p?.teamChanges?.length||0)).map(form=>({id:form.id,values:[...form.elements].filter(e=>e.name).map(e=>({name:e.name,value:e.value,checked:e.checked,type:e.type}))})):[];
  const openDetails=same?[...document.querySelectorAll('.main details')].map((d,i)=>d.open?i:-1).filter(i=>i>=0):[];
  const sidebarScroll=$('.sidebar-projects')?.scrollTop||0;
  resetDrafts=false;
  const pages = {
    overview:()=>projectList(context(),listFilter),
    collaboration:()=>p?.intakeConfirmed?collaborationPage(context()):mentorPage(context()),
    pipeline:()=>pipelinePage(context(),selectedNode,pipelineStage,traceView()),
    progress:()=>pipelinePage(context(),selectedNode,pipelineStage,traceView()),
    new:()=>newProjectPage(context(),newDraft,newStep,folderState),
    mentor:()=>mentorPage(context()),architecture:()=>architecturePage(context()),
    session:()=>sessionDetail(context(),sessionWorkerId),
    skills:()=>skillsPage(context(),skillCatalog,currentSkillSelection()),
    review:reviewView,execution:executionView,documents:documentsView,sessions:sessionsView,settings:settingsView,
  };
  $('#app').innerHTML=frame(context(),{view,content:pages[view](),connected,drawer});
  control.update(state,p,Boolean($('#control-launch')));
  if(drawer)$('#work-content').inert=true;
  updateRoute();
  if(workerDraft&&$('#worker-fields'))$('#worker-fields').innerHTML=workerDraft.map((w,i)=>workerField(context(),i,w)).join('');
  for(const draft of drafts){const form=document.getElementById(draft.id);if(!form)continue;const used=new Map();for(const value of draft.values){if(value.name.startsWith('worker'))continue;const list=[...form.elements].filter(e=>e.name===value.name);const index=used.get(value.name)||0;used.set(value.name,index+1);const element=list[index];if(!element)continue;if(value.type==='checkbox')element.checked=value.checked;else element.value=value.value;}}
  openDetails.forEach(i=>{const d=document.querySelectorAll('.main details')[i];if(d)d.open=true;});if($('.sidebar-projects'))$('.sidebar-projects').scrollTop=sidebarScroll;
  for(const f of document.querySelectorAll('.review-form')) {
    const saved=reviewDrafts.get(projectId+':'+f.dataset.qid);
    if(!saved||f.elements.answer.disabled)continue;
    f.elements.answer.value=saved.answer;f.elements.comment.value=saved.comment;
    f.querySelectorAll('.option').forEach((b,i)=>b.classList.toggle('selected',p.questions.find(q=>q.id===f.dataset.qid)?.options[i]===saved.answer));
  }
  if(same)$('.main').scrollTop=scroll;
  if($('.conversation'))$('.conversation').scrollTop=following?$('.conversation').scrollHeight:conversationScroll;
  const newCanvas=$('.pipeline-canvas');
  if(newCanvas){newCanvas.dataset.stage=pipelineStage;newCanvas.scrollLeft=graphPosition?.left??(newCanvas.scrollWidth-newCanvas.clientWidth)/2;newCanvas.scrollTop=graphPosition?.top??0;}
  if(search&&$('#skill-search')){$('#skill-search').value=search;$('#skill-search').dispatchEvent(new Event('input',{bubbles:true}));}
  restoreField(savedField);
  renderedCatalog=skillCatalog;renderedKey=key;renderedTeamRevision=p?.teamChanges?.length||0;
}
function reviewView(){const p=project();if(!p)return head('问卷批阅','review / human decisions')+noProject();const qs=p.questions,done=qs.filter(q=>q.decision!=='pending').length;return head('研究决策问卷',p.title,button('goto-collaboration','返回协作'))+(!qs.length?panel('等待 CC',`<div class="blank">CC 先梳理研究设计，再把关键问题整理给你。${button('brainstorm','让 CC 生成问卷','primary',busy(p)?'disabled':'')}</div>`):`<div class="review-top"><span class="muted">${done} / ${qs.length} 已批阅 · 第 ${p.round||1} 轮</span><div class="actions">${button('revise','交回 CC 修改','',busy(p)||!qs.some(q=>q.decision==='revise')&&!qs.every(q=>q.decision==='rejected')?'disabled':'')}${button('goto-collaboration','进入协作台 →','primary',busy(p)||p.tasks.length||qs.some(q=>!['approved','rejected'].includes(q.decision))||!qs.some(q=>q.decision==='approved')?'disabled':'')}</div></div>${p.summary?`<div class="panel section-gap"><div class="panel-body summary">${esc(p.summary)}</div></div><br>`:''}${qs.map((q,i)=>`<form class="question review-form" data-qid="${q.id}"><div class="question-head"><span class="qnum">Q${String(i+1).padStart(2,'0')}</span><h3>${esc(q.title)}</h3>${badge(q.decision)}</div><div class="question-body"><p class="muted">${esc(q.why)}</p><div class="options">${q.options.map((o,j)=>`<button type="button" class="option ${q.answer===o?'selected':''}" data-action="option" data-qid="${q.id}" data-index="${j}" ${busy(p)||p.tasks.length?'disabled':''}>${String.fromCharCode(65+j)}. ${esc(o)}</button>`).join('')}</div><div class="recommendation">CC 建议 / ${esc(q.recommendation)}</div><label class="field"><span>你的选择（可直接修改）</span><textarea name="answer" rows="2" maxlength="10000" ${busy(p)||p.tasks.length?'disabled':''}>${esc(q.answer)}</textarea></label><label class="field"><span>批注 / 修改要求</span><textarea name="comment" rows="2" maxlength="10000" ${busy(p)||p.tasks.length?'disabled':''}>${esc(q.comment)}</textarea></label><div class="actions"><button type="submit" name="decision" value="approved" class="primary" ${busy(p)||p.tasks.length?'disabled':''}>[+] 批准</button><button type="submit" name="decision" value="revise" ${busy(p)||p.tasks.length?'disabled':''}>[~] 要求修改</button><button type="submit" name="decision" value="rejected" class="danger" ${busy(p)||p.tasks.length?'disabled':''}>[-] 否决</button></div></div></form>`).join('')}`);}
function executionView(){const p=project();if(!p)return head('CX 执行','execution / approved tasks')+noProject();const tasks=p.tasks,jobs=state.jobs.filter(j=>j.projectId===p.id&&j.kind==='execution');return head('CX 执行',p.title,`${button('execute','执行待办任务','primary',busy(p)||!tasks.some(t=>['ready','failed','interrupted','cancelled'].includes(t.status))||!state.scan?.clis?.cx?.available?'disabled':'')}${busy(p)?button('stop-project','停止本课题','danger'):''}${p.status==='executed'?button('summarize','CC 汇总与复核','primary'):''}`)+`<div class="subnav"><span>CONCURRENCY <strong>${state.settings.concurrency}</strong></span><span>COMPLETED <strong>${tasks.filter(t=>t.status==='completed').length}/${tasks.length}</strong></span><span>WORKDIR <strong>每个 CX 独立目录</strong></span></div>`+panel('CC 下发的 Markdown 任务',tasks.length?tasks.map(t=>`<div class="task-row"><div class="task-head"><h3><span class="cyan">${esc(p.architecture.workers.find(w=>w.id===t.workerId)?.name||t.workerId||'CX')}</span> / T${t.index} · ${esc(t.title)}</h3>${badge(t.status)}</div><p>${esc(t.instructions)}</p><details><summary>验收标准</summary><p>${esc(t.acceptance)}</p></details>${t.cwd?`<div class="path">cwd: ${esc(t.cwd)}</div>`:''}${t.error?`<div class="note error">${esc(t.error)}</div>`:''}<div class="actions section-gap">${button('doc','任务.md','',`data-id="${t.documentId}"`)}${t.reportId?button('doc','执行报告.md','',`data-id="${t.reportId}"`):''}${t.jobId?button('log','运行日志','',`data-id="${t.jobId}"`):''}${['ready','failed','interrupted','cancelled'].includes(t.status)?button('execute-one',t.status==='ready'?'运行此任务':'重试此任务','',`data-id="${t.id}" ${busy(p)||!state.scan?.clis?.cx?.available?'disabled':''}`):''}</div></div>`).join(''):'<div class="blank">逐项批阅问卷后，让 CC 生成任务计划。<br><span class="hint">未经批准的研究决策不会下发给 CX。</span></div>')+`<div class="section-gap">${panel('执行日志',jobs.length?`<div class="terminal">${jobs.slice(0,3).map(j=>`<div class="cyan">$ ${esc(j.title)} · ${esc(label(j.status))}</div>${j.log.slice(-18).map(l=>`<div class="log-row">${esc(l)}</div>`).join('')}${j.error?`<div class="red">${esc(j.error)}</div>`:''}`).join('')||'<span class="muted">等待 CLI 输出…</span>'}</div>`:'<div class="terminal muted">$ waiting for approved tasks _</div>')}</div>`;}

function documentsView(){const p=project();if(!p)return head('Markdown 交接','documents / source of record')+noProject();return head('Markdown 交接',p.title)+`<section class="panel docs-layout"><div class="file-list"><div class="side-caption">课题文件 · ${p.documents.length}</div>${p.documents.map(d=>`<button data-action="doc" data-id="${d.id}" class="${selectedDoc===d.id?'selected':''}">${esc(d.title)}<small>${esc(d.name)}</small></button>`).join('')}</div><div class="doc-content">${doc&&doc.id===selectedDoc?`<div class="doc-toolbar"><span class="green">${esc(doc.name)}</span><a href="/api/projects/${p.id}/documents/${doc.id}?download" download>↓ 下载 .md</a></div><div class="markdown">${markdown(doc.content)}</div><details><summary>查看 Markdown 源文</summary><pre class="md-source">${esc(doc.content)}</pre></details><p class="hint wrap">${esc(doc.path)}</p>`:'<div class="blank">选择一个文件，查看内容和下载 Markdown。</div>'}</div></section>`;}
function sessionsView(){const scan=state.scan,sessions=(scan?.sessions||[]).filter(s=>sessionFilter==='all'||s.provider===sessionFilter),p=project();return head('本机会话','$ relay-lab scan',button('scan','↻ 重新扫描','primary'))+panel('CLI / 本机程序',`<div>${['cc','cx'].map(k=>{const c=scan?.clis?.[k];return `<div class="scan-line"><span class="${k==='cc'?'amber':'cyan'}">${k.toUpperCase()} / ${k==='cc'?'Claude Code':'Codex'}</span><span class="path">${esc(c?.path||'未找到程序路径')}</span><span class="${c?.available?'green':'amber'}">${esc(c?.available?c.version:scan?'missing':'scanning…')}</span></div>`;}).join('')}</div><div class="panel-body hint">每次打开时扫描 PATH、常见安装目录与本地会话索引。历史记录的在线状态未知；发现进程不会自动接管终端。${scan?.warnings.map(w=>`<br><span class="amber">${esc(w)}</span>`).join('')||''}</div>`)+`<div class="section-gap">${panel('PROCESSES / 当前识别到的进程',`<div class="table-scroll"><table class="table"><thead><tr><th>角色</th><th>PID</th><th>程序</th><th>识别结果</th></tr></thead><tbody>${scan?.processes.map(p=>`<tr><td class="${p.provider==='cc'?'amber':'cyan'}">${p.provider.toUpperCase()}</td><td>${p.pid}</td><td>${esc(p.name)}</td><td>${state.jobs.some(j=>j.pid===p.pid&&j.status==='running')?'由工作台管理':p.mode==='service'?'本机服务 · 未接管':'外部进程 · 未接管'}</td></tr>`).join('')||'<tr><td colspan="4" class="empty-row">未识别到 CLI 进程，或系统未允许读取进程。</td></tr>'}</tbody></table></div>`)}</div><div class="section-gap">${panel('SESSIONS / 本地会话记录',`<div class="table-scroll"><table class="table"><thead><tr><th>角色 / 会话</th><th>最近更新</th><th>状态</th><th>使用</th></tr></thead><tbody>${sessions.map(s=>`<tr><td class="session-title"><span class="${s.provider==='cc'?'amber':'cyan'}">${s.provider.toUpperCase()}</span> ${esc(s.title)}<span class="session-id">${esc(s.id)}</span></td><td class="small nowrap">${date(s.updatedAt)}</td><td><span class="badge">历史记录</span></td><td>${s.provider==='cc'?button('bind-cc',p?.ccSessionId===s.id?'已选为 CC':'设为本课题 CC','',`data-id="${s.id}" ${!p||busy(p)?'disabled':''}`):button('handoff','发送任务 MD','',`data-id="${s.id}" ${!p?.tasks.length?'disabled':''}`)}</td></tr>`).join('')||'<tr><td colspan="4" class="empty-row">暂无会话记录。首次使用 CLI 后，可重新扫描。</td></tr>'}</tbody></table></div>`,`<select id="session-filter" aria-label="会话类型"><option value="all" ${sessionFilter==='all'?'selected':''}>全部角色</option><option value="cc" ${sessionFilter==='cc'?'selected':''}>CC</option><option value="cx" ${sessionFilter==='cx'?'selected':''}>CX</option></select>`)}<div class="note">CC 会话通过 --resume 恢复，请先让原终端结束当前一轮。向已有 CX 发送 MD 使用原生 queue（需 CLI 支持）；只确认入队，执行结果仍在原终端查看。</div></div>`;}
function settingsView(){const p=project();return head('设置与本机连接','workspace / local configuration',button('workspace','打开或新建工作区')+'<button data-view="sessions">本机 CLI / 会话</button>')+`<div class="grid"><div>${panel('WORKSPACE / 本地目录',`<div class="panel-body"><div class="path">${esc(state.workspace)}</div><p class="hint">任务、日志和文档保存在此目录的 .relay-lab 中。切换目录会切换整套课题和设置；运行期间不可切换。</p><pre class="process-tree">.relay-lab/
├── RULES.md            工作区规则
├── state.json          课题与批阅状态
└── projects/&lt;id&gt;/
    ├── 00-brief.md     研究目标
    ├── 02-project-rules.md
    ├── 20-questionnaire-r1.md
    ├── 21-decisions-r1.md
    ├── 30-task-*.md    任务交接
    ├── 40-report-*.md  执行报告
    ├── runs/          每次输入与日志
    └── work/cx-*/     独立执行目录</pre></div>`)}${panel('RULES / 工作区规则',`<form id="rules-form" class="panel-body"><label class="field"><span>所有课题的 CC 和 CX 都会读取这些规则。</span><textarea class="rules" name="content" maxlength="30000" placeholder="# 科研协作规则\n\n- 使用中文沟通。\n- 不编造文献和实验结果。\n- 修改代码后记录实际运行的验证。\n- 缺少必要数据时明确报告阻塞。">${esc(state.rules?.workspace||'')}</textarea></label><button type="submit" class="primary">保存 RULES.md</button><p class="hint">每次运行的完整规则随指令保存在 runs/&lt;id&gt;/input.md。</p>${state.rules?.agents?`<details><summary>已读取现有 AGENTS.md（只读）</summary><pre class="rule-inherited">${esc(state.rules.agents)}</pre></details>`:''}${state.rules?.claude?`<details><summary>已读取现有 CLAUDE.md（只读）</summary><pre class="rule-inherited">${esc(state.rules.claude)}</pre></details>`:''}</form>`)}</div><div>${panel('CLI / 程序路径',`<form id="settings-form" class="panel-body"><label class="field"><span>CC / Claude Code 路径</span><input name="ccPath" value="${esc(state.settings.ccPath)}" placeholder="留空自动查找 claude"></label><label class="field"><span>CX / Codex 路径</span><input name="cxPath" value="${esc(state.settings.cxPath)}" placeholder="留空自动查找 codex"></label><label class="field"><span>同时执行的 CX 数量</span><select name="concurrency">${Array.from({length:16},(_,i)=>i+1).map(n=>`<option value="${n}" ${state.settings.concurrency===n?'selected':''}>${n}</option>`).join('')}</select></label><button type="submit" class="primary">保存并重新检测</button><p class="hint">沿用本机 CLI 的登录配置；每个课题可在课题架构中选择模型。此处不收集 API Key。CC 负责团队调度与证据复核；CX 在分配的工作目录执行任务。</p></form>`)}${panel('PROJECT / 课题补充规则',`<div class="panel-body"><p class="muted">${esc(p?.title||'尚未选择课题')}</p><p class="hint">只对当前课题生效，与工作区规则一同传入。不要在不同规则中写互相冲突的要求。</p>${button('project-rules','编辑课题规则','',!p?'disabled':'')}</div>`)}${panel('TERMINAL / 命令行',`<div class="panel-body"><pre class="process-tree">relay-lab start
relay-lab scan
relay-lab status
relay-lab --help

# 指定本地工作区
relay-lab start --workspace /path/to/research</pre></div>`)}</div></div>`;}
function showModal(title,html){$('#modal').innerHTML=`<div class="modal-backdrop"><section class="modal" role="dialog" aria-modal="true" aria-label="${esc(title)}"><div class="modal-head"><span class="green">${esc(title)}</span><button data-action="close" aria-label="关闭">esc ×</button></div>${html}</section></div>`;$('#modal input, #modal textarea, #modal select, #modal button')?.focus();}
function closeModal(){$('#modal').innerHTML='';}
async function openDoc(id){const owner=projectId;selectedDoc=id;view='documents';doc=null;render();const result=await request(`/api/projects/${owner}/documents/${id}`);if(projectId===owner&&selectedDoc===id&&view==='documents'){doc=result;render();}}
async function perform(verb,body={}){await request(`/api/projects/${projectId}/${verb}`,body);resetDrafts=true;await refresh(true);}
document.addEventListener('click',async event=>{const b=event.target.closest('button');if(!b||b.disabled)return;if(b.dataset.view){drawer=false;view=b.dataset.view;render();if(['skills','architecture'].includes(view))loadSkills().catch(e=>toast(e.message,true));return;}const a=b.dataset.action;if(!a)return;b.disabled=true;try{
  if(a==='control-chat'){control.toggle();return;}
  if(a==='retry-connect'){location.reload();return;}
  if(a==='toggle-drawer'){drawer=!drawer;render();(drawer?$('.rail-new'):$('.drawer-toggle'))?.focus();return;}
  if(a==='list-filter'){listFilter=b.dataset.id;render();return;}
  if(drawer){drawer=false;render();}
  if(a==='close')closeModal();
  if(a==='new'){closeModal();newDraft={title:'',directory:state.workspace+(state.workspace.includes('\\')?'\\':'/')+'projects'+(state.workspace.includes('\\')?'\\':'/')+'research-'+Date.now().toString(36)};newStep=1;folderState=null;view='new';render();$('#new-title')?.focus();}
  if(a==='cancel-new'){view='overview';render();}
  if(a==='new-back'){newStep=1;render();$('#new-title')?.focus();}
  if(a==='folder-browse'||a==='folder-open'){newDraft.title=$('#new-title')?.value||newDraft.title;newDraft.directory=$('#new-directory')?.value||newDraft.directory;const location=a==='folder-open'?b.dataset.path:state.workspace;folderState=await request('/api/folders?path='+encodeURIComponent(location));render();}
  if(a==='folder-select'){newDraft.directory=b.dataset.path;folderState=null;render();}
  if(['goto-mentor','goto-progress','goto-architecture','goto-skills','goto-pipeline','goto-collaboration'].includes(a)){view=a.slice(5);render();if(['skills','architecture'].includes(view))await loadSkills();}
  if(a==='trace-layout'){traceLayout=b.dataset.id;render();}
  if(a==='pipeline-node'){selectedNode=b.dataset.id;render();$('.node-inspector')?.focus();}
  if(a==='pipeline-stage'){pipelineStage=b.dataset.id;selectedNode='';render();}
  if(a==='open-session'){sessionWorkerId=b.dataset.id;view='session';render();}
  if(a==='accept-team'){await perform('accept-team',{proposalId:b.dataset.id});toast('已采纳 CC 团队建议。');}
  if(a==='activate'){await perform('activate');view='collaboration';render();toast('科研主题已确认，进入课题 pipeline。');}
  if(a==='refresh-skills')await loadSkills();
  if(a==='save-skills'){await perform('skills',{ids:[...currentSkillSelection()]});toast('已保存本课题的技能选择。');}
  if(a==='add-worker'){const fields=$('#worker-fields');const n=fields.children.length;if(n<32)fields.insertAdjacentHTML('beforeend',workerField(context(),n));}
  if(a==='remove-worker'){const fields=$('#worker-fields');if(fields.children.length>1)fields.lastElementChild.remove();}
  if(a==='projects')showModal('projects / 选择课题',`<div class="modal-body">${state.projects.map(p=>`<button class="project-option" data-action="select-project" data-id="${p.id}"><div>${esc(p.title)}<span>${p.id.slice(0,8)} · ${date(p.createdAt)}</span></div>${badge(p.status)}</button>`).join('')||'<p class="muted">暂无课题。</p>'}<br>${button('new','+ 新建课题','primary')}</div>`);
  if(a==='select-project'){projectId=b.dataset.id;skillCatalog=null;selectedDoc='';doc=null;view='collaboration';selectedNode='';pipelineStage='all';sessionWorkerId='cc';localStorage.setItem('relay-project',projectId);closeModal();render();}
  if(a==='scan'){toast('正在扫描本机…');await request('/api/scan',{});await refresh(true);toast('本机扫描完成。');}
  if(a==='brainstorm'){await perform('brainstorm');view='collaboration';render();toast('CC 正在核对研究设计并生成决策问卷。');}
  if(a==='revise'){await perform('brainstorm',{revise:true});view='collaboration';render();toast('已交回 CC。本轮修改完成后需重新批阅问卷。');}
  if(a==='plan'){await perform('plan');view='execution';render();toast('CC 正在拆解获批任务。');}
  if(a==='execute'||a==='execute-one'){await perform('collaborate',a==='execute-one'?{taskId:b.dataset.id}:{});view='collaboration';render();toast('CC ↔ CX 持续协作已启动。');}
  if(a==='stop-project'){await perform('stop');toast('已请求停止本课题任务。');}
  if(a==='summarize'){await perform('summarize');toast('CC 正在汇总执行报告。');}
  if(a==='goto-review'){view='review';render();}
  if(a==='goto-execution'){view='execution';render();}
  if(a==='doc')await openDoc(b.dataset.id);
  if(a==='log'){const j=state.jobs.find(j=>j.id===b.dataset.id);showModal(j.title,`<div class="modal-body"><div>${badge(j.status)} <span class="muted">${esc(j.sessionId||'尚未返回会话 ID')}</span></div><div class="terminal section-gap" id="live-log" data-id="${j.id}">${esc(j.log.join('\n')||'等待 CLI 输出…')}</div>${j.error?`<div class="note error">${esc(j.error)}</div>`:''}${j.status==='running'?`<div class="actions section-gap">${button('stop-job','停止该任务','danger',`data-id="${j.id}"`)}</div>`:''}</div>`);}
  if(a==='stop-job'){await request(`/api/jobs/${b.dataset.id}/stop`,{});closeModal();await refresh(true);}
  if(a==='option'){const form=b.closest('form'),q=project().questions.find(q=>q.id===b.dataset.qid);form.elements.answer.value=q.options[Number(b.dataset.index)];form.elements.answer.dispatchEvent(new Event('input',{bubbles:true}));form.querySelectorAll('.option').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');}
  if(a==='bind-cc'){await perform('bind-cc',{sessionId:b.dataset.id});toast('已选为此课题的 CC；下次讨论将恢复该会话。');}
  if(a==='handoff')showModal('handoff / 向已有 CX 发送任务',`<form id="handoff-form" class="modal-body" data-session="${b.dataset.id}"><p class="hint">只发送已批准的任务 MD 路径，不会抢占原终端；消息由原会话接收。入队后的执行状态请在原终端查看。</p><label class="field"><span>选择交接文档</span><select name="documentId">${project().tasks.map(t=>`<option value="${t.documentId}">CX-${t.index} · ${esc(t.title)}</option>`).join('')}</select></label><button type="submit" class="primary">发送到原会话队列</button></form>`);
  if(a==='workspace')showModal('workspace / 打开或创建本地工作区',`<form id="workspace-form" class="modal-body"><label class="field"><span>工作区绝对路径</span><input name="path" value="${esc(state.workspace)}" required></label><label class="flex"><input type="checkbox" name="create">目录不存在时创建</label><p class="hint">不会移动现有文件。每个目录保存独立的课题、规则与执行记录。当前运行任务结束后才能切换。</p><button type="submit" class="primary">打开此工作区</button></form>`);
  if(a==='project-rules'){const r=await request('/api/rules?project='+projectId);showModal('rules / 课题补充规则',`<form id="project-rules-form" class="modal-body"><label class="field"><span>${esc(project().title)}</span><textarea class="rules" name="content" maxlength="30000">${esc(r.project)}</textarea></label><button type="submit" class="primary">保存课题规则</button></form>`);}
}catch(e){toast(e.message,true);}finally{if(b.isConnected)b.disabled=false;}});
document.addEventListener('submit',async event=>{const form=event.target;if(!form.matches('form')||form.id==='control-form')return;event.preventDefault();const submit=event.submitter;if(submit)submit.disabled=true;const values=Object.fromEntries(new FormData(form));try{
  if(form.id==='new-title-form'){newDraft.title=values.title.trim();if(!newDraft.title)throw Error('请填写课题名称。');newStep=2;render();$('#new-directory')?.focus();}
  if(form.id==='new-project-form'){const p=await request('/api/projects',{title:newDraft.title,directory:values.directory});projectId=p.id;selectedDoc='';doc=null;skillCatalog=null;pipelineStage='all';selectedNode='';view='collaboration';await refresh(true);toast('课题已创建，开始和 CC 导师讨论你的 idea。');}
  if(form.id==='collaborate-form'){await perform('collaborate',{maxReviews:Number(values.maxReviews)});toast('CC 与 CX 已开始持续协作。');}
  if(form.id==='decision-form'){await perform('decide',{decisionId:form.dataset.decision,action:submit.value,message:values.message});toast('已记录你的决定，CC 继续协调。');}
  if(form.id==='stage-review-form'){await perform('stage-review',{stageId:form.dataset.stage,action:submit.value,comment:values.comment});toast('已记录研究者对此阶段的判断。');}
  if(form.id==='mentor-form'){await perform('chat',{message:values.message});toast('已发送给 CC 导师。');}
  if(form.id==='architecture-form'){const workers=[...form.querySelectorAll('.worker-field')].map(row=>({id:row.querySelector('[name=workerId]').value,role:row.querySelector('[name=workerRole]').value,pinned:row.querySelector('[name=workerPinned]').checked,model:row.querySelector('[name=workerModel]').value,language:row.querySelector('[name=workerLanguage]').value,skillIds:[...row.querySelectorAll('[name=workerSkill]:checked')].map(e=>e.value)}));await perform('architecture',{parallel:Number(values.parallel),workers});toast('CX 分工已保存并确认。');}
  if(form.id==='autonomy-form'){await perform('autonomy',{mode:values.mode,maxWorkers:Number(values.maxWorkers),maxParallel:Number(values.maxParallel),maxReviews:Number(values.maxReviews),brief:values.brief});toast('CC Leader 设置已保存。');}
  if(form.id==='model-form'){await perform('models',{model:values.model,language:values.language,allowCCSwitch:values.allowCCSwitch==='on',allowedModels:values.allowedModels.split(/[\n,，]/).map(s=>s.trim()).filter(Boolean)});toast('模型与语言已保存，下次调用生效。');}
  if(form.id==='team-chat-form'){await perform('team-chat',{message:values.message});toast('CC 正在讨论 CX 分工和技能。');}
  if(form.id==='new-form'){const p=await request('/api/projects',values);projectId=p.id;view='overview';closeModal();await refresh(true);toast('课题已保存。可以开始 CC 讨论。');}
  if(form.classList.contains('review-form')){await request('/api/projects/'+projectId+'/review',{...values,questionId:form.dataset.qid,decision:submit.value});reviewDrafts.delete(projectId+':'+form.dataset.qid);await refresh(true);toast('批阅已保存到 Markdown。');}
  if(form.id==='settings-form'){await request('/api/settings',{...values,concurrency:Number(values.concurrency)});await refresh(true);toast('CLI 设置已更新。');}
  if(form.id==='rules-form'||form.id==='project-rules-form'){await request('/api/rules',{content:values.content,...(form.id==='project-rules-form'?{projectId}:{})});if(form.id==='project-rules-form')closeModal();await refresh(true);toast('规则已保存。');}
  if(form.id==='workspace-form'){await request('/api/workspace',{path:values.path,create:values.create==='on'});projectId='';selectedDoc='';doc=null;closeModal();await refresh(true);toast('已切换本地工作区。');}
  if(form.id==='handoff-form'){await perform('handoff',{sessionId:form.dataset.session,documentId:values.documentId});closeModal();toast('MD 路径已入队。请在原 CX 终端查看执行状态。');}
}catch(e){toast(e.message,true);}finally{if(submit?.isConnected)submit.disabled=false;}});
document.addEventListener('change',e=>{if(e.target.id==='pipeline-filter'){pipelineStage=e.target.value;selectedNode='';render();$('#pipeline-filter')?.focus();}if(e.target.id==='session-filter'){sessionFilter=e.target.value;render();}});
document.addEventListener('keydown',e=>{if(e.key==='Escape'){if($('#modal').children.length)closeModal();else if(drawer){drawer=false;render();$('.drawer-toggle')?.focus();}}});
document.addEventListener('focusout',()=>{if(renderPending&&!composing&&!$('#modal').children.length)setTimeout(()=>{if(!['INPUT','TEXTAREA','SELECT'].includes(document.activeElement?.tagName)){renderPending=false;render();}},150);});
try{await refresh(true);loadRouteData();const events=new EventSource('/api/events');events.addEventListener('change',async()=>{try{await refresh();const pre=$('#live-log');if(pre){const j=state.jobs.find(j=>j.id===pre.dataset.id);if(j){pre.textContent=j.log.join('\n')+(j.error?'\n'+j.error:'');pre.scrollTop=pre.scrollHeight;}}}catch{connected=false;}});events.onopen=()=>{connected=true;refresh().catch(()=>{});};events.onerror=()=>{connected=false;const indicator=$('.link-status');if(indicator){indicator.className='link-status offline';indicator.textContent='正在重连';}};request('/api/scan',{}).catch(e=>toast('本机检测失败：'+e.message,true));}catch(e){$('#app').innerHTML=`<main class="boot-screen"><div class="kicker">LOCAL WORKSPACE</div><h1>本机工作台尚未连接</h1><p>打开桌面工作台，或在课题工作区运行 <code>relay-lab start</code> 并使用终端显示的地址。</p>${button('retry-connect','重新连接','primary')}</main>`;}

document.addEventListener('input',e=>{const form=e.target.closest('.review-form');if(form)reviewDrafts.set(projectId+':'+form.dataset.qid,{answer:form.elements.answer.value,comment:form.elements.comment.value});if(e.target.id==='new-title')newDraft.title=e.target.value;if(e.target.id==='new-directory')newDraft.directory=e.target.value;if(e.target.id==='skill-search'){const q=e.target.value.trim().toLowerCase();let matches=0;document.querySelectorAll('.skill-item').forEach(row=>{row.hidden=!row.dataset.search.includes(q);if(!row.hidden)matches++;});const empty=$('#skill-no-results');if(empty)empty.hidden=matches>0;}});
document.addEventListener('change',e=>{if(e.target.classList.contains('skill-checkbox')){const selected=currentSkillSelection();if(e.target.checked)selected.add(e.target.value);else selected.delete(e.target.value);$('#skill-count').textContent=selected.size;}});
