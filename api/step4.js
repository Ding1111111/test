/**
 * Step4: growthloop-candidate-report
 * 输入候选人信息 + positiveTags + learningThemes → 输出成长纪念册 JSON
 */
const { callAI } = require('./_lib/callAI.js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { candidateName, jobRole, positiveTags, learningThemes } = req.body;
  if (!candidateName || !jobRole) {
    return res.status(400).json({ error: '缺少 candidateName 或 jobRole 参数' });
  }

  const prompt = `你是 growthloop-candidate-report 技能，负责生成候选人成长纪念册。

# 输入信息
候选人姓名：${candidateName}
应聘岗位：${jobRole}
正向行为标签：${JSON.stringify(positiveTags || [], null, 2)}
学习成长主题：${JSON.stringify(learningThemes || [], null, 2)}

# 任务
生成一份温暖的成长纪念册 JSON，包含：
1. 候选人的亮点总结（基于 positiveTags）
2. 个性化成长建议（基于 learningThemes）
3. 鼓励性评语和建议的下一步行动

# 输出格式（严格 JSON，不要 Markdown 代码块）
{
  "candidateName": "候选人姓名",
  "jobRole": "岗位名",
  "generatedAt": "生成时间 ISO 格式",
  "highlights": [
    {
      "tag": "标签名",
      "evidence": "行为证据",
      "comment": "鼓励性评语"
    }
  ],
  "growthPlan": [
    {
      "theme": "学习主题",
      "description": "描述",
      "resources": [{"title": "资源名", "url": "链接", "description": "描述"}],
      "action": "建议的下一步行动"
    }
  ],
  "closingMessage": "给候选人的温暖寄语"
}

只输出纯 JSON，不要有任何其他文字。`;

  try {
    const result = await callAI(prompt, { expectJSON: true, maxTokens: 2000 });
    return res.status(200).json(result);
  } catch (e) {
    console.error('Step4 error:', e);
    return res.status(500).json({ error: e.message });
  }
};
