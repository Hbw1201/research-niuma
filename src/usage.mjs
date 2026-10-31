import fs from 'node:fs';
import path from 'node:path';

const number = x => Number.isFinite(Number(x)) && Number(x) > 0 ? Number(x) : 0;
const zero = () => ({ input:0, output:0, cacheRead:0, cacheWrite:0, total:0 });
const fields = ['input','output','cacheRead','cacheWrite','total'];
const plus = (a,b) => { for(const k of fields)a[k]+=b[k]||0;return a; };
function normalize(provider,u,camel=false) {
  const cacheRead=number(u[camel?'cacheReadInputTokens':provider==='cc'?'cache_read_input_tokens':'cached_input_tokens']);
  const cacheWrite=provider==='cc'?number(u[camel?'cacheCreationInputTokens':'cache_creation_input_tokens']):0;
  const input=number(u[camel?'inputTokens':'input_tokens'])+(provider==='cc'?cacheRead+cacheWrite:0);
  const output=number(u[camel?'outputTokens':'output_tokens']);
  return {input,output,cacheRead,cacheWrite,total:input+output};
}

// Claude modelUsage includes subagents and restored session totals. Subtract the
// last known session snapshot; never add cumulative results from resumed calls.
export function usageTracker(provider,{baseline=null,continued=false}={}) {
  let usage=null,sessionModelUsage=null;
  const seen=new Set(),models=new Set();
  return {
    observe(event) {
      if(provider==='cc') {
        if(event.type==='system'&&event.model)models.add(event.model);
        if(event.type==='assistant'&&event.message?.model)models.add(event.message.model);
        if(event.type==='assistant'&&event.message?.usage&&!seen.has(event.message.id)) {
          seen.add(event.message.id);usage ||= {...zero(),reported:true,complete:false,scope:'partial'};
          const partial=normalize('cc',event.message.usage);partial.output=0;partial.total=partial.input;
          plus(usage,partial); // assistant output_tokens may be a placeholder.
          // Carry forward already-counted input after interruption. A later
          // resumed result may restore these tokens even without a prior result.
          if(event.message.model&&(!continued||baseline)) {
            sessionModelUsage ||= structuredClone(baseline||{});
            const raw=event.message.usage,model=event.message.model;
            const row=sessionModelUsage[model] ||= {};
            row.inputTokens=number(row.inputTokens)+number(raw.input_tokens);
            row.cacheReadInputTokens=number(row.cacheReadInputTokens)+number(raw.cache_read_input_tokens);
            row.cacheCreationInputTokens=number(row.cacheCreationInputTokens)+number(raw.cache_creation_input_tokens);
          }
        }
        if(event.type==='result') {
          if(event.modelUsage)sessionModelUsage=event.modelUsage;
          if(event.modelUsage&&Object.keys(sessionModelUsage).length&&(!continued||baseline)) {
            usage={...zero(),reported:true,complete:true,scope:'tree',byModel:{}};
            for(const [model,raw] of Object.entries(sessionModelUsage)) {
              models.add(model);
              const current=normalize('cc',raw,true),previous=normalize('cc',baseline?.[model]||{},true);
              const reset=current.input<previous.input||current.output<previous.output;
              const delta=Object.fromEntries(fields.map(k=>[k,Math.max(0,current[k]-(reset?0:previous[k]))]));
              delta.total=delta.input+delta.output;usage.byModel[model]=delta;plus(usage,delta);
            }
          } else if(event.usage) {
            usage={...normalize('cc',event.usage),reported:true,complete:false,scope:'main-only'};
          }
        }
      } else if(event.type==='turn.completed'&&event.usage) {
        usage ||= {...zero(),reported:true,complete:true,scope:'turns'};
        plus(usage,normalize('cx',event.usage));
      }
      return {usage,sessionModelUsage,actualModels:[...models]};
    }
  };
}

export function summarizeUsage(jobs) {
  const total={...zero(),reportedJobs:0,unreportedJobs:0,partialJobs:0};
  for(const job of jobs.filter(j=>j.kind!=='handoff')) {
    if(job.usage?.reported){plus(total,job.usage);total.reportedJobs++;if(!job.usage.complete)total.partialJobs++;}
    else total.unreportedJobs++;
  }
  return total;
}

export function recoverUsage(state,folderFor) {
  const sessions=new Map();
  for(const job of [...state.jobs].sort((a,b)=>String(a.startedAt).localeCompare(String(b.startedAt)))) {
    const project=state.projects.find(p=>p.id===job.projectId);if(!project)continue;
    job.workerId ||= project.tasks.find(t=>t.jobId===job.id)?.workerId||'';
    if(!job.workerId&&job.provider==='cx')job.workerId=project.architecture.workers.find(w=>w.sessionId&&w.sessionId===job.sessionId)?.id||'';
    if(job.usageVersion!==2) {
      const tracker=usageTracker(job.provider,{baseline:sessions.get(job.sessionId)||null,continued:sessions.has(job.sessionId)||Boolean(job.requestedSessionId)||Boolean(project.externalCCSession&&job.provider==='cc')});
      try {
        const file=path.join(folderFor(project.id),'runs',job.id,'events.jsonl');
        if(fs.statSync(file).size<=64*1024*1024)for(const line of fs.readFileSync(file,'utf8').split('\n')) {
          try{Object.assign(job,tracker.observe(JSON.parse(line)));}catch{}
        }
      }catch{}
      job.usageVersion=2;
    }
    if(job.sessionModelUsage&&job.sessionId)sessions.set(job.sessionId,job.sessionModelUsage);
  }
}
