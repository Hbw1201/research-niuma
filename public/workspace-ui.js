const tabs = [
  ['collaboration', '协作台'], ['pipeline', 'Pipeline'], ['architecture', '团队'], ['files', '文件'],
];
const globalViews = new Set(['overview', 'new', 'settings', 'sessions']);

export function phaseOf(p) {
  const decisions = p.questions || [];
  const accepted = decisions.length > 0 && decisions.every(q => ['approved', 'rejected'].includes(q.decision))
    && decisions.some(q => q.decision === 'approved');
  if (!p.intakeConfirmed) {const r=p.proposalReviews?.at(-1);return { step: 0, hint:p.status==='proposal_reviewing'?({independent:'三位 CC 评委独立审查提案',cross:'三位评委正在交叉互评',synthesis:'主导师正在回应意见并修订提案'}[r?.stage]||'评委会评审中'):r?.status==='completed'?'查看评委意见，确认修订提案':p.proposal?'提交 / 继续提案评委会评审':'与主导师明确研究问题', attention:Boolean(p.proposal)&&p.status!=='proposal_reviewing'};}
  if (!accepted && !p.tasks?.length) {
    if (p.status === 'brainstorming') return { step: 1, hint: 'CC 正在准备研究问卷' };
    if (!decisions.length) return { step: 1, hint: '请 CC 生成研究设计问卷', attention:['failed','interrupted'].includes(p.status) };
    return { step: 1, hint: '批阅研究问卷，确定执行范围', attention: true };
  }
  if (p.collaboration?.pendingDecision) return { step: 2, hint: '答复 CC 提出的研究问题', attention: true };
  if (p.collaboration?.state === 'completed' || ['completed','cycle_complete'].includes(p.status))
    return { step: 3, hint: '查看 CC 的结论与证据' };
  if (p.autonomy?.mode !== 'auto' && !p.architecture?.confirmed) return { step: 2, hint: '确认团队成员和分工', attention: true };
  if (['paused','failed','interrupted'].includes(p.status)) return { step: 2, hint: '查看上次进展，决定是否继续', attention: true };
  return { step: 2, hint: p.collaboration?.state === 'running' ? '跟踪 CX 回报和 CC 复核' : '开始团队协作' };
}

export function projectHeader(c, view) {
  if (globalViews.has(view) || !c.p) return '';
  const {p,esc,badge} = c;
  const section = ['architecture','session','skills'].includes(view) ? 'architecture' :
    ['pipeline','progress'].includes(view) ? 'pipeline' : ['documents','files'].includes(view) ? 'files' : 'collaboration';
  const labels = ['明确问题','确认方案','实验与复核','审阅结论'];
  const phase = phaseOf(p);
  return `<header class="project-heading"><div class="kicker">PROJECT / 研究课题</div>
    <div class="title-line"><h1>${esc(p.title)}</h1>${badge(p.status)}</div>
    <ol class="milestones" aria-label="研究进度">${labels.map((label,i) =>
      `<li class="${i === phase.step ? 'current' : i < phase.step ? 'done' : ''}" ${i===phase.step?'aria-current="step"':''}><span>${i<phase.step?'✓':'0'+(i+1)}</span> ${label}</li>`).join('')}</ol>
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
      <a href="${p&&!globalViews.has(view)?'/#space='+encodeURIComponent(p.id):'/'}" class="wordmark" aria-label="返回主页"><b aria-hidden="true">&gt;_</b> 项目对话</a>
      <span class="bar-divider"></span><strong class="lab-heading">实验区</strong>
      ${p&&!globalViews.has(view)?'<button id="control-launch" data-action="control-chat" type="button" aria-controls="control-chat" aria-expanded="false">CC 总控对话</button>':''}
      <span class="link-status ${connected?'online':'offline'}" role="status">${connected?'已连接':'正在重连'}</span>
    </header>
    <div class="work-layout ${drawer?'drawer-open':''}">
      ${drawer?'<button class="drawer-backdrop" data-action="toggle-drawer" aria-label="收起导航"></button>':''}
      <aside id="project-rail" class="work-rail" aria-label="工作区导航">
        <div class="rail-cap">WORKSPACE</div>
        <button class="rail-workspace" data-action="workspace" title="${esc(state.workspace)}">${esc(workspace)} <span>⌄</span></button>
        <button class="rail-new" data-action="new"><span>＋</span> 新建课题</button>
        <button class="rail-link ${view==='overview'?'current':''}" data-view="overview">课题总览</button>
        <div class="rail-cap project-count">课题 <span>${state.projects.length}</span></div>
        <nav class="sidebar-projects" aria-label="我的课题">${projects||'<p class="empty-rail">还没有课题</p>'}</nav>
        <button class="rail-settings rail-link ${['settings','sessions'].includes(view)?'current':''}" data-view="settings">工作区设置</button>
      </aside>
      <main class="main" id="work-content"><div class="page-wrap">${projectHeader(c,view)}${content}</div></main>
    </div>
    <footer class="status-line"><span>● LOCAL <i>/</i> CC ${ready('cc')} <i>/</i> CX ${ready('cx')}</span><span>Markdown · v${esc(state.version)}</span></footer>`;
}

export function projectList(c, filter) {
  const {state,esc,busy,badge} = c;
  const groups = {all: state.projects, attention: state.projects.filter(p=>!busy(p) && phaseOf(p).attention), running: state.projects.filter(busy)};
  const visible = groups[filter] || groups.all;
  const filters = [['all','全部课题'],['attention','待我处理'],['running','运行中']];
  return `<header class="desk-heading"><div class="kicker">WORKSPACE / 课题索引</div><h1>课题总览</h1><p>打开一个课题，继续和 CC 推进研究。</p></header>
    <div class="list-tools"><nav aria-label="按状态筛选课题">${filters.map(([key,name])=>`<button type="button" data-action="list-filter" data-id="${key}" aria-pressed="${key===filter}">${name} <span>${groups[key].length}</span></button>`).join('')}</nav><button class="primary" data-action="new">＋ 新建课题</button></div>
    <div class="project-index">${visible.map(p=>{
      const phase = phaseOf(p);
      return `<button type="button" class="index-row" data-action="select-project" data-id="${esc(p.id)}">
        <span class="row-number">${String(state.projects.indexOf(p)+1).padStart(2,'0')}</span>
        <span class="index-copy"><strong>${esc(p.title)}</strong><span>${esc(phase.hint)}</span></span>
        ${badge(p.status)}<span aria-hidden="true" class="row-arrow">↗</span></button>`;
    }).join('')||`<div class="index-empty"><strong>${state.projects.length?'此分类暂无课题':'从第一个研究问题开始'}</strong><p>${state.projects.length?'切换到全部课题可查看其他进展。':'新建课题、选择本地目录，然后把想法告诉 CC。'}</p></div>`}</div>`;
}
