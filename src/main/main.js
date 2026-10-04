'use strict';

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { app, BrowserWindow, Menu, dialog, ipcMain, protocol, session, safeStorage } = require('electron');

if (process.env.GAMEBUD_USER_DATA) app.setPath('userData', process.env.GAMEBUD_USER_DATA);

const gemini = require('./gemini');
const { THREE_BASE } = require('./cdn');
const { JsonFile, Projects, ID } = require('./store');
const { Account } = require('./billing');
const { Secrets } = require('./secrets');
const { Service } = require('./service');
const { slugify } = require('../shared/textures');

// `gamebud://play/<project>` serves the game, `gamebud://tex/<project>/<texture>` serves images.
// Games get their own locked-down CSP: they can run code, but cannot reach the network
// (except to fetch Three.js).
protocol.registerSchemesAsPrivileged([{ scheme: 'gamebud', privileges: { standard: true, secure: true } }]);

// Scripts may also load from the pinned Three.js folder on jsDelivr (and nowhere else).
const GAME_CSP =
  `default-src 'none'; script-src 'unsafe-inline' 'unsafe-eval' ${THREE_BASE}; style-src 'unsafe-inline'; ` +
  "img-src data: blob:; media-src data: blob:; font-src data:; connect-src data: blob:; worker-src blob:";
const DEV_WINDOW_MS = 10 * 60 * 1000;

let win = null;
let service = null;
let secrets = null;
let account = null;
let devUnlockedUntil = 0;

function createWindow() {
  win = new BrowserWindow({
    width: 1320,
    height: 840,
    minWidth: 980,
    minHeight: 640,
    show: false,
    title: 'Gamebud',
    backgroundColor: '#f7f7f9',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: !app.isPackaged || !!process.env.GAMEBUD_DEBUG,
    },
  });
  win.once('ready-to-show', () => win.show());
  win.on('closed', () => (win = null));
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());

  // Hidden developer panel. There is deliberately no menu item or button for it.
  win.webContents.on('before-input-event', (event, input) => {
    const mod = process.platform === 'darwin' ? input.meta : input.control;
    if (input.type === 'keyDown' && mod && input.shift && !input.alt && input.key.toLowerCase() === 'k') {
      event.preventDefault();
      devUnlockedUntil = Date.now() + DEV_WINDOW_MS;
      win.webContents.send('dev:open');
    }
  });

  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'));
}

function setupMenu() {
  if (process.platform === 'darwin') {
    // macOS needs an Edit menu for copy/paste to work in text fields.
    Menu.setApplicationMenu(
      Menu.buildFromTemplate([
        { role: 'appMenu' },
        { role: 'editMenu' },
        { role: 'windowMenu' },
      ]),
    );
  } else {
    Menu.setApplicationMenu(null);
  }
}

function setupProtocol(projects) {
  protocol.handle('gamebud', (request) => {
    try {
      const url = new URL(request.url);
      const parts = url.pathname.split('/').filter(Boolean);
      if (url.hostname === 'play' && parts.length === 1 && ID.test(parts[0])) {
        const out = service.playableHtml(parts[0]);
        if (out) {
          return new Response(out.html, {
            headers: { 'content-type': 'text/html; charset=utf-8', 'content-security-policy': GAME_CSP, 'cache-control': 'no-store' },
          });
        }
      }
      if (url.hostname === 'tex' && parts.length === 2 && ID.test(parts[0]) && ID.test(parts[1])) {
        const tex = service.readTexture(parts[0], parts[1]);
        if (tex) return new Response(tex.data, { headers: { 'content-type': tex.mime, 'cache-control': 'private, max-age=31536000' } });
      }
    } catch {}
    return new Response('Not found', { status: 404 });
  });
}

// Wraps a handler so a bug can never surface as an unhandled rejection in the UI.
function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, ...args) => {
    try {
      return await fn(...args);
    } catch (err) {
      console.error(`[gamebud] ${channel} failed:`, err);
      return { ok: false, code: 'ERROR' };
    }
  });
}

function requireDev() {
  if (Date.now() > devUnlockedUntil) throw new Error('developer panel is locked');
}

function registerIpc(projects) {
  const str = (v) => (typeof v === 'string' ? v : '');

  handle('account:get', () => account.snapshot());
  handle('billing:upgrade', () => ({ ok: true, account: account.upgrade() }));
  handle('billing:cancel', () => ({ ok: true, account: account.cancel() }));

  handle('projects:list', () => projects.list());
  handle('projects:create', () => projects.create());
  handle('projects:get', (id) => projects.get(str(id)));
  handle('projects:delete', (id) => {
    projects.delete(str(id));
    return true;
  });
  handle('projects:rename', (id, title) => service.renameProject(str(id), str(title)));

  handle('chat:send', (id, text) => service.sendChat(str(id), str(text)));
  handle('texture:generate', (id, prompt, style) => service.makeTexture(str(id), str(prompt), str(style)));
  handle('texture:delete', (id, texId) => service.deleteTexture(str(id), str(texId)));
  handle('game:undo', (id) => service.undoGame(str(id)));

  handle('game:export', async (id) => {
    const out = service.playableHtml(str(id));
    if (!out) return { ok: false };
    const res = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath('documents'), `${slugify(out.title, new Set()) || 'game'}.html`),
      filters: [{ name: 'Game (HTML)', extensions: ['html'] }],
    });
    if (res.canceled || !res.filePath) return { ok: false, canceled: true };
    fs.writeFileSync(res.filePath, out.html);
    return { ok: true, path: res.filePath };
  });

  handle('dev:status', () => {
    requireDev();
    return { ...secrets.status(), chatModel: gemini.CHAT_MODEL, imageModel: gemini.IMAGE_MODEL, lastError: service.lastError };
  });
  handle('dev:setKey', (key) => {
    requireDev();
    const ok = secrets.set(str(key));
    return { ok, status: secrets.status() };
  });
  handle('dev:clearKey', () => {
    requireDev();
    secrets.clear();
    return { ok: true, status: secrets.status() };
  });
  handle('dev:test', async () => {
    requireDev();
    try {
      const reply = await gemini.ping(service._opts());
      return { ok: true, message: `Connected. Model replied: "${reply.slice(0, 40)}"` };
    } catch (err) {
      return { ok: false, message: err.message };
    }
  });
  handle('dev:refill', () => {
    requireDev();
    const snap = account.snapshot();
    account.state.credits = snap.allowance;
    account._save();
    return { ok: true, account: account.snapshot() };
  });
  handle('dev:reset', () => {
    requireDev();
    return { ok: true, account: account.reset() };
  });
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(() => {
    const dir = app.getPath('userData');
    const projects = new Projects(path.join(dir, 'projects'), crypto.randomUUID);
    account = new Account(new JsonFile(path.join(dir, 'account.json')));
    secrets = new Secrets(new JsonFile(path.join(dir, 'secrets.json')), safeStorage);
    service = new Service({
      account,
      projects,
      getKey: () => secrets.get(),
      base: process.env.GAMEBUD_API_BASE || gemini.DEFAULT_BASE,
      uuid: crypto.randomUUID,
      log: (...a) => console.error(...a),
    });

    session.defaultSession.setPermissionRequestHandler((_wc, _perm, cb) => cb(false));
    session.defaultSession.setPermissionCheckHandler(() => false);

    setupMenu();
    setupProtocol(projects);
    registerIpc(projects);
    createWindow();

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow();
    });
  });

  app.on('before-quit', () => service && service.shutdown());
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit();
  });
}
