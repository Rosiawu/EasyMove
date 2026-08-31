const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { ContentIndexService } = require('../src/content-index-service');

const waitFor = async (check, timeout = 10000) => {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    const value = check();
    if (value) return value;
    await new Promise((resolve) => setTimeout(resolve, 40));
  }
  throw new Error('Timed out waiting for content index');
};

test('independent SQLite index finds Chinese file content and removes stale paths', async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'easymove-content-index-'));
  const root = path.join(directory, '文稿');
  await fsp.mkdir(root);
  const source = path.join(root, '播客脚本.md');
  await fsp.writeFile(source, '灯下白视频播客从教学现场开始。');
  const service = new ContentIndexService({
    databasePath: path.join(directory, 'content.sqlite'),
    settingsPath: path.join(directory, 'settings.json')
  });
  t.after(async () => { await service.close(); await fsp.rm(directory, { recursive: true, force: true }); });
  await service.start([root]);
  await waitFor(() => service.snapshot().phase === 'ready');
  const results = await service.search('视频播客');
  assert.equal(results.length, 1);
  assert.equal(results[0].path, source);
  await fsp.rm(source);
  const previousCompletion = service.snapshot().completedAt;
  await service.refresh();
  await waitFor(() => service.snapshot().phase === 'ready' && service.snapshot().completedAt !== previousCompletion);
  assert.deepEqual(await service.search('视频播客'), []);
});
