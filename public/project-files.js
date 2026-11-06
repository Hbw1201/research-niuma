import {escapeHtml as esc} from './markdown.js';

export class ProjectFilesView {
  constructor(){this.projectId='';this.workspace='';this.path='';this.area='project';this.data=null;this.file=null;this.error='';this.ticket=0;this.newFolder=false;this.folderName='';}
  mount(host, options){
    if(!host)return;
    this.host=host;this.options=options;
    host.onclick=e=>this.click(e);
    host.onsubmit=e=>this.create(e);
    host.oninput=e=>{if(e.target.name==='name')this.folderName=e.target.value;};
    if(this.projectId!==options.projectId||this.workspace!==options.workspace){this.projectId=options.projectId;this.workspace=options.workspace;this.path='';this.area='project';this.data=null;this.file=null;this.error='';this.newFolder=false;this.folderName='';this.load();}
    this.render();
  }
  async load(value=this.path,area=this.area,file=false){
    const ticket=++this.ticket,projectId=this.projectId;
    this.error='';this.loading=true;
    this.render();
    try{
      const url='/api/project-files?'+new URLSearchParams({project:projectId,path:value,area,...(file?{file:'1'}:{})});
      const response=await fetch(url,{cache:'no-store'}),data=await response.json();
      if(!response.ok)throw Error(data.error);
      if(ticket!==this.ticket||projectId!==this.projectId)return;
      if(file)this.file=data;
      else {this.path=data.path;this.area=area;this.data=data;this.file=null;}
    }catch(e){if(ticket===this.ticket)this.error=e.message;}
    finally{if(ticket===this.ticket){this.loading=false;this.render();}}
  }
  render(){
    if(!this.host)return;
    const data=this.data,scope=new URLSearchParams({space:this.projectId,folder:this.path,new:'chat'});
    this.host.innerHTML=`<section class="project-files" aria-label="项目共享文件">
      <div class="pf-tabs"><button type="button" data-area="project" aria-pressed="${this.area==='project'}">项目文件</button><button type="button" data-area="research" aria-pressed="${this.area==='research'}">实验记录与产物</button></div>
      <p class="pf-note">聊天与实验区直接使用同一份本地文件。文件变化后，点击刷新查看。</p>
      <div class="pf-toolbar"><button type="button" data-file-action="up" ${!data?.path||this.loading?'disabled':''}>↑ 上级</button><span>${esc(this.path||'根目录')}</span><button type="button" data-file-action="refresh" ${this.loading?'disabled':''}>${this.loading?'读取中…':'刷新'}</button>
      ${this.area==='project'?`<button type="button" data-file-action="new">新建子文件夹</button>${this.options.onDiscuss?'<button type="button" data-file-action="discuss">在此目录新对话</button>':`<a href="/#${esc(scope)}">在此目录新对话 ↗</a>`}`:''}</div>
      ${this.newFolder?`<form class="pf-create"><label>子文件夹名称 <input name="name" maxlength="100" value="${esc(this.folderName)}" required placeholder="例如：实验资料"></label><button type="submit" ${this.creating?'disabled':''}>创建</button><button type="button" data-file-action="cancel-new">取消</button></form>`:''}
      ${this.error?`<p class="pf-error" role="status">${esc(this.error)}</p>`:''}
      <div class="pf-entries">${data?.entries.map(entry=>`<button type="button" data-file-path="${esc(entry.path)}" data-file-type="${entry.type}" title="${esc(entry.name)}"><span>${entry.type==='directory'?'▸':'·'}</span><span>${esc(entry.name)}</span><small>${entry.type==='directory'?'文件夹':Math.max(1,Math.ceil(entry.bytes/1024))+' KB'}</small></button>`).join('')||`<p class="pf-note">${this.loading?'正在读取文件…':'此目录没有可显示的文件。'}</p>`}</div>
      ${data?.truncated?'<p class="pf-note">当前显示前 400 项，请进入子目录查看。</p>':''}
      ${this.file?`<div class="pf-preview"><div><strong>${esc(this.file.name)}</strong><button type="button" data-file-action="close-file">关闭预览</button></div><pre>${esc(this.file.content)}</pre></div>`:''}
      <p class="pf-path">${esc(data?.directory||'')}</p></section>`;
  }
  click(e){
    const b=e.target.closest('button');if(!b||b.disabled)return;e.stopPropagation();
    if(b.dataset.area){this.newFolder=false;this.load('',b.dataset.area);return;}
    if(b.dataset.filePath!==undefined){this.newFolder=false;this.load(b.dataset.filePath,this.area,b.dataset.fileType==='file');return;}
    const action=b.dataset.fileAction;
    if(action==='up')this.load(this.data?.parent||'');
    if(action==='refresh')this.load();
    if(action==='new'||action==='cancel-new'){this.newFolder=action==='new';this.render();if(this.newFolder)this.host.querySelector('input')?.focus();}
    if(action==='close-file'){this.file=null;this.render();}
    if(action==='discuss')this.options.onDiscuss(this.path);
  }
  async create(e){
    e.preventDefault();e.stopPropagation();
    if(this.creating)return;
    const body={workspace:this.options.workspace,projectId:this.projectId,parent:this.path,name:new FormData(e.target).get('name')};
    const ticket=++this.ticket,projectId=this.projectId;
    this.creating=true;this.error='';e.target.querySelector('button[type=submit]').disabled=true;
    try{
      const response=await fetch('/api/project-folders',{method:'POST',headers:{'Content-Type':'application/json','X-Relay-Token':this.options.token},body:JSON.stringify(body)});
      const result=await response.json();if(!response.ok)throw Error(result.error);
      if(ticket!==this.ticket||projectId!==this.projectId)return;
      this.newFolder=false;this.area='project';this.path=result.path;this.data=result;this.file=null;
    }catch(error){if(ticket===this.ticket)this.error=error.message;}
    finally{this.creating=false;this.render();}
  }
}
