/**
 * build-rag-index.js
 * 轻量 RAG 知识库预处理脚本
 * 
 * 功能：
 * 1. 扫描 Knowledge/ 下全部 HTML/PDF 文件
 * 2. 提取正文
 * 3. 用 AI 生成资源卡（title, summary, learningValue, suitableFor, keywords）
 * 4. 将正文按 500-800 字切片
 * 5. 使用 title+summary+learningValue+suitableFor+chunkContent 生成 embedding
 * 6. 保存为 knowledge-rag.json
 * 
 * 用法：node api/build-rag-index.js
 * 需要：OPENAI_API_KEY 环境变量（OpenAI text-embedding-3-small）
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const { JSDOM } = require('jsdom');
const { execSync } = require('child_process');

// 手动加载 .env.local（兼容无 dotenv 的情况）
try {
  const envFile = fs.readFileSync(path.resolve(__dirname, '..', '.env.local'), 'utf8');
  for (const line of envFile.split('\n')) {
    const [k, ...v] = line.split('=');
    if (k && v.length) process.env[k.trim()] = v.join('=').trim();
  }
} catch (e) { /* 忽略 */ }

const KNOWLEDGE_DIR = '/Users/dingding/.workbuddy/knowledge-base/Knowledge';
const OUTPUT_FILE = path.resolve(__dirname, 'knowledge-rag.json');
const EMBEDDING_MODEL = 'text-embedding-3-small';
const CHUNK_SIZE_MIN = 500;
const CHUNK_SIZE_MAX = 800;

// ── 工具函数 ──────────────────────────────────────────────

function getOpenAIKey() {
  return process.env.OPENAI_API_KEY || '';
}

// 调用 OpenAI Chat API（用于生成资源卡）
async function callOpenAIChat(prompt) {
  const apiKey = getOpenAIKey();
  if (!apiKey) throw new Error('缺少 OPENAI_API_KEY 环境变量');
  
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  
  try {
    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        messages: [{ role: 'user', content: prompt }],
        temperature: 0.3,
        response_format: { type: 'json_object' },
      }),
      signal: controller.signal,
    });
    clearTimeout(timeout);
    
    if (!response.ok) {
      const err = await response.text();
      throw new Error(`OpenAI Chat API 错误 ${response.status}: ${err}`);
    }
    
    const data = await response.json();
    return data.choices[0].message.content;
  } catch (e) {
    clearTimeout(timeout);
    throw e;
  }
}

// 调用 OpenAI Embedding API
async function getEmbedding(text) {
  const apiKey = getOpenAIKey();
  if (!apiKey) throw new Error('缺少 OPENAI_API_KEY 环境变量');
  
  // 截断到 8192 tokens 以内（text-embedding-3-small 的限制）
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
        model: EMBEDDING_MODEL,
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

// 提取 HTML 纯文本
function extractTextFromHTML(htmlPath) {
  try {
    const html = fs.readFileSync(htmlPath, 'utf8');
    // 去掉 script/style
    let text = html.replace(/<script[^>]*>.*?<\/script>/gis, ' ');
    text = text.replace(/<style[^>]*>.*?<\/style>/gis, ' ');
    // 去掉所有 HTML 标签
    text = text.replace(/<[^>]+>/g, ' ');
    // 解码 HTML 实体
    text = text.replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&mdash;/g, '—')
      .replace(/&hellip;/g, '…');
    // 合并空白
    text = text.replace(/\s+/g, ' ').trim();
    return text;
  } catch (e) {
    return '';
  }
}

// 提取 PDF 纯文本（使用 Python pymupdf）
async function extractTextFromPDF(pdfPath) {
  try {
    const scriptPath = path.resolve(__dirname, 'extract-pdf-text.py');
    const pythonPath = '/Users/dingding/.workbuddy/binaries/python/versions/3.13.12/bin/python3';
    // execSync 同步调用，stdout 即为提取的文本
    const stdout = execSync(`"${pythonPath}" "${scriptPath}" "${pdfPath}"`, {
      encoding: 'utf8',
      timeout: 30000, // 30秒超时
      maxBuffer: 10 * 1024 * 1024, // 10MB 输出缓冲
    });
    const text = (stdout || '').replace(/\s+/g, ' ').trim();
    return text;
  } catch (e) {
    console.error(`  ⚠️ PDF 解析失败: ${path.basename(pdfPath)} - ${e.message}`);
    return '';
  }
}

      // 从文件路径推断分类
      function inferCategory(filePath) {
        const relativePath = path.relative(KNOWLEDGE_DIR, filePath);
        const parts = relativePath.split(path.sep);
        if (parts.length > 1) {
          // 用第一层文件夹名作为分类
          return parts[0];
        }
        return '校招通用';
      }

