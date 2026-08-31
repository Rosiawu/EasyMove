const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { RecentItems } = require('../src/recent-items');

test('recent items persist newest-first and de-duplicate revisited paths', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'easymove-recent-'));
  const filePath = path.join(directory, 'recent.json');
  const recent = new RecentItems({ filePath, limit: 3 });
  await recent.load();
  await recent.touch(['/tmp/first', '/tmp/second']);
  await recent.touch('/tmp/first');
  assert.deepEqual(recent.list().map((item) => item.path), ['/tmp/first', '/tmp/second']);
  const restored = new RecentItems({ filePath, limit: 3 });
  await restored.load();
  assert.deepEqual(restored.list().map((item) => item.path), ['/tmp/first', '/tmp/second']);
  await fs.rm(directory, { recursive: true, force: true });
});

test('recent items recover from corrupt storage and enforce the limit', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'easymove-recent-corrupt-'));
  const filePath = path.join(directory, 'recent.json');
  await fs.writeFile(filePath, '{broken');
  const recent = new RecentItems({ filePath, limit: 2 });
  assert.deepEqual(await recent.load(), []);
  await recent.touch(['/tmp/a', '/tmp/b', '/tmp/c']);
  assert.deepEqual(recent.list().map((item) => item.path), ['/tmp/a', '/tmp/b']);
  await fs.rm(directory, { recursive: true, force: true });
});

test('concurrent recent updates serialize their atomic writes', async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), 'easymove-recent-concurrent-'));
  const filePath = path.join(directory, 'recent.json');
  const recent = new RecentItems({ filePath, limit: 10 });
  await recent.load();
  await Promise.all(['/tmp/one', '/tmp/two', '/tmp/three', '/tmp/four'].map((itemPath) => recent.touch(itemPath)));
  const stored = JSON.parse(await fs.readFile(filePath, 'utf8'));
  assert.equal(stored.length, 4);
  assert.deepEqual(new Set(stored.map((item) => item.path)), new Set(['/tmp/one', '/tmp/two', '/tmp/three', '/tmp/four']));
  await fs.rm(directory, { recursive: true, force: true });
});
