import fs from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { recoverUsage } from './usage.mjs';

export const uid = () => randomUUID();
export const now = () => new Date().toISOString();
export const defaultAutonomy = (mode = 'auto') => ({mode,maxWorkers:8,maxParallel:4,maxReviews:100,brief:''});
export const defaultArchitecture = () => ({ mentor:'CC 导师', confirmed:false, parallel:2, workers:[
  {id:'cx-1',name:'CX-01',role:'方法与代码实现',sessionId:''},
  {id:'cx-2',name:'CX-02',role:'数据处理与准备',sessionId:''},
  {id:'cx-3',name:'CX-03',role:'实验设计与评估',sessionId:''},
  {id:'cx-4',name:'CX-04',role:'验证、复现与报告',sessionId:''}
] .map(w=>({...w,model:'',language:'',skillIds:[]})) });
export function upgradeProject(p) {
  if(p.status==='failed'&&p.error==='任务已停止。')p.status='interrupted';
  p.architecture ||= defaultArchitecture();p.architecture.confirmed ??= Boolean(p.tasks?.length);
  p.mentor ||= {model:'',language:'简体中文'};
  p.modelPolicy ||= {allowCCSwitch:false,allowedModels:[]};
  // Existing projects keep their previous operating mode until the user enables Auto Research.
  p.autonomy ||= defaultAutonomy('assisted');p.teamChanges ||= [];
  p.steering ||= {revision:0,turns:[],sessionId:''};
  p.teamConversation ||= [];p.modelChanges ||= [];
  p.proposalReviews ||= [];
  p.stageReviews ||= [];p.stageReviewRevisions ||= {};
  p.collaboration ||= {state:'idle',maxReviews:8,reviewsUsed:0,messages:[],reviews:[],pendingDecision:null};
  p.collaboration.messages ||= [];p.collaboration.reviews ||= [];
  for(const w of p.architecture.workers){w.model ??='';w.language ??='';w.skillIds ||= [];w.active ??= true;w.pinned ??= false;}
}
export function assert(condition, message, status = 400) { if (!condition) throw Object.assign(new Error(message), { status }); }
export function text(value, max = 20000) { assert(typeof value === 'string' && value.trim().length > 0 && value.length <= max, `文本不能为空，且不得超过 ${max} 字符。`); return value.trim(); }

