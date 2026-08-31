const fsp = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

async function atomicWriteJson(filePath, payload) {
  await fsp.mkdir(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.${process.pid}.tmp`;
  await fsp.writeFile(temporary, JSON.stringify(payload, null, 2));
  await fsp.rename(temporary, filePath);
}

class PersistentCollection {
  constructor({ filePath, key, limit = 100 } = {}) {
    this.filePath = filePath;
    this.key = key;
    this.limit = limit;
    this.items = [];
    this.writeChain = Promise.resolve();
  }

  async load() {
    try {
      const payload = JSON.parse(await fsp.readFile(this.filePath, 'utf8'));
      this.items = Array.isArray(payload[this.key]) ? payload[this.key].slice(0, this.limit) : [];
    } catch (error) {
      if (error.code !== 'ENOENT' && !(error instanceof SyntaxError)) throw error;
      this.items = [];
    }
    return this.list();
  }

  list() {
    return structuredClone(this.items);
  }

  async persist() {
    const snapshot = { version: 1, [this.key]: this.items };
    this.writeChain = this.writeChain.then(() => atomicWriteJson(this.filePath, snapshot));
    return this.writeChain;
  }
}

class FileBasket extends PersistentCollection {
  constructor(options = {}) {
    super({ ...options, key: 'items', limit: options.limit || 500 });
  }

  async add(paths) {
    const now = Date.now();
    for (const requestedPath of paths || []) {
      const itemPath = path.resolve(String(requestedPath || ''));
      if (!itemPath) continue;
      const comparable = process.platform === 'win32' ? itemPath.toLocaleLowerCase() : itemPath;
      const existing = this.items.find((item) => (process.platform === 'win32' ? item.path.toLocaleLowerCase() : item.path) === comparable);
      if (existing) {
        existing.addedAt = now;
        continue;
      }
      this.items.unshift({ id: `basket-${randomUUID()}`, path: itemPath, addedAt: now });
    }
    this.items = this.items.slice(0, this.limit);
    await this.persist();
    return this.list();
  }

  async remove(idsOrPaths) {
    const targets = new Set((idsOrPaths || []).map(String));
    this.items = this.items.filter((item) => !targets.has(item.id) && !targets.has(item.path));
    await this.persist();
    return this.list();
  }

  async clear() {
    this.items = [];
    await this.persist();
    return [];
  }
}

function cleanPane(pane = {}) {
  return {
    path: String(pane.path || ''),
    viewMode: ['list', 'icon', 'column', 'gallery'].includes(pane.viewMode) ? pane.viewMode : 'list',
    sort: {
      field: ['name', 'type', 'modified', 'size'].includes(pane.sort?.field) ? pane.sort.field : 'name',
      direction: pane.sort?.direction === 'desc' ? 'desc' : 'asc'
    },
    showHidden: Boolean(pane.showHidden),
    columnPath: pane.columnPath ? String(pane.columnPath) : null
  };
}

class WorkspaceStore extends PersistentCollection {
  constructor(options = {}) {
    super({ ...options, key: 'workspaces', limit: options.limit || 50 });
  }

  async save(input = {}) {
    const name = String(input.name || '').trim();
    if (!name) throw new Error('请输入工作区名称');
    const requestedId = input.id ? String(input.id) : null;
    const existing = requestedId
      ? this.items.find((item) => item.id === requestedId)
      : this.items.find((item) => item.name === name);
    const workspace = {
      id: existing?.id || `workspace-${randomUUID()}`,
      name,
      layout: [1, 2, 4].includes(Number(input.layout)) ? Number(input.layout) : 2,
      panes: (input.panes || []).slice(0, 4).map(cleanPane),
      createdAt: existing?.createdAt || Date.now(),
      updatedAt: Date.now()
    };
    this.items = [workspace, ...this.items.filter((item) => item.id !== workspace.id)].slice(0, this.limit);
    await this.persist();
    return structuredClone(workspace);
  }

  async remove(id) {
    this.items = this.items.filter((item) => item.id !== String(id));
    await this.persist();
    return this.list();
  }
}

module.exports = { FileBasket, WorkspaceStore, atomicWriteJson, cleanPane };
