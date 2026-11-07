import {benchmarkCurrent} from './benchmark-ui.js';
const tabs = [
  ['collaboration', '概览'], ['pipeline', '研究流程'], ['architecture', '团队'], ['files', '文件'],
];
const globalViews = new Set(['overview', 'new', 'settings', 'sessions']);

export function phaseOf(p) {
  if (!p.intakeConfirmed) {const r=p.proposalReviews?.at(-1);return { step: 0, hint:p.status==='proposal_reviewing'?({independent:'三位 CC 评委独立审查提案',cross:'三位评委正在交叉互评',synthesis:'主导师正在回应意见并修订提案'}[r?.stage]||'评委会评审中'):r?.status==='completed'?'查看评委意见，确认修订提案':p.proposal?'提交 / 继续提案评委会评审':'与主导师明确研究问题', attention:Boolean(p.proposal)&&p.status!=='proposal_reviewing'};}
  if (p.collaboration?.pendingDecision) return { step: 2, hint: '答复 CC 提出的研究问题', attention: true };
  const research=p.benchmarkResearch?.runs?.at(-1);
  if(research&&(!benchmarkCurrent(p)||research.status!=='ready'))return {step:1,hint:!benchmarkCurrent(p)?'要求已更新，重新检查文献与评测依据':['blocked','failed','interrupted'].includes(research.status)?'查看调研缺口并继续未完成步骤':research.literature.status==='completed'?'CC 正在确定性能衡量方案':'CC 正在调研文献与比较方法',attention:['blocked','failed','interrupted'].includes(research.status)};
  if (p.collaboration?.state === 'completed' || ['completed','cycle_complete'].includes(p.status))
    return { step: 3, hint: '查看 CC 的结论与证据' };
  if (p.autonomy?.mode !== 'auto' && !p.architecture?.confirmed) return { step: 1, hint: '确认团队成员和分工', attention: true };
  if(!p.tasks?.length)return {step:1,hint:p.collaboration?.state==='running'?'CC 正在说明执行安排与理由':'让 CC 说明安排并推进研究',attention:['failed','interrupted'].includes(p.status)};
  if (['paused','failed','interrupted'].includes(p.status)) return { step: 2, hint: '查看上次进展，决定是否继续', attention: true };
  return { step: 2, hint: p.collaboration?.state === 'running' ? '跟踪 CX 回报和 CC 复核' : '开始团队协作' };
}

export function projectHeader(c, view) {
  if (globalViews.has(view) || !c.p) return '';
  const {p,esc,badge} = c;
  const section = ['architecture','session','skills'].includes(view) ? 'architecture' :
    ['pipeline','progress','stage'].includes(view) ? 'pipeline' : ['documents','files'].includes(view) ? 'files' : 'collaboration';
  return `<header class="project-heading">
    <div class="title-line"><h1>${esc(p.title)}</h1>${badge(p.status)}</div>
    <nav class="project-tabs" aria-label="课题导航">${tabs.map(([id,name]) =>
      `<button type="button" data-view="${id}" ${id===section?'class="active" aria-current="page"':''}>${name}</button>`).join('')}</nav></header>`;
}

