/**
 * Step3: growthloop-resource-advisor-local
 * 输入岗位名 + 成长标签 → 输出学习主题与资源 JSON
 * 使用 AI 语义匹配本地 knowledge-index.json
 */
const fs   = require('fs');
const path = require('path');
const { callAI } = require('./_lib/callAI');

// ── 加载本地知识库索引（启动时加载一次） ──────────────────
const INDEX_PATH = path.resolve(__dirname, 'knowledge-index.json');
let cacheRecords = null;

function loadRecords() {
  if (cacheRecords) return cacheRecords;
  try {
    const data = JSON.parse(fs.readFileSync(INDEX_PATH, 'utf8'));
    cacheRecords = data.records || [];
    console.log(`[Step3] 知识库索引已加载，${cacheRecords.length} 条记录`);
  } catch (e) {
    console.error('[Step3] 索引加载失败：', e.message);
    cacheRecords = [];
  }
  return cacheRecords;
}

// ── 构建发给 AI 的知识库资源列表（轻量，只有 title+category+type） ──
function buildResourceList(records) {
  return records.map(r => ({
    title:    r.title || '',
    category: r.category || '',
    type:     r.type || 'html',
  }));
}

// ── AI 语义匹配：一次调用为所有主题匹配资源 ────────────────
async function matchResourcesByAI(jobRole, learningThemes, records) {
  const resourceList = buildResourceList(records);

  const prompt = `你是 GrowthLoop 的成长资源顾问。

## 成长主题列表
${JSON.stringify(learningThemes, null, 2)}

## 知识库资源列表（共 ${resourceList.length} 条）
${JSON.stringify(resourceList, null, 2)}

## 任务
为每个成长主题，从上述知识库资源中选出最相关的 3~5 条。

## 匹配原则
- 根据资源 title 和 category 的语义判断相关性，不要求关键词完全一致
- 优先选能真正帮助成长的资源（方法论 > 实战经验 > 案例复盘 > 职业成长 > 补充阅读）
- 每个主题的资源类型尽量多样化
- 如果某个主题确实没有相关资源，返回空数组 []

## 输出格式
严格输出 JSON 数组，每个元素对应一个成长主题，顺序与输入一致：
[
  {
    "theme": "成长主题名（与输入完全一致）",
    "resources": [
      {
        "type": "方法论" | "实战经验" | "案例复盘" | "职业成长" | "补充阅读",
        "title": "资源标题（必须与知识库中的 title 完全一致）",
        "summary": "一句话描述资源内容（20字以内）",
        "learningValue": "候选人为什么值得读这个资源（30字以内）"
      }
    ]
  }
]

除 JSON 外不要输出任何解释。`;

  try {
    const result = await callAI(prompt, { maxTokens: 4096, expectJSON: true });
    return result; // 期望是数组
  } catch (e) {
    console.error('[Step3] AI 语义匹配失败：', e.message);
    return null;
  }
}

// ── 兜底：关键词粗筛（AI 失败时使用） ─────────────────────
function fallbackKeywordMatch(learningThemes, records) {
  const results = [];
  for (const theme of learningThemes) {
    const keywords = (theme.searchKeywords || []).map(k => k.toLowerCase());
    const matched = [];
    for (const r of records) {
      const text = (r.title + r.category).toLowerCase();
      if (keywords.some(k => text.includes(k))) {
        matched.push({
          type:         r.type === 'pdf' ? '补充阅读' : '实战经验',
          title:        r.title,
          summary:      (r.content || '').slice(0, 60).replace(/\s+/g, ' ') + '...',
          learningValue: '与' + theme.theme + '相关，建议阅读',
        });
      }
      if (matched.length >= 5) break;
    }
    results.push({
      theme:     theme.theme,
      resources: matched.length > 0 ? matched : [{
        type:         '补充阅读',
        title:        '待补充：' + theme.theme,
        summary:      '请在知识库中补充相关学习资源',
        learningValue: '',
      }],
    });
  }
  return results;
}

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
    if (tagText.match(/好奇|探索|主动|自驱/))     searchKeywords = ['实习', '成长', '主动'];
    else if (tagText.match(/结构化|逻辑|拆解|分析/)) searchKeywords = ['拆解', '分析', '规划'];
    else if (tagText.match(/跨界|整合|协作/))       searchKeywords = ['协作', '整合', '团队'];
    else if (tagText.match(/同理|用户|产品/))       searchKeywords = ['用户', '产品', '产品经理'];
    else if (tagText.match(/代码|技术|AI|算法/))    searchKeywords = ['技术', 'AI', '开发'];
    else if (tagText.match(/HR|人力|培训|学习/))    searchKeywords = ['HR', '培训', '成长'];
    else if (tagText.match(/表达|沟通|商业|方案/))  searchKeywords = ['表达', '沟通', '商业'];
    else if (tagText.match(/设计|创意|UI|UX/))      searchKeywords = ['设计', '创意', 'UI'];
    else if (tagText.match(/项目|推进|落地/))       searchKeywords = ['项目', '推进', '落地'];
    else searchKeywords = [(tag.tag || '校招').slice(0, 4), '实习', '校招'];

    return {
      theme:         tag.tag || tag,
      description:   tag.reason || `在"${tag.tag || tag}"方向上持续成长`,
      searchKeywords,
    };
  });

  const records = loadRecords();

  // 尝试 AI 语义匹配
  let matchedThemes = null;
  if (records.length > 0) {
    console.log('[Step3] 开始 AI 语义匹配，知识库 ' + records.length + ' 条记录');
    matchedThemes = await matchResourcesByAI(jobRole, learningThemes, records);
  }

  // AI 失败或返回格式异常，降级到关键词匹配
  if (!Array.isArray(matchedThemes) || matchedThemes.length !== learningThemes.length) {
    console.log('[Step3] AI 匹配失败/格式异常，降级到关键词匹配');
    matchedThemes = fallbackKeywordMatch(learningThemes, records);
  }

  // 组装最终输出
  const resultThemes = matchedThemes.map((mt, i) => ({
    theme:         mt.theme || learningThemes[i].theme,
    description:   learningThemes[i].description,
    searchKeywords: learningThemes[i].searchKeywords,
    resources:     (mt.resources || []).slice(0, 5),
    knowledgeBase: {
      name: '腾讯校园招聘知识库（本地索引）',
      url:  '',
    },
  }));

  console.log('[Step3] 完成，共 ' + resultThemes.length + ' 个主题');
  return res.status(200).json({ jobRole, learningThemes: resultThemes });
};
