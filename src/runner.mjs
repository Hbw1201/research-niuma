import {activeRequirements,controlPreview} from './steering.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import { invocation, stopChild } from './platform.mjs';
import { uid, now, assert } from './store.mjs';
import { scanSkills, loadSelectedSkills } from './skills.mjs';
import { usageTracker } from './usage.mjs';

export function cliArgs(provider, { sessionId, schema, agents, model, liveReply=false } = {}) {
  if (provider === 'cx') {
    const args = ['-a', 'never', '-s', 'workspace-write', 'exec'];
    if (sessionId) args.push('resume');
    args.push('--json', '--skip-git-repo-check');
    if(model)args.push('--model',model);
    if (sessionId) args.push(sessionId);
    args.push('-');
    return args;
  }
  const args = ['-p', '--output-format', 'stream-json', '--verbose', '--permission-mode', 'dontAsk', '--allowedTools', 'Read,Glob,Grep,Agent,Task,WebSearch,WebFetch'];
  if(model)args.push('--model',model);
  if (sessionId) args.push('--resume', sessionId);
  if (liveReply) args.push('--include-partial-messages');
  if (schema) args.push('--json-schema', JSON.stringify(schema));
  if (agents) args.push('--agents', JSON.stringify(agents));
  return args;
}

export function decodeEvent(provider, x) {
  const out = { text: '', sessionId: '', error: '', structured: null, notice: '' };
  if (provider === 'cc') {
    out.sessionId = x.session_id || '';
    if (x.type === 'assistant') for (const c of x.message?.content || []) {
      if (c.type === 'text') out.text += c.text + '\n';
      if (c.type === 'tool_use') out.notice += `${c.name}${c.input?.subagent_type ? ' · ' + c.input.subagent_type : ''}\n`;
    }
    if (x.type === 'result') {
      out.structured = x.structured_output || null;
      out.text = x.result || '';
      if (x.is_error || (x.subtype && x.subtype !== 'success')) out.error = x.result || (x.errors || []).join('\n') || x.subtype;
    }
  } else {
    if (x.type === 'thread.started') out.sessionId = x.thread_id;
    if (x.type === 'item.completed' && x.item?.type === 'agent_message') out.text = x.item.text || '';
    if (x.type === 'item.started') out.notice = x.item?.type || '';
    if (x.type === 'turn.failed' || x.type === 'error') out.error = x.error?.message || x.message || 'Codex 任务失败';
  }
  return out;
}

export class Runner extends EventEmitter {
  constructor(store) { super(); this.store = store; this.children = new Map(); this.closing = false; }
  changed() { this.store.save(); this.emit('change'); }
  async run({ projectId, provider, kind, title, executable, cwd, prompt, sessionId, schema, agents, args, workerId='', taskId='', model, language, skillIds, controlTurnId }) {
    assert(!this.closing, '服务正在退出。', 409);
    const project=this.store.project(projectId);
    const worker=project.architecture.workers.find(w=>w.id===workerId);
    model ??= provider==='cc'?project.mentor.model:worker?.model||'';
    language ||= worker?.language||project.mentor.language||'简体中文';
    const selected=kind==='handoff'?[]:loadSelectedSkills({skillIds:[...new Set([...(project.skillIds||[]),...(skillIds||worker?.skillIds||[])])]},scanSkills(this.store.workspace,[...(this.store.state.settings.skillRoots||[]),...['.claude','.codex','.agents'].map(dir=>path.join(project.directory,dir,'skills'))]));
    prompt=`输出语言：${language}。面向研究者的解释、进展与最终报告使用此语言；保留必要的代码、路径和模型标识。\n\n`+(prompt||'');
    if(kind!=='handoff') prompt=`# 本次工作区与课题规则\n\n${this.store.rulesText(projectId)}\n\n# 本课题显式选择的 Skills\n\n${selected.length?selected.map(s=>`## ${s.name}\n来源：${s.path}\n相对资源请基于 ${s.directory} 解析。\n\n${s.content}`).join('\n\n'):'研究者未显式选择附加 Skill。'}\n\n以本课题选择的技能为优先，不要擅自扩展研究任务或修改全局技能配置。\n\n# 当前任务\n\n${prompt}`;
    prompt+=`\n\n本次输出语言设置：${language}。请据此撰写面向研究者的说明和报告，模型标识与 JSON 字段名保持不变。`;
    const steeringRevision=kind==='handoff'?0:(project.steering?.revision||0);
    if(steeringRevision)prompt+='\n\n# 研究者更新的课题要求（按发出顺序，后发要求修订冲突项）\n'+activeRequirements(project)+'\n在既有权限与已确认研究范围内应用。若与获批决策冲突或需新授权，向研究者说明，不擅自执行。';
    return this.execute({projectId,provider,kind,title,executable,cwd,prompt,sessionId,schema,agents,args,workerId,taskId,model,language,controlTurnId,steeringRevision,
      skills:selected.map(({id,name,path,hash})=>({id,name,path,hash})),directory:this.store.folder(projectId)});
  }

