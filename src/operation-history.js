const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

class OperationHistory {
  constructor({ filePath, limit = 100 } = {}) {
    this.filePath = filePath;
    this.limit = limit;
    this.entries = [];
    this.writeChain = Promise.resolve();
  }

  async load() {
    try {
      const payload = JSON.parse(await fsp.readFile(this.filePath, 'utf8'));
      this.entries = Array.isArray(payload.entries) ? payload.entries.slice(0, this.limit) : [];
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      this.entries = [];
    }
    return this.list();
  }

  list() {
    return structuredClone(this.entries);
  }

  get(id) {
    const entry = this.entries.find((item) => item.id === id);
    return entry ? structuredClone(entry) : null;
  }

  latestUndoable() {
    const entry = this.entries.find((item) => item.canUndo && item.status !== 'undone');
    return entry ? structuredClone(entry) : null;
  }

  async record(input) {
    const entry = {
      id: input.id || `history-${randomUUID()}`,
      type: String(input.type || 'unknown'),
      label: String(input.label || '文件操作'),
      createdAt: Number(input.createdAt || Date.now()),
      status: input.status || (input.errors?.length ? 'partial' : 'completed'),
      canUndo: Boolean(input.canUndo),
      items: Array.isArray(input.items) ? structuredClone(input.items) : [],
      errors: Array.isArray(input.errors) ? [...input.errors] : [],
      retry: input.retry ? structuredClone(input.retry) : null
    };
    this.entries = [entry, ...this.entries.filter((item) => item.id !== entry.id)].slice(0, this.limit);
    await this.persist();
    return structuredClone(entry);
  }

  async update(id, changes) {
    const index = this.entries.findIndex((item) => item.id === id);
    if (index < 0) return null;
    this.entries[index] = { ...this.entries[index], ...structuredClone(changes) };
    await this.persist();
    return structuredClone(this.entries[index]);
  }

  async persist() {
    const snapshot = JSON.stringify({ version: 1, entries: this.entries }, null, 2);
    this.writeChain = this.writeChain.then(async () => {
      await fsp.mkdir(path.dirname(this.filePath), { recursive: true });
      const temporary = `${this.filePath}.tmp`;
      await fsp.writeFile(temporary, snapshot);
      await fsp.rename(temporary, this.filePath);
    });
    return this.writeChain;
  }
}

module.exports = { OperationHistory };
