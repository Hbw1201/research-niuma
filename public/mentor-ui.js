const names={proceed:'导师认可 · 可继续',revise:'导师要求修改',blocked:'待补材料',running:'导师判断中',failed:'组会待重试',interrupted:'组会待继续'};
export function taskMeetingCurrent(p,t){const r=p.collaboration?.reviews?.find(r=>r.id===t.reviewId);return Boolean(r&&(!r.sourceHash||r.reportId===t.reportId&&r.requirementsRevision===(p.steering?.revision||0)&&r.benchmarkRunId===p.benchmarkResearch?.runs?.at(-1)?.id));}
export function taskMeetingResolved(p,t,seen=new Set()){
 if(t.status==='superseded')return true;if(seen.has(t.id)||!taskMeetingCurrent(p,t))return false;if(t.assessment==='passed')return true;
 seen.add(t.id);const r=p.collaboration.reviews.find(r=>r.id===t.reviewId),fixes=p.tasks.filter(x=>r.createdTaskIds?.includes(x.id)&&(x.relation!=='next'||r.userDecision?.action==='approve'));
 return fixes.length>0&&fixes.every(x=>taskMeetingResolved(p,x,new Set(seen)));
}
export function meetingState(p,stage){
 const tasks=(p.tasks||[]).filter(t=>t.status!=='superseded'&&t.researchStage===stage),reviews=(p.collaboration?.reviews||[]).filter(r=>!r.councilRoundId&&tasks.some(t=>t.id===r.taskId));
 const r=p.benchmarkResearch?.runs?.at(-1),phase=stage==='literature'?'literature':stage==='benchmark'?'protocol':'',key=phase?r?.id+':'+phase:stage==='design'&&p.executionPlan?'plan:'+p.executionPlan.id:'';
 const meeting=(p.mentorMeetings||[]).filter(m=>m.stage===stage&&(!key||m.source.key===key)).at(-1);
 if(meeting&&(!phase||r?.[phase]?.status==='completed'||meeting.status!=='completed')&&meeting.source.requirementsRevision===(p.steering?.revision||0)&&meeting.source.goal===p.brief){
  if(meeting.status!=='completed')return {label:names[meeting.status]||'待导师判断',status:meeting.status,meeting};
  if(!tasks.length)return {label:names[meeting.data.verdict],status:meeting.data.verdict,meeting};
 }
 if(tasks.length){
  if(tasks.some(t=>t.reportId&&!taskMeetingCurrent(p,t)))return {label:'已汇报 · 待导师判断',status:'pending'};
  if(tasks.some(t=>!t.reportId))return {label:'执行后向导师汇报',status:'pending'};
  const unresolved=tasks.find(t=>!taskMeetingResolved(p,t)),last=unresolved?reviews.find(r=>r.id===unresolved.reviewId):reviews.at(-1);if(last)return {label:unresolved?(last.assessment==='retry'?'导师要求修改':'待补材料'):'导师认可 · 可继续',status:unresolved?(last.assessment==='retry'?'revise':'blocked'):'proceed',review:last};
 }
 if(phase&&r?.[phase]?.status==='completed'||stage==='design'&&p.executionPlan)return {label:'已形成材料 · 待组会',status:'pending'};
 return {label:'完成后汇报 → 导师判断',status:'pending'};
}
export function meetingNodes(p){return (p.mentorMeetings||[]).map(m=>({id:m.id,title:`主 CC 组会 · 第 ${m.number} 次`,kind:'meeting',owner:'主 CC 导师',status:m.status==='completed'?{proceed:'passed',revise:'retry',blocked:'blocked'}[m.data.verdict]:m.status,researchStage:m.stage,parents:[m.stage==='design'?'plan-'+m.source.key.slice(5):`benchmark-${m.source.key.replace(':','-')}`],relation:'步骤汇报 → 导师判断',detail:m.data?.summary||m.error||'正在核对本步骤证据与研究方向。',meeting:m}));}
export function meetingDetails(c,m){const {esc,button}=c,d=m.data;return `${d?`<h3>做了什么</h3><p class="message-text">${esc(d.work)}</p><h3>证据与核验边界</h3><p class="message-text">${esc(d.evidence)}</p><h3>导师对方向的判断</h3><p class="message-text">${esc(d.direction)}</p><h3>问题与风险</h3><p class="message-text">${esc(d.risks)}</p><h3>下一步与验收</h3><p class="message-text">${esc(d.nextStep)}</p><p class="meeting-verdict">${names[d.verdict]}</p>${d.revisionInstructions?`<p class="message-text">修改要求：${esc(d.revisionInstructions)}</p>`:''}`:`<p>${esc(m.error||'等待导师完成判断。')}</p>`}<div class="actions">${m.documentId?button('doc','组会纪要.md','',`data-id="${esc(m.documentId)}"`):''}${m.source?.documentId?button('doc','本次汇报材料','',`data-id="${esc(m.source.documentId)}"`):''}${c.state.jobs.some(j=>j.id===m.jobId)?button('log','导师会话日志','',`data-id="${esc(m.jobId)}"`):''}</div>`;}
export function mentorPanel(c,stage){
 const {p,esc,panel,button}=c,s=meetingState(p,stage),reports=(p.collaboration?.reviews||[]).filter(r=>!r.councilRoundId&&p.tasks.some(t=>t.id===r.taskId&&t.researchStage===stage));
 const history=(p.mentorMeetings||[]).filter(m=>m.stage===stage);
 if(!history.length&&!reports.length)return panel('步骤组会 · 向主 CC 汇报',`<div class="panel-body"><p>${esc(s.label)}</p><p class="hint">每一步结束后，导师核对证据、判断研究方向，说明下一步和验收条件。认可后放行；要求修改则继续本步骤。三位委员与用户的正式审核仍保留。</p></div>`);
 const last=reports.at(-1),m=history.at(-1);
 const body=last?`<p class="hint">T${p.tasks.find(t=>t.id===last.taskId)?.index} · ${esc(s.label)}</p><h3>本次工作与汇报</h3><p class="message-text">${esc(last.summary)}</p><h3>证据与核验边界</h3><p class="message-text">${esc(last.evidence)}</p><h3>导师对方向的判断</h3><p class="message-text">${esc(last.reason)}</p><h3>下一步与验收</h3><p class="message-text">${esc(last.handoff||'见本次具体任务与验收要求。')}</p>${button('pipeline-node','查看完整汇报与后续任务','',`data-id="${esc(last.id)}"`)}`:meetingDetails(c,m);
 return panel('步骤组会 · 主 CC 的方向判断',`<div class="panel-body"><p class="hint">${esc(s.label)} · 每个步骤汇报一次，调整后再次汇报</p>${body}${history.length+reports.length>1?`<details class="section-gap"><summary>历次汇报与导师判断（${history.length+reports.length}）</summary>${[...history.map(m=>({id:m.id,label:`组会 ${m.number} · ${names[m.data?.verdict]||names[m.status]||m.status}`})),...reports.map((r,i)=>({id:r.id,label:`执行汇报 ${i+1} · ${r.summary}`}))].map(x=>button('pipeline-node',esc(x.label),'',`data-id="${esc(x.id)}"`)).join('')}</details>`:''}</div>`);
}
