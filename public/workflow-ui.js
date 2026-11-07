import { architecture } from './team-ui.js';
import {councilPanel} from './proposal-review-ui.js';
export function newProjectPage(c,draft,step,folders){const {head,panel,button,esc}=c;return head('新建课题','NEW PROJECT / 工作区',button('cancel-new','返回课题'))+`<div class="onboarding-steps"><span class="${step===1?'green':''}">01 命名</span><span>→</span><span class="${step===2?'green':''}">02 选目录</span><span>→</span><span>03 讨论想法</span><span>→</span><span>04 确认方向</span></div><div class="onboarding-page">${step===1?panel('给课题起个名字',`<form id="new-title-form" class="panel-body"><p class="hint">先起一个工作标题即可。研究目标和方向，接下来与 CC 一起明确。</p><label class="field"><span>课题名称</span><input id="new-title" name="title" value="${esc(draft.title)}" required maxlength="120" placeholder="例如：探索细胞形态与基因表达的联系" autofocus></label><div class="form-end"><span class="muted">可以从一个模糊的想法开始。</span><button type="submit" class="primary">下一步：选择文件夹 →</button></div></form>`):panel('02 / 这个课题放在哪里',`<form id="new-project-form" class="panel-body"><p class="new-title-preview">课题 / <strong>${esc(draft.title)}</strong></p><label class="field"><span>课题文件夹（绝对路径）</span><div class="flex"><input id="new-directory" name="directory" value="${esc(draft.directory)}" required><button type="button" data-action="folder-browse" class="nowrap">浏览目录</button></div></label><p class="hint">这个课题的讨论、规则、技能、研究流程、任务和执行产物都保存在此目录中。路径不存在时会创建；已有文件会保留。</p>${folders?`<div class="folder-picker"><div class="flex"><button type="button" data-action="folder-open" data-path="${esc(folders.parent)}">.. 上级</button><span class="path grow">${esc(folders.path)}</span></div><div class="folder-entries">${folders.directories.map(d=>`<button type="button" data-action="folder-open" data-path="${esc(d.path)}">[dir] ${esc(d.name)} /</button>`).join('')||'<p class="hint">没有子文件夹。</p>'}</div><button type="button" class="primary" data-action="folder-select" data-path="${esc(folders.path)}">使用当前文件夹</button></div>`:''}<div class="form-end">${button('new-back','← 修改名称')}<button type="submit" class="primary">创建课题，开始和 CC 讨论 →</button></div></form>`)}<div class="note">CC 会先听你的 idea，追问目标与约束，随后提出研究方向。你确认后，课题才进入研究流程。</div></div>`;}

