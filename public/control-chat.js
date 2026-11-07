// The composer lives outside the project pane so navigation and live updates preserve typing.
export class ControlChat {
  constructor(host, {request, refresh, esc}) {
    Object.assign(this,{host,request,refresh,esc});
    this.drafts=new Map();this.activeKey='';this.visible=false;
    host.addEventListener('input',()=>this.capture());
    host.addEventListener('submit',e=>{e.preventDefault();this.send();});
    host.addEventListener('click',e=>{
      if(e.target.closest('[data-close-control]'))this.toggle(false);
      const retry=e.target.closest('[data-retry-turn]');
      if(retry)this.retry(retry.dataset.retryTurn);
    });
    host.addEventListener('keydown',e=>{
      if(e.key==='Escape'){e.preventDefault();e.stopPropagation();this.toggle(false);}
      if(e.key==='Enter'&&(e.ctrlKey||e.metaKey)&&!e.isComposing&&e.target.tagName==='TEXTAREA'){
        e.preventDefault();host.querySelector('form').requestSubmit();
      }
    });
  }
  capture(){
    const form=this.host.querySelector('form');
    if(!form||!this.activeKey)return;
    const draft=this.drafts.get(this.activeKey);
    if(draft.message!==form.elements.message.value||draft.required!==form.elements.requirement.checked)draft.requestId=null;
    draft.message=form.elements.message.value;draft.required=form.elements.requirement.checked;
  }
  update(state,p,enabled){
    const key=enabled&&p?state.workspace+'/'+p.id:'';
    if(key!==this.activeKey){
      this.capture();this.activeKey=key;this.visible=false;this.markup='';this.host.replaceChildren();
    }
    this.p=key?p:null;this.jobs=state.jobs;this.ready=Boolean(state.scan?.clis?.cc?.available);
    if(key&&!this.drafts.has(key))this.drafts.set(key,{message:'',required:false});
    this.paint();
  }
  toggle(force){
    if(!this.p)return;
    this.visible=force??!this.visible;this.paint();
    if(this.visible)this.host.querySelector('textarea')?.focus({preventScroll:true});
    else document.querySelector('#control-launch')?.focus({preventScroll:true});
  }
  paint(){
    const p=this.p,turns=p?.steering?.turns||[];
    const pending=turns.filter(t=>['queued','replying'].includes(t.status)).length;
    const latest=turns.findLast(t=>t.status==='answered'||t.status==='failed');
    const badgeKey='cc-control-read:'+this.activeKey;
    if(latest&&this.visible)sessionStorage.setItem(badgeKey,latest.id);
    const unread=latest&&sessionStorage.getItem(badgeKey)!==latest.id;
    const launch=document.querySelector('#control-launch');
    if(launch){launch.setAttribute('aria-expanded',String(this.visible));launch.textContent=pending?'CC 回复中…':unread?'CC 有新消息':'和 CC 对话';}
    document.querySelector('.work-layout')?.classList.toggle('control-open',this.visible);
    this.host.hidden=!this.visible;
    if(!p||!this.visible)return;
    const draft=this.drafts.get(this.activeKey),esc=this.esc;
    if(!this.host.firstElementChild){
      this.host.innerHTML=`<header class="control-head"><div><strong>和 CC 对话</strong><small></small></div><button type="button" data-close-control aria-label="收起导师对话">收起</button></header>
        <div class="control-feed" role="log" aria-label="课题总控对话记录" aria-live="polite"></div>
        <form id="control-form" class="control-compose"><label><span class="control-label">给当前课题的 CC</span><textarea name="message" required rows="2" maxlength="20000" placeholder="问进度、讨论结果，或告诉 CC 下一步要改什么…"></textarea></label>
        <div class="control-actions"><label><input type="checkbox" name="requirement"> 直接设为课题要求</label><button class="primary" type="submit">发送</button></div><small class="control-status" role="status"></small></form>`;
      this.host.querySelector('.control-head small').textContent=p.title;
      const form=this.host.querySelector('form');form.elements.message.value=draft.message;form.elements.requirement.checked=draft.required;
    }
    const feed=this.host.querySelector('.control-feed');
    const readers=this.jobs.filter(j=>j.projectId===p.id&&j.steeringRevision&&!['control-chat','handoff'].includes(j.kind)).reverse();
    const renderTurn=t=>{
      const firstReader=t.revision&&readers.find(j=>j.steeringRevision>=t.revision);
      const receipt=t.revision?`<small class="control-receipt">课题要求 #${t.revision} · ${firstReader?'已传入后续调用':'已记录，待后续调用读取'}</small>${firstReader?`<button class="control-job" type="button" data-action="log" data-id="${esc(firstReader.id)}">${esc(firstReader.title)} ↗</button>`:''}`:'';
      const progress=t.status==='queued'?'消息已排队':t.status==='replying'?'CC 正在回复…':'';
      const job=t.status==='replying'?this.jobs.find(j=>j.projectId===p.id&&j.controlTurnId===t.id):null;
      const preview=job?.replyPreview?`<div class="control-answer" aria-live="off"><b>CC · 正在撰写</b><p>${esc(job.replyPreview)}</p></div>`:'';
      const reply=t.reply?`<div class="control-answer"><b>CC</b><p>${esc(t.reply)}</p></div>`:preview;
      const problem=['failed','interrupted'].includes(t.status)?`<p class="red">${esc(t.error||'回复已中断。')}</p><button type="button" data-retry-turn="${esc(t.id)}">重试回复</button>`:'';
      return `<article class="control-turn"><b>你</b><p>${esc(t.message)}</p>${receipt}${reply}${progress?`<small>${progress}</small>`:''}${problem}</article>`;
    };
    const markup=turns.length?turns.map(renderTurn).join(''):'<p class="control-empty">可以问「各个 CX 现在在做什么」，也可以说「接下来先验证基线，再扩大实验」。对话和新增要求保存在本课题。</p>';
    if(markup!==this.markup){
      const follow=!this.markup||feed.scrollHeight-feed.clientHeight-feed.scrollTop<32;
      feed.innerHTML=markup;this.markup=markup;if(follow)feed.scrollTop=feed.scrollHeight;
    }
    const form=this.host.querySelector('form');
    form.querySelector('button[type=submit]').disabled=Boolean(draft.sending)||!this.ready;
    form.querySelector('.control-status').textContent=draft.error||(!this.ready?'等待本机 Claude Code 就绪。':draft.sending?'正在发送…':pending?'可以继续发送下一条。':'明确的新要求会用于之后的调度和执行。');
  }
  async send(){
    const key=this.activeKey,p=this.p,draft=this.drafts.get(key);
    if(!p||!this.ready||draft.sending)return;
    this.capture();
    const message=draft.message.trim();if(!message)return;
    const requestId=draft.requestId||crypto.randomUUID();draft.requestId=requestId;draft.sending=true;draft.error='';this.paint();
    try{
      await this.request('/api/projects/'+p.id+'/control-chat',{requestId,message,mode:draft.required?'requirement':'auto'});
      if(draft.requestId===requestId){
        Object.assign(draft,{message:'',required:false,requestId:null});
        if(this.activeKey===key){const form=this.host.querySelector('form');if(form){form.elements.message.value='';form.elements.requirement.checked=false;}}
      }
      await this.refresh();
    }catch(e){draft.error=e.message;}
    finally{draft.sending=false;this.paint();}
  }
  async retry(id){
    const p=this.p,draft=this.drafts.get(this.activeKey);
    try{draft.error='';await this.request('/api/projects/'+p.id+'/control-chat',{requestId:id,retry:true});await this.refresh();}
    catch(e){draft.error=e.message;this.paint();}
  }
}
