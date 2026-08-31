const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { performExactBatchRename, archiveType, archiveBaseName, safeArchiveEntry } = require('../src/file-actions');

test('batch rename uses temporary names so two files can swap names safely', async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'easymove-batch-rename-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const first = path.join(directory, 'A.txt');
  const second = path.join(directory, 'B.txt');
  await fsp.writeFile(first, 'content A');
  await fsp.writeFile(second, 'content B');
  await performExactBatchRename([{ source: first, destination: second }, { source: second, destination: first }]);
  assert.equal(await fsp.readFile(first, 'utf8'), 'content B');
  assert.equal(await fsp.readFile(second, 'utf8'), 'content A');
});

test('batch rename rejects duplicate destinations before touching sources', async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'easymove-batch-conflict-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const first = path.join(directory, 'A.txt');
  const second = path.join(directory, 'B.txt');
  const destination = path.join(directory, 'same.txt');
  await fsp.writeFile(first, 'A');
  await fsp.writeFile(second, 'B');
  await assert.rejects(performExactBatchRename([{ source: first, destination }, { source: second, destination }]), /新名称重复/);
  assert.equal(await fsp.readFile(first, 'utf8'), 'A');
  assert.equal(await fsp.readFile(second, 'utf8'), 'B');
});

test('archive helpers recognize supported formats and reject path traversal', () => {
  assert.equal(archiveType('/tmp/a.tar.gz'), 'tar.gz');
  assert.equal(archiveType('/tmp/a.rar'), null);
  assert.equal(archiveBaseName('/tmp/课程资料.tar.gz'), '课程资料');
  assert.equal(safeArchiveEntry('课程/第一课.txt'), true);
  assert.equal(safeArchiveEntry('../逃逸.txt'), false);
  assert.equal(safeArchiveEntry('/etc/passwd'), false);
  assert.equal(safeArchiveEntry('C:/Windows/file'), false);
});
