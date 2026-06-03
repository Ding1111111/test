/**
 * Step2: growthloop-tag-generator
 * 输入行为维度 + 会议纪要 → 输出 positiveTags + growthTags
 */
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { jobRole, focusBehaviors, meetingMinutes } = req.body;
  if (!meetingMinutes) return res.status(400).json({ error: '缺少会议纪要' });

  const prompt = `你是 growthloop-tag-generator 技能。

# 任务
基于以下面试行为观察维度和会议纪要，生成正向标签（positiveTags）和成长标签（growthTags）候选池。

# 输入
岗位：${jobRole || '未指定'}
行为观察维度：${JSON.stringify(focusBehaviors || [], null, 2)}
面试纪要：
${meetingMinutes}

# 输出格式（严格 JSON，不要 Markdown 代码块）
{
  "jobRole": "${jobRole || ''}}",
  "positiveTags": [
    {
      "tag": "正向行为标签名",
      "strength": "high | medium | low",
      "quote": "候选人原话或行为描述",
      "position": "时间位置",
      "reason": "为什么生成这个标签"
    }
  ],
  "growthTags": [
    {
      "tag": "成长方向标签名",
      "strength": "low",
      "quote": "候选人原话",
      "position": "时间位置",
      "reason": "为什么这是值得成长的维度"
    }
  ]
}

规则：
- positiveTags：候选人在面试中已展现的闪光行为，strength 可以是 high/medium/low
- growthTags：值得继续探索的方向，strength 统一为 low
- 每个标签必须有真实的 quote（来自纪要）
- 只输出纯 JSON，不要有其他文字。`;

  try {
    const baseURL = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
    const aiResponse = await fetch(`${baseURL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.OPENAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: process.env.AI_MODEL || 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    });

    const aiData = await aiResponse.json();
    if (!aiResponse.ok) {
      return res.status(aiResponse.status).json({ error: aiData.error?.message || 'AI 调用失败' });
    }

    const result = JSON.parse(aiData.choices[0].message.content);
    return res.status(200).json(result);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
