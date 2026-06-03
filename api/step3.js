/**
 * Step3: growthloop-resource-finder
 * 输入岗位名 + 成长标签 → 输出学习主题与资源 JSON
 * 调用 IMA 知识库搜索匹配资源
 */
const { callAI } = require('./_lib/callAI.js');
const fetch = globalThis.fetch;

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { jobRole, growthTags } = req.body;
  if (!jobRole || !growthTags) {
    return res.status(400).json({ error: '缺少 jobRole 或 growthTags 参数' });
  }

  // ── IMA 知识库搜索函数 ─────────────────────────────────────
  const IMA_CLIENT_ID = process.env.IMA_CLIENT_ID;
  const IMA_API_KEY   = process.env.IMA_API_KEY;
  const IMA_BASE_URL  = process.env.IMA_BASE_URL || 'https://ima.qq.com';
  const IMA_KB_ID     = process.env.IMA_KNOWLEDGE_BASE_ID || '';

  async function searchIMA(keyword, knowledgeBaseId) {
    const body = { query: keyword, cursor: '' };
    if (knowledgeBaseId) body.knowledge_base_id = knowledgeBaseId;

    const res = await fetch(IMA_BASE_URL + '/openapi/wiki/v1/search_knowledge', {
      method: 'POST',
      headers: {
        'Content-Type':              'application/json',
        'ima-openapi-clientid':     IMA_CLIENT_ID || '',
        'ima-openapi-apikey':       IMA_API_KEY || '',
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const text = await res.text();
      console.error('[IMA] HTTP ' + res.status + ': ' + text);
      return null;
    }
    return res.json();
  }

  // ── 为每个成长标签搜索 IMA 资源 ─────────────────────────
  const learningThemes = [];

  for (const tag of growthTags) {
    const keyword = tag.tag || tag;
    let resources = [];

    if (IMA_CLIENT_ID && IMA_API_KEY) {
      try {
        const imaResult = await searchIMA(keyword, IMA_KB_ID || undefined);
        if (imaResult && imaResult.data) {
          resources = (imaResult.data.results || []).slice(0, 3).map(r => ({
            title:       r.title || r.name || keyword,
            url:         r.url || r.link || '',
            description: r.snippet || r.description || '',
            source:       'IMA 知识库',
          }));
        }
      } catch (e) {
        console.error('[IMA] search error for "' + keyword + '":', e.message);
      }
    }

    // 如果 IMA 没有结果，用 AI 推荐通用资源
    if (resources.length === 0) {
      try {
        const prompt = `为以下成长标签推荐 2-3 个学习资源（腾讯/公开课程、文章、视频均可）：

标签：${keyword}
岗位：${jobRole}

输出 JSON 数组，每项包含 title / url / description / source。`;
        const aiResult = await callAI(prompt, { expectJSON: true, maxTokens: 500 });
        if (Array.isArray(aiResult)) resources = aiResult;
        else if (aiResult && Array.isArray(aiResult.resources)) resources = aiResult.resources;
      } catch (e) {
        console.error('[AI resource] error:', e.message);
      }
    }

    learningThemes.push({
      theme:      tag.tag || tag,
      category:   tag.category || '通用',
      priority:   tag.priority || 'medium',
      resources:  resources.length > 0 ? resources : [{
        title:       '待补充：' + keyword,
        url:         '',
        description: '请在 IMA 知识库中补充相关学习资源',
        source:       '待补充',
      }],
    });
  }

  // ── 生成完整报告 ──────────────────────────────────────────
  const reportPrompt = `你是一个学习路径规划专家。基于以下信息，为每个成长标签生成完整的学习主题描述和建议。

岗位：${jobRole}
成长标签：${JSON.stringify(growthTags, null, 2)}
已匹配资源：${JSON.stringify(learningThemes, null, 2)}

输出严格 JSON 格式（不要 Markdown 代码块）：
{
  "jobRole": "${jobRole}",
  "learningThemes": [{
    "theme": "主题名",
    "category": "分类",
    "priority": "high/medium/low",
    "description": "主题描述和建议",
    "resources": [{"title":"资源名","url":"链接","description":"描述","source":"来源"}]
  }]
}`;

  try {
    const result = await callAI(reportPrompt, { expectJSON: true });
    return res.status(200).json(result);
  } catch (e) {
    console.error('Step3 error:', e);
    // 降级：返回已收集的数据
    return res.status(200).json({
      jobRole,
      learningThemes,
      note: 'AI 报告生成失败，返回原始匹配结果：' + e.message,
    });
  }
};