export function mentorPage(c) {
  const {p,state,esc,button,panel,busy,noProject}=c;
  if(!p)return noProject();
  const proposal=p.proposal;
  const review=p.proposalReviews?.at(-1),reviewed=!p.proposalReviewRequired&&review?.status==='completed'&&review.reviewers?.length===3&&review.reviewers.every(m=>m.verification?.data?.verdict==='ready')&&review.requirementsRevision===(p.steering?.revision||0);
  const turns=(p.conversation||[]).map(m=>`<article class="message"><div class="message-who"><strong class="${m.role==='user'?'green':'amber'}">${m.role==='user'?'研究者':'CC 导师'}</strong><time>${new Date(m.at).toLocaleTimeString('zh-CN',{hour12:false})}</time></div><div class="message-text">${esc(m.content)}</div></article>`).join('');
  const composer=p.intakeConfirmed?'<p class="panel-body muted">研究方向已确认，本次立项讨论已归档。</p>':`<form id="mentor-form" class="panel-body">
    <label class="field"><span>${turns?'回复 CC':'你的研究想法'}</span><textarea name="message" rows="3" required maxlength="20000" placeholder="你想解释什么现象？目前手头有哪些材料？" ${busy(p)?'disabled':''}></textarea></label>
    <div class="form-end"><span class="hint">每轮对话保存为 Markdown</span><button type="submit" class="primary" ${busy(p)||!state.scan?.clis?.cc?.available?'disabled':''}>发送给 CC</button></div>
    ${state.scan&&!state.scan.clis?.cc?.available?'<p class="work-notice">尚未找到 Claude Code。<button type="button" data-view="settings">检查本机连接</button></p>':''}</form>`;
  const discuss=panel('与 CC 讨论研究问题',`<div class="conversation">${turns||'<p class="hint">从一个问题开始。CC 会根据你的描述追问目标、材料和限制，再提出研究方向。</p>'}${p.status==='chatting'?'<p class="hint amber">CC 正在整理回复…</p>':''}</div>${composer}`);
  const direction=proposal?panel(p.intakeConfirmed?'已确认的研究方向':reviewed?'评审后的研究方向 · 待你确认':'主导师提案 · 待评委会完善',`<div class="panel-body"><h3>${esc(proposal.researchTopic)}</h3><p class="hint">${esc(proposal.direction)}</p>
    <details><summary>研究想法与计划 · ${proposal.pipeline.length} 步</summary>${proposal.ideas.map(i=>`<p class="proposal-item">${esc(i)}</p>`).join('')}${proposal.pipeline.map((s,i)=>`<div class="proposal-step"><span>${i+1}</span><div><strong>${esc(s.title)}</strong><p>${esc(s.description)}</p></div></div>`).join('')}</details>
    <div class="section-gap">${p.intakeConfirmed?button('goto-pipeline','查看研究流程'):reviewed?button('activate','审核通过，出环并推进','primary',`data-round="${esc(review.id)}" data-hash="${esc(review.finalHash)}" ${busy(p)?'disabled':''}`):'<p class="hint">主导师修改后重新送审，三位委员全票通过才提交给你审核。</p>'}</div></div>`):'';
  return `<div class="mentor-stack">${direction}${reviewed&&!p.intakeConfirmed?panel('退回提案',`<form id="proposal-revise-form" class="panel-body"><label class="field"><span>需要主 CC 修改的内容</span><textarea name="message" required maxlength="20000" rows="2"></textarea></label><button type="submit" ${busy(p)?'disabled':''}>退回修改，重新送审</button></form>`):''}${councilPanel(c)}${discuss}${p.error&&p.error!==review?.error?`<p class="work-notice">${esc(p.error)}</p>`:''}</div>`;
}

export function architecturePage(c){return architecture(c);}

const skillSources = {Claude:'Claude Code', Codex:'Codex', Shared:'本机共享', Workspace:'当前工作区', Custom:'附加目录'};

export function skillsPage(c,catalog,selection){
  const {p,head,panel,button,esc,noProject}=c;
  if(!p)return head('课题技能','为每个课题单独选择技能')+noProject();
  const header=head('课题技能',p.title,button('refresh-skills','重新扫描')+button('save-skills','保存选择','primary',c.busy(p)?'disabled':''));
  const counts=`<div class="subnav"><span>可用技能 <strong>${catalog?.length??'…'}</strong></span><span>已勾选 <strong id="skill-count">${selection.size}</strong></span><span>生效范围 <strong>仅当前课题</strong></span></div>`;
  const search='<label class="field"><span>搜索技能</span><input id="skill-search" type="search" placeholder="输入中文名称、用途或英文标识，例如：文献、绘图"></label>';
  const rows=catalog?.map(s=>{
    const title=s.displayName||s.name, description=s.displayDescription||s.description, source=skillSources[s.source]||s.source;
    const terms=[title,description,s.name,s.description,source].join(' ').toLowerCase();
    return `<label class="skill-item" data-search="${esc(terms)}"><input type="checkbox" class="skill-checkbox" value="${esc(s.id)}" ${selection.has(s.id)?'checked':''}><div><div class="skill-name">${esc(title)} <span class="badge">${esc(source)}</span></div><p>${esc(description||'此技能未提供说明。')}</p>${title!==s.name?`<small>原标识：${esc(s.name)}</small><br>`:''}<small class="path">${esc(s.path)}</small></div></label>`;
  }).join('');
  const list=rows?`<div class="skill-list">${rows}</div><p id="skill-no-results" class="blank" hidden>没有匹配的技能，试试其他关键词。</p>`:catalog?'<div class="blank">未发现本机技能。可将含 SKILL.md 的技能文件夹放入 .claude/skills、.codex/skills 或 .agents/skills 后重新扫描。</div>':'<div class="blank">正在扫描本机技能…</div>';
  return header+counts+search+panel('选择本课题使用的技能',list)+'<div class="note">保存后，CC 导师和各个 CX 执行者都能使用这些技能。每次调用会读取所选技能的 SKILL.md，并记录文件来源和内容校验值。本机全局配置不变；依赖外部服务的技能需在本机配置。</div>';
}