export class Store {
  constructor(workspace) {
    this.workspace = path.resolve(workspace);
    this.root = path.join(this.workspace, '.relay-lab');
    fs.mkdirSync(this.root, { recursive: true });
    this.file = path.join(this.root, 'state.json');
    this.lockFile = path.join(this.root, 'server.lock');
    try {
      const fd = fs.openSync(this.lockFile, 'wx'); fs.writeFileSync(fd, String(process.pid)); fs.closeSync(fd);
    } catch {
      const pid = Number(fs.readFileSync(this.lockFile, 'utf8'));
      let alive = false; try { process.kill(pid, 0); alive = true; } catch (e) { if (e.code === 'EPERM') alive = true; }
      assert(!alive, '此工作区已被另一工作台占用，请使用已有窗口或选择其他工作区。', 409);
      fs.writeFileSync(this.lockFile, String(process.pid));
    }
    try {
      this.state = fs.existsSync(this.file) ? JSON.parse(fs.readFileSync(this.file, 'utf8')) : { version: 1, settings: { ccPath: '', cxPath: '', concurrency: 4 }, projects: [], jobs: [], activity: [] };
      for(const p of this.state.projects){upgradeProject(p);p.skillIds ||= [];p.conversation ||= [];p.directory ||= this.workspace;p.intakeConfirmed ??= true;}
      for(const p of this.state.projects)for(const t of p.steering.turns)if(['queued','replying'].includes(t.status)){t.status='interrupted';t.error='工作台已重启，可重试这条消息。';}
      recoverUsage(this.state,id=>this.folder(id));
      for (const job of this.state.jobs) if (['running', 'queued', 'cancelling'].includes(job.status)) { job.status = 'interrupted'; job.error = '工作台在此任务完成前退出；请检查产物后手动重试。'; }
      for(const p of this.state.projects)for(const r of p.proposalReviews)if(r.status==='running'){r.status='interrupted';r.error='工作台已重启，已完成的评审保留；继续后仅补齐未完成步骤。';p.status='interrupted';for(const step of [...r.reviewers.flatMap(m=>[m.independent,m.cross]),r.synthesis])if(step.status==='running')step.status='interrupted';}
      for(const p of this.state.projects)for(const r of p.stageReviews)if(r.status==='running'){r.status='interrupted';r.error='工作台已重启，继续协作后恢复未完成的评审与修改。';for(const step of [...r.reviewers.flatMap(m=>[m.independent,m.cross]),r.synthesis])if(step.status==='running')step.status='interrupted';}
      for (const p of this.state.projects) { if (['proposal_reviewing','brainstorming','planning','executing','reviewing','chatting','team_chatting'].includes(p.status)) p.status = 'interrupted'; for (const t of p.tasks || []) if (['running','queued'].includes(t.status)) t.status = 'interrupted'; }
      for(const p of this.state.projects)if(p.collaboration.state==='running'){p.collaboration.state='paused';p.collaboration.pauseReason='工作台已退出，历史步骤保留；点击继续后恢复反馈与待办。';p.status='interrupted';}
      this.save();
    } catch (e) { this.close(); throw e; }
  }
  close() { try { if (fs.readFileSync(this.lockFile, 'utf8') === String(process.pid)) fs.unlinkSync(this.lockFile); } catch {} }
  save() { const tmp = `${this.file}.tmp`; fs.writeFileSync(tmp, JSON.stringify(this.state, null, 2)); fs.renameSync(tmp, this.file);for(const p of this.state.projects){if(!p.dataDirectory)continue;fs.mkdirSync(p.dataDirectory,{recursive:true});const meta=path.join(p.dataDirectory,'project.json');fs.writeFileSync(meta+'.tmp',JSON.stringify(p,null,2));fs.renameSync(meta+'.tmp',meta);} }
  log(message, projectId, type = 'info') { this.state.activity.unshift({ id: uid(), at: now(), message, projectId, type }); this.state.activity = this.state.activity.slice(0, 300); this.save(); }
  project(id) { const p = this.state.projects.find(p => p.id === id); assert(p, '课题不存在。', 404); return p; }
  folder(id) { const p=this.project(id); return p.dataDirectory || path.join(this.root, 'projects', id); }
  doc(projectId, name, title, content, kind = 'markdown') {
    assert(/^[a-zA-Z0-9_-]+\.md$/.test(name), '非法文档名。');
    const p = this.project(projectId), dir = this.folder(projectId);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), content, 'utf8');
    let doc = p.documents.find(d => d.name === name);
    if (!doc) { doc = { id: uid(), name, title, kind, createdAt: now() }; p.documents.push(doc); }
    doc.updatedAt = now(); this.save(); return doc;
  }
  readDoc(projectId, docId) {
    const p = this.project(projectId), d = p.documents.find(d => d.id === docId);
    assert(d, '文档不存在。', 404);
    const file = path.join(this.folder(projectId), d.name);
    return { ...d, path: file, content: fs.readFileSync(file, 'utf8') };
  }
  rules(projectId) {
    const read = file => { try { return fs.readFileSync(file,'utf8').slice(0,30000); } catch { return ''; } };
    const directory=projectId?this.project(projectId).directory:null;
    return { workspace: read(path.join(this.root,'RULES.md')), project: projectId ? read(path.join(this.folder(projectId),'02-project-rules.md')) : '', agents: read(path.join(this.workspace,'AGENTS.md')), claude: read(path.join(this.workspace,'CLAUDE.md')), projectAgents:directory?read(path.join(directory,'AGENTS.md')):'',projectClaude:directory?read(path.join(directory,'CLAUDE.md')):'' };
  }
  rulesText(projectId) {
    const rules=this.rules(projectId);
    return Object.entries(rules).filter(([,value])=>value.trim()).map(([key,value])=>`## ${key} 规则\n\n${value}`).join('\n\n') || '没有附加工作区规则。遵循研究者批准的任务范围。';
  }
  setRules(content, projectId) {
    assert(typeof content==='string'&&content.length<=30000,'规则不得超过 30,000 字符。');
    if(projectId)this.doc(projectId,'02-project-rules.md','课题规则',content,'rules');
    else fs.writeFileSync(path.join(this.root,'RULES.md'),content,'utf8');
    this.log(projectId?'已更新课题规则。':'已更新工作区规则。',projectId);
  }
  newProject(input) {
    const title=text(input.title,120),id=uid();
    const directory=input.directory?path.resolve(text(input.directory,4096)):path.join(this.workspace,'projects',id.slice(0,8));
    if(input.directory)assert(path.isAbsolute(input.directory),'课题目录必须是绝对路径。');
    fs.mkdirSync(directory,{recursive:true});
    const brief=typeof input.brief==='string'?input.brief.trim():'';assert(brief.length<=20000,'研究目标过长。');
    const p = { id, title, brief, directory, dataDirectory:path.join(directory,'.relay-lab','projects',id), intakeConfirmed:!!brief, status: brief?'draft':'defining', architecture:defaultArchitecture(),skillIds:[],conversation:[],createdAt: now(), questions: [], perspectives: [], tasks: [], documents: [], ccSessionId: '', error: '' };
    this.state.projects.unshift(p);
    upgradeProject(p);p.architecture.confirmed=!!brief;
    p.autonomy=defaultAutonomy();p.modelPolicy.allowCCSwitch=true;p.collaboration.maxReviews=p.autonomy.maxReviews;
    this.doc(p.id, '00-brief.md', '研究目标', `# ${p.title}\n\n${p.brief}\n\n## 协作约定\n\nCC 主持讨论与拆解任务；研究者逐项批阅；CX 只执行已批准的任务。所有交接留存为 Markdown。\n`);
    this.log('新建课题：' + p.title, p.id);
    return p;
  }
}
