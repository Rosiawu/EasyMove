const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
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
