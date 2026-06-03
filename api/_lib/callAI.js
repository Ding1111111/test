/**
 * 统一 AI 调用封装
 * 自动识别 API Key 类型：
 *   sk-ant-...  → Anthropic API
 *   其他        → OpenAI 兼容 API
 */

async function callAI(prompt, options = {}) {
  const apiKey     = process.env.ANTHROPIC_API_KEY || process.env.OPENAI_API_KEY || '';
  const baseURL    = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model      = process.env.AI_MODEL || '';
  const maxTokens  = options.maxTokens || 4096;
  const expectJSON = options.expectJSON !== false;

  if (!apiKey) throw new Error('缺少 ANTHROPIC_API_KEY 或 OPENAI_API_KEY 环境变量');

  // ── 超时控制（Vercel maxDuration - 10s 缓冲）──────────
  const controller = new AbortController();
  const timeoutId  = setTimeout(() => controller.abort(), 50000);

  try {

    // ── Anthropic API ────────────────────────────────────────
    if (apiKey.startsWith('sk-ant-')) {
      const anthropicModel = model || 'claude-sonnet-4-6';
      const anthropicURL  = 'https://api.anthropic.com/v1/messages';

      const body = {
        model:      anthropicModel,
        max_tokens: maxTokens,
        messages: [{ role: 'user', content: prompt }],
      };

      if (expectJSON) {
        body.system = 'You must respond with valid JSON only. No markdown fences, no explanations, no extra text.';
      }

      const res = await fetch(anthropicURL, {
        method:  'POST',
        headers: {
          'x-api-key':       apiKey,
          'anthropic-version': '2023-06-01',
          'Content-Type':    'application/json',
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      clearTimeout(timeoutId);
      const data = await res.json();

      if (!res.ok) {
        throw new Error('Anthropic API 错误 (' + res.status + '): ' + (data.error?.message || JSON.stringify(data)));
      }

      // 安全提取 text
      const firstBlock = Array.isArray(data.content) ? data.content[0] : null;
      const text = firstBlock?.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      const jsonStr   = jsonMatch ? jsonMatch[0] : text;
      return JSON.parse(jsonStr);
    }

    // ── OpenAI 兼容 API ───────────────────────────────────────
    const openaiModel = model || 'gpt-4o-mini';
    const res = await fetch(baseURL + '/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type':  'application/json',
        'Authorization': 'Bearer ' + apiKey,
      },
      body: JSON.stringify({
        model:           openaiModel,
        messages:        [{ role: 'user', content: prompt }],
        response_format: expectJSON ? { type: 'json_object' } : undefined,
      }),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);
    const data = await res.json();

    if (!res.ok) {
      throw new Error('AI API 错误 (' + res.status + '): ' + (data.error?.message || JSON.stringify(data)));
    }

    return JSON.parse(data.choices[0].message.content);

  } finally {
    clearTimeout(timeoutId);
  }
}

module.exports = { callAI };
