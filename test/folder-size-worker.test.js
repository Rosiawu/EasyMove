const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { measureDirectory } = require('../src/folder-size-worker');

async function fixture(t) {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), 'easymove-size-'));
  t.after(() => fsp.rm(root, { recursive: true, force: true }));
  return root;
}

test('measures nested and empty directories', async (t) => {
  const root = await fixture(t);
  await fsp.mkdir(path.join(root, 'nested', 'empty'), { recursive: true });
  await fsp.writeFile(path.join(root, 'one.bin'), Buffer.alloc(5));
  await fsp.writeFile(path.join(root, 'nested', 'two.bin'), Buffer.alloc(7));
  assert.equal(await measureDirectory(root), 12);
  assert.equal(await measureDirectory(path.join(root, 'nested', 'empty')), 0);
});

test('does not follow file or directory symbolic links', async (t) => {
  const root = await fixture(t);
  await fsp.mkdir(path.join(root, 'child'));
  await fsp.writeFile(path.join(root, 'child', 'file.bin'), Buffer.alloc(9));
  await fsp.symlink(root, path.join(root, 'child', 'loop'));
  await fsp.symlink(path.join(root, 'child', 'file.bin'), path.join(root, 'file-link'));
  assert.equal(await measureDirectory(root), 9);
});

test('returns unavailable for missing or unreadable roots and skips vanished children', async (t) => {
  const root = await fixture(t);
  assert.equal(await measureDirectory(path.join(root, 'missing')), null);
  const originalReaddir = fsp.readdir;
  fsp.readdir = async (target, options) => target.endsWith('denied')
    ? Promise.reject(Object.assign(new Error('denied'), { code: 'EACCES' }))
    : originalReaddir(target, options);
  try { assert.equal(await measureDirectory(path.join(root, 'denied')), null); } finally { fsp.readdir = originalReaddir; }
  await fsp.writeFile(path.join(root, 'stable'), Buffer.alloc(4));
  await fsp.writeFile(path.join(root, 'vanished'), Buffer.alloc(8));
  const originalLstat = fsp.lstat;
  fsp.lstat = async (target) => target.endsWith('vanished') ? Promise.reject(Object.assign(new Error('gone'), { code: 'ENOENT' })) : originalLstat(target);
  try { assert.equal(await measureDirectory(root), 4); } finally { fsp.lstat = originalLstat; }
});
