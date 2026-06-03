/**
 * 统一 AI 调用封装
 * 自动识别 API Key 类型：
 *   sk-ant-...  → Anthropic API
 *   其他        → OpenAI 兼容 API
 */

const fetch = globalThis.fetch; // Node 18+ 内置

async function callAI(prompt, options = {}) {
  const apiKey     = process.env.OPENAI_API_KEY;
  const baseURL    = (process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1').replace(/\/+$/, '');
  const model      = process.env.AI_MODEL || '';
  const maxTokens  = options.maxTokens || 4096;
  const expectJSON = options.expectJSON !== false;

  if (!apiKey) throw new Error('缺少 OPENAI_API_KEY 环境变量');

  // ── Anthropic API ─────────────────────────────────────────────
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
      method: 'POST',
      headers: {
        'x-api-key':       apiKey,
        'anthropic-version': '2023-06-01',
        'Content-Type':    'application/json',
      },
      body: JSON.stringify(body),
    });

    const data = await res.json();
    if (!res.ok) {
      throw new Error('Anthropic API 错误 (' + res.status + '): ' + (data.error?.message || JSON.stringify(data)));
    }

    const text = data.content?.[0]?.text || '';
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    const jsonStr   = jsonMatch ? jsonMatch[0] : text;
    return JSON.parse(jsonStr);
  }

  // ── OpenAI 兼容 API ───────────────────────────────────────────
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
  });

  const data = await res.json();
  if (!res.ok) {
    throw new Error('AI API 错误 (' + res.status + '): ' + (data.error?.message || JSON.stringify(data)));
  }

  return JSON.parse(data.choices[0].message.content);
}

module.exports = { callAI };
