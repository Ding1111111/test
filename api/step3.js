/**
 * Step3: growthloop-resource-finder
 * 输入成长标签 → 调用 AI 生成 learningThemes + 调用 IMA 知识库搜索真实资源
 */
export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { jobRole, growthTags } = req.body;
  if (!growthTags || !Array.isArray(growthTags) || growthTags.length === 0) {
    return res.status(400).json({ error: '缺少成长标签数据（growthTags）' });
  }

  // ── IMA 知识库搜索函数 ──────────────────────────────────────
  const IMA_CLIENT_ID = process.env.IMA_CLIENT_ID;
  const IMA_API_KEY   = process.env.IMA_API_KEY;
  const IMA_BASE_URL  = process.env.IMA_BASE_URL || 'https://ima.qq.com';
  const IMA_KB_ID     = process.env.IMA_KNOWLEDGE_BASE_ID || '';

  if (!IMA_CLIENT_ID || !IMA_API_KEY) {
    return res.status(500).json({
      error: 'IMA 凭证未配置，请在 Vercel Dashboard 中设置 IMA_CLIENT_ID 和 IMA_API_KEY 环境变量。'
    });
  }

  async function searchIMA(keyword, knowledgeBaseId) {
    const body = { query: keyword, cursor: '' };
    if (knowledgeBaseId) body.knowledge_base_id = knowledgeBaseId;

    const response = await fetch(`${IMA_BASE_URL}/openapi/wiki/v1/search_knowledge`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'ima-openapi-clientid': IMA_CLIENT_ID,
        'ima-openapi-apikey':   IMA_API_KEY,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`IMA 搜索失败 (${response.status}): ${text.slice(0, 200)}`);
    }

    const result = await response.json();
    if (result.code !== 0) {
      throw new Error(`IMA 业务错误 (code=${result.code}): ${result.msg}`);
    }
    return result.data;
  }
  // ────────────────────────────────────────────────────────────────

  const prompt = `你是 growthloop-resource-finder 技能。

# 任务
基于以下成长标签，生成学习主题（learningThemes）。每个成长标签对应一个学习主题。

# 输入
岗位：${jobRole || '未指定'}
成长标签：${JSON.stringify(growthTags, null, 2)}

# 输出格式（严格 JSON，不要 Markdown 代码块，不要有其他文字）
{
  "learningThemes": [
    {
      "theme": "学习主题名称（简短，8字以内）",
      "description": "这个主题关注什么，40~80字",
      "searchKeywords": ["关键词1", "关键词2", "关键词3"],
      "knowledgeBase": {
        "name": "腾讯校园招聘官方知识库",
        "url": "知识库统一入口"
      }
    }
  ]
}

规则：
- learningThemes 数量 = growthTags 数量（每个成长标签对应一个学习主题）
- searchKeywords 每个主题 3~5 个，用于后续在知识库中搜索资源
- 只输出纯 JSON，不要有其他文字。`;

  try {
    // ── Step1: 调用 AI 生成 learningThemes 框架 ──
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

    // ── Step2: 用 IMA 知识库搜索真实资源，填充每个 theme 的 resources ──
    const themes = result.learningThemes || [];
    const kbId = IMA_KB_ID || undefined;

    for (const theme of themes) {
      const resources = [];

      for (const kw of (theme.searchKeywords || []).slice(0, 3)) {
        try {
          const imaData = await searchIMA(kw, kbId);
          const items = imaData.info_list || [];

          for (const item of items.slice(0, 2)) {
            resources.push({
              title:   item.title || item.name || kw,
              summary:  item.brief || item.description || `关于「${kw}」的学习资源`,
              url:      (item.url_info && item.url_info.url) || item.url || '',
              mediaId:  item.media_id || '',
            });
          }

          if (!imaData.is_end && imaData.next_cursor) {
            const page2 = await searchIMA(kw, kbId);
            for (const item of (page2.info_list || []).slice(0, 1)) {
              resources.push({
                title:   item.title || item.name || kw,
                summary:  item.brief || item.description || '',
                url:      (item.url_info && item.url_info.url) || item.url || '',
                mediaId:  item.media_id || '',
              });
            }
          }
        } catch (e) {
          console.warn(`IMA 搜索失败 (keyword=${kw}):`, e.message);
        }
      }

      const seen = new Set();
      theme.resources = resources.filter(r => {
        if (seen.has(r.title)) return false;
        seen.add(r.title);
        return true;
      }).slice(0, 5);

      if (theme.resources.length === 0) {
        theme.resources = [
          { title: `${theme.theme}——入门指南`,  summary: `系统了解${theme.theme}的基础知识与应用场景` },
          { title: `${theme.theme}——实战案例`,  summary: `通过真实案例掌握${theme.theme}的核心方法` },
        ];
      }
    }

    return res.status(200).json(result);

  } catch (e) {
    console.error('Step3 error:', e);
    return res.status(500).json({ error: e.message });
  }
}