// 智能切片（500-800字，优先在标点处切）
function chunkText(text, minSize = CHUNK_SIZE_MIN, maxSize = CHUNK_SIZE_MAX) {
  if (text.length <= maxSize) return [text];
  
  const chunks = [];
  let start = 0;
  
  while (start < text.length) {
    if (start + maxSize >= text.length) {
      chunks.push(text.slice(start));
      break;
    }
    
    // 在 minSize~maxSize 之间找标点切
    let end = start + maxSize;
    const searchStart = Math.max(start + minSize, start + Math.floor(minSize * 0.8));
    let bestEnd = -1;
    
    for (let i = end; i >= searchStart; i--) {
      const ch = text[i];
      if (ch === '。' || ch === '！' || ch === '？' || ch === '\n') {
        bestEnd = i + 1;
        break;
      }
    }
    
    if (bestEnd === -1) {
      // 找不到标点，强制在 maxSize 处切
      bestEnd = start + maxSize;
    }
    
    chunks.push(text.slice(start, bestEnd).trim());
    start = bestEnd;
  }
  
  return chunks.filter(c => c.length > 50); // 过滤太短的碎片
}

// 用 AI 生成资源卡（summary, learningValue, suitableFor, keywords）
async function generateResourceCard(title, content, category) {
  const prompt = `你是一个校招知识库的资源整理专家。请根据以下内容，生成结构化的资源卡信息。

资源标题：${title}
资源分类：${category}
资源正文（前3000字）：${content.slice(0, 3000)}

请严格按照以下 JSON 格式输出（不要输出其他内容）：
{
  "summary": "用1-2句话概括这个资源的核心内容（50字以内）",
  "learningValue": "这个资源对校招候选人有什么学习价值（80字以内）",
  "suitableFor": "适合哪类候选人（如：准备面试的产品经理方向候选人，50字以内）",
  "keywords": ["关键词1", "关键词2", "关键词3"]
}

要求：
- summary 要简洁准确
- learningValue 要结合校招/成长的视角
- suitableFor 要具体，不要写"所有人"
- keywords 3-5个，覆盖主题和适用场景
`;

  try {
    const result = await callOpenAIChat(prompt);
    const parsed = JSON.parse(result);
    return {
      summary: parsed.summary || '',
      learningValue: parsed.learningValue || '',
      suitableFor: parsed.suitableFor || '',
      keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
    };
  } catch (e) {
    console.error(`  ⚠️ 生成资源卡失败: ${e.message}`);
    return { summary: '', learningValue: '', suitableFor: '', keywords: [] };
  }
}

// ── 主流程 ────────────────────────────────────────────────

