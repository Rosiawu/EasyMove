const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { captureTreeSnapshot, copyStagingPath, verifiedAtomicCopy } = require('../src/verified-copy');

test('three consecutive folder copies have identical directory structures and file hashes', async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'easymove-verified-copy-'));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const source = path.join(fixture, '归档');
  await fs.mkdir(path.join(source, '照片'), { recursive: true });
  await Promise.all([
    fs.writeFile(path.join(source, '封面.png'), crypto.randomBytes(8193)),
    fs.writeFile(path.join(source, '照片', '第一张.jpg'), crypto.randomBytes(16385)),
    fs.writeFile(path.join(source, '照片', '第二张.jpg'), crypto.randomBytes(32771))
  ]);

  const expected = await captureTreeSnapshot(source);
  for (let index = 1; index <= 3; index += 1) {
    const destination = path.join(fixture, index === 1 ? '归档 副本' : `归档 副本 ${index}`);
    const staging = copyStagingPath(destination, `operation-${index}`);
    await verifiedAtomicCopy({
      source,
      destination,
      staging,
      copyTree: (from, to) => fs.cp(from, to, { recursive: true, errorOnExist: true })
    });
    assert.deepEqual(await captureTreeSnapshot(destination), expected);
    await assert.rejects(fs.access(staging));
  }
});

test('a corrupted folder copy is rejected and never appears under its final name', async (t) => {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'easymove-corrupt-copy-'));
  t.after(() => fs.rm(fixture, { recursive: true, force: true }));
  const source = path.join(fixture, '归档');
  const destination = path.join(fixture, '归档 副本');
  const staging = copyStagingPath(destination, 'corrupt-operation');
  await fs.mkdir(source);
  await fs.writeFile(path.join(source, '照片.png'), 'original image bytes');

  await assert.rejects(verifiedAtomicCopy({
    source,
    destination,
    staging,
    copyTree: async (_from, to) => {
      await fs.mkdir(to);
      await fs.writeFile(path.join(to, '照片.png'), 'different image bytes');
    }
  }), { code: 'EASYMOVE_COPY_VERIFICATION_FAILED' });
  await assert.rejects(fs.access(destination));
  await assert.rejects(fs.access(staging));
});
