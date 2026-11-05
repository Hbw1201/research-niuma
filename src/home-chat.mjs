import path from 'node:path';
import {assert,now,text,uid} from './store.mjs';

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

  snapshot(id) {
    const jobs=new Map(this.store.state.jobs.filter(j=>j.kind==='home-chat').map(j=>[j.id,j]));
    const selected=this.chats.find(c=>c.id===id);
    const clis=this.getScan()?.clis;
    return {
      workspace:this.store.workspace,
      cli:clis?{ready:Boolean(clis.cc?.available),version:clis.cc?.version||'',error:clis.cc?.error||''}:null,
      chats:this.chats.map(c=>({id:c.id,title:c.title,updatedAt:c.turns.at(-1)?.at})).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt)),
      chat:selected?{id:selected.id,title:selected.title,turns:selected.turns.map(turn=>{
        const job=jobs.get(turn.jobId);
        return {id:turn.id,message:turn.message,at:turn.at,jobId:turn.jobId,
          status:turn.error?'failed':job?.status||'interrupted',
          reply:job?.status==='completed'?job.output:job?.replyPreview||'',
          error:turn.error||job?.error||'',model:job?.actualModels?.[0]||job?.model||''};
      })}:null
    };
  }

  send({chatId,requestId,message,workspace}) {
    assert(workspace===this.store.workspace,'工作区已切换，请刷新后再发送。',409);
    const content=text(message,20000);
    assert(typeof requestId==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(requestId),'消息标识无效。');
    const existing=this.chats.find(c=>c.turns.some(t=>t.id===requestId));
    if(existing){
      const previous=existing.turns.find(t=>t.id===requestId);
      assert((!chatId||chatId===existing.id)&&previous.message===content,'消息标识已用于其他内容。',409);
      return {chatId:existing.id,turnId:previous.id};
    }
    const cli=this.getScan()?.clis?.cc;
    assert(cli?.available,'Claude Code 尚未就绪，请检查本机连接。',409);
    let chat;
    if(chatId){
      chat=this.chats.find(c=>c.id===chatId);
      assert(chat,'找不到这段主页对话。',404);
      assert(!this.pending.has(chatId),'请等待当前回复完成，或先停止生成。',409);
    } else {
      chat={id:uid(),title:content.replace(/\s+/g,' ').slice(0,56),turns:[]};
      this.chats.unshift(chat);
    }
    const previousJob=this.store.state.jobs.find(j=>j.kind==='home-chat'&&j.chatId===chat.id&&j.sessionId);
    const turn={id:requestId,jobId:uid(),message:content,at:now()};
    chat.turns.push(turn);
    this.runner.changed();
    const rules=this.store.rules();
    const instructions=[rules.workspace,rules.agents,rules.claude].filter(Boolean).join('\n\n');
    const prompt=instructions?`工作区规则：\n${instructions}\n\n研究者：\n${content}`:content;
    const work=this.runner.execute({id:turn.jobId,chatId:chat.id,kind:'home-chat',provider:'cc',title:'Claude Code · '+chat.title,
      executable:cli.path,cwd:this.store.workspace,directory:path.join(this.store.root,'home',chat.id),
      prompt,sessionId:previousJob?.sessionId}).catch(e=>{
        const job=this.store.state.jobs.find(j=>j.id===turn.jobId);
        if(!job)turn.error=e.message;
        else if(!job.error){job.error=e.message;job.status='failed';job.endedAt=now();}
      }).finally(()=>{this.pending.delete(chat.id);this.runner.changed();});
    this.pending.set(chat.id,work);
    return {chatId:chat.id,turnId:turn.id};
  }
}
