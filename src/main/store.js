'use strict';

const fs = require('fs');
const path = require('path');

// Small JSON file with atomic writes. A corrupt file is set aside instead of
// crashing the app or silently being overwritten.
class JsonFile {
  constructor(file) {
    this.file = file;
    fs.mkdirSync(path.dirname(file), { recursive: true });
  }

  read(fallback) {
    let raw;
    try {
      raw = fs.readFileSync(this.file, 'utf8');
    } catch {
      return fallback;
    }
    try {
      return JSON.parse(raw);
    } catch {
      try {
        fs.renameSync(this.file, `${this.file}.corrupt-${Date.now()}`);
      } catch {}
      return fallback;
    }
  }

  write(data) {
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(data));
    fs.renameSync(tmp, this.file);
  }
}

const ID = /^[a-f0-9-]{36}$/;

// One JSON file per project, textures as image files next to them.
class Projects {
  constructor(dir, randomUUID) {
    this.dir = dir;
    this.texDir = path.join(dir, 'textures');
    this.uuid = randomUUID;
    fs.mkdirSync(dir, { recursive: true });
  }

  _file(id) {
    if (!ID.test(id)) throw new Error('bad id');
    return new JsonFile(path.join(this.dir, `${id}.json`));
  }

  list() {
    const out = [];
    for (const f of fs.readdirSync(this.dir)) {
      if (!f.endsWith('.json')) continue;
      const p = this.get(f.slice(0, -5));
      if (p) out.push({ id: p.id, title: p.title, updatedAt: p.updatedAt, hasGame: !!p.game });
    }
    return out.sort((a, b) => b.updatedAt - a.updatedAt);
  }

  get(id) {
    if (!ID.test(id)) return null;
    const p = this._file(id).read(null);
    return p && p.id === id ? p : null;
  }

  create() {
    const now = Date.now();
    const p = {
      id: this.uuid(),
      title: 'Untitled game',
      titleAuto: true,
      createdAt: now,
      updatedAt: now,
      messages: [],
      game: null,
      versions: [],
      textures: [],
    };
    this._file(p.id).write(p);
    return p;
  }

  save(p) {
    p.updatedAt = Date.now();
    this._file(p.id).write(p);
    return p;
  }

  delete(id) {
    if (!ID.test(id)) return;
    fs.rmSync(path.join(this.dir, `${id}.json`), { force: true });
    fs.rmSync(path.join(this.texDir, id), { recursive: true, force: true });
  }

  texturePath(projectId, texId, ext) {
    if (!ID.test(projectId) || !ID.test(texId)) throw new Error('bad id');
    return path.join(this.texDir, projectId, `${texId}.${ext}`);
  }
}

module.exports = { JsonFile, Projects, ID };
