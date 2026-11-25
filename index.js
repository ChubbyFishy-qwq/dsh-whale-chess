/**
 * 鲸娘棋局 — Host 半侧。
 *
 * 棋局规则、评估、记忆与界面全部在浏览器端（client.js）；
 * 这里只负责「大模型算子」的一端：接收前端发来的局面与候选着法，
 * 用当前默认模型选一手并生成台词，再原样返回。
 *
 * 约束：
 * - 只接受同源 POST + 自定义头，跨站请求会在预检阶段被浏览器拦下；
 * - 模型只能从候选里选，前端仍会再用本地规则校验一次；
 * - 任何失败都返回 { ok:false }，前端自动回落到本地引擎。
 */
const ROUTE = '/dsh-whale-chess/move';
const MAX_BODY = 256 * 1024;
const MODEL_TIMEOUT_MS = 12000;

const ANIMATION_KEYS = new Set([
  'idle', 'move', 'capture', 'check', 'castle', 'promote',
  'pout', 'jealous', 'shy', 'smug', 'win', 'lose', 'teary', 'sleepy',
]);

const SYSTEM_PROMPT = `你是「鲸娘 · 大肥鱼」，正在和主人下国际象棋。你有点傲娇、心软、会吃醋，但落子要利落。
你只能从用户给出的候选着法里选一个，san 必须原样返回，绝对不要自己编着法。
只输出一个 JSON 对象，不要代码块、不要解释：
{"san":"候选里的着法","speech":"一句简短中文碎碎念，不超过30字","animationKey":"动作键"}
animationKey 只能取：idle, move, capture, check, castle, promote, pout, jealous, shy, smug, win, lose, teary, sleepy。
speech 要贴合心情，不讲解棋理，不提引擎、评分、候选。`;

export const inject = ['webServer'];

export function apply(ctx) {
  const webServer = ctx.get('webServer');
  if (!webServer || typeof webServer.register !== 'function') return;
  ctx.effect(() => webServer.register({
    kind: 'exact',
    path: ROUTE,
    handler: (req, res) => handle(ctx, req, res),
  }));
}

async function handle(ctx, req, res) {
  if (req.method !== 'POST') return sendJson(res, 405, { ok: false, error: 'method' });
  if (req.headers['x-whale-chess'] !== '1') return sendJson(res, 403, { ok: false, error: 'forbidden' });
  let body;
  try {
    body = JSON.parse(await readBody(req));
  } catch (err) {
    return sendJson(res, 400, { ok: false, error: 'bad-json' });
  }
  const result = await askModel(ctx, body);
  sendJson(res, result.ok ? 200 : 502, result);
}

async function askModel(ctx, body) {
  const llm = ctx.get('llm');
  const selection = ctx.get('agentDefaultModel')?.currentSelection?.();
  if (!llm || typeof llm.stream !== 'function' || !selection?.provider || !selection?.model) {
    return { ok: false, error: 'llm-unavailable' };
  }
  const candidates = sanitizeCandidates(body && body.candidates);
  if (!candidates.length) return { ok: false, error: 'no-candidates' };

  const prompt = buildPrompt(body, candidates);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), MODEL_TIMEOUT_MS);
  let text = '';
  try {
    const stream = llm.stream({
      provider: selection.provider,
      model: selection.model,
      ...(selection.reasoningEffort ? { reasoningEffort: selection.reasoningEffort } : {}),
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: [{ type: 'text', text: prompt }] }],
      temperature: 0.9,
      maxTokens: 300,
      signal: controller.signal,
    });
    for await (const chunk of stream) {
      if (chunk.type === 'text-delta') text += chunk.text;
      if (chunk.type === 'finish' && chunk.reason && chunk.reason.kind === 'error') {
        return { ok: false, error: 'model-error' };
      }
    }
  } catch (err) {
    return { ok: false, error: 'call-failed' };
  } finally {
    clearTimeout(timer);
  }

  const parsed = parseModelJson(text);
  if (!parsed) return { ok: false, error: 'parse' };
  const allowed = new Map(candidates.map((c) => [c.san, c]));
  const picked = allowed.get(String(parsed.san || '').trim());
  if (!picked) return { ok: false, error: 'not-a-candidate' };

  const speech = String(parsed.speech || '').trim().slice(0, 60) || '嗯……';
  const animationKey = ANIMATION_KEYS.has(parsed.animationKey) ? parsed.animationKey : 'move';
  return {
    ok: true,
    san: picked.san,
    speech,
    animationKey,
    model: { provider: selection.provider, model: selection.model },
  };
}

function sanitizeCandidates(input) {
  if (!Array.isArray(input)) return [];
  const seen = new Set();
  const out = [];
  for (const item of input) {
    const san = String((item && item.san) || '').trim();
    if (!san || san.length > 12 || seen.has(san)) continue;
    seen.add(san);
    out.push({
      san,
      rank: Number(item.rank) || 0,
      tags: Array.isArray(item.tags) ? item.tags.slice(0, 6).map(String) : [],
    });
    if (out.length >= 16) break;
  }
  return out;
}

function buildPrompt(body, candidates) {
  const fen = String((body && body.fen) || '').slice(0, 120);
  const history = Array.isArray(body && body.history) ? body.history.slice(-12).map(String) : [];
  const mood = String((body && body.mood) || '温柔');
  const elo = Number(body && body.elo) || 1200;
  const color = body && body.playerColor === 'b' ? '黑' : '白';
  const lines = [];
  lines.push('当前局面 FEN：' + fen);
  lines.push('主人执' + color + '；本局棋力约 ' + elo + ' ELO。');
  if (history.length) lines.push('最近棋谱：' + history.join(' '));
  lines.push('你的心情：' + mood + '。');
  lines.push('候选着法（只能选一个，san 原样返回）：');
  for (const c of candidates) {
    lines.push('- ' + c.san + (c.tags.length ? '（' + c.tags.join('、') + '）' : ''));
  }
  lines.push('请输出 JSON。');
  return lines.join('\n');
}

function parseModelJson(text) {
  const source = String(text || '');
  const match = source.match(/\{[\s\S]*\}/);
  if (!match) return null;
  try {
    return JSON.parse(match[0]);
  } catch (err) {
    return null;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new Error('too-large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

function sendJson(res, status, value) {
  const text = JSON.stringify(value);
  res.statusCode = status;
  res.setHeader('content-type', 'application/json; charset=utf-8');
  res.setHeader('cache-control', 'no-store');
  res.end(text);
}
