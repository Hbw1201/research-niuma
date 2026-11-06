import path from 'node:path';
import fs from 'node:fs';
import {assert,now,text,uid} from './store.mjs';
import {ProjectFiles} from './project-files.mjs';

// Home conversations belong to the workspace. Only the server chooses CLI session IDs.
export class HomeChat {
  constructor(store,runner,getScan) {
    this.store=store;
    this.runner=runner;
    this.getScan=getScan;
    this.pending=new Map();
    store.state.homeChats??=[];
  }

  get chats(){ return this.store.state.homeChats; }

  snapshot(id, projectId = '') {
    const jobs=new Map(this.store.state.jobs.filter(j=>j.kind==='home-chat').map(j=>[j.id,j]));
    const selected=this.chats.find(c=>c.id===id);
    const owner=selected?.projectId||projectId;
    const project=this.store.state.projects.find(p=>p.id===owner);
    const clis=this.getScan()?.clis;
    return {
      workspace:this.store.workspace,
      projects:this.store.state.projects.map(p=>({id:p.id,title:p.title,directory:p.directory,status:p.status})),
      project:project?{id:project.id,title:project.title,directory:project.directory,researchDirectory:this.store.folder(project.id)}:null,
      cli:clis?{ready:Boolean(clis.cc?.available),version:clis.cc?.version||'',error:clis.cc?.error||''}:null,
      chats:this.chats.map(c=>({id:c.id,title:c.title,projectId:c.projectId||'',folder:c.folder||'',updatedAt:c.turns.at(-1)?.at||''})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),
      chat:selected?{id:selected.id,title:selected.title,projectId:selected.projectId||'',folder:selected.folder||'',turns:selected.turns.map(turn=>{
        const job=jobs.get(turn.jobId);
        return {id:turn.id,message:turn.message,at:turn.at,jobId:turn.jobId,
          status:turn.error?'failed':job?.status||'interrupted',
          reply:job?.status==='completed'?job.output:job?.replyPreview||'',
          error:turn.error||job?.error||'',model:job?.actualModels?.[0]||job?.model||''};
      })}:null
    };
  }

  saveTranscript(chat) {
    if(!chat.projectId)return;
    const jobs=new Map(this.store.state.jobs.map(j=>[j.id,j]));
    const content=`# ${chat.title}\n\n当前目录：${chat.folder||'项目根目录'}\n\n`+chat.turns.map(turn=>{
      const job=jobs.get(turn.jobId);
      return `## 研究者 · ${turn.at}\n\n${turn.message}\n\n## Claude Code\n\n${job?.output||job?.error||turn.error||'回复中…'}\n`;
    }).join('\n');
    this.store.doc(chat.projectId,'60-chat-'+chat.id+'.md','项目对话 · '+chat.title,content,'chat');
  }
  send({chatId,requestId,message,workspace,projectId,folder}) {
    assert(workspace===this.store.workspace,'工作区已切换，请刷新后再发送。',409);
    const content=text(message,20000);
    assert(typeof requestId==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(requestId),'消息标识无效。');
    const existing=this.chats.find(c=>c.turns.some(t=>t.id===requestId));
    const selected=chatId?this.chats.find(c=>c.id===chatId):null;
    if(chatId)assert(selected,'找不到这段对话。',404);
    const scope=projectId===undefined?(selected?.projectId||''):projectId;
    const location=folder===undefined?(selected?.folder||''):folder;
    assert(typeof scope==='string'&&typeof location==='string','项目或目录无效。');
    if(selected)assert((selected.projectId||'')===scope&&(selected.folder||'')===location,'已有对话的项目和目录不能改变，请在目标目录新建对话。',409);
    if(existing){
      const previous=existing.turns.find(t=>t.id===requestId);
      assert((!chatId||chatId===existing.id)&&previous.message===content&&(existing.projectId||'')===scope&&(existing.folder||'')===location,'消息标识已用于其他内容。',409);
      return {chatId:existing.id,turnId:previous.id};
    }
    const cli=this.getScan()?.clis?.cc;
    assert(cli?.available,'Claude Code 尚未就绪，请检查本机连接。',409);
    assert(scope||!location,'独立对话不能指定项目子目录。');
    const target=scope?new ProjectFiles(this.store).resolve(scope,location):null;
    if(target)assert(fs.statSync(target.target).isDirectory(),'请选择文件夹。');
    let chat;
    if(chatId){
      chat=this.chats.find(c=>c.id===chatId);
      assert(chat,'找不到这段主页对话。',404);
      assert(!this.pending.has(chatId),'请等待当前回复完成，或先停止生成。',409);
    } else {
      chat={id:uid(),title:content.replace(/\s+/g,' ').slice(0,56),projectId:scope,folder:target?.relative||'',turns:[]};
      this.chats.unshift(chat);
    }
    const previousJob=this.store.state.jobs.find(j=>j.kind==='home-chat'&&j.chatId===chat.id&&j.sessionId);
    if(previousJob)assert(previousJob.cwd===(target?.target||this.store.workspace),'对话目录已变化，请新建对话。',409);
    const turn={id:requestId,jobId:uid(),message:content,at:now()};
    chat.turns.push(turn);
    this.runner.changed();
    const rules=this.store.rules();
    const instructions=[rules.workspace,rules.agents,rules.claude].filter(Boolean).join('\n\n');
    const prompt=instructions?`工作区规则：\n${instructions}\n\n研究者：\n${content}`:content;
    const args={id:turn.jobId,chatId:chat.id,kind:'home-chat',provider:'cc',title:'Claude Code · '+chat.title,
      executable:cli.path,cwd:target?.target||this.store.workspace,directory:path.join(this.store.root,'home',chat.id),
      prompt:scope?`你正在项目「${target.project.title}」内与研究者对话。项目根目录：${target.project.directory}。当前目录：${target.target}。实验区文档与产物：${this.store.folder(scope)}。这些是同一项目的本地文件，可读取现有文件了解上下文。普通讨论不自动批准实验或改写研究要求；要调度实验请提示使用实验区的 CC 总控。\n\n研究者：\n${content}`:prompt,
      sessionId:previousJob?.sessionId};
    const work=(scope?this.runner.run({...args,projectId:scope}):this.runner.execute(args)).catch(e=>{
        const job=this.store.state.jobs.find(j=>j.id===turn.jobId);
        if(!job)turn.error=e.message;
        else if(!job.error){job.error=e.message;job.status='failed';job.endedAt=now();}
      }).finally(()=>{this.pending.delete(chat.id);this.saveTranscript(chat);this.runner.changed();});
    this.pending.set(chat.id,work);
    this.saveTranscript(chat);
    return {chatId:chat.id,turnId:turn.id};
  }
}
