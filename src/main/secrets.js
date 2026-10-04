'use strict';

const gemini = require('./gemini');

// Stores the Gemini key. Uses the OS keychain via Electron's safeStorage when it
// is available; otherwise falls back to a plain file in the user-data folder.
// GEMINI_API_KEY in the environment is honoured as a developer fallback.
class Secrets {
  constructor(file, safeStorage, env = process.env) {
    this.file = file;
    this.safe = safeStorage;
    this.env = env;
  }

  _canEncrypt() {
    try {
      return !!(this.safe && this.safe.isEncryptionAvailable());
    } catch {
      return false;
    }
  }

  _saved() {
    const rec = this.file.read(null);
    if (!rec || typeof rec.key !== 'string') return null;
    try {
      if (rec.enc) return this.safe.decryptString(Buffer.from(rec.key, 'base64'));
      return rec.key;
    } catch {
      return null;
    }
  }

  get() {
    const saved = this._saved();
    if (saved) return saved;
    const env = gemini.normalizeKey(this.env.GEMINI_API_KEY);
    return env || '';
  }

  set(raw) {
    const key = gemini.normalizeKey(raw);
    if (!gemini.isValidKey(key)) return false;
    if (this._canEncrypt()) {
      this.file.write({ enc: true, key: this.safe.encryptString(key).toString('base64') });
    } else {
      this.file.write({ enc: false, key });
    }
    return true;
  }

  clear() {
    this.file.write({});
  }

  status() {
    const saved = this._saved();
    const key = saved || gemini.normalizeKey(this.env.GEMINI_API_KEY);
    return {
      hasKey: !!key,
      source: saved ? 'saved' : key ? 'env' : 'none',
      last4: key ? key.slice(-4) : '',
      encrypted: !!saved && !!(this.file.read({}) || {}).enc,
    };
  }
}

module.exports = { Secrets };
