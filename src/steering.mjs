import {assert, now, text, uid} from './store.mjs';

const schema = {
  type:'object', additionalProperties:false, required:['reply','isRequirement'],
  properties:{reply:{type:'string'}, isRequirement:{type:'boolean'}},
};

// Only expose the answer field of the main structured response, never reasoning or tool arguments.
export function controlPreview() {
  let index=-1, json='';
  return packet=>{
    if(packet.parent_tool_use_id)return;
    if(packet.type==='assistant')return packet.message?.content?.find(b=>b.type==='tool_use'&&b.name==='StructuredOutput')?.input?.reply;
    if(packet.type!=='stream_event')return;
    const e=packet.event;
    if(e?.type==='message_start'){index=-1;json='';}
    if(e?.type==='content_block_start'&&e.content_block?.name==='StructuredOutput'){
      index=e.index;json='';
    }
    if(e?.type!=='content_block_delta'||e.index!==index||e.delta?.type!=='input_json_delta')return;
    if(json.length>=200000)return;
    json+=e.delta.partial_json;
    const match=/"reply"\s*:\s*"((?:\\(?:["\\/bfnrt]|u[\da-fA-F]{4})|[^"\\\x00-\x1f])*)/.exec(json);
    if(match)return JSON.parse('"'+match[1]+'"');
  };
}

export function activeRequirements(project) {
  return (project.steering?.turns || []).filter(turn => turn.revision)
    .map(turn => `- ${turn.message}`).join('\n');
}

export class Steering {
  constructor(flow) {
    this.flow=flow;
    this.active=new Map();
  }

  submit(id, input) {
    const p=this.flow.store.project(id), channel=p.steering;
    const key=input.requestId||uid();
    assert(typeof key==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(key),'消息标识无效。');
    const previous=channel.turns.find(t=>t.id===key);
    if(previous){
      if(input.retry===true&&['failed','interrupted'].includes(previous.status)){
        this.flow.cli('cc');
        previous.status='queued';previous.error='';
        this.save(p);this.drain(p);
      }
      return previous;
    }
    assert(!input.retry,'找不到要重试的消息。',404);
    const message=text(input.message,20000);
    assert(['auto','requirement'].includes(input.mode||'auto'),'未知消息类型。');
    this.flow.cli('cc');
    const turn={id:key,at:now(),message,status:'queued',mode:input.mode||'auto'};
    channel.turns.push(turn);
    if(turn.mode==='requirement')turn.revision=++channel.revision;
    this.save(p);this.drain(p);
    return turn;
  }

  save(p) {
    const history=p.steering.turns.map(t=>{
      const reply=t.reply?'\n\n### CC\n\n'+t.reply:'';
      const error=t.error?'\n\n回复状态：'+t.error:'';
      return `## 研究者 · ${t.at}${t.revision?' · 课题要求 #'+t.revision:''}\n\n${t.message}${reply}${error}`;
    }).join('\n\n');
    this.flow.store.doc(p.id,'65-control-chat.md','CC 总控对话','# '+p.title+' · 总控对话\n\n'+history,'conversation');
    this.flow.runner.changed();
  }

  drain(p) {
    if(this.active.has(p.id))return;
    const work=Promise.resolve().then(async()=>{
      let turn;
      while(!this.flow.runner.closing&&(turn=p.steering.turns.find(t=>t.status==='queued'))){
        turn.status='replying';this.flow.runner.changed();
        try {
          await this.answer(p,turn);
        } catch(e) {
          if(turn.status==='replying'){
            turn.status=this.flow.runner.closing?'interrupted':'failed';
            turn.error=e.message;turn.jobId=e.jobId||turn.jobId;
          }
        }
        this.save(p);
      }
    }).finally(()=>{
      this.active.delete(p.id);
      if(!this.flow.runner.closing&&p.steering.turns.some(t=>t.status==='queued'))this.drain(p);
    });
    this.active.set(p.id,work);
  }

  async answer(p,turn) {
    const c=p.collaboration,turns=p.steering.turns;
    const context={
      title:p.title, goal:p.researchTopic||p.brief, status:p.status, confirmed:p.intakeConfirmed,
      benchmark:p.benchmarkResearch?.runs?.at(-1)||null, executionPlan:p.executionPlan||null, historicalDecisions:p.questions.map(q=>({title:q.title,decision:q.decision,answer:q.answer})),
      pendingDecision:c.pendingDecision, plan:p.pipeline||p.proposal?.pipeline||[],
      team:p.architecture.workers.filter(w=>w.active!==false).map(w=>({name:w.name,role:w.role,model:w.model})),
      tasks:p.tasks.map(t=>({id:t.index,title:t.title,status:t.status,assessment:t.assessment})),
      exchanges:c.messages.slice(-8).map(m=>({from:m.from,to:m.to,content:m.content.slice(-1500)})),
      intake:p.conversation.slice(-4).map(m=>({role:m.role,content:m.content.slice(-1500)})),
      councils:(p.stageReviews||[]).slice(-4).map(r=>({kind:r.kind,round:r.number,status:r.status,phase:r.phase,summary:r.synthesis.data?.summary,modificationTasks:r.createdTaskIds,error:r.error})),
      earlierTurns:turns.slice(0,turns.indexOf(turn)).slice(-12).map(t=>({message:t.message,reply:t.reply})),
    };
    const prompt=`你是当前课题的总控 CC。直接与研究者对话，结合以下真实状态回答，必要时使用只读工具核对证据。简洁说明目前情况及下一步。普通问题、设想或请求解释返回 isRequirement=false；只有明确要求更改此课题后续工作的指示返回 true。含糊时先追问。明确指令将按研究者原话加入之后 CC 和 CX 的输入，较新要求修订冲突的旧要求。明确区分“已记录”和“已执行”。进行中的调用不会被改写。不要声称已运行实验、已调整队列或已更改配置，实际进展以项目记录为准。已确认研究方向与用户明确约束继续适用。常规安排说明做什么和理由后直接推进，不生成问卷、不要求逐项批阅；日常执行不反复请示；提案、实验结果与论文需要三位委员全票通过，再由用户审核才能出环。待用户审核时说明正在等待用户，不要声称可自动进入下一阶段。新的权限、额外预算或无法自行获取的必要材料仍需研究者判断。\n项目状态：${JSON.stringify(context)}\n本条类型：${turn.mode==='requirement'?'研究者已将此条设为课题要求':'普通对话，判断是否包含明确的新要求'}\n研究者：${turn.message}`;
    const {runner,store}=this.flow;
    const result=await runner.run({projectId:p.id,provider:'cc',kind:'control-chat',controlTurnId:turn.id,title:'CC 总控 · 回复研究者',executable:this.flow.cli('cc'),cwd:store.folder(p.id),sessionId:p.steering.sessionId||undefined,prompt,schema});
    if(runner.closing||turn.status!=='replying')return;
    const data=result.structured||JSON.parse(result.text);
    const reply=text(data.reply,30000);
    assert(typeof data.isRequirement==='boolean','CC 的需求判断格式无效。');
    if(data.isRequirement&&!turn.revision)turn.revision=++p.steering.revision;
    Object.assign(turn,{reply,jobId:result.job.id,status:'answered',answeredAt:now()});
    p.steering.sessionId=result.job.sessionId||p.steering.sessionId;
  }

  stop(id) {
    const p=this.flow.store.project(id);
    const pending=p.steering.turns.filter(t=>['queued','replying'].includes(t.status));
    for(const t of pending){t.status='interrupted';t.error='回复已中断，可重试。';}
    if(pending.length)this.save(p);
  }
}
