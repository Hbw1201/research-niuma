#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { startServer } from '../src/server.mjs';
import { discover } from '../src/platform.mjs';

const argv=process.argv.slice(2), command=argv[0]||'help';
const option=(name,fallback)=>{const i=argv.indexOf('--'+name);return i<0?fallback:argv[i+1];};
const workspace=path.resolve(option('workspace',process.cwd()));
const json=value=>console.log(JSON.stringify(value,null,2));
const help=`Relay Lab · CC × CX 科研工作台 v0.5.0

用法：relay-lab <命令> [参数]
也可：node bin/relay-lab.mjs <命令>

  start [--port 4318] [--open]    启动本机网页工作台
  scan [--json]                  识别本机 CLI、进程与会话记录
  status                         查看当前工作台状态
  new --title "标题" --directory "本地目录"  新建课题，随后在网页与 CC 讨论
  brainstorm --project ID        让 CC 组织四视角讨论
  review --project ID --question q1 --decision approved --answer "选择" [--comment "批注"]
  plan --project ID              CC 根据逐项批阅生成任务
  leader --project ID [--mode auto|assisted] [--max-workers 8] [--parallel 4] [--reviews 100]
                                 设置 CC Leader；可加 --brief "长期要求"
  run --project ID [--task ID] [--max-reviews 100]
                                 启动 CC 自主组队与持续研究
  message --project ID --text "要求"  与总控 CC 对话，加 --requirement 可直接更新课题要求
  stop --project ID              停止工作台管理的课题任务
  summarize --project ID         CC 汇总 CX 报告
  docs --project ID              列出 Markdown 文档

所有命令可加 --workspace "/path/to/workspace"。
操作命令需要该工作区的工作台正在运行。scan 不会启动 AI 任务。
已存在终端进程只作识别，不会被自动接管或结束。
`;
async function api(route,body) {
  const connection=JSON.parse(fs.readFileSync(path.join(workspace,'.relay-lab','connection.json'),'utf8'));
  const current=await fetch(connection.url+'/api/state').then(r=>r.json());
  if(!route)return current;
  const res=await fetch(connection.url+route,{method:'POST',headers:{'Content-Type':'application/json','X-Relay-Token':current.token},body:JSON.stringify(body||{})});
  const result=await res.json();if(!res.ok)throw new Error(result.error);return result;
}
try {
  if(command==='help'||argv.includes('--help')||command==='--help')console.log(help);
  else if(command==='start') {
    const port=Number(option('port',4318));if(!Number.isInteger(port)||port<0||port>65535)throw new Error('端口无效。');
    const app=await startServer({workspace,port});console.log(`\nRelay Lab 已启动\n${app.url}\n工作区：${workspace}\nCtrl+C 停止工作台和它管理的 AI 任务。\n`);
    if(argv.includes('--open')) {
      const opener=process.platform==='win32'?['rundll32',['url.dll,FileProtocolHandler',app.url]]:process.platform==='darwin'?['open',[app.url]]:['xdg-open',[app.url]];
      const child=spawn(opener[0],opener[1],{stdio:'ignore',windowsHide:true,detached:true});child.on('error',()=>{});child.unref();
    }
    let exiting=false;const shutdown=async()=>{if(exiting)return;exiting=true;await app.close();process.exit(0);};process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
  } else if(command==='scan') {
    let settings={};try{settings=JSON.parse(fs.readFileSync(path.join(workspace,'.relay-lab','state.json'),'utf8')).settings;}catch{}
    const result=await discover(settings);
    if(argv.includes('--json'))json(result);else {
      for(const [key,cli]of Object.entries(result.clis))console.log(`${key.toUpperCase()} · ${cli.available?cli.version:'未找到'}\n  ${cli.path||cli.error}`);
      console.log(`\n发现 ${result.processes.length} 个相关进程、${result.sessions.length} 条会话记录。`);
      console.table(result.sessions.map(s=>({角色:s.provider.toUpperCase(),ID:s.id,标题:s.title,状态:'历史记录（在线状态未确认）'})));
      for(const warning of result.warnings)console.log(warning);
    }
  } else if(command==='status') {
    const s=await api();json({workspace:s.workspace,projects:s.projects.map(p=>({id:p.id,title:p.title,status:p.status})),jobs:s.jobs.filter(j=>j.status==='running').map(j=>({id:j.id,title:j.title,status:j.status}))});
  } else if(command==='new')json(await api('/api/projects',{title:option('title',''),brief:option('brief',''),directory:option('directory')}));
  else if(command==='docs'){const s=await api();const p=s.projects.find(p=>p.id===option('project'));if(!p)throw new Error('课题不存在。');json(p.documents.map(d=>({...d,path:path.join(p.dataDirectory||path.join(workspace,'.relay-lab','projects',p.id),d.name)})));}
  else if(command==='leader'){
    const id=option('project',''),state=await api(),p=state.projects.find(p=>p.id===id);if(!p)throw new Error('请指定有效 --project ID。');
    const policy=p.autonomy||{mode:'auto',maxWorkers:8,maxParallel:4,maxReviews:100,brief:''};
    json(await api(`/api/projects/${id}/autonomy`,{mode:option('mode',policy.mode),maxWorkers:Number(option('max-workers',policy.maxWorkers)),maxParallel:Number(option('parallel',policy.maxParallel)),maxReviews:Number(option('reviews',policy.maxReviews)),brief:option('brief',policy.brief)}));
  }
  else if(['brainstorm','review','plan','run','stop','summarize','message'].includes(command)) {
    const id=option('project','');if(!/^[a-f0-9-]+$/.test(id))throw new Error('请指定有效 --project ID。');
    const body=command==='review'?{questionId:option('question',''),decision:option('decision',''),answer:option('answer',''),comment:option('comment','')}:command==='run'?{taskId:option('task'),...(argv.includes('--max-reviews')?{maxReviews:Number(option('max-reviews'))}:{})}:command==='message'?{message:option('text',''),mode:argv.includes('--requirement')?'requirement':'auto'}:{};
    json(await api(`/api/projects/${id}/${command==='run'?'execute':command==='message'?'control-chat':command}`,body));
  } else throw new Error(`未知命令 ${command}。使用 --help 查看帮助。`);
}catch(e){console.error('Relay Lab：'+e.message);process.exitCode=1;}
