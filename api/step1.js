/**
 * Step1: jd-behavior-observer
 * 输入 JD 文本 → 输出行为观察维度 JSON
 */
export const config = { maxDuration: 30 };

import { callAI } from './_lib/callAI.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { jd } = req.body;
  if (!jd) return res.status(400).json({ error: '缺少 jd 参数' });

  const prompt = `你是 jd-behavior-observer 技能。

# 任务
分析以下岗位 JD，提取面试中值得观察的关键行为维度。

# 输入 JD
${jd}

# 输出格式（严格 JSON，不要 Markdown 代码块）
{
  "jobRole": "从 JD 中提取的岗位名称",
  "focusBehaviors": [
    {
      "behavior": "行为维度名称",
      "description": "面试中如何观察这一行为",
      "reason": "为什么从 JD 中推导出这个维度"
    }
  ]
}

只输出纯 JSON，不要有任何其他文字。`;

  try {
    const result = await callAI(prompt, { expectJSON: true });
    return res.status(200).json(result);
  } catch (e) {
    console.error('Step1 error:', e);
    return res.status(500).json({ error: e.message });
  }
}
