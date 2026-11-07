// questionIds remains the wire field for existing CLI sessions and task records.
// New tasks reference the confirmed research goal; no questionnaire approval is synthesized.
export function executionScope(project) {
  return [
    {id:'research-goal',title:project.researchTopic||project.title,description:project.brief},
    ...(project.questions||[]).filter(q=>q.decision==='approved').map(q=>({id:q.id,title:q.title,description:q.answer||q.recommendation||''})),
  ];
}

export function scopeContext(project) {
  return `已确认的研究目标：\n${project.brief}\n\n可引用的目标标识（questionIds 为兼容旧记录的字段名，不代表问卷）：\n${JSON.stringify(executionScope(project))}\n\n历史明确决定（保留已否决内容及修改要求；pending 只代表旧版未答题，不是执行门槛）：\n${JSON.stringify((project.questions||[]).filter(q=>q.decision!=='pending'))}\n\n依据用户已确认的目标自主选择常规技术方案，向用户说明做什么、为什么和如何验证，不生成问卷，不要求逐项批阅。不得违背用户明确决定；需要新权限、额外预算或缺少必要材料时再提出具体问题。`;
}
