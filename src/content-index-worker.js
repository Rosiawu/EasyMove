const { parentPort, workerData } = require('node:worker_threads');
const { DatabaseSync } = require('node:sqlite');
const fsp = require('node:fs/promises');
const path = require('node:path');
const { extractContent, indexedText, ftsQuery, shouldSkipDirectory } = require('./content-index-utils');

let database = null;
let roots = [];
let paused = false;
let scanGeneration = 0;
let status = { phase: 'idle', processed: 0, indexed: 0, currentPath: '', roots: [], errors: [] };

function postStatus(changes = {}) {
  status = { ...status, ...changes, roots: [...roots] };
  parentPort.postMessage({ type: 'status', status });
}

function openDatabase() {
  if (database) return database;
  database = new DatabaseSync(workerData.databasePath);
  database.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA temp_store=MEMORY;');
  database.exec(`
    CREATE TABLE IF NOT EXISTS documents (
      path TEXT PRIMARY KEY,
      root TEXT NOT NULL,
      name TEXT NOT NULL,
      parent TEXT NOT NULL,
      extension TEXT NOT NULL,
      kind TEXT NOT NULL,
      is_directory INTEGER NOT NULL,
      size INTEGER NOT NULL,
      modified REAL NOT NULL,
      content TEXT NOT NULL,
      content_truncated INTEGER NOT NULL DEFAULT 0,
      indexed_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS documents_root ON documents(root);
    CREATE INDEX IF NOT EXISTS documents_modified ON documents(modified);
    CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
      path UNINDEXED, name, parent, content, tokens,
      tokenize='unicode61 remove_diacritics 2'
    );
  `);
  return database;
}

const statements = () => ({
  existing: database.prepare('SELECT size, modified, is_directory FROM documents WHERE path = ?'),
  upsert: database.prepare(`INSERT INTO documents(path,root,name,parent,extension,kind,is_directory,size,modified,content,content_truncated,indexed_at)
    VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(path) DO UPDATE SET root=excluded.root,name=excluded.name,parent=excluded.parent,extension=excluded.extension,kind=excluded.kind,is_directory=excluded.is_directory,size=excluded.size,modified=excluded.modified,content=excluded.content,content_truncated=excluded.content_truncated,indexed_at=excluded.indexed_at`),
  deleteFts: database.prepare('DELETE FROM documents_fts WHERE path = ?'),
  insertFts: database.prepare('INSERT INTO documents_fts(path,name,parent,content,tokens) VALUES(?,?,?,?,?)'),
  pathsForRoot: database.prepare('SELECT path FROM documents WHERE root = ?'),
  deleteDocument: database.prepare('DELETE FROM documents WHERE path = ?')
});

async function waitIfPaused(generation) {
  while (paused && generation === scanGeneration) await new Promise((resolve) => setTimeout(resolve, 120));
}

async function indexRoot(root, generation, prepared) {
  const seen = new Set();
  const stack = [root];
  let batch = 0;
  database.exec('BEGIN');
  try {
    while (stack.length && generation === scanGeneration) {
      await waitIfPaused(generation);
      const current = stack.pop();
      let dirents;
      try { dirents = await fsp.readdir(current, { withFileTypes: true }); }
      catch (error) {
        status.errors = [...status.errors.slice(-19), { path: current, code: error.code || 'READ_FAILED' }];
        continue;
      }
      for (const dirent of dirents) {
        if (generation !== scanGeneration) break;
        const fullPath = path.join(current, dirent.name);
        if (dirent.isSymbolicLink()) continue;
        if (dirent.isDirectory() && shouldSkipDirectory(dirent.name, fullPath)) continue;
        let stat;
        try { stat = await fsp.lstat(fullPath); } catch { continue; }
        if (!stat.isFile() && !stat.isDirectory()) continue;
        seen.add(fullPath);
        status.processed += 1;
        status.currentPath = fullPath;
        const existing = prepared.existing.get(fullPath);
        const isDirectory = stat.isDirectory();
        if (!existing || existing.size !== stat.size || existing.modified !== stat.mtimeMs || Boolean(existing.is_directory) !== isDirectory) {
          const extracted = isDirectory ? { content: '', truncated: false } : await extractContent(fullPath, stat);
          const extension = isDirectory ? '' : path.extname(dirent.name).slice(1).toLocaleLowerCase();
          const kind = isDirectory ? '文件夹' : (extension.toLocaleUpperCase() || '文件');
          const now = Date.now();
          prepared.upsert.run(fullPath, root, dirent.name, current, extension, kind, isDirectory ? 1 : 0, stat.size, stat.mtimeMs, extracted.content, extracted.truncated ? 1 : 0, now);
          prepared.deleteFts.run(fullPath);
          prepared.insertFts.run(fullPath, dirent.name, current, extracted.content, indexedText(`${dirent.name}\n${current}\n${extracted.content}`));
          status.indexed += 1;
        }
        if (isDirectory) stack.push(fullPath);
        batch += 1;
        if (batch >= 100) {
          database.exec('COMMIT; BEGIN');
          batch = 0;
          postStatus();
          await new Promise((resolve) => setImmediate(resolve));
        }
      }
    }
    if (generation === scanGeneration) {
      for (const row of prepared.pathsForRoot.all(root)) {
        if (seen.has(row.path)) continue;
        prepared.deleteFts.run(row.path);
        prepared.deleteDocument.run(row.path);
      }
    }
    database.exec('COMMIT');
  } catch (error) {
    try { database.exec('ROLLBACK'); } catch {}
    throw error;
  }
}

