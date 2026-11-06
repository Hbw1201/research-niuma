export const proposal={phase:'proposal',message:'初稿供评审',direction:'验证一种可检验的方法',ideas:['对比基线'],researchTopic:'测试研究',proposal:'## 假设\n明确可检验假设。\n## 设计\n使用保留集比较基线，失败后检查设计。',pipeline:[{title:'最小验证',description:'运行基线，检查保留集指标；不满足标准则回到设计。'}]};
export function councilResult(kind,reviewerId='cc'){
  if(kind==='intake')return structuredClone(proposal);
  if(kind==='proposal-independent')return {summary:`${reviewerId} 的独立判断`,strengths:['问题可检验'],concerns:[{title:'需要独立验证',severity:'major',reason:'尚无验证证据',recommendation:'预先保留测试数据'}],verdict:'revise'};
  const ids=['cc-r1','cc-r2','cc-r3'];
  if(kind==='proposal-cross')return {summary:'已比较各方意见',direction:'明确数据划分后验证',responses:ids.filter(id=>id!==reviewerId).map(id=>({issueId:`${id}-c1`,position:id==='cc-r2'?'refine':'agree',reason:'验证应与探索分开',suggestion:'冻结测试集'}))};
  if(kind==='proposal-synthesis'){const {phase,...p}=structuredClone(proposal);return {...p,message:'根据评委意见完成修订',proposal:'## 修订提案\n冻结测试集，在训练集内完成探索。\n## 失败标准\n性能未超过基线则检查假设。',decisions:ids.map(id=>({issueId:`${id}-c1`,action:'adopted',reason:'避免评估偏差',change:'加入冻结测试集要求'})),openQuestions:['是否有足够数据用于独立验证？']};}
  if(kind==='brainstorm')return {summary:'明确修订稿中的未决事项',questions:[{title:'采用何种验证设计？',why:'区分探索与验证',options:['冻结测试集','收集独立批次'],recommendation:'冻结测试集'}]};
  throw Error('Unexpected kind '+kind);
}
