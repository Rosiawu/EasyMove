const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { FolderSizeService } = require('../src/folder-size-service');

class FakeWorker extends EventEmitter {
  messages = [];
  postMessage(message) { this.messages.push(message); }
  terminate() { return Promise.resolve(); }
}

test('caches results and invalidates them after file operations', async () => {
  const worker = new FakeWorker();
  const service = new FolderSizeService({ worker });
  const first = service.measure(['/tmp/folder']);
  worker.emit('message', { id: worker.messages[0].id, results: [{ path: '/tmp/folder', size: 12 }] });
  assert.deepEqual(await first, [{ path: '/tmp/folder', size: 12 }]);
  assert.deepEqual(await service.measure(['/tmp/folder']), [{ path: '/tmp/folder', size: 12 }]);
  assert.equal(worker.messages.length, 1);
  service.invalidate();
  const refreshed = service.measure(['/tmp/folder']);
  worker.emit('message', { id: worker.messages[1].id, results: [{ path: '/tmp/folder', size: 18 }] });
  assert.deepEqual(await refreshed, [{ path: '/tmp/folder', size: 18 }]);
});

test('keeps concurrent request results associated with their request', async () => {
  const worker = new FakeWorker();
  const service = new FolderSizeService({ worker });
  const stale = service.measure(['/tmp/old']);
  const current = service.measure(['/tmp/new']);
  worker.emit('message', { id: worker.messages[1].id, results: [{ path: '/tmp/new', size: 2 }] });
  worker.emit('message', { id: worker.messages[0].id, results: [{ path: '/tmp/old', size: 1 }] });
  assert.deepEqual(await current, [{ path: '/tmp/new', size: 2 }]);
  assert.deepEqual(await stale, [{ path: '/tmp/old', size: 1 }]);
});

test('persists warm folder sizes across service restarts', async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'easymove-size-cache-'));
  const cacheFile = path.join(directory, 'folder-sizes.json');
  const firstWorker = new FakeWorker();
  const first = new FolderSizeService({ worker: firstWorker, cacheFile });
  const measured = first.measure(['/tmp/persistent-folder']);
  firstWorker.emit('message', { id: firstWorker.messages[0].id, results: [{ path: '/tmp/persistent-folder', size: 42 }] });
  await measured;
  await first.close();

  const secondWorker = new FakeWorker();
  const second = new FolderSizeService({ worker: secondWorker, cacheFile });
  assert.deepEqual(await second.measure(['/tmp/persistent-folder']), [{ path: '/tmp/persistent-folder', size: 42 }]);
  assert.equal(secondWorker.messages.length, 0);
  await second.close();
  await fsp.rm(directory, { recursive: true, force: true });
});
