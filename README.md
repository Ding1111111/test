# GrowthLoop Web — 四步流水线

将 `jd-behavior-observer` → `growthloop-tag-generator` → `growthloop-resource-finder` → `growthloop-candidate-report` 四个 Skill 串联成可在线使用的 Web 工具。

---

## 快速开始

### 1. 安装依赖（仅本地开发需要）

```bash
cd growthloop-web
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env.local
# 编辑 .env.local，填入：
# - OPENAI_API_KEY  （必填，去 https://platform.openai.com/api-keys 申请）
# - IMA_CLIENT_ID / IMA_API_KEY（已在 .env.local 中填好，无需修改）
```

### 3. 本地运行

```bash
npx vercel dev
# 浏览器打开 http://localhost:3000
```

---

## 部署到 Vercel（让别人也能用）

### 第一步：推送到 Git

```bash
git init
git add .
git commit -m "init: GrowthLoop Web"
git remote add origin https://github.com/你的用户名/growthloop-web.git
git push -u origin main
```

### 第二步：Vercel 导入项目

1. 打开 https://vercel.com/new
2. 选择你的 Git 仓库
3. 默认设置，点 **Deploy**

### 第三步：在 Vercel 配置环境变量

进入项目 → **Settings** → **Environment Variables** → 添加以下变量：

| 变量名 | 说明 | 获取方式 |
|---|---|---|
| `OPENAI_API_KEY` | AI 模型 API Key | https://platform.openai.com/api-keys |
| `OPENAI_BASE_URL` | AI API 地址（可选，默认 OpenAI） | 如果用通义/混元等填对应地址 |
| `AI_MODEL` | 模型名（可选，默认 `gpt-4o-mini`） | — |
| `IMA_CLIENT_ID` | IMA 知识库 Client ID | 已提供，直接填 `854077b5...` |
| `IMA_API_KEY` | IMA 知识库 API Key | 已提供，直接填 `I3O0DE9n...` |
| `IMA_BASE_URL` | IMA API 地址（可选，默认 `https://ima.qq.com`） | — |
| `IMA_KNOWLEDGE_BASE_ID` | 指定知识库 ID（可选，留空则全站搜索） | — |

配置完成后重新 Deploy 即可。

---

## 目录结构

```
growthloop-web/
├── index.html          # 前端页面（四步流水线交互）
├── api/
│   ├── step1.js      # jd-behavior-observer
│   ├── step2.js      # growthloop-tag-generator
│   ├── step3.js      # growthloop-resource-finder（含 IMA 真实调用）
│   └── step4.js     # growthloop-candidate-report
├── package.json
├── vercel.json
├── .env.example      # 环境变量模板
├── .env.local        # 本地开发用（不提交）
└── .gitignore        # 禁止提交 .env.local
```

---

## 四步说明

| 步骤 | Skill | 输入 | 输出 |
|---|---|---|---|
| Step 1 | jd-behavior-observer | 岗位 JD 文本 | `jobRole` + `focusBehaviors` |
| Step 2 | growthloop-tag-generator | 会议纪要 + Step1 结果 | `positiveTags` + `growthTags` |
| Step 3 | growthloop-resource-finder | Step2 成长标签 | `learningThemes`（含 IMA 知识库真实资源） |
| Step 4 | growthloop-candidate-report | 候选人信息 + 全部前序数据 | 完整成长纪念册 JSON |

---

## 注意事项

- **OPENAI_API_KEY 必填**，否则 Step 1-4 全部无法运行
- **IMA 凭证已配置**，Step3 会自动调用腾讯校园招聘知识库搜索真实资源
- `.env.local` 已加入 `.gitignore`，不会被提交到 Git
- 如果用通义/混元等兼容 OpenAI 格式的 API，修改 `OPENAI_BASE_URL` 和 `AI_MODEL` 即可
