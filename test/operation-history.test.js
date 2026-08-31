const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { OperationHistory } = require('../src/operation-history');

test('operation history persists newest-first entries and restores undo state', async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'easymove-history-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'operations.json');
  const history = new OperationHistory({ filePath, limit: 2 });
  await history.load();
  const first = await history.record({ type: 'rename', label: '重命名', canUndo: true, items: [{ source: '/a', destination: '/b' }] });
  await history.record({ type: 'copy', label: '复制', canUndo: true, items: [{ destination: '/c' }] });
  await history.record({ type: 'trash', label: '移入废纸篓', canUndo: true, items: [{ source: '/d', trashPath: '/trash/d' }] });
  assert.equal(history.list().length, 2);
  assert.equal(history.latestUndoable().type, 'trash');
  assert.equal(history.get(first.id), null, 'old entries beyond the limit are removed');

  const latest = history.latestUndoable();
  await history.update(latest.id, { status: 'undone', canUndo: false, undoneAt: 123 });
  assert.equal(history.latestUndoable().type, 'copy');

  const reloaded = new OperationHistory({ filePath, limit: 2 });
  await reloaded.load();
  assert.equal(reloaded.get(latest.id).status, 'undone');
});

test('operation history treats missing or corrupt storage as empty', async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'easymove-history-corrupt-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'operations.json');
  await fsp.writeFile(filePath, '{broken');
  const history = new OperationHistory({ filePath });
  assert.deepEqual(await history.load(), []);
});
