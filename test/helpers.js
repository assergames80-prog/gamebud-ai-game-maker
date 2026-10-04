'use strict';
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { JsonFile, Projects } = require('../src/main/store');
const { Account } = require('../src/main/billing');
const { Service } = require('../src/main/service');

// A scriptable fake of the Gemini REST API.
async function mockGemini(handler) {
  const calls = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      const call = { url: req.url, headers: req.headers, body: body ? JSON.parse(body) : null };
      calls.push(call);
      const out = handler(call, calls.length) || {};
      res.writeHead(out.status || 200, { 'content-type': 'application/json' });
      res.end(typeof out.raw === 'string' ? out.raw : JSON.stringify(out.json || {}));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { calls, base: `http://127.0.0.1:${server.address().port}`, close: () => server.close() };
}

const textReply = (text, extra = {}) => ({
  json: { candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP', ...extra }] },
});

function setup(base, opts = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gamebud-'));
  const account = new Account(new JsonFile(path.join(dir, 'account.json')), opts.now);
  const projects = new Projects(path.join(dir, 'projects'), crypto.randomUUID);
  const service = new Service({
    account,
    projects,
    base,
    getKey: () => ('key' in opts ? opts.key : 'AQ.Ab8RN6KtestKeyWithDotsAndLength_1234567890'),
    uuid: crypto.randomUUID,
  });
  return { dir, account, projects, service };
}

module.exports = { mockGemini, textReply, setup };
