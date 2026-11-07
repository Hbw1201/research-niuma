// A working framework for empirical/computational research, not a universal linear rule.
export const researchStages = [
  {id:'question',title:'现象与研究问题',output:'问题陈述、研究对象、边界与价值',gate:'研究者能解释要回答什么，以及什么证据可能推翻判断。',back:'问题不清晰时继续澄清，不直接进入实现。'},
  {id:'literature',title:'文献与研究缺口',output:'原始论文、经典与近期方法、论文实际采用的 baseline 与实验设置',gate:'从已读原文追溯方法、数据、指标和设置；区分全文、摘要与未获取来源，记录覆盖范围和缺口。',back:'发现已有解答时调整问题或贡献定位。'},
  {id:'benchmark',title:'Baseline 与性能衡量',output:'文献驱动的对照方法、主/辅助指标、数据划分与公平评测协议',gate:'CC 解释为什么选这些比较对象和指标，确定训练调参预算、防泄漏、重复试验与成功/失败标准，再开展实现。',back:'方法不适用或关键设置缺失时回到原文调研；评测改变后保留旧版本，必要时重跑。'},
  {id:'design',title:'假设与研究设计',output:'可检验假设、对照、指标、分析与停止规则',gate:'研究者确认研究方向与资源边界；CC 说明设计依据、步骤和验证方式后推进。',back:'方案不能区分替代解释时，回到问题或设计。'},
  {id:'data',title:'数据与实验准备',output:'数据来源、质量检查、划分、环境与版本',gate:'数据和计算资源可用，必要许可/伦理条件落实，泄漏检查完成。',back:'数据不适用时调整采集方案或缩小研究范围。'},
  {id:'pilot',title:'最小验证与基线',output:'可复现基线、小规模试验、初步失败分析',gate:'先确认测量与代码可信，再决定是否扩大实验。',back:'区分实现错误、设计不足和假设不成立。'},
  {id:'experiments',title:'正式实验与迭代',output:'主实验、对照/消融、重复实验、完整实验日志',gate:'按已确认协议执行；探索得到的新假设单独标注与验证。',back:'保留失败结果；替代方案作为新分支，不覆盖历史。'},
  {id:'analysis',title:'分析与结论复核',output:'效应与不确定性、替代解释、适用边界、证据对照',gate:'研究者核对结论是否由证据支持；需要时由另一个 CX 独立复跑。',back:'证据不足则补实验或收缩结论；阴性结果也可构成有效结论。'},
  {id:'writing',title:'写作、交流与复现归档',output:'论文/报告、图表、数据代码版本、复现说明与回应',gate:'逐项核对主张和引用，确认署名、披露及材料可用性。',back:'同行反馈可触发补充实验、修订分析或重新界定问题。'}
];
export const stageIds=researchStages.map(s=>s.id);