async function main() {
  const LIMIT = process.env.LIMIT ? parseInt(process.env.LIMIT) : Infinity;
  console.log('=== RAG 知识库预处理开始 ===');
  if (LIMIT < Infinity) console.log(`⚠️  限制模式：只处理前 ${LIMIT} 个文件\n`);
  
  if (!getOpenAIKey()) {
    console.error('❌ 错误：未找到 OPENAI_API_KEY 环境变量');
    console.error('请设置后再运行：export OPENAI_API_KEY=sk-...');
    process.exit(1);
  }
  
  // 1. 扫描所有文件
  console.log('[1/5] 扫描知识库文件...');
  let files = [];
  
  function walkDir(dir) {
    const items = fs.readdirSync(dir, { withFileTypes: true });
    for (const item of items) {
      const fullPath = path.join(dir, item.name);
      if (item.isDirectory()) {
        walkDir(fullPath);
      } else if (item.name.endsWith('.html') || item.name.endsWith('.htm')) {
        files.push(fullPath);
      } else if (item.name.endsWith('.pdf')) {
        files.push(fullPath);
      }
    }
  }
  
  walkDir(KNOWLEDGE_DIR);
  files = files.slice(0, LIMIT);
  const htmlCount = files.filter(f => f.endsWith('.html') || f.endsWith('.htm')).length;
  const pdfCount = files.filter(f => f.endsWith('.pdf')).length;
  console.log(`  找到 ${files.length} 个文件（HTML: ${htmlCount}，PDF: ${pdfCount}）\n`);
  
  // 2. 处理每个文件
  console.log('[2/5] 提取正文 + 生成资源卡...');
  const records = [];
  
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const relativePath = path.relative(KNOWLEDGE_DIR, file);
    const ext = path.extname(file).toLowerCase();
    const baseName = path.basename(file, ext);
    const title = baseName.replace(/_/g, ' ');
    const category = inferCategory(file);

    let content = '';
    if (ext === '.pdf') {
      console.log(`  📄 PDF 文件，使用文件名+分类作为内容...`);
      // PDF 文本提取较困难，直接用文件名 + 分类作为语义内容
      content = baseName.replace(/-/g, ' ') + ' ' + category;
    } else {
      content = extractTextFromHTML(file);
    }
    
    console.log(`  [${i+1}/${files.length}] ${title.slice(0, 40)}...`);
    
    // 生成资源卡（调 AI）
    const card = await generateResourceCard(title, content, category);
    
    const fileType = ext === '.pdf' ? 'pdf' : 'html';
    records.push({
      id: `res-${String(i).padStart(4, '0')}`,
      title,
      category,
      type: fileType,
      path: relativePath,
      // 资源卡字段
      summary: card.summary,
      learningValue: card.learningValue,
      suitableFor: card.suitableFor,
      keywords: card.keywords,
      // 正文切片
      contentLength: content.length,
      chunks: chunkText(content),
    });
    
    // 每处理 10 个文件保存一次（防止中断丢失进度）
    if ((i + 1) % 10 === 0) {
      const intermediate = {
        version: '1.0',
        model: EMBEDDING_MODEL,
        generatedAt: new Date().toISOString(),
        total: records.length,
        records: records.map(r => ({ ...r, chunkEmbeddings: undefined })), // 暂时不存向量
      };
      fs.writeFileSync(OUTPUT_FILE + '.tmp', JSON.stringify(intermediate, null, 2));
      console.log(`  💾 已保存中间结果（${records.length} 条）`);
    }
    
    // 限速：避免 OpenAI API 限流
    await new Promise(r => setTimeout(r, 300));
  }
  
  console.log(`\n  共处理 ${records.length} 个资源\n`);
  
  // 3. 为所有 chunk 生成 embedding
  console.log('[3/5] 生成向量嵌入（Embedding）...');
  let totalChunks = 0;
  let embeddingCount = 0;
  
  for (const record of records) {
    totalChunks += record.chunks.length;
  }
  console.log(`  共 ${totalChunks} 个文本切片需要生成向量\n`);
  
  for (let i = 0; i < records.length; i++) {
    const record = records[i];
    console.log(`  [${i+1}/${records.length}] ${record.title.slice(0, 40)}（${record.chunks.length} 个切片）`);
    
    record.chunkEmbeddings = [];
    for (let j = 0; j < record.chunks.length; j++) {
      const chunk = record.chunks[j];
      // 用 title + summary + learningValue + suitableFor + chunk 前200字 生成 embedding
      const embeddingText = [
        record.title,
        record.summary,
        record.learningValue,
        record.suitableFor,
        chunk.slice(0, 200)
      ].filter(Boolean).join(' ');
      
      try {
        const embedding = await getEmbedding(embeddingText);
        record.chunkEmbeddings.push(embedding);
        embeddingCount++;
        
        if (embeddingCount % 20 === 0) {
          console.log(`    ✅ 已生成 ${embeddingCount}/${totalChunks} 个向量`);
        }
      } catch (e) {
        console.error(`    ❌ 切片 ${j} embedding 失败: ${e.message}`);
        record.chunkEmbeddings.push(null); // 用 null 占位
      }
      
      // 限速：OpenAI embedding 限流较宽松，但保守一点
      await new Promise(r => setTimeout(r, 100));
    }
  }
  
  console.log(`\n  共生成 ${embeddingCount} 个向量\n`);
  
  // 4. 保存最终结果
  console.log('[4/5] 保存向量库...');
  const output = {
    version: '1.0',
    model: EMBEDDING_MODEL,
    embeddingDim: 1536, // text-embedding-3-small 的维度
    generatedAt: new Date().toISOString(),
    total: records.length,
    records: records.map(r => ({
      id: r.id,
      title: r.title,
      category: r.category,
      type: r.type,
      path: r.path,
      summary: r.summary,
      learningValue: r.learningValue,
      suitableFor: r.suitableFor,
      keywords: r.keywords,
      contentLength: r.contentLength,
      chunkCount: r.chunks.length,
      chunks: r.chunks, // 保留切片文本
      chunkEmbeddings: r.chunkEmbeddings, // 向量（可能包含 null）
    })),
  };
  
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2));
  console.log(`  ✅ 已保存到 ${OUTPUT_FILE}`);
  console.log(`  文件大小: ${(fs.statSync(OUTPUT_FILE).size / 1024 / 1024).toFixed(2)} MB\n`);
  
  // 5. 清理临时文件
  const tmpFile = OUTPUT_FILE + '.tmp';
  if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
  
  console.log('=== 预处理完成 ===');
  console.log(`总计：${records.length} 个资源，${totalChunks} 个文本切片，${embeddingCount} 个向量`);
}

main().catch(e => {
  console.error('❌ 预处理失败:', e.message);
  process.exit(1);
});
