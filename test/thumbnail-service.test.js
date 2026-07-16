const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ThumbnailService } = require('../src/thumbnail-service');

async function fixture() { return fsp.mkdtemp(path.join(os.tmpdir(), 'easymove-thumb-test-')); }

test('folder cover is the first directly contained image in natural name order', async (t) => {
  const root = await fixture(); t.after(() => fsp.rm(root, { recursive: true, force: true }));
  await Promise.all(['10.png', '2.jpg', 'readme.txt'].map((name) => fsp.writeFile(path.join(root, name), 'x')));
  const service = new ThumbnailService({ cacheDirectory: path.join(root, 'cache') });
  assert.equal(await service.findFolderCover(root), path.join(root, '2.jpg'));
});

test('unsupported, missing and oversized files safely return no preview or reject with ENOENT', async (t) => {
  const root = await fixture(); t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const unsupported = path.join(root, 'data.bin'); await fsp.writeFile(unsupported, 'x');
  const service = new ThumbnailService({ cacheDirectory: path.join(root, 'cache'), maxSourceSize: 0 });
  assert.equal(await service.get(unsupported), null);
  await assert.rejects(service.get(path.join(root, 'gone.pdf')), { code: 'ENOENT' });
});

test('queue enforces concurrency and coalesces identical cache requests', async () => {
  const service = new ThumbnailService({ cacheDirectory: '/tmp/unused', concurrency: 2 });
  let active = 0; let maximum = 0;
  const jobs = Array.from({ length: 7 }, () => service.enqueue(async () => {
    active += 1; maximum = Math.max(maximum, active);
    await new Promise((resolve) => setTimeout(resolve, 15));
    active -= 1; return true;
  }));
  assert.ok((await Promise.all(jobs)).every(Boolean));
  assert.equal(maximum, 2);
});

test('pathForKey rejects traversal and only serves existing cache files', async (t) => {
  const root = await fixture(); t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const service = new ThumbnailService({ cacheDirectory: root });
  const key = 'a'.repeat(64); await fsp.writeFile(path.join(root, `${key}.png`), 'png');
  assert.equal(service.pathForKey('../secret'), null);
  assert.equal(service.pathForKey(key), path.join(root, `${key}.png`));
});
