'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { mockGemini, textReply, setup } = require('./helpers');

const GAME = '<!DOCTYPE html><html><body><canvas></canvas><script>1</script></body></html>';
const ok = textReply('Built a snake game.\n```html\n' + GAME + '\n```');

test('chat success: charges 5, stores game, uses AQ key header + high thinking', async () => {
  const m = await mockGemini(() => ok);
  const { service, projects, account } = setup(m.base);
  const p = projects.create();
  const r = await service.sendChat(p.id, 'make me a snake game');
  m.close();
  assert.equal(r.ok, true);
  assert.equal(r.account.credits, 45);
  assert.equal(r.project.game.html, GAME);
  assert.equal(r.project.messages.length, 2);
  assert.equal(r.project.messages[1].text, 'Built a snake game.');
  assert.equal(r.project.title, 'Make me a snake game');
  const c = m.calls[0];
  assert.match(c.url, /^\/v1beta\/models\/gemini-3\.5-flash-lite:generateContent$/);
  assert.equal(c.headers['x-goog-api-key'], 'AQ.Ab8RN6KtestKeyWithDotsAndLength_1234567890');
  assert.equal(c.body.generationConfig.thinkingConfig.thinkingLevel, 'high');
  assert.equal(account.snapshot().credits, 45);
});

test('upstream failures are refunded and reported as DEMAND', async () => {
  for (const out of [
    { status: 429, json: { error: { message: 'quota exceeded' } } },
    { status: 403, json: { error: { message: 'API key not valid' } } },
    { status: 503, raw: 'overloaded' },
    { status: 200, raw: 'not json' },
    { status: 200, json: { candidates: [] } },
  ]) {
    const m = await mockGemini(() => out);
    const { service, projects } = setup(m.base);
    const p = projects.create();
    const r = await service.sendChat(p.id, 'hi');
    m.close();
    assert.equal(r.code, 'DEMAND', JSON.stringify(out));
    assert.equal(r.account.credits, 50);
    assert.equal(projects.get(p.id).messages.length, 0);
    assert.ok(service.lastError);
  }
});

test('missing key and unreachable server are DEMAND with refund', async () => {
  const a = setup('http://127.0.0.1:1', { key: '' });
  const p = a.projects.create();
  const r1 = await a.service.sendChat(p.id, 'hi');
  assert.equal(r1.code, 'DEMAND');
  assert.equal(a.service.lastError.code, 'NO_KEY');
  const b = setup('http://127.0.0.1:1');
  const r2 = await b.service.sendChat(b.projects.create().id, 'hi');
  assert.equal(r2.code, 'DEMAND');
  assert.equal(r2.account.credits, 50);
});

test('blocked and truncated answers are distinct and refunded', async () => {
  let reply = textReply('', { finishReason: 'SAFETY' });
  const m = await mockGemini(() => reply);
  const { service, projects } = setup(m.base);
  const p = projects.create();
  assert.equal((await service.sendChat(p.id, 'x')).code, 'BLOCKED');
  reply = textReply('Sure\n```html\n<html><body>unfinished');
  assert.equal((await service.sendChat(p.id, 'x')).code, 'TRUNCATED');
  reply = textReply('Sure\n```html\n<html>', { finishReason: 'MAX_TOKENS' });
  const r = await service.sendChat(p.id, 'x');
  m.close();
  assert.equal(r.code, 'TRUNCATED');
  assert.equal(r.account.credits, 50);
});

test('no credits: refuses without calling the API; 10 messages on Hobby', async () => {
  const m = await mockGemini(() => textReply('Just chatting, no code.'));
  const { service, projects } = setup(m.base);
  const p = projects.create();
  for (let i = 0; i < 10; i++) assert.equal((await service.sendChat(p.id, `m${i}`)).ok, true);
  const r = await service.sendChat(p.id, 'one more');
  m.close();
  assert.equal(r.code, 'NO_CREDITS');
  assert.equal(r.account.credits, 0);
  assert.equal(m.calls.length, 10);
  assert.equal(projects.get(p.id).game, null);
});

test('only one request at a time; second is BUSY and free', async () => {
  let release;
  const gate = new Promise((r) => (release = r));
  const m = await mockGemini(() => null);
  // slow server: replace handler by delaying via a custom fetch
  const { service, projects } = setup(m.base);
  service.fetchImpl = async () => {
    await gate;
    return new Response(JSON.stringify(ok.json), { status: 200 });
  };
  const p = projects.create();
  const first = service.sendChat(p.id, 'a');
  const second = await service.sendChat(p.id, 'b');
  assert.equal(second.code, 'BUSY');
  assert.equal(second.account.credits, 45);
  release();
  const r1 = await first;
  m.close();
  assert.equal(r1.ok, true);
  assert.equal(r1.account.credits, 45);
});

test('deleting a project mid-request refunds', async () => {
  const m = await mockGemini(() => ok);
  const { service, projects } = setup(m.base);
  const p = projects.create();
  const orig = service.fetchImpl;
  service.fetchImpl = async (...a) => {
    projects.delete(p.id);
    return (orig || fetch)(...a);
  };
  const r = await service.sendChat(p.id, 'hi');
  m.close();
  assert.equal(r.code, 'GONE');
  assert.equal(r.account.credits, 50);
});

