import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { agentHome, userHome } from './platform.mjs';
import { assert } from './store.mjs';

// Translations are presentation metadata. The runner always receives the original skill.
export function scanSkills(workspace, extraRoots = [], { localized = false } = {}) {
  let translations = {};
  if (localized) {
    try {
      const entries = JSON.parse(fs.readFileSync(path.join(workspace, '.relay-lab', 'skills.zh-CN.json'), 'utf8'));
      if (entries && typeof entries === 'object' && !Array.isArray(entries)) translations = entries;
    } catch { /* Optional workspace dictionary. */ }
  }
  const roots = [
    {path:path.join(agentHome('cc'),'skills'),source:'Claude'},
    {path:path.join(agentHome('cx'),'skills'),source:'Codex'},
    {path:path.join(userHome(),'.agents','skills'),source:'Shared'},
    ...['.claude','.codex','.agents'].map(dir=>({path:path.join(workspace,dir,'skills'),source:'Workspace'})),
    ...extraRoots.map(p=>({path:p,source:'Custom'}))
  ];
  const result=[],seen=new Set();
  const visit=(dir,source,depth=0)=>{
    if(depth>2||result.length>=300)return;
    try {
      const file=path.join(dir,'SKILL.md');
      if(fs.existsSync(file)) {
        const real=fs.realpathSync(file);if(seen.has(real))return;seen.add(real);
        const raw=fs.readFileSync(real,'utf8').slice(0,8000);
        const front=raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
        const read=key=>{
          const lines=(front?.[1]||'').split(/\r?\n/),index=lines.findIndex(line=>line.startsWith(key+':'));if(index<0)return '';
          const value=lines[index].slice(key.length+1).trim();
          if(/^[>|][-+]?$/.test(value)){const body=[];for(let i=index+1;i<lines.length;i++){if(lines[i].trim()&&!/^\s/.test(lines[i]))break;body.push(lines[i].trim());}return body.join(value.startsWith('>')?' ':'\n').trim();}
          return value.replace(/^["']|["']$/g,'');
        };
        const id=createHash('sha256').update(real).digest('hex').slice(0,24),name=read('name')||path.basename(dir);
        const skill={id,name,description:read('description'),path:real,directory:path.dirname(real),source};
        if(localized){
          const t=Object.hasOwn(translations,id)?translations[id]:Object.hasOwn(translations,name)?translations[name]:null;
          skill.displayName=(typeof t?.name==='string' && t.name.trim())||read('name_zh')||name;
          skill.displayDescription=(typeof t?.description==='string' && t.description.trim())||read('description_zh')||skill.description;
        }
        result.push(skill);return;
      }
      for(const entry of fs.readdirSync(dir,{withFileTypes:true}))if(entry.isDirectory()||entry.isSymbolicLink())visit(path.join(dir,entry.name),source,depth+1);
    }catch{}
  };
  for(const root of roots)visit(root.path,root.source);
  return result.sort((a,b)=>a.name.localeCompare(b.name));
}

export function loadSelectedSkills(project,catalog) {
  const selected=(project.skillIds||[]).map(id=>{
    const skill=catalog.find(s=>s.id===id);assert(skill,`所选技能已不存在（${id}），请重新扫描并保存选择。`,409);
    const content=fs.readFileSync(skill.path,'utf8');assert(content.length<=60000,`技能 ${skill.name} 超过 60,000 字符，请拆分后再选择。`);
    return{...skill,content,hash:createHash('sha256').update(content).digest('hex')};
  });
  assert(selected.reduce((n,s)=>n+s.content.length,0)<=180000,'所选技能的内容总量过大，请减少本课题勾选的技能。');
  return selected;
}
