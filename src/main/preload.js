'use strict';

const { contextBridge, ipcRenderer } = require('electron');

const call = (channel) => (...args) => ipcRenderer.invoke(channel, ...args);

contextBridge.exposeInMainWorld('gamebud', {
  account: call('account:get'),
  billing: { upgrade: call('billing:upgrade'), cancel: call('billing:cancel') },
  projects: {
    list: call('projects:list'),
    create: call('projects:create'),
    get: call('projects:get'),
    remove: call('projects:delete'),
    rename: call('projects:rename'),
  },
  chat: { send: call('chat:send') },
  textures: { generate: call('texture:generate'), remove: call('texture:delete') },
  game: { undo: call('game:undo'), export: call('game:export') },
  dev: {
    status: call('dev:status'),
    setKey: call('dev:setKey'),
    clearKey: call('dev:clearKey'),
    test: call('dev:test'),
    refill: call('dev:refill'),
    reset: call('dev:reset'),
    onOpen(cb) {
      const fn = () => cb();
      ipcRenderer.on('dev:open', fn);
      return () => ipcRenderer.removeListener('dev:open', fn);
    },
  },
});
