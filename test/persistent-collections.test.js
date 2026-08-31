const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { FileBasket, WorkspaceStore } = require('../src/persistent-collections');

test('file basket persists references, de-duplicates them, and removes without touching files', async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'easymove-basket-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const source = path.join(directory, '原文件.txt');
  await fsp.writeFile(source, 'keep me');
  const filePath = path.join(directory, 'basket.json');
  const basket = new FileBasket({ filePath });
  await basket.add([source, source]);
  assert.equal(basket.list().length, 1);
  const loaded = new FileBasket({ filePath });
  await loaded.load();
  assert.equal(loaded.list()[0].path, source);
  await loaded.remove([source]);
  assert.equal((await fsp.readFile(source, 'utf8')), 'keep me');
  assert.deepEqual(loaded.list(), []);
});

test('workspace store saves only stable pane state and can overwrite by id', async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'easymove-workspace-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'workspaces.json');
  const store = new WorkspaceStore({ filePath });
  const first = await store.save({
    name: '视频播客整理', layout: 2,
    panes: [{ path: '/tmp/a', viewMode: 'column', sort: { field: 'modified', direction: 'desc' }, showHidden: true, columnPath: '/tmp/a/sub', selection: ['/tmp/a/no'] }]
  });
  assert.equal(first.panes[0].selection, undefined);
  const updated = await store.save({ id: first.id, name: '视频播客整理', layout: 4, panes: [{ path: '/tmp/b' }] });
  assert.equal(updated.id, first.id);
  assert.equal(store.list().length, 1);
  const loaded = new WorkspaceStore({ filePath });
  await loaded.load();
  assert.equal(loaded.list()[0].layout, 4);
});
