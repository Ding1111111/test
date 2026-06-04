/**
 * Step3: growthloop-resource-advisor-local
 * 输入岗位名 + 成长标签 → 输出学习主题与资源 JSON
 * 使用本地 knowledge-index.json 搜索，不依赖 IMA API
 */
const fs   = require('fs');
const path = require('path');

// ── 加载本地知识库索引（启动时加载一次） ──────────────────
const INDEX_PATH = path.resolve(__dirname, 'knowledge-index.json');
let knowledgeIndex = null;

function loadIndex() {
  if (knowledgeIndex) return knowledgeIndex;
  try {
    const raw = fs.readFileSync(INDEX_PATH, 'utf8');
    const data = JSON.parse(raw);
    knowledgeIndex = data.records || [];
    console.log(`[Step3] 知识库索引已加载，${knowledgeIndex.length} 条记录`);
  } catch (e) {
    console.error('[Step3] 索引加载失败：', e.message);
    knowledgeIndex = [];
  }
  return knowledgeIndex;
}

// ── 本地搜索：在标题/内容/路径中匹配关键词 ──────────────────
function searchLocalIndex(keywords) {
  const records = loadIndex();
  if (!Array.isArray(keywords) || keywords.length === 0) return [];

  const results = [];

  for (const record of records) {
    const searchText = [
      record.title    || '',
      record.content   || '',
      record.path      || '',
      record.category  || '',
    ].join(' ').toLowerCase();

    // 只要有一个关键词匹配就纳入候选
    const matchedKeyword = keywords.find(kw =>
      kw && searchText.includes(kw.toLowerCase())
    );

    if (matchedKeyword) {
      results.push({
        title:   record.title || path.basename(record.path),
        summary: record.content
          ? record.content.slice(0, 100).replace(/\s+/g, ' ') + '...'
          : `来自知识库：${record.category}`,
        type:     record.type || 'html',
        path:     record.path,
        keyword:  matchedKeyword,
      });
    }
  }

  // 去重（按标题）
  const seen = new Set();
  const unique = [];
  for (const r of results) {
    if (!seen.has(r.title)) {
      seen.add(r.title);
      unique.push(r);
    }
  }

  return unique.slice(0, 5); // 最多返回 5 条
}

// ── 为成长标签生成搜索关键词 ──────────────────
function getSearchKeywords(tag) {
  const category = (tag.category || '') + ' ' + (tag.tag || '');
  const tagText  = category.toLowerCase();

  if (tagText.match(/好奇|探索|主动|自驱/))     return ['实习', '成长', '主动'];
  if (tagText.match(/结构化|逻辑|拆解|分析/)) return ['拆解', '分析', '规划'];
  if (tagText.match(/跨界|整合|协作/))         return ['协作', '整合', '团队'];
  if (tagText.match(/同理|用户|产品/))         return ['用户', '产品', '产品经理'];
  if (tagText.match(/代码|技术|AI|算法/))      return ['技术', 'AI', '开发'];
  if (tagText.match(/HR|人力|培训|学习/))      return ['HR', '培训', '成长'];
  if (tagText.match(/表达|沟通|商业|方案/))    return ['表达', '沟通', '商业'];
  if (tagText.match(/设计|创意|UI|UX/))        return ['设计', '创意', 'UI'];
  if (tagText.match(/项目|推进|落地/))         return ['项目', '推进', '落地'];
  // 兜底：用 tag 名的前 4 个字作为关键词
  const fallback = (tag.tag || '校招').slice(0, 4);
  return [fallback, '实习', '校招'];
}

// ── 主处理函数 ──────────────────────────────────
module.exports = async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

  const { jobRole, growthTags } = req.body;
  if (!jobRole || !growthTags) {
    return res.status(400).json({ error: '缺少 jobRole 或 growthTags 参数' });
  }

  console.log('[Step3] 收到请求，标签数：' + growthTags.length);

  const learningThemes = [];

  for (const tag of growthTags) {
    const searchKeywords = getSearchKeywords(tag);
    const matchedResources = searchLocalIndex(searchKeywords);

    const resources = matchedResources.length > 0
      ? matchedResources.map(r => ({
          type:   r.type === 'pdf' ? '补充阅读' : '实战经验',
          title:  r.title,
          summary: r.summary,
        }))
      : [{
          type:     '补充阅读',
          title:    '待补充：' + (tag.tag || tag),
          summary:  '请在知识库中补充相关学习资源',
          learningValue: '',
        }];

    // 保证每个主题有 2~4 条资源（用 AI 补全描述）
    const themeName = tag.tag || tag;
    learningThemes.push({
      theme:         themeName,
      description:   tag.reason || `在"${themeName}"方向上持续成长`,
      searchKeywords,
      resources:     resources.slice(0, 4),
      knowledgeBase: {
        name: '腾讯校园招聘知识库（本地索引）',
        url:  '',
      },
    });
  }

  console.log('[Step3] 完成，共 ' + learningThemes.length + ' 个主题');
  return res.status(200).json({ jobRole, learningThemes });
};
