/**
 * Step3: growthloop-resource-finder
 * 输入岗位名 + 成长标签 → 输出学习主题与资源 JSON
 * 调用 IMA 知识库搜索匹配资源
 */
const { callAI } = require('./_lib/callAI.js');

module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { jobRole, growthTags } = req.body;
  if (!jobRole || !growthTags) {
    return res.status(400).json({ error: '缺少 jobRole 或 growthTags 参数' });
  }

  // ── IMA 知识库搜索函数 ────────────────────────────────────
  const IMA_CLIENT_ID = process.env.IMA_CLIENT_ID;
  const IMA_API_KEY   = process.env.IMA_API_KEY;
  const IMA_BASE_URL  = process.env.IMA_BASE_URL || 'https://ima.qq.com';
  const IMA_KB_ID     = process.env.IMA_KNOWLEDGE_BASE_ID || 'ZjU16hYUQTf71bvkP9t_0zfWqiEkOdo-kap5YExwMRg=';

  async function searchIMA(keyword, knowledgeBaseId) {
    const body = { query: keyword, cursor: '' };
    if (knowledgeBaseId) body.knowledge_base_id = knowledgeBaseId;

    console.log('[IMA] 搜索参数:', JSON.stringify({ keyword, knowledgeBaseId }));

    const res = await fetch(IMA_BASE_URL + '/openapi/wiki/v1/search_knowledge', {
      method: 'POST',
      headers: {
        'Content-Type':          'application/json',
        'ima-openapi-clientid':   IMA_CLIENT_ID || '',
        'ima-openapi-apikey':     IMA_API_KEY || '',
      },
      body: JSON.stringify(body),
    });

    const text = await res.text();
    console.log('[IMA] HTTP ' + res.status + '，首200字符：' + text.slice(0, 200));

    if (!res.ok) {
      console.error('[IMA] 请求失败 HTTP ' + res.status + ': ' + text);
      return null;
    }

    let json;
    try { json = JSON.parse(text); } catch (e) {
      console.error('[IMA] JSON 解析失败：' + text.slice(0, 200));
      return null;
    }

    if (json.code !== 0) {
      console.error('[IMA] 业务错误 code=' + json.code + ': ' + (json.msg || ''));
      return null;
    }

    return json;
  }

  // ── 为每个成长标签搜索 IMA 资源 ─────────────────────────
  const learningThemes = [];

  // IMA 知识库搜索关键词映射：用简短关键词代替完整标签名
  function getSearchKeywords(tag) {
    const category = tag.category || '';
    if (category.includes('好奇心') || category.includes('探索') || category.includes('主动')) return ['实习', '成长'];
    if (category.includes('结构化') || category.includes('逻辑') || category.includes('拆解')) return ['拆解', '分析'];
    if (category.includes('跨界') || category.includes('整合')) return ['协作', '整合'];
    if (category.includes('同理心') || category.includes('用户')) return ['用户', '产品经理'];
    if (category.includes('代码') || category.includes('技术') || category.includes('AI')) return ['技术', 'AI'];
    if (category.includes('HR') || category.includes('人力') || category.includes('行业')) return ['HR', '培训'];
    if (category.includes('学习') || category.includes('成长') || category.includes('敏捷')) return ['成长', '复盘'];
    if (category.includes('表达') || category.includes('商业') || category.includes('方案')) return ['表达', '沟通'];
    return [tag.tag ? tag.tag.slice(0, 10) : '校招'];
  }

  for (const tag of growthTags) {
    const searchKeywords = getSearchKeywords(tag);
    let resources = [];
    let keywordUsed = '';

    if (IMA_CLIENT_ID && IMA_API_KEY) {
      // 用多个简短关键词搜索，取第一个有结果的关键词
      for (const keyword of searchKeywords) {
        try {
          const imaResult = await searchIMA(keyword, IMA_KB_ID || undefined);
          const items = (imaResult && imaResult.data && imaResult.data.info_list) || [];
          if (items.length > 0) {
            console.log(`[IMA] 关键词 "${keyword}" 找到 ${items.length} 条结果`);
            resources = items.slice(0, 3).map(r => ({
              title:       r.title || r.name || keyword,
              url:         r.url || r.link || '',
              description: r.snippet || r.description || '',
              source:      'IMA 知识库',
            }));
            keywordUsed = keyword;
            break; // 找到结果就停止搜索
          }
        } catch (e) {
          console.error('[IMA] 搜索出错 "' + keyword + '":', e.message);
        }
      }
    }

    // 如果 IMA 没有结果，用 AI 推荐通用资源
    if (resources.length === 0) {
      try {
        const tagName = tag.tag || tag;
        const prompt = `为以下成长标签推荐 2-3 个学习资源（腾讯/公开课程、文章、视频均可）：

标签：${tagName}
岗位：${jobRole}

输出 JSON 数组，每项包含 title / url / description / source。`;
        const aiResult = await callAI(prompt, { expectJSON: true, maxTokens: 500 });
        if (Array.isArray(aiResult)) resources = aiResult;
        else if (aiResult && Array.isArray(aiResult.resources)) resources = aiResult.resources;
      } catch (e) {
        console.error('[AI resource] error:', e.message);
      }
    }

    const tagName = tag.tag || tag;
    learningThemes.push({
      theme:      tagName,
      category:   tag.category || '通用',
      priority:   tag.priority || 'medium',
      resources:  resources.length > 0 ? resources : [{
        title:       '待补充：' + tagName,
        url:         '',
        description: '请在 IMA 知识库中补充相关学习资源',
        source:      '待补充',
      }],
    });
  }

  // ── 直接返回，不再调用 AI 生成报告（避免超时） ──────────
  console.log('[Step3] 完成，共 ' + learningThemes.length + ' 个主题');
  return res.status(200).json({
    jobRole,
    learningThemes,
    note: '基于 IMA 知识库匹配结果，已跳过 AI 报告生成',
  });
};
