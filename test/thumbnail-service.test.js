const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ThumbnailService, containedSize } = require('../src/thumbnail-service');

async function fixture() { return fsp.mkdtemp(path.join(os.tmpdir(), 'easymove-thumb-test-')); }

test('thumbnail dimensions preserve landscape, portrait, panorama and square aspect ratios', () => {
  const cases = [[1200, 800, { width: 512 }], [800, 1200, { height: 512 }], [3200, 400, { width: 512 }], [900, 900, { width: 512 }]];
  for (const [width, height, expected] of cases) {
    const resized = containedSize({ getSize: () => ({ width, height }) });
    assert.deepEqual(resized, expected);
    const outputWidth = resized.width || width * (resized.height / height);
    const outputHeight = resized.height || height * (resized.width / width);
    assert.ok(Math.abs((outputWidth / outputHeight) / (width / height) - 1) < 0.01);
  }
  assert.equal(containedSize({ getSize: () => ({ width: 200, height: 400 }) }), null);
});

test('folder cover is the first directly contained image in natural name order', async (t) => {
  const root = await fixture(); t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const onePixelPng = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await Promise.all([['10.png', onePixelPng], ['2.jpg', onePixelPng], ['readme.txt', Buffer.from('x')]].map(([name, content]) => fsp.writeFile(path.join(root, name), content)));
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

test('text and OOXML previews contain real source content', async (t) => {
  const root = await fixture(); t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const textPath = path.join(root, 'notes.txt'); await fsp.writeFile(textPath, 'REAL_TEXT_SENTINEL');
  const service = new ThumbnailService({ cacheDirectory: path.join(root, 'cache') });
  const text = await service.get(textPath);
  if (text) {
    assert.equal(text.kind, 'content');
    assert.match(text.text, /REAL_TEXT_SENTINEL/);
  } else {
    assert.equal(process.platform, 'darwin');
  }
  const missingOffice = path.join(root, 'sample.docx'); await fsp.writeFile(missingOffice, 'not a zip');
  const office = await service.get(missingOffice);
  assert.equal(office.kind, 'content');
  assert.equal(office.text, '');
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

test('real PNG thumbnails survive desktop-style complex paths', async (t) => {
  const root = await fixture(); t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const directory = path.join(root, 'Desktop 风格', '下载 (测试) #100%');
  await fsp.mkdir(directory, { recursive: true });
  const source = path.join(directory, `${'很长的文件名'.repeat(12)} # 50%.png`);
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  await fsp.writeFile(source, png);
  const service = new ThumbnailService({ cacheDirectory: path.join(root, '缓存 空间') });
  service.generate = async (input, destination) => { await fsp.mkdir(path.dirname(destination), { recursive: true }); await fsp.copyFile(input, destination); return { kind: 'image' }; };
  const result = await service.get(source);
  assert.equal(result?.kind, 'image');
  assert.match(result?.key || '', /^[a-f0-9]{64}$/);
  assert.equal((await fsp.stat(service.pathForKey(result.key))).size > 0, true);
});

test('pathForKey rejects traversal and only serves existing cache files', async (t) => {
  const root = await fixture(); t.after(() => fsp.rm(root, { recursive: true, force: true }));
  const service = new ThumbnailService({ cacheDirectory: root });
  const key = 'a'.repeat(64); await fsp.writeFile(path.join(root, `${key}.png`), 'png');
  assert.equal(service.pathForKey('../secret'), null);
  assert.equal(service.pathForKey(key), path.join(root, `${key}.png`));
});
