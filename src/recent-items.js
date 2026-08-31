const fs = require('node:fs/promises');
const path = require('node:path');

class RecentItems {
  constructor({ filePath, limit = 120 }) {
    this.filePath = filePath;
    this.limit = limit;
    this.items = [];
    this.writeQueue = Promise.resolve();
  }

  async load() {
    try {
      const stored = JSON.parse(await fs.readFile(this.filePath, 'utf8'));
      this.items = Array.isArray(stored)
        ? stored.filter((item) => item && typeof item.path === 'string' && Number.isFinite(item.usedAt)).slice(0, this.limit)
        : [];
    } catch {
      this.items = [];
    }
    return this.list();
  }

  list() {
    return this.items.map((item) => ({ ...item }));
  }

  async touch(paths) {
    const now = Date.now();
    const incoming = Array.from(new Set((Array.isArray(paths) ? paths : [paths])
      .filter(Boolean)
      .map((item) => path.resolve(String(item)))));
    if (!incoming.length) return this.list();
    const incomingSet = new Set(incoming);
    this.items = [
      ...incoming.map((itemPath, index) => ({ path: itemPath, usedAt: now - index })),
      ...this.items.filter((item) => !incomingSet.has(item.path))
    ].slice(0, this.limit);
    const snapshot = this.list();
    this.writeQueue = this.writeQueue.catch(() => {}).then(() => this.save(snapshot));
    await this.writeQueue;
    return this.list();
  }

  async save(items = this.items) {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await fs.writeFile(temporary, JSON.stringify(items, null, 2));
    await fs.rename(temporary, this.filePath);
  }
}

module.exports = { RecentItems };
