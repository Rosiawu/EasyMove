const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { TransferJournal } = require('../src/transfer-journal');

test('transfer journal persists checkpoints and marks active work interrupted after restart', async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'easymove-transfer-journal-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, 'queue.json');
  const journal = new TransferJournal({ filePath });
  const task = await journal.create({ id: 'task-1', sources: ['/tmp/source'], targetDirectory: '/tmp/target', mode: 'copy' });
  await journal.update(task.id, { status: 'active', completed: 1024, files: { '/tmp/target/source': { status: 'partial', size: 2048, mtime: 10 } } });
  const restored = new TransferJournal({ filePath });
  await restored.load();
  assert.equal(restored.get(task.id).status, 'interrupted');
  assert.equal(restored.get(task.id).completed, 1024);
  assert.equal(restored.get(task.id).files['/tmp/target/source'].status, 'partial');
});
