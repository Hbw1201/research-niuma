import {escapeHtml as esc, markdown} from './markdown.js';

const hash=()=>new URLSearchParams(location.hash.slice(1));
if(hash().has('view')||hash().has('project')){
  // Project links from earlier versions retain their original route.
  location.replace('/experiments/'+location.search+location.hash);
}else{
  startHome();
}

function startHome(){
  const $=id=>document.getElementById(id);
  const form=$('composer'),input=$('message'),scroll=$('scroll-pane');
  const busyStates=new Set(['running','queued','cancelling']);
  let selected=hash().get('chat')||'',data=null,source=null,online=false;
  let loading=false,dirty=false,restored=false,navEpoch=0,drawer=false;
  let sending=null,stopping='',feedback='',lastList='',lastTurns='',renderedChat=null;
  const draftKey=()=>data?'home-draft:'+data.workspace+':'+selected:'';
  const lastKey=()=> 'last-home-chat:'+data.workspace;
  const getDraft=()=>{try{return JSON.parse(sessionStorage.getItem(draftKey()))||{};}catch{return {};}};
  const saveDraft=(text,id=null,key=draftKey())=>{if(key){if(text)sessionStorage.setItem(key,JSON.stringify({text,id}));else sessionStorage.removeItem(key);}};
  const lastTurn=()=>data?.chat?.id===selected?data.chat.turns.at(-1):null;
  function showHistory(open){
    drawer=open;document.querySelector('.layout').classList.toggle('history-open',open);
    $('history-toggle').setAttribute('aria-expanded',String(open));
    $('shade').hidden=!open;document.querySelector('main').inert=open;
    if(open)$('new-chat').focus();
  }
  function choose(id,{push=true}={}){
    navEpoch++;selected=id;feedback='';stopping='';lastTurns='';renderedChat=null;
    if(data){localStorage.setItem(lastKey(),id);data.chat=null;}
    if(push&&hash().get('chat')!== (id||null))history.pushState(null,'',location.pathname+(id?'#chat='+encodeURIComponent(id):''));
    if(drawer)showHistory(false);
    input.value=getDraft().text||'';
    render();refresh();
  }
  function controls(){
    const state=lastTurn()?.status,active=busyStates.has(state);
    const ready=online&&data?.cli?.ready;
    $('send').hidden=active;$('stop').hidden=!active;
    $('stop').disabled=!online||state==='cancelling'||stopping===lastTurn()?.jobId;
    $('stop').textContent=state==='cancelling'?'停止中…':'■ 停止生成';
    $('send').disabled=Boolean(sending)||!ready||!input.value.trim()||Boolean(selected&&data?.chat?.id!==selected);
    const status=$('connection');status.classList.toggle('online',Boolean(ready));
    status.textContent=!online?'连接中':!data?.cli?'检测 CLI 中':ready?'本机 CLI 就绪':'Claude Code 未就绪';
    const notice=$('notice');notice.hidden=false;
    if(feedback)notice.textContent=feedback;
    else if(!online)notice.textContent=data?'正在重新连接本机服务…':'正在连接本机工作台…';
    else if(data.cli&&!ready)notice.innerHTML='请检查本机 Claude Code。 <a href="/experiments/#view=settings">打开连接设置</a>';
    else notice.hidden=true;
  }

  function turnMarkup(t){
    const active=busyStates.has(t.status);
    const problem=['failed','interrupted','cancelled'].includes(t.status);
    const progress=t.status==='cancelling'?'正在停止…':t.reply?'正在回复…':'正在等待 Claude Code 回复…';
    return `<article class="turn"><div class="question" aria-label="你的消息">${esc(t.message)}</div>
      <div class="reply"><div class="reply-label"><span aria-hidden="true">✳</span> Claude Code</div>
      <div class="reply-body">${markdown(t.reply,{chat:true})}</div>
      ${active?`<p class="turn-state" role="status">${progress}</p>`:''}
      ${problem?`<p class="turn-state error">${esc(t.error||(t.status==='cancelled'?'已停止生成。':'回复已中断。'))} <button type="button" class="text-button" data-reuse="${esc(t.id)}">重新编辑</button></p>`:''}</div></article>`;
  }
  function render(){
    if(!data){controls();return;}
    $('workspace-name').textContent=data.workspace.split(/[\\/]/).filter(Boolean).pop()||data.workspace;
    $('workspace-name').title=data.workspace;
    const list=data.chats.map(c=>`<button type="button" data-chat="${esc(c.id)}" title="${esc(c.title)}" ${c.id===selected?'aria-current="page"':''}>${esc(c.title)}</button>`).join('')||'<p class="empty-history">发送第一条消息后，对话将保存在这里。</p>';
    if(lastList!==list){$('chat-list').innerHTML=list;lastList=list;}
    const chat=data.chat?.id===selected?data.chat:null;
    $('welcome').hidden=Boolean(selected);
    const markup=chat?chat.turns.map(turnMarkup).join(''):selected?'<p class="turn-state">正在读取对话…</p>':'';
    if(lastTurns!==markup||renderedChat!==selected){
      const follow=renderedChat!==selected||scroll.scrollHeight-scroll.scrollTop-scroll.clientHeight<72;
      $('transcript').innerHTML=markup;lastTurns=markup;renderedChat=selected;
      if(follow)scroll.scrollTop=scroll.scrollHeight;
    }
    controls();
  }

  async function refresh(){
    if(loading){dirty=true;return;}
    loading=true;
    try{
      do{
        dirty=false;
        const epoch=navEpoch;
        const res=await fetch('/api/home-chat'+(selected?'?chat='+encodeURIComponent(selected):''),{cache:'no-store'});
        if(!res.ok)throw Error('本机服务暂时无法读取对话。');
        const next=await res.json();
        if(epoch!==navEpoch){dirty=true;continue;}
        const switched=data&&data.workspace!==next.workspace;
        data=next;online=true;
        if(switched){restored=false;selected='';history.replaceState(null,'',location.pathname);}
        if(!restored){
          restored=true;
          const remembered=selected||localStorage.getItem(lastKey())||'';
          if(remembered!==selected&&data.chats.some(c=>c.id===remembered)){
            selected=remembered;history.replaceState(null,'','#chat='+encodeURIComponent(selected));dirty=true;
          }
          input.value=getDraft().text||'';
        }
        if(selected&&!data.chats.some(c=>c.id===selected)){
          selected='';history.replaceState(null,'',location.pathname);localStorage.removeItem(lastKey());input.value=getDraft().text||'';
          feedback='该对话不在当前工作区，可以开始新对话。';
        }
        render();
      }while(dirty);
    }catch(e){online=false;controls();}
    finally{loading=false;}
  }
  async function post(url,body){
    const res=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json','X-Relay-Token':data.token},body:JSON.stringify(body)});
    const result=await res.json();if(!res.ok)throw Error(result.error||'请求未完成。');return result;
  }
  form.addEventListener('submit',async event=>{
    event.preventDefault();if($('send').disabled||$('send').hidden)return;
    const message=input.value.trim(),epoch=navEpoch,key=draftKey(),ws=data.workspace;
    const requestId=getDraft().id||crypto.randomUUID();saveDraft(input.value,requestId);
    sending=requestId;feedback='';controls();
    try{
      const result=await post('/api/home-chat/send',{chatId:selected,requestId,message,workspace:ws});
      let saved;try{saved=JSON.parse(sessionStorage.getItem(key));}catch{}
      if(saved?.id===requestId)sessionStorage.removeItem(key);
      if(epoch===navEpoch&&ws===data.workspace){
        const unsent=saved?.id!==requestId?input.value:'';
        if(selected!==result.chatId){choose(result.chatId);if(unsent){saveDraft(unsent);input.value=unsent;}}
        else input.value=unsent;
        input.focus({preventScroll:true});
      }
    }catch(e){if(epoch===navEpoch)feedback=e.message;}
    finally{sending=null;controls();refresh();}
  });
  $('stop').addEventListener('click',async()=>{
    const turn=lastTurn();if(!turn||!busyStates.has(turn.status)||stopping)return;
    stopping=turn.jobId;controls();
    try{await post('/api/jobs/'+encodeURIComponent(turn.jobId)+'/stop',{});}
    catch(e){feedback=e.message;}
    finally{stopping='';refresh();controls();}
  });
  input.addEventListener('input',()=>{saveDraft(input.value);feedback='';controls();});
  input.addEventListener('keydown',e=>{if(!e.isComposing&&e.key==='Enter'&&(e.ctrlKey||e.metaKey)){e.preventDefault();form.requestSubmit();}});
  document.addEventListener('click',e=>{
    const button=e.target.closest('button');if(!button)return;
    if(button.dataset.chat)choose(button.dataset.chat);
    if(button.id==='new-chat'){choose('');input.focus();}
    if(button.id==='history-toggle')showHistory(!drawer);
    if(button.id==='shade'){showHistory(false);$('history-toggle').focus();}
    const reuse=data?.chat?.turns.find(t=>t.id===button.dataset.reuse);
    if(button.dataset.prompt||reuse){input.value=reuse?.message||button.dataset.prompt;input.dispatchEvent(new Event('input'));input.focus();}
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&drawer){showHistory(false);$('history-toggle').focus();}});
  matchMedia('(max-width:720px)').addEventListener('change',()=>showHistory(false));
  window.addEventListener('popstate',()=>choose(hash().get('chat')||'',{push:false}));
  const connect=()=>{
    source=new EventSource('/api/events');source.addEventListener('change',refresh);
    source.onopen=refresh;source.onerror=()=>{online=false;controls();};
  };
  window.addEventListener('pagehide',()=>source?.close());
  window.addEventListener('pageshow',e=>{if(e.persisted){refresh();connect();}});
  refresh();connect();
}
