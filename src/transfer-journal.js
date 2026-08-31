const fsp = require('node:fs/promises');
const path = require('node:path');
const { atomicWriteJson } = require('./persistent-collections');

class TransferJournal {
  constructor({ filePath, limit = 50 } = {}) {
    this.filePath = filePath;
    this.limit = limit;
    this.tasks = [];
    this.writeChain = Promise.resolve();
  }

  async load() {
    try {
      const payload = JSON.parse(await fsp.readFile(this.filePath, 'utf8'));
      this.tasks = Array.isArray(payload.tasks) ? payload.tasks.slice(0, this.limit) : [];
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      this.tasks = [];
    }
    let changed = false;
    this.tasks = this.tasks.map((task) => {
      if (!['active', 'measuring'].includes(task.status)) return task;
      changed = true;
      return { ...task, status: 'interrupted', updatedAt: Date.now() };
    });
    if (changed) await this.persist();
    return this.list();
  }

  list() { return structuredClone(this.tasks); }
  get(id) {
    const task = this.tasks.find((item) => item.id === id);
    return task ? structuredClone(task) : null;
  }

  async create(input) {
    const task = {
      id: String(input.id),
      sources: [...(input.sources || [])],
      targetDirectory: path.resolve(String(input.targetDirectory)),
      mode: input.mode === 'move' ? 'move' : 'copy',
      status: input.status || 'measuring',
      total: Number(input.total || 1),
      completed: Number(input.completed || 0),
      currentFile: '',
      files: {},
      plans: {},
      historyItems: [],
      errors: [],
      conflictDecision: null,
      createdAt: Number(input.createdAt || Date.now()),
      updatedAt: Date.now()
    };
    this.tasks = [task, ...this.tasks.filter((item) => item.id !== task.id)].slice(0, this.limit);
    await this.persist();
    return structuredClone(task);
  }

  async update(id, changes) {
    const index = this.tasks.findIndex((item) => item.id === id);
    if (index < 0) return null;
    this.tasks[index] = { ...this.tasks[index], ...structuredClone(changes), updatedAt: Date.now() };
    await this.persist();
    return structuredClone(this.tasks[index]);
  }

  async remove(id) {
    this.tasks = this.tasks.filter((item) => item.id !== id);
    await this.persist();
  }

  async persist() {
    const snapshot = { version: 1, tasks: this.tasks };
    this.writeChain = this.writeChain.then(() => atomicWriteJson(this.filePath, snapshot));
    return this.writeChain;
  }
}

module.exports = { TransferJournal };
