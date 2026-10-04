'use strict';

const fs = require('fs');
const gemini = require('./gemini');
const { SYSTEM, TEXTURE_STYLES } = require('./prompts');
const { MESSAGE_COST } = require('./billing');
const { inlineTextures, slugify } = require('../shared/textures');

const MAX_TEXT = 4000;
const MAX_VERSIONS = 10;
const MAX_TEXTURES = 30;
const HISTORY_MESSAGES = 10;
// Browsers leave a few pixels under an inline <canvas>, which makes full-window
// games scroll. Inserted first so a game's own CSS still wins.
const BASE_STYLE = '<style>canvas{display:block}</style>';
function withBaseStyle(html) {
  if (/<head[^>]*>/i.test(html)) return html.replace(/<head[^>]*>/i, (m) => m + BASE_STYLE);
  if (/<html[^>]*>/i.test(html)) return html.replace(/<html[^>]*>/i, (m) => m + BASE_STYLE);
  return BASE_STYLE + html;
}
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp' };

// The app's brain. Nothing in here knows about Electron, so it can be tested
// directly. Every upstream failure is classified once, here:
//   DEMAND  - API out of quota / bad key / network / empty answer. The UI shows a
//             calm "Demand is high." and the user's credits are returned.
function Failure(code) {
  return { ok: false, code };
}

class Service {
  constructor({ account, projects, getKey, base, fetchImpl, uuid, log = () => {} }) {
    this.account = account;
    this.projects = projects;
    this.getKey = getKey;
    this.base = base;
    this.fetchImpl = fetchImpl;
    this.uuid = uuid;
    this.log = log;
    this.busy = false;
    this.lastError = null;
    this.abort = new AbortController();
  }

  shutdown() {
    this.abort.abort(new Error('shutdown'));
  }

  _opts() {
    return { apiKey: this.getKey(), base: this.base, fetchImpl: this.fetchImpl, signal: this.abort.signal };
  }

  _recordError(err) {
    this.lastError = { at: Date.now(), code: err.code || 'ERROR', message: String(err.message || err) };
    this.log('[gamebud] upstream error:', this.lastError.code, this.lastError.message);
  }

  _fail(err) {
    this._recordError(err);
    if (err.code === 'BLOCKED') return Failure('BLOCKED');
    if (err.code === 'TRUNCATED') return Failure('TRUNCATED');
    return Failure('DEMAND');
  }

  // Runs `work` with credits reserved and the busy lock held. Credits come back
  // unless `work` resolves with { ok: true }.
  async _paid(work) {
    if (this.busy) return { ...Failure('BUSY'), account: this.account.snapshot() };
    if (!this.account.reserve(MESSAGE_COST)) return { ...Failure('NO_CREDITS'), account: this.account.snapshot() };
    this.busy = true;
    let result = Failure('DEMAND');
    try {
      result = await work();
    } catch (err) {
      result = this._fail(err);
    } finally {
      this.busy = false;
      if (!result.ok) this.account.refund(MESSAGE_COST);
    }
    return { ...result, account: this.account.snapshot() };
  }

  async sendChat(projectId, rawText) {
    const text = String(rawText || '').trim();
    if (!text || text.length > MAX_TEXT) return { ...Failure('INVALID'), account: this.account.snapshot() };
    if (!this.projects.get(projectId)) return { ...Failure('GONE'), account: this.account.snapshot() };

    return this._paid(async () => {
      const before = this.projects.get(projectId);
      if (!before) return Failure('GONE');

      const history = before.messages
        .slice(-HISTORY_MESSAGES)
        .map((m) => ({ role: m.role === 'user' ? 'user' : 'model', parts: [{ text: m.text }] }));

      let turn = '';
      if (before.game) turn += `Current game file:\n\`\`\`html\n${before.game.html}\n\`\`\`\n\n`;
      if (before.textures.length) {
        turn +=
          'Available textures (reference as texture://<name>):\n' +
          before.textures.map((t) => `- ${t.name}: ${t.prompt}`).join('\n') +
          '\n\n';
      }
      turn += turn ? `Request:\n${text}` : text;

      const out = await gemini.chat(this._opts(), {
        system: SYSTEM,
        contents: [...history, { role: 'user', parts: [{ text: turn }] }],
      });

      // Re-read: the project may have been renamed or deleted while we waited.
      const p = this.projects.get(projectId);
      if (!p) return Failure('GONE');
      const now = Date.now();
      p.messages.push({ id: this.uuid(), role: 'user', text, ts: now });
      p.messages.push({
        id: this.uuid(),
        role: 'assistant',
        text: out.reply || 'Here you go.',
        ts: now,
        built: !!out.html,
      });
      if (out.html) {
        if (p.game) p.versions = [...p.versions, p.game.html].slice(-MAX_VERSIONS);
        p.game = { html: out.html, updatedAt: now };
      }
      if (p.titleAuto && p.messages.length === 2) p.title = titleFrom(text);
      this.projects.save(p);
      return { ok: true, project: p };
    });
  }

