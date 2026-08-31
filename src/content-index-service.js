const { Worker } = require('node:worker_threads');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { atomicWriteJson } = require('./persistent-collections');

class ContentIndexService extends EventEmitter {
  constructor({ databasePath, settingsPath, workerPath = path.join(__dirname, 'content-index-worker.js') } = {}) {
    super();
    this.databasePath = databasePath;
    this.settingsPath = settingsPath;
    this.workerPath = workerPath;
    this.worker = null;
    this.nextId = 1;
    this.pending = new Map();
    this.roots = [];
    this.status = { phase: 'idle', roots: [] };
  }

  async loadRoots(defaultRoots = []) {
    try {
      const payload = JSON.parse(await fsp.readFile(this.settingsPath, 'utf8'));
      this.roots = Array.isArray(payload.roots) ? payload.roots.map(String) : [...defaultRoots];
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      this.roots = [...defaultRoots];
    }
    return [...this.roots];
  }

  async start(defaultRoots = []) {
    await this.loadRoots(defaultRoots);
    this.worker = new Worker(this.workerPath, { workerData: { databasePath: this.databasePath } });
    this.worker.on('message', (message) => {
      if (message.type === 'status') {
        this.status = message.status;
        this.emit('status', structuredClone(this.status));
        return;
      }
      if (message.type !== 'response') return;
      const pending = this.pending.get(message.id);
      if (!pending) return;
      this.pending.delete(message.id);
      if (message.error) {
        const error = new Error(message.error.message);
        error.code = message.error.code;
        pending.reject(error);
      } else pending.resolve(message.result);
    });
    this.worker.on('error', (error) => {
      this.status = { ...this.status, phase: 'error', error: error.message };
      this.emit('status', structuredClone(this.status));
      for (const pending of this.pending.values()) pending.reject(error);
      this.pending.clear();
    });
    await this.request('initialize', { roots: this.roots });
    return this.snapshot();
  }

  request(type, payload = {}) {
    if (!this.worker) return Promise.reject(new Error('内容索引尚未启动'));
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, payload });
    });
  }

  snapshot() {
    return { ...structuredClone(this.status), roots: [...this.roots] };
  }

  search(query, limit) { return this.request('search', { query, limit }); }
  pause() { return this.request('pause'); }
  resume() { return this.request('resume'); }
  rebuild() { return this.request('rebuild'); }
  refresh() { return this.request('refresh'); }
  clear() { return this.request('clear'); }

  async setRoots(roots) {
    this.roots = [...new Set((roots || []).map((item) => path.resolve(String(item))))];
    await atomicWriteJson(this.settingsPath, { version: 1, roots: this.roots });
    await this.request('set-roots', { roots: this.roots });
    return this.snapshot();
  }

  async close() {
    if (!this.worker) return;
    const worker = this.worker;
    this.worker = null;
    await worker.terminate();
  }
}

module.exports = { ContentIndexService };
