/**
 * Step4: growthloop-candidate-report
 * 输入全部前序数据 + 候选人信息 → 输出成长纪念册 JSON
 */
export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { candidateInfo, positiveTags, learningThemes } = req.body;
  if (!candidateInfo || !positiveTags) {
    return res.status(400).json({ error: '缺少必要参数（candidateInfo 或 positiveTags）' });
  }

  const prompt = `你是 GrowthLoop 候选人成长纪念册生成器（growthloop-candidate-report）。

# 任务
根据以下输入数据，生成一份温暖的候选人成长纪念册 JSON。

# 输入数据
候选人信息：${JSON.stringify(candidateInfo, null, 2)}
正向标签：${JSON.stringify(positiveTags, null, 2)}
学习主题：${JSON.stringify(learningThemes || [], null, 2)}

# 重要规则
- 不评价候选人，不解释面试结果，不分析淘汰原因
- 候选人阅读后感受应该是：被看见、被尊重、拥有继续探索的方向
- 禁止词：提升、不足、加强、优化、改进、短板
- 只输出纯 JSON，不要 Markdown 代码块，不要任何解释文字

# 输出 JSON 结构
{
  "candidateInfo": ${JSON.stringify(candidateInfo)},
  "cover": {
    "titleLine1": "候选人姓名，",
    "titleLine2": "感谢你认真参与",
    "highlightWord": "这次交流",
    "subtitle": "这是一份记录成长与探索的纪念册。"
  },
  "summary": {
    "intro": "在{岗位}岗位的面试交流中，我们观察到了你多个值得记住的表现。",
    "paragraphs": ["段落1（40~80字）", "段落2（40~80字）"],
    "closing": "30字以内的结尾"
  },
  "medals": [
    {
      "icon": "合适的 emoji",
      "name": "成长勋章名称（有纪念感）",
      "description": "一句简短描述"
    }
  ],
  "seenMoments": [
    {
      "icon": "emoji",
      "medalName": "对应勋章名称",
      "text": "行为总结描述"
    }
  ],
  "growthMap": [
    {
      "icon": "🧭",
      "title": "学习主题名称",
      "description": "关注什么，40~80字",
      "tryNext": "下一次你可以尝试……"
    }
  ],
  "resourceSections": [
    {
      "themeTitle": "学习主题名称",
      "knowledgeBase": { "name": "腾讯校园招聘官方知识库", "url": "知识库统一入口" },
      "searchKeywords": ["关键词1", "关键词2", "关键词3"],
      "resources": [
        {
          "icon": "📖",
          "title": "资源标题",
          "description": "内容介绍，20~40字",
          "whyRecommended": "推荐原因：……"
        }
      ]
    }
  ],
  "closing": {
    "philosophy": [
      "GrowthLoop 不尝试定义你是什么样的人。",
      "我们只是记录这次交流中那些值得被记住的瞬间。",
      "一次面试无法定义一个人。",
      "但每一次认真表达，都可能成为下一次成长的起点。",
      "成长不是修正自己。",
      "而是在一次次被看见之后，继续成为自己。"
    ],
    "message": "感谢你认真参与这次交流。无论未来身处哪里，我们都希望这份记录能够陪伴你继续探索更多可能。",
    "footerNotes": [
      "本报告由 GrowthLoop AI 自动生成",
      "GrowthLoop 已阅读本次面试纪要与岗位要求",
      "本报告仅供成长参考",
      "不会影响任何面试结果",
      "不构成录用或淘汰依据"
    ]
  }
}

medals 数量 = positiveTags 数量。
seenMoments 数量 = positiveTags 数量，medalName 对应 medals 中的 name。
growthMap 数量 = learningThemes 数量。
resourceSections 数量 = learningThemes 数量。

只输出纯 JSON。`;

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
