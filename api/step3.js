/**
 * Step3: growthloop-resource-advisor-RAG
 * 输入岗位名 + 成长标签 → 输出学习主题与资源 JSON
 * 使用轻量 RAG（向量召回 + AI 重排）
 */

const { callAI } = require('./_lib/callAI');
const { ragSearch } = require('./rag-search');

// ── 主处理函数 ─────────────────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { jobRole, growthTags } = req.body;
  if (!jobRole || !growthTags) {
    return res.status(400).json({ error: '缺少 jobRole 或 growthTags 参数' });
  }

  console.log('[Step3] 收到请求，标签数：' + growthTags.length);

  // 构建 learningThemes（与原来逻辑一致）
  const learningThemes = growthTags.map(tag => {
    const tagText = ((tag.tag || '') + ' ' + (tag.category || '')).toLowerCase();
    let searchKeywords = [];
    if (tagText.match(/好奇|探索|主动|自驱/))      searchKeywords = ['实习', '成长', '主动'];
    else if (tagText.match(/结构化|逻辑|拆解|分析/)) searchKeywords = ['拆解', '分析', '规划'];
    else if (tagText.match(/跨界|整合|协作/))      searchKeywords = ['协作', '整合', '团队'];
    else if (tagText.match(/同理|用户|产品/))      searchKeywords = ['用户', '产品', '产品经理'];
    else if (tagText.match(/代码|技术|AI|算法/))   searchKeywords = ['技术', 'AI', '开发'];
    else if (tagText.match(/HR|人力|培训|学习/))   searchKeywords = ['HR', '培训', '成长'];
    else if (tagText.match(/表达|沟通|商业|方案/)) searchKeywords = ['表达', '沟通', '商业'];
    else if (tagText.match(/设计|创意|UI|UX/))     searchKeywords = ['设计', '创意', 'UI'];
    else if (tagText.match(/项目|推进|落地/))      searchKeywords = ['项目', '推进', '落地'];
    else searchKeywords = [(tag.tag || '校招').slice(0, 4), '实习', '校招'];

    return {
      theme:          tag.tag || tag,
      description:    tag.reason || `在"${tag.tag || tag}"方向上持续成长`,
      searchKeywords,
      growthTagReason: tag.reason || '',
    };
  });

  console.log('[Step3] 开始 RAG 搜索，共 ' + learningThemes.length + ' 个主题');

  // 调用 RAG 搜索（向量召回 + AI 重排）
  let ragResults;
  try {
    ragResults = await ragSearch(learningThemes, callAI);
  } catch (e) {
    console.error('[Step3] RAG 搜索失败：', e.message);
    // 降级：返回空资源
    ragResults = learningThemes.map(t => ({
      ...t,
      resources: [],
      summary: `${t.theme}资源匹配失败，请稍后重试。`,
    }));
  }

  // 组装最终输出（保持与原格式兼容）
  const resultThemes = ragResults.map((rt, i) => ({
    theme:         rt.theme || learningThemes[i].theme,
    description:   rt.description || learningThemes[i].description,
    searchKeywords: rt.searchKeywords || learningThemes[i].searchKeywords,
    resources:     (rt.resources || []).slice(0, 5).map(r => ({
      type:         r.type || '实战经验',
      title:        r.title || '',
      summary:      (r.summary || '').slice(0, 60),
      learningValue: (r.learningValue || '').slice(0, 80),
    })),
    knowledgeBase: {
      name: '腾讯校招知识库（RAG 向量检索）',
      url:  '',
    },
  }));

  console.log('[Step3] 完成，共 ' + resultThemes.length + ' 个主题');
  return res.status(200).json({ jobRole, learningThemes: resultThemes });
};
