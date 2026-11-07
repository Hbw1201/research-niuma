import {escapeHtml as esc, markdown} from './markdown.js';
import {ProjectFilesView} from './project-files.js';

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
  let selectedProject=hash().get('space')||'',selectedFolder=hash().get('folder')||'',createPage=hash().get('new')==='project',showFiles=false;
  let picker=null,folderTicket=0,projectSubmitting=false;
  const files=new ProjectFilesView();
  const expandedProjects=new Set(selectedProject?[selectedProject]:[]);
  let loading=false,dirty=false,restored=false,navEpoch=0,drawer=false;
  const narrow=matchMedia('(max-width:720px)');
  let sidebarCollapsed=localStorage.getItem('home-nav-collapsed')==='true';
  let sending=null,stopping='',feedback='',lastList='',lastTurns='',renderedChat=null;
  const draftKey=()=>data?'home-draft:'+data.workspace+':'+(selected||'new:'+selectedProject+':'+selectedFolder):'';
  const lastKey=()=> 'last-home-chat:'+data.workspace;
  const getDraft=()=>{try{return JSON.parse(sessionStorage.getItem(draftKey()))||{};}catch{return {};}};
  const saveDraft=(text,id=null,key=draftKey())=>{if(key){if(text)sessionStorage.setItem(key,JSON.stringify({text,id}));else sessionStorage.removeItem(key);}};
  const lastTurn=()=>data?.chat?.id===selected?data.chat.turns.at(-1):null;
  function showHistory(open){
    const mobile=narrow.matches;
    drawer=mobile&&open;
    if(!mobile){sidebarCollapsed=!open;localStorage.setItem('home-nav-collapsed',String(sidebarCollapsed));}
    document.querySelector('.layout').classList.toggle('history-open',drawer);
    document.querySelector('.layout').classList.toggle('sidebar-collapsed',!mobile&&sidebarCollapsed);
    $('history-toggle').setAttribute('aria-expanded',String(mobile?drawer:!sidebarCollapsed));
    $('history-toggle').setAttribute('aria-label',open?'收起导航':'展开导航');
    $('shade').hidden=!drawer;document.querySelector('main').inert=drawer;
    if(drawer)$('new-chat').focus();
  }
  function route(){
    const params=new URLSearchParams();
    if(createPage)params.set('new','project');
    else{
      if(selectedProject)params.set('space',selectedProject);
      if(selectedFolder)params.set('folder',selectedFolder);
      if(selected)params.set('chat',selected);else params.set('new','chat');
    }
    return location.pathname+'#'+params;
  }
  function choose(id,{push=true,projectId,folder,newProject=false}={}){
    const chat=data?.chats.find(c=>c.id===id);
    selectedProject=projectId??chat?.projectId??'';
    if(selectedProject)expandedProjects.add(selectedProject);
    selectedFolder=folder??chat?.folder??'';
    createPage=newProject;showFiles=false;restored=true;
    navEpoch++;selected=id;feedback='';stopping='';lastTurns='';renderedChat=null;
    if(data){localStorage.setItem(lastKey(),id);data.chat=null;}
    if(push)history.pushState(null,'',route());
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
    $('send').disabled=createPage||Boolean(sending)||!ready||!input.value.trim()||Boolean(selected&&data?.chat?.id!==selected);
    const status=$('connection');status.classList.toggle('online',Boolean(ready));
    status.textContent=!online?'连接中':!data?.cli?'检测 CLI 中':ready?'已连接':'Claude Code 未就绪';
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
    const item=c=>`<button type="button" data-chat="${esc(c.id)}" title="${esc(c.title)}" ${c.id===selected?'aria-current="page"':''}>${esc(c.title)}</button>`;
    const list=data.chats.filter(c=>!c.projectId).map(item).join('')||'<p class="empty-history">不属于任何项目的对话。</p>';
    const projects=data.projects.map(p=>`<section class="home-project"><button class="project-name" type="button" data-project="${esc(p.id)}" aria-expanded="${expandedProjects.has(p.id)}" title="${esc(p.directory)}"><span>${expandedProjects.has(p.id)?'▾':'▸'}</span><span>${esc(p.title)}</span></button>${expandedProjects.has(p.id)?`<div class="project-chats"><button class="project-new-chat" type="button" data-project-chat="${esc(p.id)}">＋ 项目新对话</button>${data.chats.filter(c=>c.projectId===p.id).map(item).join('')||'<p class="empty-history">在这里开始项目讨论。</p>'}</div>`:''}</section>`).join('')||'<p class="empty-history">添加本地文件夹，开始一个项目。</p>';
    if(lastList!==list+projects){$('chat-list').innerHTML=list;$('project-list').innerHTML=projects;lastList=list+projects;}
    const chat=data.chat?.id===selected?data.chat:null;
    const project=data.projects.find(p=>p.id===selectedProject);
    $('context-title').textContent=createPage?'新建项目':project?.title||'独立对话';
    $('context-path').textContent=project?(selectedFolder||'项目根目录'):'Claude Code';
    $('context-path').title=project?.directory||data.workspace;
    $('lab-link').href=project?'/experiments/#view=collaboration&project='+encodeURIComponent(project.id):'/experiments/';
    $('project-create').hidden=!createPage;
    document.querySelector('.compose-wrap').hidden=createPage;
    $('show-files').hidden=!project||createPage;
    $('show-files').textContent=showFiles?'收起文件':'共享文件';
    $('welcome').hidden=Boolean(selected)||createPage||showFiles;
    $('welcome-title').textContent=project?'今天推进哪一步？':'从一个想法开始';
    $('welcome-copy').textContent=project?'和 CC 讨论这个项目，也可以进入实验区推进研究。':'和 CC 讨论想法，或打开项目继续研究。';
    $('scope-label').textContent=project?'目录：'+(selectedFolder||'项目根目录'):'独立对话 · 当前工作区';
    $('choose-chat-folder').hidden=!project||Boolean(selected);
    $('project-files-panel').hidden=!project||!showFiles||createPage;
    if(project&&showFiles)files.mount($('home-project-files'),{projectId:project.id,workspace:data.workspace,token:data.token,onDiscuss:folder=>{choose('',{projectId:project.id,folder});input.focus();}});
    $('transcript').hidden=createPage;
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
        const res=await fetch('/api/home-chat?'+new URLSearchParams({chat:selected,project:selectedProject}),{cache:'no-store'});
        if(!res.ok)throw Error('本机服务暂时无法读取对话。');
        const next=await res.json();
        if(epoch!==navEpoch){dirty=true;continue;}
        const switched=data&&data.workspace!==next.workspace;
        data=next;online=true;
        if(switched){restored=false;selected='';selectedProject='';selectedFolder='';createPage=false;showFiles=false;history.replaceState(null,'',location.pathname);}
        if(!restored){
          restored=true;
          const remembered=selected||(!location.hash?localStorage.getItem(lastKey()):'')||'';
          if(remembered!==selected&&data.chats.some(c=>c.id===remembered)){
            selected=remembered;history.replaceState(null,'','#chat='+encodeURIComponent(selected));dirty=true;
          }
          input.value=getDraft().text||'';
        }
        if(data.chat&&data.chat.id===selected){const previous=selectedProject;selectedProject=data.chat.projectId||'';selectedFolder=data.chat.folder||'';if(selectedProject&&selectedProject!==previous)expandedProjects.add(selectedProject);}
        if(selectedProject&&!data.projects.some(p=>p.id===selectedProject)){selectedProject='';selectedFolder='';showFiles=false;feedback='该项目不在当前工作区。';}
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
  async function browse(folder){
    const ticket=++folderTicket;
    $('project-error').hidden=true;
    try{
      const response=await fetch('/api/folders?path='+encodeURIComponent(folder));
      const value=await response.json();if(!response.ok)throw Error(value.error||'无法读取文件夹。');
      if(ticket!==folderTicket||!createPage)return;
      picker=value;$('folder-picker').hidden=false;
      $('folder-picker').innerHTML=`<div class="picker-toolbar"><button type="button" data-folder="${esc(value.parent)}">↑ 上级</button><span>${esc(value.path)}</span></div><div class="picker-entries">${value.directories.map(d=>`<button type="button" data-folder="${esc(d.path)}">▸ ${esc(d.name)}</button>`).join('')||'<p>没有子文件夹。</p>'}</div><button type="button" id="use-folder">使用此文件夹</button>`;
    }catch(e){if(ticket===folderTicket){$('project-error').textContent=e.message;$('project-error').hidden=false;}}
  }
  $('project-form').addEventListener('submit',async event=>{
    event.preventDefault();if(projectSubmitting||!online||!data)return;
    const epoch=navEpoch,workspace=data.workspace;
    projectSubmitting=true;$('create-project').disabled=true;$('project-error').hidden=true;
    try{
      const result=await post('/api/home-projects',{workspace,title:$('project-title').value,directory:$('project-directory').value});
      await refresh();
      if(epoch===navEpoch&&workspace===data.workspace){
        choose('',{projectId:result.project.id});feedback=result.existing?'已打开使用该文件夹的现有项目。':'项目已创建，可以开始对话或进入实验区。';
        $('project-form').reset();$('folder-picker').hidden=true;picker=null;input.focus();controls();
      }
    }catch(e){if(epoch===navEpoch){$('project-error').textContent=e.message;$('project-error').hidden=false;}}
    finally{projectSubmitting=false;$('create-project').disabled=false;}
  });
  form.addEventListener('submit',async event=>{
    event.preventDefault();if($('send').disabled||$('send').hidden)return;
    const message=input.value.trim(),epoch=navEpoch,key=draftKey(),ws=data.workspace;
    const requestId=getDraft().id||crypto.randomUUID();saveDraft(input.value,requestId);
    sending=requestId;feedback='';controls();
    try{
      const result=await post('/api/home-chat/send',{chatId:selected,requestId,message,workspace:ws,projectId:selectedProject,folder:selectedFolder});
      let saved;try{saved=JSON.parse(sessionStorage.getItem(key));}catch{}
      if(saved?.id===requestId)sessionStorage.removeItem(key);
      if(epoch===navEpoch&&ws===data.workspace){
        const unsent=saved?.id!==requestId?input.value:'';
        if(selected!==result.chatId){choose(result.chatId,{projectId:selectedProject,folder:selectedFolder});if(unsent){saveDraft(unsent);input.value=unsent;}}
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
    if(button.dataset.project){const id=button.dataset.project;if(selectedProject===id){if(expandedProjects.has(id))expandedProjects.delete(id);else expandedProjects.add(id);render();}else{choose('',{projectId:id});input.focus();}}
    if(button.dataset.projectChat){choose('',{projectId:button.dataset.projectChat});input.focus();}
    if(button.id==='new-project'){choose('',{newProject:true});$('project-title').focus();}
    if(button.id==='show-files'||button.id==='choose-chat-folder'){showFiles=button.id==='choose-chat-folder'||!showFiles;render();}
    if(button.id==='browse-project')browse($('project-directory').value||data.workspace);
    if(button.dataset.folder!==undefined)browse(button.dataset.folder);
    if(button.id==='use-folder'&&picker){$('project-directory').value=picker.path;$('folder-picker').hidden=true;}
    if(button.id==='history-toggle')showHistory(narrow.matches?!drawer:sidebarCollapsed);
    if(button.id==='shade'){showHistory(false);$('history-toggle').focus();}
    const reuse=data?.chat?.turns.find(t=>t.id===button.dataset.reuse);
    if(button.dataset.prompt||reuse){input.value=reuse?.message||button.dataset.prompt;input.dispatchEvent(new Event('input'));input.focus();}
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&drawer){showHistory(false);$('history-toggle').focus();}});
  narrow.addEventListener('change',()=>showHistory(narrow.matches?false:!sidebarCollapsed));
  window.addEventListener('popstate',()=>choose(hash().get('chat')||'',{push:false,projectId:hash().get('space')||'',folder:hash().get('folder')||'',newProject:hash().get('new')==='project'}));
  const connect=()=>{
    source=new EventSource('/api/events');source.addEventListener('change',refresh);
    source.onopen=refresh;source.onerror=()=>{online=false;controls();};
  };
  window.addEventListener('pagehide',()=>source?.close());
  window.addEventListener('pageshow',e=>{if(e.persisted){refresh();connect();}});
  showHistory(narrow.matches?false:!sidebarCollapsed);refresh();connect();
}
