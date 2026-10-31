import fs from 'node:fs';
import path from 'node:path';
import {agentHome} from './platform.mjs';

export function modelCatalog() {
  const cc=[],cx=[];let ccDefault='',cxDefault='';
  const add=(list,id,label=id,source='local')=>{if(typeof id==='string'&&id.length<=160&&!list.some(x=>x.id===id))list.push({id,label,source});};
  try {
    // Expose only model names. Never return env/auth fields from settings.
    const config=JSON.parse(fs.readFileSync(path.join(agentHome('cc'),'settings.json'),'utf8'));
    ccDefault=config.model||config.env?.ANTHROPIC_MODEL||'';
    add(cc,ccDefault,ccDefault,'configured');
    for(const key of ['ANTHROPIC_DEFAULT_OPUS_MODEL','ANTHROPIC_DEFAULT_SONNET_MODEL','ANTHROPIC_DEFAULT_HAIKU_MODEL'])if(config.env?.[key])add(cc,config.env[key]);
  }catch{}
  for(const alias of ['opus','sonnet','haiku'])add(cc,alias,alias+' · CLI 别名','alias');
  try {
    const config=fs.readFileSync(path.join(agentHome('cx'),'config.toml'),'utf8').split(/^\[/m)[0];
    cxDefault=config.match(/^model\s*=\s*["']([^"']+)["']/m)?.[1]||'';
    if(cxDefault)add(cx,cxDefault,cxDefault,'configured');
  }catch{}
  try{const cache=JSON.parse(fs.readFileSync(path.join(agentHome('cx'),'models_cache.json'),'utf8'));for(const m of cache.models||[])if(m.visibility!=='hide')add(cx,m.slug,m.display_name||m.slug,'cli-cache');}catch{}
  return {cc:cc.filter(x=>x.id),cx:cx.filter(x=>x.id),defaults:{cc:ccDefault,cx:cxDefault},note:'来自本机配置与 CLI 缓存；自定义网关的模型权限以实际调用为准。'};
}
