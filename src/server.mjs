import { HomeChat } from './home-chat.mjs';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { Store, assert } from './store.mjs';
import { discover } from './platform.mjs';
import { Runner } from './runner.mjs';
import { Workflow } from './workflow.mjs';
import { scanSkills } from './skills.mjs';
import { modelCatalog } from './models.mjs';

const publicDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../public');
const assets = { '/':'index.html', '/index.html':'index.html', '/app.js':'app.js', '/workflow-ui.js':'workflow-ui.js', '/team-ui.js':'team-ui.js', '/leader-ui.js':'leader-ui.js', '/pipeline-ui.js':'pipeline-ui.js', '/research-stages.js':'research-stages.js', '/pipeline.css':'pipeline.css', '/styles.css':'styles.css', '/favicon.svg':'favicon.svg' };
const mime = { '.html':'text/html; charset=utf-8', '.js':'text/javascript; charset=utf-8', '.css':'text/css; charset=utf-8', '.svg':'image/svg+xml' };
Object.assign(assets,{'/':'home.html','/index.html':'home.html','/experiments/':'index.html','/experiments':'index.html','/home.js':'home.js','/home.css':'home.css','/markdown.js':'markdown.js'});
assets['/control-chat.js'] = 'control-chat.js';
assets['/workspace-ui.js'] = 'workspace-ui.js';
assets['/workbench.css'] = 'workbench.css';