export function frame(c, {view, content, connected, drawer}) {
  const {state,p,esc} = c;
  const workspace = state.workspace.split(/[\\/]/).filter(Boolean).pop() || state.workspace;
  const projects = state.projects.map(item => {
    const selected = item.id === p?.id && !globalViews.has(view);
    return `<button type="button" data-action="select-project" data-id="${esc(item.id)}" class="rail-project ${selected?'current':''}" ${selected?'aria-current="page"':''}><span class="rail-dot"></span><span>${esc(item.title)}</span></button>`;
  }).join('');
  const ready = key => !state.scan ? '检测中' : state.scan.clis?.[key]?.available ? '就绪' : '未就绪';
  return `<header class="app-bar">
      <button type="button" class="drawer-toggle" data-action="toggle-drawer" aria-label="${drawer?'关闭课题列表':'打开课题列表'}" aria-controls="project-rail" aria-expanded="${drawer}">☰</button>
      <a href="${p&&!globalViews.has(view)?'/#space='+encodeURIComponent(p.id):'/'}" class="wordmark" aria-label="返回主页"><b aria-hidden="true">&gt;_</b> 科研牛马局</a>
      <span class="bar-divider"></span><a class="back-to-chat" href="${p&&!globalViews.has(view)?'/#space='+encodeURIComponent(p.id):'/'}">返回对话</a>
      ${p&&!globalViews.has(view)?'<button id="control-launch" data-action="control-chat" type="button" aria-controls="control-chat" aria-expanded="false">和 CC 对话</button>':''}
      <span class="link-status ${connected?'online':'offline'}" role="status">${connected?'已连接':'正在重连'}</span>
    </header>
    <div class="work-layout ${drawer?'drawer-open':''}">
      ${drawer?'<button class="drawer-backdrop" data-action="toggle-drawer" aria-label="收起导航"></button>':''}
      <aside id="project-rail" class="work-rail" aria-label="工作区导航">
        <button class="rail-new" data-action="new"><span>＋</span> 新建项目</button>
        <button class="rail-link ${view==='overview'?'current':''}" data-view="overview">所有项目</button>
        <div class="rail-cap project-count">项目 <span>${state.projects.length}</span></div>
        <nav class="sidebar-projects" aria-label="我的课题">${projects||'<p class="empty-rail">还没有课题</p>'}</nav>
        <button class="rail-workspace" data-action="workspace" title="${esc(state.workspace)}">${esc(workspace)} <span>⌄</span></button>
        <button class="rail-settings rail-link ${['settings','sessions'].includes(view)?'current':''}" data-view="settings">设置</button>
      </aside>
      <main class="main ${view==='pipeline'?'pipeline-main':view==='stage'?'pipeline-detail-main':''}" id="work-content"><div class="page-wrap">${projectHeader(c,view)}${content}</div></main>
    </div>
    <footer class="status-line"><span>● LOCAL <i>/</i> CC ${ready('cc')} <i>/</i> CX ${ready('cx')}</span><span>Markdown · v${esc(state.version)}</span></footer>`;
}

export function projectList(c, filter) {
  const {state,esc,busy,badge} = c;
  const groups = {all: state.projects, attention: state.projects.filter(p=>!busy(p) && phaseOf(p).attention), running: state.projects.filter(busy)};
  const visible = groups[filter] || groups.all;
  const filters = [['all','全部课题'],['attention','待我处理'],['running','运行中']];
  return `<header class="desk-heading"><h1>你的项目</h1><p>选一个项目，继续上次的研究。</p></header>
    <div class="list-tools"><nav aria-label="按状态筛选课题">${filters.map(([key,name])=>`<button type="button" data-action="list-filter" data-id="${key}" aria-pressed="${key===filter}">${name} <span>${groups[key].length}</span></button>`).join('')}</nav><button class="primary" data-action="new">＋ 新建课题</button></div>
    <div class="project-index">${visible.map(p=>{
      const phase = phaseOf(p);
      return `<button type="button" class="index-row" data-action="select-project" data-id="${esc(p.id)}">
        <span class="row-number">${String(state.projects.indexOf(p)+1).padStart(2,'0')}</span>
        <span class="index-copy"><strong>${esc(p.title)}</strong><span>${esc(phase.hint)}</span></span>
        ${badge(p.status)}<span aria-hidden="true" class="row-arrow">↗</span></button>`;
    }).join('')||`<div class="index-empty"><strong>${state.projects.length?'此分类暂无课题':'从第一个研究问题开始'}</strong><p>${state.projects.length?'切换到全部课题可查看其他进展。':'新建课题、选择本地目录，然后把想法告诉 CC。'}</p></div>`}</div>`;
}