test('follow-up sends current game + textures, keeps undo history', async () => {
  const m = await mockGemini((c, n) =>
    n === 1 ? ok : n === 2 ? { json: { candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from('PNG').toString('base64') } }] } }] } } : textReply('Changed.\n```html\n' + GAME.replace('1', '2') + '\n```'),
  );
  const { service, projects } = setup(m.base);
  const p = projects.create();
  await service.sendChat(p.id, 'snake');
  const t = await service.makeTexture(p.id, 'Green grass field', 'tile');
  assert.equal(t.ok, true);
  assert.equal(t.project.textures[0].name, 'green-grass-field');
  assert.equal(m.calls[1].url.includes('gemini-3.1-flash-lite-image'), true);
  assert.deepEqual(m.calls[1].body.generationConfig.imageConfig, { aspectRatio: '1:1' });
  assert.match(m.calls[1].body.generationConfig.responseModalities.join(), /IMAGE/);
  const r = await service.sendChat(p.id, 'make it faster');
  m.close();
  assert.equal(r.account.credits, 35);
  const last = m.calls[2].body.contents.at(-1).parts[0].text;
  assert.match(last, /Current game file/);
  assert.match(last, /green-grass-field: Green grass field/);
  assert.equal(m.calls[2].body.contents[0].role, 'user');
  assert.equal(r.project.versions.length, 1);
  const undone = service.undoGame(p.id);
  assert.equal(undone.game.html, GAME);
  assert.equal(undone.versions.length, 0);
});

test('texture refs are inlined for playback, unknown refs become blank', async () => {
  const m = await mockGemini((c, n) =>
    n === 1 ? { json: { candidates: [{ content: { parts: [{ text: 'ok' }, { inlineData: { mimeType: 'image/png', data: Buffer.from('PNGDATA').toString('base64') } }] } }] } }
            : textReply('x\n```html\n<html><body><img src="texture://green-grass-field"><img src="texture://gone"></body></html>\n```'));
  const { service, projects } = setup(m.base);
  const p = projects.create();
  await service.makeTexture(p.id, 'Green grass field', 'tile');
  await service.sendChat(p.id, 'use it');
  m.close();
  const { html } = service.playableHtml(p.id);
  assert.match(html, /src="data:image\/png;base64,UE5HREFUQQ=="/);
  assert.match(html, /src="data:image\/gif;base64/);
  assert.doesNotMatch(html, /texture:\/\//);
  const id = projects.get(p.id).textures[0].id;
  assert.equal(service.readTexture(p.id, id).data.toString(), 'PNGDATA');
  service.deleteTexture(p.id, id);
  assert.equal(service.readTexture(p.id, id), null);
});

test('input validation', async () => {
  const { service, projects } = setup('http://127.0.0.1:1');
  const p = projects.create();
  assert.equal((await service.sendChat(p.id, '   ')).code, 'INVALID');
  assert.equal((await service.sendChat(p.id, 'x'.repeat(4001))).code, 'INVALID');
  assert.equal((await service.makeTexture(p.id, 'a', 'nope')).code, 'INVALID');
  assert.equal((await service.sendChat('../../etc/passwd', 'hi')).code, 'GONE');
  assert.equal(projects.get('../../x'), null);
});

test('playback html gets the canvas reset first, so game CSS can still override it', async () => {
  const m = await mockGemini(() => textReply('x\n```html\n<!DOCTYPE html><html><head><style>canvas{display:inline}</style></head><body><canvas></canvas></body></html>\n```'));
  const { service, projects } = setup(m.base);
  const p = projects.create();
  await service.sendChat(p.id, 'go');
  m.close();
  const { html } = service.playableHtml(p.id);
  assert.ok(html.indexOf('canvas{display:block}') < html.indexOf('canvas{display:inline}'));
  assert.equal(html.split('canvas{display:block}').length, 2);
  assert.equal(projects.get(p.id).game.html.includes('display:block'), false); // stored file stays untouched
});

test('RECITATION is retried with an originality nudge, not reported as a refusal', async () => {
  const m = await mockGemini((c, n) => (n === 1 ? textReply('', { finishReason: 'RECITATION' }) : ok));
  const { service, projects } = setup(m.base);
  const p = projects.create();
  const r = await service.sendChat(p.id, 'make snake');
  m.close();
  assert.equal(r.ok, true);
  assert.equal(m.calls.length, 2);
  assert.match(m.calls[1].body.contents.at(-1).parts[0].text, /original implementation/);
  assert.doesNotMatch(m.calls[0].body.contents.at(-1).parts[0].text, /original implementation/);
  assert.equal(r.account.credits, 45);
});

test('RECITATION that still returns a finished game is used as-is; repeated RECITATION is masked, not "blocked"', async () => {
  let mode = 'full';
  const m = await mockGemini(() => (mode === 'full' ? textReply('Done.\n```html\n' + GAME + '\n```', { finishReason: 'RECITATION' }) : textReply('', { finishReason: 'RECITATION' })));
  const { service, projects } = setup(m.base);
  const p = projects.create();
  const a = await service.sendChat(p.id, 'make pong');
  assert.equal(a.ok, true);
  assert.equal(m.calls.length, 1);
  mode = 'empty';
  const b = await service.sendChat(p.id, 'again');
  m.close();
  assert.equal(b.code, 'DEMAND');
  assert.equal(b.account.credits, 45);
  assert.match(service.lastError.message, /RECITATION/);
});

test('chat requests carry relaxed safety settings so words like "shooter" are not blocked', async () => {
  const m = await mockGemini(() => ok);
  const { service, projects } = setup(m.base);
  await service.sendChat(projects.create().id, 'space shooter');
  m.close();
  const ss = m.calls[0].body.safetySettings;
  assert.equal(ss.length, 4);
  assert.ok(ss.every((x) => x.threshold === 'BLOCK_ONLY_HIGH'));
});