  async execute({id=uid(),directory,projectId,chatId,provider,kind,title,executable,cwd,prompt,sessionId,schema,agents,args,workerId='',taskId='',model,language,controlTurnId,steeringRevision=0,skills=[]}) {
    assert(!this.closing,'服务正在退出。',409);
    const homeChat=kind==='home-chat';
    const baseline=this.store.state.jobs.find(j=>j.provider==='cc'&&j.sessionId===sessionId&&j.sessionModelUsage)?.sessionModelUsage||null;
    const usage=usageTracker(provider,{baseline,continued:!!sessionId});
    const job = { id, projectId, chatId, provider, kind, title, workerId, taskId, model, language, controlTurnId, steeringRevision, usageVersion:2, usage:null, status: 'running', startedAt: now(), cwd, requestedSessionId:sessionId||'', sessionId: sessionId || '', skills, log: [], output: '', error: '' };
    this.store.state.jobs.unshift(job);
    const jobDir = path.join(directory, 'runs', job.id);
    fs.mkdirSync(jobDir, { recursive: true });
    fs.writeFileSync(path.join(jobDir, 'input.md'), prompt || '');
    const logFile = fs.createWriteStream(path.join(jobDir, 'events.jsonl'));
    logFile.on('error', e => { job.error = '日志写入失败：' + e.message; });
    this.changed();
    return new Promise((resolve, reject) => {
      let child, buffer = '', stderr = '', structured = null, finalOutput = '', fatal = '', settled = false;
      const append = line => { job.log.push(line.slice(0, 4000)); if (job.log.length > 120) job.log.shift(); this.emit('change'); };
      const preview=controlTurnId?controlPreview():null;
      let partialText='';
      const consume = line => {
        if (!line.trim()) return;
        logFile.write(line + '\n');
        try {
          const x = JSON.parse(line), e = decodeEvent(provider, x);
          if(homeChat){
            if(x.parent_tool_use_id)return;
            if(x.type==='stream_event'){
              const event=x.event;
              if(event?.type==='message_start')partialText='';
              if(event?.type==='content_block_delta'&&event.delta?.type==='text_delta'){
                partialText=(partialText+event.delta.text).slice(-100000);
                job.replyPreview=partialText;this.emit('change');
              }
            }
            if(x.type==='assistant'&&e.text)job.replyPreview=e.text.trimEnd();
          }
          if(preview){
            const answer=preview(x);
            if(typeof answer==='string'&&answer!==job.replyPreview){job.replyPreview=answer.slice(0,30000);this.emit('change');}
          }
          Object.assign(job,usage.observe(x));
          if(provider==='cx'&&x.type==='item.completed'&&x.item?.type==='command_execution')append('› '+(x.item.command||'command')+'\n'+(x.item.aggregated_output||'').slice(-4000));
          if (e.sessionId) job.sessionId = e.sessionId;
          if (e.structured) structured = e.structured;
          if (e.error) fatal = e.error;
          if (e.text) { finalOutput = e.text; job.output = (job.output + '\n' + e.text).slice(-100000); append(e.text); }
          if (e.notice) append('› ' + e.notice);
        } catch { append(line); finalOutput += line + '\n'; }
      };
      const finish = (code, error) => {
        if (settled) return; settled = true; clearTimeout(timeout);
        if (buffer) consume(buffer); logFile.end(); this.children.delete(job.id);
        job.endedAt = now();
        if (job.status === 'cancelling' || this.closing) { job.status = 'cancelled'; job.error = '任务已停止。'; }
        else if (error || code !== 0 || fatal || job.error) { job.status = 'failed'; job.error = (error?.message || fatal || job.error || stderr || `CLI 退出码 ${code}`).slice(-6000); }
        else job.status = 'completed';
        job.output = finalOutput || job.output;
        fs.writeFileSync(path.join(jobDir, 'output.md'), job.output || job.error || 'CLI 未返回文本。');
        this.changed();
        if (job.status === 'completed') resolve({ job, text: job.output, structured });
        else reject(Object.assign(new Error(job.error), { jobId: job.id }));
      };
      const timeout = setTimeout(() => { fatal = '任务超过 60 分钟，已停止。'; if (child) stopChild(child); }, 3600000);
      timeout.unref();
      try {
        const call = invocation(executable, args || cliArgs(provider, { sessionId, schema, agents, model, liveReply:homeChat||Boolean(controlTurnId) }));
        child = spawn(call.command, call.args, { cwd, env: call.env, windowsHide: true, detached: process.platform !== 'win32', stdio: ['pipe','pipe','pipe'] });
        job.pid = child.pid; this.children.set(job.id, child);
        child.stdout.setEncoding('utf8'); child.stderr.setEncoding('utf8');
        child.stdout.on('data', chunk => { buffer += chunk; const lines = buffer.split('\n'); buffer = lines.pop(); for (const line of lines) consume(line); if (buffer.length > 2 * 1024 * 1024) { fatal = 'CLI 返回单行数据过大。'; stopChild(child); } });
        child.stderr.on('data', chunk => { stderr = (stderr + chunk).slice(-12000); append(chunk); });
        child.on('error', e => finish(null, e)); child.on('close', code => finish(code));
        child.stdin.on('error', e => { if (e.code !== 'EPIPE') fatal = e.message; });
        child.stdin.end(prompt || '');
      } catch (e) { finish(null, e); }
    });
  }
  cancel(id) {
    const child = this.children.get(id); assert(child, '任务已结束或不由当前工作台管理。', 409);
    const job = this.store.state.jobs.find(x => x.id === id); job.status = 'cancelling'; this.changed(); stopChild(child);
  }
  async close() {
    this.closing = true;
    const children = [...this.children.values()];
    for (const child of children) stopChild(child);
    await Promise.all(children.map(child => new Promise(resolve => { if (child.exitCode !== null) return resolve(); child.once('close', resolve); setTimeout(resolve, 3000).unref(); })));
  }
}
