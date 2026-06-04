/**
 * 预处理 Knowledge 文件夹 → 生成 knowledge-index.json 搜索索引
 * 用法: node build-knowledge-index.js
 */

const fs   = require('fs');
const path = require('path');

const KNOWLEDGE_DIR = '/Users/dingding/.workbuddy/knowledge-base/Knowledge';
const OUTPUT_FILE  = path.resolve(__dirname, 'knowledge-index.json');

// 简单提取 HTML 中的文本内容
function extractTextFromHTML(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 2000); // 每条最多保留 2000 字
}

// 从 HTML 提取 <title> 标签
function extractTitle(html, fallback) {
  const m = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  if (m && m[1].trim()) return m[1].trim();
  // 尝试 h1
  const h1 = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/i);
  if (h1 && h1[1].trim()) return h1[1].replace(/<[^>]+>/g, '').trim();
  return fallback;
}

function walkDir(dir) {
  const results = [];
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch (e) { return results; }

  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      results.push(...walkDir(full));
    } else if (entry.isFile()) {
      const ext = path.extname(entry.name).toLowerCase();
      const relativePath = path.relative(KNOWLEDGE_DIR, full).replace(/\\/g, '/');
      const category = relativePath.split('/')[0] || '未分类';
      results.push({ full, relativePath, ext, category });
    }
  }
  return results;
}

async function main() {
  console.log('[Index] 扫描 Knowledge 文件夹...');
  const files = walkDir(KNOWLEDGE_DIR);
  console.log(`[Index] 共发现 ${files.length} 个文件`);

  const records = [];

  for (const file of files) {
    const { relativePath, ext, category } = file;

    if (ext === '.html' || ext === '.htm') {
      try {
        const html    = fs.readFileSync(file.full, 'utf8');
        const title   = extractTitle(html, relativePath);
        const content = extractTextFromHTML(html);
        records.push({ title, content, path: relativePath, category, type: 'html' });
      } catch (e) {
        console.error(`[Index] 读取失败: ${relativePath}`, e.message);
      }
    } else if (ext === '.pdf') {
      // PDF 无法读取内容，只记录文件名
      const title = path.basename(file.relativePath, '.pdf');
      records.push({ title, content: '', path: relativePath, category, type: 'pdf' });
    } else if (ext === '.md' || ext === '.txt' || ext === '.csv') {
      try {
        const content = fs.readFileSync(file.full, 'utf8').slice(0, 2000);
        const title  = path.basename(file.relativePath);
        records.push({ title, content, path: relativePath, category, type: ext.slice(1) });
      } catch (e) {
        // skip
      }
    }
  }

  const output = { total: records.length, generatedAt: new Date().toISOString(), records };
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(output, null, 2), 'utf8');

  const stats = fs.statSync(OUTPUT_FILE);
  console.log(`[Index] 完成！输出 ${records.length} 条记录 → ${OUTPUT_FILE}`);
  console.log(`[Index] 文件大小: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
}

main().catch(e => { console.error('[Index] 错误:', e); process.exit(1); });
