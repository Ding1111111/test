/**
 * rag-search.js
 * 轻量 RAG 搜索模块（无外部向量库）
 * 
 * 流程：
 * 1. 把 query 转成向量（OpenAI embedding）
 * 2. 余弦相似度召回 Top20
 * 3. 让 AI 从 Top20 中重排 Top3
 * 4. 输出格式保持 learningThemes 不变
 */

const fs = require('fs');
const path = require('path');

const RAG_INDEX_FILE = path.resolve(__dirname, 'knowledge-rag.json');

// ── 工具函数 ─────────────────────────────────────────────

function getOpenAIKey() {
  return process.env.OPENAI_API_KEY || '';
}

// 调用 OpenAI Embedding API
async function getEmbedding(text) {
  const apiKey = getOpenAIKey();
  if (!apiKey) throw new Error('缺少 OPENAI_API_KEY 环境变量');
  
  const truncated = text.slice(0, 8000);
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  
  try {
    const response = await fetch('https://api.openai.com/v1/embeddings', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'text-embedding-3-small',
        input: truncated,
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Embedding API 错误 ${response.status}: ${err}`);
    }
    
    const data = await response.json();
    return data.data[0].embedding; // 1536 维向量
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

// 余弦相似度
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

// 加载 RAG 索引
function loadRAGIndex() {
  if (!fs.existsSync(RAG_INDEX_FILE)) {
    throw new Error(`RAG 索引文件不存在: ${RAG_INDEX_FILE}\n请先运行: node api/build-rag-index.js`);
  }
  return JSON.parse(fs.readFileSync(RAG_INDEX_FILE, 'utf8'));
}

// ── 向量召回 Top20 ──────────────────────────────────────

async function vectorRecall(queryEmbedding, ragIndex, topK = 20) {
  const scores = [];
  
  for (const record of ragIndex.records) {
    if (!record.chunkEmbeddings) continue;
    
    // 找该资源的最佳 chunk 匹配
    let bestScore = -1;
    let bestChunkIdx = -1;
    
    for (let i = 0; i < record.chunkEmbeddings.length; i++) {
      const emb = record.chunkEmbeddings[i];
      if (!emb) continue; // null 占位符
      const score = cosineSimilarity(queryEmbedding, emb);
      if (score > bestScore) {
        bestScore = score;
        bestChunkIdx = i;
      }
    }
    
    if (bestScore > -1) {
      scores.push({
        record,
        score: bestScore,
        bestChunkIdx,
      });
    }
  }
  
  // 按相似度降序排列，取 TopK
  scores.sort((a, b) => b.score - a.score);
  return scores.slice(0, topK);
}

// ── AI 重排 Top3 ────────────────────────────────────────

async function aiRerank(queryInfo, candidates, callAI) {
  // queryInfo: { theme, description, searchKeywords, growthTagReason }
  // candidates: vectorRecall 返回的 Top20
  
  const prompt = `你是一个校招资源推荐专家。请根据候选资源列表，为指定学习主题选出最相关的 3 个资源。

## 学习主题信息
- 主题：${queryInfo.theme}
- 描述：${queryInfo.description || '无'}
- 搜索关键词：${(queryInfo.searchKeywords || []).join('、')}
- 候选人表现：${queryInfo.growthTagReason || '无'}

## 候选资源（Top20，按向量相似度排序）
${candidates.map((c, i) => `${i+1}. [${c.record.id}] ${c.record.title}\n   分类：${c.record.category}\n   摘要：${c.record.summary || '无'}\n   学习价值：${c.record.learningValue || '无'}\n   适合人群：${c.record.suitableFor || '无'}\n   向量相似度：${(c.score * 100).toFixed(1)}%\n`).join('\n')}

## 要求
请从以上 ${candidates.length} 个候选资源中，选出与学习主题「${queryInfo.theme}」最相关的 3 个资源。

选择标准：
1. 内容主题与学习主题高度相关
2. 适合该候选人的成长阶段
3. 资源质量高、可操作性强

## 输出格式（严格 JSON）
{
  "selected": [
    {
      "id": "资源ID（从候选资源中选）",
      "relevanceScore": "相关性评分 1-10",
      "matchReason": "为什么这个资源适合这个学习主题（50字以内）"
    }
  ]
}

只输出 JSON，不要输出其他内容。`;

  try {
    const result = await callAI(prompt, { expectJSON: true, maxTokens: 1000 });
    return JSON.parse(result).selected || [];
  } catch (e) {
    console.error('  ⚠️ AI 重排失败，使用向量相似度排序:', e.message);
    // 降级：直接用向量相似度取 Top3
    return candidates.slice(0, 3).map(c => ({
      id: c.record.id,
      relevanceScore: Math.round(c.score * 10),
      matchReason: `向量相似度 ${(c.score * 100).toFixed(1)}%`,
    }));
  }
}

// ── 主入口：为单个 learningTheme 搜索资源 ─────────────

async function searchResourcesForTheme(theme, ragIndex, callAI) {
  // 构造 query（用 theme + description + searchKeywords + growthTagReason）
  const queryText = [
    theme.theme || '',
    theme.description || '',
    (theme.searchKeywords || []).join(' '),
    theme.growthTagReason || '',
  ].filter(Boolean).join(' ');
  
  console.log(`  🔍 查询: ${theme.theme}`);
  
  // 1. query 转向量
  let queryEmbedding;
  try {
    queryEmbedding = await getEmbedding(queryText);
    console.log(`  ✅ 向量生成成功`);
  } catch (e) {
    console.error(`  ❌ 向量生成失败: ${e.message}`);
    throw e;
  }
  
  // 2. 向量召回 Top20
  const top20 = await vectorRecall(queryEmbedding, ragIndex, 20);
  console.log(`  📊 向量召回 ${top20.length} 个候选（Top20）`);
  
  if (top20.length === 0) {
    console.log(`  ⚠️ 无候选资源`);
    return { resources: [], summary: `${theme.theme}暂无相关学习资源，建议持续关注该方向的实践机会。` };
  }
  
  // 3. AI 重排 Top3
  const queryInfo = {
    theme: theme.theme || '',
    description: theme.description || '',
    searchKeywords: theme.searchKeywords || [],
    growthTagReason: theme.growthTagReason || '',
  };
  
  const top3 = await aiRerank(queryInfo, top20, callAI);
  console.log(`  🏆 AI 重排完成，选出 ${top3.length} 个资源`);
  
  // 4. 组装输出（格式保持与原来一致）
  const resources = top3.map(item => {
    const record = ragIndex.records.find(r => r.id === item.id);
    if (!record) return null;
    
    return {
      title: record.title,
      type: record.type || 'html',
      path: record.path || '',
      summary: record.summary || '',
      learningValue: record.learningValue || '',
      suitableFor: record.suitableFor || '',
      relevanceScore: item.relevanceScore || 5,
      matchReason: item.matchReason || '',
      keywords: record.keywords || [],
    };
  }).filter(Boolean);
  
  // 生成 summary
  let summary = '';
  if (resources.length > 0) {
    summary = `基于「${theme.theme}」主题，推荐 ${resources.map(r => r.title).join('、')} 等 ${resources.length} 个学习资源，涵盖${theme.description || '相关'}方向。`;
  } else {
    summary = `${theme.theme}暂无相关学习资源，建议持续关注该方向的实践机会。`;
  }
  
  return { resources, summary };
}

// ── 批量处理所有 learningThemes ────────────────────────

async function ragSearch(learningThemes, callAI) {
  console.log(`\n=== RAG 搜索开始（${learningThemes.length} 个主题）===\n`);
  
  const ragIndex = loadRAGIndex();
  console.log(`  📚 已加载 RAG 索引（${ragIndex.total} 个资源，${ragIndex.embeddingDim} 维向量）\n`);
  
  const results = [];
  
  for (let i = 0; i < learningThemes.length; i++) {
    const theme = learningThemes[i];
    console.log(`[${i+1}/${learningThemes.length}] 处理主题: ${theme.theme || '未知'}`);
    
    try {
      const { resources, summary } = await searchResourcesForTheme(theme, ragIndex, callAI);
      
      results.push({
        ...theme,
        resources,
        summary,
      });
      
      console.log(`  ✅ 完成（${resources.length} 个资源）\n`);
    } catch (e) {
      console.error(`  ❌ 失败: ${e.message}\n`);
      // 降级：返回空资源
      results.push({
        ...theme,
        resources: [],
        summary: `${theme.theme}资源匹配失败，请稍后重试。`,
      });
    }
  }
  
  console.log(`=== RAG 搜索完成 ===\n`);
  return results;
}

module.exports = { ragSearch, loadRAGIndex, getEmbedding };
