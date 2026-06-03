/**
 * Step2: growthloop-tag-generator
 * 输入岗位名 + 行为维度 + 会议纪要 → 输出候选标签池 JSON
 */
const { callAI } = require('./_lib/callAI.js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { jobRole, focusBehaviors, meetingNotes } = req.body;
  if (!jobRole || !focusBehaviors) {
    return res.status(400).json({ error: '缺少 jobRole 或 focusBehaviors 参数' });
  }

  const prompt = `你是 growthloop-tag-generator 技能。

# 任务
基于岗位名和行为观察维度，结合面试纪要，生成候选人的正向行为标签和成长标签候选池。

# 输入
岗位名：${jobRole}
行为观察维度：${JSON.stringify(focusBehaviors, null, 2)}
面试纪要：${meetingNotes || '（无纪要，仅基于行为维度生成）'}

# 输出格式（严格 JSON，不要 Markdown 代码块）
{
  "jobRole": "岗位名",
  "positiveTags": [
    {
      "tag": "标签名称",
      "category": "能力分类",
      "evidence": "支持该标签的行为证据（来自纪要或推导）",
      "strength": "evidence 的强度说明：strong / moderate / weak"
    }
  ],
  "growthTags": [
    {
      "tag": "成长标签名称",
      "category": "能力分类",
      "gap": "当前与期望的差距描述",
      "priority": "high / medium / low"
    }
  ]
}

只输出纯 JSON，不要有任何其他文字。`;

  try {
    const result = await callAI(prompt, { expectJSON: true });
    return res.status(200).json(result);
  } catch (e) {
    console.error('Step2 error:', e);
    return res.status(500).json({ error: e.message });
  }
};