  async makeTexture(projectId, rawPrompt, styleId) {
    const prompt = String(rawPrompt || '').trim();
    const style = TEXTURE_STYLES[styleId];
    const p0 = this.projects.get(projectId);
    if (!prompt || prompt.length > 300 || !style) return { ...Failure('INVALID'), account: this.account.snapshot() };
    if (!p0) return { ...Failure('GONE'), account: this.account.snapshot() };
    if (p0.textures.length >= MAX_TEXTURES) return { ...Failure('LIMIT'), account: this.account.snapshot() };

    return this._paid(async () => {
      const img = await gemini.image(this._opts(), { prompt: style.prefix + prompt, aspectRatio: style.aspectRatio });
      const p = this.projects.get(projectId);
      if (!p) return Failure('GONE');
      const mime = EXT[img.mimeType] ? img.mimeType : 'image/png';
      const id = this.uuid();
      const file = this.projects.texturePath(projectId, id, EXT[mime]);
      fs.mkdirSync(require('path').dirname(file), { recursive: true });
      fs.writeFileSync(file, Buffer.from(img.data, 'base64'));
      const name = slugify(prompt, new Set(p.textures.map((t) => t.name)));
      p.textures.unshift({ id, name, prompt, style: styleId, mime, createdAt: Date.now() });
      try {
        this.projects.save(p);
      } catch (err) {
        fs.rmSync(file, { force: true });
        throw err;
      }
      return { ok: true, project: p, textureId: id };
    });
  }

  readTexture(projectId, texId) {
    const p = this.projects.get(projectId);
    const t = p && p.textures.find((x) => x.id === texId);
    if (!t) return null;
    try {
      return { mime: t.mime, data: fs.readFileSync(this.projects.texturePath(projectId, t.id, EXT[t.mime])) };
    } catch {
      return null;
    }
  }

  deleteTexture(projectId, texId) {
    const p = this.projects.get(projectId);
    if (!p) return null;
    const t = p.textures.find((x) => x.id === texId);
    if (!t) return p;
    fs.rmSync(this.projects.texturePath(projectId, t.id, EXT[t.mime]), { force: true });
    p.textures = p.textures.filter((x) => x.id !== texId);
    return this.projects.save(p);
  }

  undoGame(projectId) {
    const p = this.projects.get(projectId);
    if (!p || !p.versions.length) return p;
    p.game = { html: p.versions[p.versions.length - 1], updatedAt: Date.now() };
    p.versions = p.versions.slice(0, -1);
    return this.projects.save(p);
  }

  renameProject(projectId, title) {
    const p = this.projects.get(projectId);
    const t = String(title || '').trim().slice(0, 60);
    if (!p || !t) return p;
    p.title = t;
    p.titleAuto = false;
    return this.projects.save(p);
  }

  // The game with texture references swapped for inline data, ready to run or export.
  playableHtml(projectId) {
    const p = this.projects.get(projectId);
    if (!p || !p.game) return null;
    const used = new Set([...p.game.html.matchAll(/texture:\/\/([a-z0-9][a-z0-9-]*)/g)].map((m) => m[1]));
    const urls = {};
    for (const t of p.textures) {
      if (!used.has(t.name)) continue;
      const tex = this.readTexture(projectId, t.id);
      if (tex) urls[t.name] = `data:${tex.mime};base64,${tex.data.toString('base64')}`;
    }
    return { title: p.title, html: withBaseStyle(inlineTextures(p.game.html, urls)) };
  }
}

function titleFrom(text) {
  const clean = text.replace(/\s+/g, ' ').trim();
  const words = clean.split(' ');
  let title = '';
  for (const w of words) {
    if ((title + ' ' + w).trim().length > 34) break;
    title = (title + ' ' + w).trim();
  }
  title = title || clean.slice(0, 34);
  return title.charAt(0).toUpperCase() + title.slice(1).replace(/[.,;:!?-]+$/, '');
}

module.exports = { Service, MAX_TEXTURES };
