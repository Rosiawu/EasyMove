const path = require('node:path');
const { Worker } = require('node:worker_threads');

class FolderSizeService {
  constructor(options = {}) {
    const bundledWorkerPath = path.join(__dirname, 'folder-size-worker.js');
    this.workerPath = options.workerPath || bundledWorkerPath.replace(
      `${path.sep}app.asar${path.sep}`,
      `${path.sep}app.asar.unpacked${path.sep}`
    );
    this.ttlMs = options.ttlMs ?? 30_000;
    this.cache = new Map();
    this.pending = new Map();
    this.nextId = 1;
    this.worker = options.worker || new Worker(this.workerPath);
    this.worker.on('message', (message) => this.handleMessage(message));
    this.worker.on('error', (error) => this.handleFailure(error));
    this.worker.on('exit', (code) => {
      if (code !== 0) this.handleFailure(new Error(`Folder size worker stopped with code ${code}`));
    });
  }

  async measure(paths) {
    const uniquePaths = Array.from(new Set(paths.map((item) => path.resolve(item))));
    const now = Date.now();
    const results = [];
    const missing = [];
    for (const item of uniquePaths) {
      const cached = this.cache.get(item);
      if (cached && now - cached.cachedAt < this.ttlMs) results.push({ path: item, size: cached.size });
      else missing.push(item);
    }
    if (!missing.length) return results;

    const measured = await new Promise((resolve, reject) => {
      const id = this.nextId++;
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, paths: missing });
    });
    for (const result of measured) this.cache.set(result.path, { size: result.size, cachedAt: Date.now() });
    return results.concat(measured);
  }

  invalidate() {
    this.cache.clear();
  }

  handleMessage(message) {
    const pending = this.pending.get(message.id);
    if (!pending) return;
    this.pending.delete(message.id);
    if (message.error) pending.reject(new Error(message.error));
    else pending.resolve(message.results);
  }

  handleFailure(error) {
    for (const pending of this.pending.values()) pending.reject(error);
    this.pending.clear();
  }

  async close() {
    await this.worker.terminate();
  }
}

module.exports = { FolderSizeService };
