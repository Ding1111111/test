const fs = require('fs');
const path = require('path');

// Knowledge 文件夹路径（macOS）
const KNOWLEDGE_DIR = '/Users/dingding/.workbuddy/knowledge-base/Knowledge';
const OUTPUT_FILE = path.resolve(__dirname, 'knowledge-index.json');

// 递归收集所有文件
function walkDir(dir) {
  let results = [];
  const list = fs.readdirSync(dir);
  list.forEach(file => {
    const fullPath = path.join(dir, file);
    const stat = fs.statSync(fullPath);
    if (stat && stat.isDirectory()) {
      results = results.concat(walkDir(fullPath));
    } else {
      results.push(fullPath);
    }
  });
  return results;
}

// 从 HTML 提取纯文本（改进版）
function extractTextFromHtml(html) {
  // 去掉 script 和 style 标签及其内容
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
  // 去掉所有 HTML 标签
  text = text.replace(/<[^>]+>/g, ' ');
  // 解码 HTML 实体
  text = text.replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#\d+;/g, ''); // 去掉其他数字实体
  // 合并空白字符
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

// 从文件路径推断分类
function getCategory(filePath) {
  const relativePath = filePath.replace(KNOWLEDGE_DIR, '');
  const parts = relativePath.split(path.sep).filter(Boolean);
  if (parts.length >= 2) {
    return parts[0]; // 第一层文件夹名作为分类
  }
  return '未分类';
}

// 主函数
async function buildIndex() {
  console.log('开始扫描 Knowledge 文件夹...');
  console.log('路径:', KNOWLEDGE_DIR);

  const allFiles = walkDir(KNOWLEDGE_DIR);
  console.log(`共找到 ${allFiles.length} 个文件`);

  const records = [];
  let htmlCount = 0;
  let pdfCount = 0;
  let otherCount = 0;

  allFiles.forEach(filePath => {
    const ext = path.extname(filePath).toLowerCase();
    const fileName = path.basename(filePath, ext);
    const relativePath = filePath.replace(KNOWLEDGE_DIR, '').replace(/^\//, '');
    const category = getCategory(filePath);

    if (ext === '.html' || ext === '.htm') {
      try {
        const html = fs.readFileSync(filePath, 'utf8');
        const content = extractTextFromHtml(html);

        records.push({
          title: fileName,
          path: relativePath,
          type: 'html',
          category: category,
          content: content.slice(0, 2000), // 前2000字
          contentLength: content.length
        });
        htmlCount++;
      } catch (e) {
        console.error(`读取失败: ${filePath}`, e.message);
      }
    } else if (ext === '.pdf') {
      records.push({
        title: fileName,
        path: relativePath,
        type: 'pdf',
        category: category,
        content: '',
        contentLength: 0
      });
      pdfCount++;
    } else {
      otherCount++;
    }
  });

  const result = {
    total: records.length,
    generatedAt: new Date().toISOString(),
    records: records
  };

  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(result, null, 2), 'utf8');

  console.log('\n索引生成完成！');
  console.log(`HTML 文件: ${htmlCount} 个`);
  console.log(`PDF 文件: ${pdfCount} 个`);
  console.log(`其他文件: ${otherCount} 个`);
  console.log(`总记录数: ${records.length}`);
  console.log(`索引文件: ${OUTPUT_FILE}`);
  console.log(`文件大小: ${(fs.statSync(OUTPUT_FILE).size / 1024 / 1024).toFixed(2)} MB`);

  // 统计有正文的记录数
  const withContent = records.filter(r => r.contentLength > 50);
  console.log(`\n有正文内容（>50字）的记录: ${withContent.length} 条`);

  // 显示前3条示例
  console.log('\n前3条记录示例:');
  records.slice(0, 3).forEach((r, i) => {
    console.log(`[${i+1}] ${r.title}`);
    console.log(`    分类: ${r.category}`);
    console.log(`    正文长度: ${r.contentLength} 字`);
    console.log(`    正文前100字: ${r.content.slice(0, 100)}`);
    console.log('');
  });
}

buildIndex();
