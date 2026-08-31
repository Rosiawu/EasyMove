const test = require('node:test');
const assert = require('node:assert/strict');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { chineseBigrams, indexedText, ftsQuery, shouldSkipDirectory, extractContent } = require('../src/content-index-utils');

test('Chinese bigrams make continuous content searchable without changing displayed text', () => {
  assert.deepEqual(chineseBigrams('灯下白视频播客'), ['灯下', '下白', '白视', '视频', '频播', '播客']);
  assert.match(indexedText('灯下白视频播客'), /视频 频播 播客/);
  assert.equal(ftsQuery('视频播客'), '"视频" AND "频播" AND "播客"');
});

test('index exclusions skip repositories, dependencies, hidden folders, and Library', () => {
  assert.equal(shouldSkipDirectory('.git', '/tmp/a/.git'), true);
  assert.equal(shouldSkipDirectory('node_modules', '/tmp/a/node_modules'), true);
  assert.equal(shouldSkipDirectory('Library', '/Users/a/Library'), true);
  assert.equal(shouldSkipDirectory('课程', '/Users/a/Documents/课程'), false);
});

test('content extractor reads bounded local text', async (t) => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), 'easymove-index-'));
  t.after(() => fsp.rm(directory, { recursive: true, force: true }));
  const filePath = path.join(directory, '播客脚本.md');
  await fsp.writeFile(filePath, '这一期视频播客从教学现场开始。');
  const stat = await fsp.stat(filePath);
  const result = await extractContent(filePath, stat);
  assert.match(result.content, /视频播客/);
  assert.equal(result.truncated, false);
});
