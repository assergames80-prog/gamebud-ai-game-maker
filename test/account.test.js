'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { JsonFile } = require('../src/main/store');
const { Account, PERIOD_MS } = require('../src/main/billing');
const { isValidKey, normalizeKey, parseChatText } = require('../src/main/gemini');

const mk = (now) => new Account(new JsonFile(path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'gb-')), 'a.json')), now);

test('plans, upgrade, cancel', () => {
  const a = mk();
  assert.deepEqual([a.snapshot().planName, a.snapshot().credits, a.snapshot().cost], ['Hobby', 50, 5]);
  a.reserve(); a.reserve();
  assert.equal(a.upgrade().credits, 150);
  assert.equal(a.snapshot().planName, 'Plus');
  assert.equal(a.snapshot().price, 10);
  assert.equal(a.cancel().credits, 50);
  assert.equal(a.snapshot().planName, 'Hobby');
});

test('refund never exceeds allowance; cannot overspend', () => {
  const a = mk();
  a.refund(5);
  assert.equal(a.snapshot().credits, 50);
  for (let i = 0; i < 10; i++) assert.equal(a.reserve(), true);
  assert.equal(a.reserve(), false);
  assert.equal(a.snapshot().credits, 0);
});

test('monthly refill and persistence', () => {
  let t = 1_000_000;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-'));
  const file = new JsonFile(path.join(dir, 'a.json'));
  const a = new Account(file, () => t);
  for (let i = 0; i < 10; i++) a.reserve();
  assert.equal(a.snapshot().credits, 0);
  t += PERIOD_MS - 1;
  assert.equal(a.snapshot().credits, 0);
  t += 1;
  assert.equal(a.snapshot().credits, 50);
  assert.equal(new Account(file, () => t).snapshot().credits, 50);
});

test('corrupt account file is recovered, not fatal', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gb-'));
  fs.writeFileSync(path.join(dir, 'a.json'), '{nope');
  assert.equal(new Account(new JsonFile(path.join(dir, 'a.json'))).snapshot().credits, 50);
});

test('API key validation accepts legacy AIza and new AQ. keys', () => {
  assert.ok(isValidKey('AIzaSyA1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q'));
  assert.ok(isValidKey('AQ.Ab8RN6K_abcdefghijklmnopqrstuvwxyz0123456789-ABCDEFGH'));
  assert.ok(!isValidKey('short'));
  assert.ok(!isValidKey('has spaces in it, definitely not a key!!'));
  assert.equal(normalizeKey('  "AQ.abc"\n'), 'AQ.abc');
});

test('parseChatText', () => {
  assert.deepEqual(parseChatText('Just words.'), { reply: 'Just words.', html: null });
  const r = parseChatText('Hi!\n```html\n<html><body></body></html>\n```\nBye');
  assert.equal(r.html, '<html><body></body></html>');
  assert.match(r.reply, /Hi!/);
  assert.throws(() => parseChatText('x\n```html\n<html>'), { code: 'TRUNCATED' });
  assert.throws(() => parseChatText('x\n```js\nconst a = 1\n```'), { code: 'EMPTY' });
});

test('prompt teaches the pinned Three.js import map and nothing else is allowed by CSP', () => {
  const { SYSTEM } = require('../src/main/prompts');
  const { THREE_BASE, THREE_VERSION } = require('../src/main/cdn');
  assert.match(THREE_VERSION, /^\d+\.\d+\.\d+$/);
  assert.ok(SYSTEM.includes(`"three":"${THREE_BASE}build/three.module.js"`));
  assert.ok(SYSTEM.includes(`"three/addons/":"${THREE_BASE}examples/jsm/"`));
  const src = require('fs').readFileSync(require('path').join(__dirname, '../src/main/main.js'), 'utf8');
  assert.match(src, /script-src 'unsafe-inline' 'unsafe-eval' \$\{THREE_BASE\}/);
  assert.doesNotMatch(src, /script-src[^;]*https:(?!\/\/cdn)/);
});
