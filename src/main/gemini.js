'use strict';

const CHAT_MODEL = 'gemini-3.5-flash-lite';
const IMAGE_MODEL = 'gemini-3.1-flash-lite-image';
const DEFAULT_BASE = 'https://generativelanguage.googleapis.com';
const TIMEOUT_MS = 180000;

// Keys used to look like `AIza…` (39 chars). New Auth keys look like `AQ.Ab…`:
// longer, and they contain a dot. Keep the pattern loose so future formats work.
const KEY_PATTERN = /^[A-Za-z0-9._-]{20,512}$/;

function normalizeKey(raw) {
  return String(raw || '')
    .trim()
    .replace(/^["']|["']$/g, '')
    .trim();
}

function isValidKey(key) {
  return KEY_PATTERN.test(key);
}

// code is one of:
//   NO_KEY, UPSTREAM  - anything wrong on the API side (quota, auth, 5xx, network)
//   BLOCKED           - the model refused the request
//   TRUNCATED         - the answer was cut off before the game was finished
//   EMPTY             - nothing usable came back
class GeminiError extends Error {
  constructor(code, detail, status) {
    super(detail);
    this.code = code;
    this.status = status;
  }
}

const BLOCK_REASONS = new Set(['SAFETY', 'PROHIBITED_CONTENT', 'BLOCKLIST', 'SPII', 'IMAGE_SAFETY', 'RECITATION']);

async function call({ apiKey, model, body, base = DEFAULT_BASE, fetchImpl = fetch, timeoutMs = TIMEOUT_MS, signal }) {
  if (!apiKey) throw new GeminiError('NO_KEY', 'No API key configured');
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error('timeout')), timeoutMs);
  const onAbort = () => ctl.abort(signal.reason);
  if (signal) signal.aborted ? ctl.abort(signal.reason) : signal.addEventListener('abort', onAbort, { once: true });
  let res;
  try {
    // The key goes in a header: AQ. keys are rejected on the legacy `?key=` query form.
    res = await fetchImpl(`${base}/v1beta/models/${model}:generateContent`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
      body: JSON.stringify(body),
      signal: ctl.signal,
    });
  } catch (err) {
    clearTimeout(timer);
    signal && signal.removeEventListener('abort', onAbort);
    throw new GeminiError('UPSTREAM', `Network error: ${err && err.message ? err.message : err}`);
  }
  let text;
  try {
    text = await res.text();
  } catch (err) {
    throw new GeminiError('UPSTREAM', `Read error: ${err.message}`, res.status);
  } finally {
    clearTimeout(timer);
    signal && signal.removeEventListener('abort', onAbort);
  }
  let json = null;
  try {
    json = JSON.parse(text);
  } catch {}
  if (!res.ok) {
    const msg = (json && json.error && json.error.message) || text.slice(0, 300);
    throw new GeminiError('UPSTREAM', `HTTP ${res.status}: ${msg}`, res.status);
  }
  if (!json) throw new GeminiError('UPSTREAM', 'Response was not JSON', res.status);
  return json;
}

function candidateOf(json) {
  const block = json.promptFeedback && json.promptFeedback.blockReason;
  if (block) throw new GeminiError('BLOCKED', `Prompt blocked: ${block}`);
  const cand = json.candidates && json.candidates[0];
  if (!cand) throw new GeminiError('EMPTY', 'No candidates in response');
  if (BLOCK_REASONS.has(cand.finishReason)) throw new GeminiError('BLOCKED', `Finish reason ${cand.finishReason}`);
  return cand;
}

function textOf(cand) {
  const parts = (cand.content && cand.content.parts) || [];
  return parts
    .filter((p) => typeof p.text === 'string' && !p.thought)
    .map((p) => p.text)
    .join('');
}

const FENCE_OPEN = /```[a-zA-Z]*[ \t]*\r?\n/;

// Splits a model answer into the friendly sentence(s) and the game file.
function parseChatText(text) {
  const closed = text.match(/```[a-zA-Z]*[ \t]*\r?\n([\s\S]*?)\r?\n?```/);
  if (closed) {
    const html = closed[1].trim();
    const reply = (text.slice(0, closed.index) + text.slice(closed.index + closed[0].length)).trim();
    if (!/<\s*(!doctype|html|body|canvas|script)/i.test(html)) {
      throw new GeminiError('EMPTY', 'Code block did not look like a game');
    }
    return { reply, html };
  }
  if (FENCE_OPEN.test(text)) throw new GeminiError('TRUNCATED', 'Unclosed code fence');
  return { reply: text.trim(), html: null };
}

async function chat(opts, { system, contents }) {
  const json = await call({
    ...opts,
    model: CHAT_MODEL,
    body: {
      systemInstruction: { parts: [{ text: system }] },
      contents,
      generationConfig: { thinkingConfig: { thinkingLevel: 'high' }, maxOutputTokens: 32768 },
    },
  });
  const cand = candidateOf(json);
  const text = textOf(cand);
  if (cand.finishReason === 'MAX_TOKENS') throw new GeminiError('TRUNCATED', 'Hit max output tokens');
  if (!text.trim()) throw new GeminiError('EMPTY', 'Empty text');
  const out = parseChatText(text);
  if (!out.reply && !out.html) throw new GeminiError('EMPTY', 'Nothing to show');
  return out;
}

// Cheap connectivity check for the developer panel. Surfaces the real error.
async function ping(opts) {
  const json = await call({
    ...opts,
    model: CHAT_MODEL,
    body: {
      contents: [{ role: 'user', parts: [{ text: 'Reply with the single word: ok' }] }],
      generationConfig: { thinkingConfig: { thinkingLevel: 'minimal' }, maxOutputTokens: 16 },
    },
  });
  return textOf(candidateOf(json)).trim() || 'ok';
}

async function image(opts, { prompt, aspectRatio }) {
  const json = await call({
    ...opts,
    model: IMAGE_MODEL,
    body: {
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig: { responseModalities: ['TEXT', 'IMAGE'], imageConfig: { aspectRatio } },
    },
  });
  const cand = candidateOf(json);
  const parts = (cand.content && cand.content.parts) || [];
  for (const p of parts) {
    const d = p.inlineData || p.inline_data;
    if (d && d.data) return { mimeType: d.mimeType || d.mime_type || 'image/png', data: d.data };
  }
  throw new GeminiError('EMPTY', 'No image in response');
}

module.exports = {
  CHAT_MODEL,
  IMAGE_MODEL,
  DEFAULT_BASE,
  GeminiError,
  isValidKey,
  normalizeKey,
  parseChatText,
  chat,
  image,
  ping,
};