async function rebuildIndex({ clear = false } = {}) {
  openDatabase();
  const generation = ++scanGeneration;
  if (clear) database.exec('DELETE FROM documents; DELETE FROM documents_fts;');
  status = { phase: paused ? 'paused' : 'indexing', processed: 0, indexed: 0, currentPath: '', roots: [...roots], errors: [] };
  postStatus();
  const prepared = statements();
  for (const root of roots) {
    if (generation !== scanGeneration) return;
    try {
      const stat = await fsp.stat(root);
      if (stat.isDirectory()) await indexRoot(root, generation, prepared);
    } catch (error) {
      status.errors.push({ path: root, code: error.code || 'ROOT_UNAVAILABLE' });
    }
  }
  if (generation !== scanGeneration) return;
  const count = Number(database.prepare('SELECT count(*) AS count FROM documents').get().count);
  let bytes = 0;
  try { bytes = (await fsp.stat(workerData.databasePath)).size; } catch {}
  postStatus({ phase: paused ? 'paused' : 'ready', count, bytes, currentPath: '', completedAt: Date.now() });
}

function search(query, limit = 200) {
  openDatabase();
  const match = ftsQuery(query);
  if (!match) return [];
  const rows = database.prepare(`SELECT d.*, snippet(documents_fts,3,'','','…',18) AS snippet
    FROM documents_fts JOIN documents d ON d.path = documents_fts.path
    WHERE documents_fts MATCH ? ORDER BY rank LIMIT ?`).all(match, Math.max(1, Math.min(1000, Number(limit) || 200)));
  return rows.map((row) => ({
    name: row.name,
    path: row.path,
    isDirectory: Boolean(row.is_directory),
    isSymbolicLink: false,
    size: row.size,
    modified: row.modified,
    extension: row.extension,
    kind: row.kind,
    searchSnippet: row.snippet || '',
    contentTruncated: Boolean(row.content_truncated)
  }));
}

async function handle(message) {
  const { id, type, payload = {} } = message;
  try {
    let result = null;
    if (type === 'initialize') {
      await fsp.mkdir(path.dirname(workerData.databasePath), { recursive: true });
      roots = [...new Set((payload.roots || []).map((item) => path.resolve(String(item))))];
      openDatabase();
      result = status;
      void rebuildIndex();
    } else if (type === 'search') result = search(payload.query, payload.limit);
    else if (type === 'rebuild') { void rebuildIndex({ clear: true }); result = true; }
    else if (type === 'refresh') { void rebuildIndex(); result = true; }
    else if (type === 'pause') { paused = true; postStatus({ phase: 'paused' }); result = true; }
    else if (type === 'resume') { paused = false; postStatus({ phase: status.processed ? 'indexing' : 'idle' }); result = true; }
    else if (type === 'set-roots') { roots = [...new Set((payload.roots || []).map((item) => path.resolve(String(item))))]; void rebuildIndex(); result = roots; }
    else if (type === 'clear') {
      scanGeneration += 1;
      openDatabase().exec('DELETE FROM documents; DELETE FROM documents_fts;');
      status = { phase: 'idle', processed: 0, indexed: 0, count: 0, bytes: 0, currentPath: '', roots: [...roots], errors: [] };
      postStatus();
      result = true;
    } else if (type === 'status') result = status;
    parentPort.postMessage({ type: 'response', id, result });
  } catch (error) {
    parentPort.postMessage({ type: 'response', id, error: { message: error.message || String(error), code: error.code || 'INDEX_ERROR' } });
    postStatus({ phase: 'error', error: error.message || String(error) });
  }
}

parentPort.on('message', (message) => void handle(message));