export async function startServer({ workspace = process.cwd(), port = 4318, scanner = discover } = {}) {
  let store = new Store(workspace), runner = new Runner(store);
  const token = randomBytes(32).toString('hex');
  let scan = null, scanning = null, origin = '', closing = false;
  let workflow = new Workflow(store, runner, () => scan);
  let home=new HomeChat(store,runner,()=>scan);
  const clients = new Set();
  const snapshot = () => ({ ...store.state, workspace: store.workspace, rules:store.rules(), models:modelCatalog(), scan, token, version: '0.5.0' });
  let broadcastTimer;
  const broadcast = () => { if(broadcastTimer)return; broadcastTimer = setTimeout(()=>{ broadcastTimer=null;for (const res of clients) res.write('event: change\ndata: {}\n\n'); },100); };
  runner.on('change',broadcast);
  const refresh = async () => {
    if (scanning) return scanning;
    scanning = scanner(store.state.settings).then(result=>{scan=result;broadcast();return scan;}).finally(()=>{scanning=null;});
    return scanning;
  };
  const json = (res,status,value) => { res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});res.end(JSON.stringify(value)); };
  const readBody = async req => { let raw=''; for await(const chunk of req){raw+=chunk;assert(raw.length<=256*1024,'请求过大。',413);}try{return JSON.parse(raw||'{}');}catch{throw Object.assign(new Error('JSON 格式错误。'),{status:400});} };
  const server = http.createServer(async(req,res)=>{
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'");
    try {
      assert(req.headers.host === new URL(origin).host, '不接受此 Host。',403);
      const url = new URL(req.url,origin), route=url.pathname;
      if(req.method==='GET') {
        if(route==='/api/home-chat') return json(res,200,{...home.snapshot(url.searchParams.get('chat')),token});
        if(route==='/api/state') return json(res,200,snapshot());
        if(route==='/api/health') return json(res,200,{ok:true,version:'0.5.0'});
        if(route==='/api/rules')return json(res,200,store.rules(url.searchParams.get('project')||undefined));
        if(route==='/api/skills'){const p=url.searchParams.get('project')?store.project(url.searchParams.get('project')):null;return json(res,200,{skills:scanSkills(store.workspace,[...(store.state.settings.skillRoots||[]),...(p?['.claude','.codex','.agents'].map(dir=>path.join(p.directory,dir,'skills')):[])],{localized:true})});}
        if(route==='/api/folders') {
          const dir=path.resolve(url.searchParams.get('path')||store.workspace);
          const directories=fs.readdirSync(dir,{withFileTypes:true}).filter(d=>d.isDirectory()&&!d.name.startsWith('.')).map(d=>({name:d.name,path:path.join(dir,d.name)})).sort((a,b)=>a.name.localeCompare(b.name));
          return json(res,200,{path:dir,parent:path.dirname(dir),directories});
        }
        if(route==='/api/events') {
          res.writeHead(200,{'Content-Type':'text/event-stream','Cache-Control':'no-cache','Connection':'keep-alive'});res.write(': connected\n\n');clients.add(res);req.on('close',()=>clients.delete(res));return;
        }
        const docMatch=route.match(/^\/api\/projects\/([a-f0-9-]+)\/documents\/([a-f0-9-]+)$/);
        if(docMatch) {
          const doc=store.readDoc(docMatch[1],docMatch[2]);
          if(url.searchParams.has('download')) {res.writeHead(200,{'Content-Type':'text/markdown; charset=utf-8','Content-Disposition':`attachment; filename="${doc.name}"`});return res.end(doc.content);}
          return json(res,200,doc);
        }
        if(assets[route]) {const file=path.join(publicDir,assets[route]);res.writeHead(200,{'Content-Type':mime[path.extname(file)],'Cache-Control':'no-cache'});fs.createReadStream(file).pipe(res);return;}
        return json(res,404,{error:'找不到此页面。'});
      }
      assert(req.method==='POST','不支持的请求方式。',405);
      assert(!req.headers.origin||req.headers.origin===origin,'仅允许本机工作台发起操作。',403);
      assert(req.headers['x-relay-token']===token,'连接已过期，请刷新页面。',403);
      assert(String(req.headers['content-type']||'').startsWith('application/json'),'需要 JSON 请求。',415);
      const body=await readBody(req);
      if(route==='/api/home-chat/send')return json(res,202,home.send(body));
      if(route==='/api/workspace') {
        assert(!home.pending.size&&!runner.children.size&&!workflow.busy.size&&!workflow.pumps.size&&!workflow.steering.active.size&&!workflow.collaboration.active.size,'请先停止当前工作区的所有任务。',409);
        assert(typeof body.path==='string'&&path.isAbsolute(body.path)&&body.path.length<4096,'请提供工作区的绝对路径。');
        const target=path.resolve(body.path);
        if(target===store.workspace)return json(res,200,{ok:true,workspace:target});
        if(body.create)fs.mkdirSync(target,{recursive:true});
        assert(fs.existsSync(target)&&fs.statSync(target).isDirectory(),'目录不存在；勾选“创建目录”或选择已有目录。');
        const next=new Store(target);
        await runner.close(); store.close();try{fs.unlinkSync(connection);}catch{}
        store=next;runner=new Runner(store);home=new HomeChat(store,runner,()=>scan);workflow=new Workflow(store,runner,()=>scan);runner.on('change',broadcast);
        connection=path.join(store.root,'connection.json');fs.writeFileSync(connection,JSON.stringify({url:origin,pid:process.pid}),{mode:0o600});
        scan=null;await refresh();broadcast();return json(res,200,{ok:true,workspace:target});
      }
      if(route==='/api/rules') {
        assert(!runner.children.size&&!workflow.busy.size&&!workflow.pumps.size&&!workflow.collaboration.active.size,'运行任务期间不能修改规则。',409);
        store.setRules(body.content,body.projectId||undefined);broadcast();return json(res,200,{ok:true});
      }
      if(route==='/api/scan')return json(res,200,await refresh());
      if(route==='/api/settings') {
        assert(!runner.children.size&&!workflow.collaboration.active.size,'运行任务期间不能修改 CLI 设置。',409);
        assert(Number.isInteger(body.concurrency)&&body.concurrency>=1&&body.concurrency<=16,'并发数必须为 1–16。');
        for(const key of ['ccPath','cxPath'])assert(typeof body[key]==='string'&&body[key].length<4096,'程序路径无效。');
        store.state.settings={ccPath:body.ccPath.trim(),cxPath:body.cxPath.trim(),concurrency:body.concurrency};store.save();await refresh();broadcast();return json(res,200,{ok:true});
      }
      if(route==='/api/projects') {const p=store.newProject(body);broadcast();return json(res,201,p);}
      const action=route.match(/^\/api\/projects\/([a-f0-9-]+)\/(brainstorm|review|plan|execute|stop|summarize|bind-cc|handoff|chat|activate|architecture|skills|models|team-chat|accept-team|collaborate|message|decide|stage-review|autonomy|control-chat)$/);
      if(action) {
        const [,id,verb]=action;store.project(id);
        if(verb==='control-chat'){const turn=workflow.steering.submit(id,body);return json(res,202,{id:turn.id,status:turn.status});}
        if(verb==='brainstorm')workflow.brainstorm(id,Boolean(body.revise));
        if(verb==='review')workflow.review(id,body);
        if(verb==='plan')workflow.plan(id);
        if(verb==='execute'||verb==='collaborate')workflow.collaborate(id,body);
        if(verb==='message')workflow.collaboration.send(id,body.message);
        if(verb==='decide')workflow.collaboration.decide(id,body);
        if(verb==='stage-review')workflow.stageReview(id,body);
        if(verb==='stop')workflow.stopProject(id);
        if(verb==='summarize')workflow.summarize(id);
        if(verb==='bind-cc')workflow.bindCC(id,body.sessionId);
        if(verb==='handoff')await workflow.handoff(id,body.sessionId,body.documentId);
        if(verb==='chat')workflow.chat(id,body.message);
        if(verb==='activate')workflow.activate(id);
        if(verb==='architecture')workflow.configure(id,body);
        if(verb==='autonomy')workflow.configureAutonomy(id,body);
        if(verb==='models')workflow.configureModels(id,body);
        if(verb==='team-chat')workflow.teamChat(id,body.message);
        if(verb==='accept-team')workflow.acceptTeam(id,body.proposalId);
        if(verb==='skills')workflow.selectSkills(id,body.ids);
        broadcast();return json(res,200,{ok:true,project:store.project(id)});
      }
      const stop=route.match(/^\/api\/jobs\/([a-f0-9-]+)\/stop$/);
      if(stop){runner.cancel(stop[1]);broadcast();return json(res,200,{ok:true});}
      return json(res,404,{error:'接口不存在。'});
    } catch(e){if(!res.headersSent)json(res,e.status||500,{error:e.message});else res.end();}
  });
  try { await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);}); } catch(e){store.close();throw e;}
  origin=`http://127.0.0.1:${server.address().port}`;
  let connection=path.join(store.root,'connection.json');
  fs.writeFileSync(connection,JSON.stringify({url:origin,pid:process.pid}),{mode:0o600});
  const heartbeat=setInterval(()=>{for(const res of clients)res.write(': heartbeat\n\n');},20000);heartbeat.unref();
  refresh().catch(e=>{scan={clis:{},sessions:[],processes:[],warnings:[e.message]};broadcast();});
  return {url:origin,get store(){return store;},get runner(){return runner;},get workflow(){return workflow;},refresh,snapshot,async close(){if(closing)return;closing=true;clearInterval(heartbeat);clearTimeout(broadcastTimer);for(const p of store.state.projects)workflow.steering.stop(p.id);await runner.close();await Promise.allSettled([...home.pending.values(),...workflow.steering.active.values(),...[...workflow.collaboration.active.values()].map(t=>t.promise)]);for(const res of clients)res.end();server.closeAllConnections();await new Promise(resolve=>server.close(resolve));store.close();try{fs.unlinkSync(connection);}catch{}}};
}
