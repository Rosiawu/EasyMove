const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { writeFilesToSystemClipboard } = require('../src/file-clipboard');

test('macOS file clipboard passes de-duplicated absolute paths to the native pasteboard helper', async () => {
  const calls = [];
  const result = await writeFilesToSystemClipboard(['相片.jpg', '相片.jpg'], {
    platform: 'darwin',
    helperPath: '/helper',
    exists: () => true,
    execute: async (...args) => calls.push(args)
  });
  assert.deepEqual(result, { written: true, count: 1, platform: 'darwin' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], '/helper');
  assert.deepEqual(calls[0][1], ['--write', path.resolve('相片.jpg')]);
});

test('non-macOS file clipboard reports unsupported without launching a helper', async () => {
  let launched = false;
  const result = await writeFilesToSystemClipboard(['/照片.png'], {
    platform: 'win32',
    exists: () => true,
    execute: async () => { launched = true; }
  });
  assert.deepEqual(result, { written: false, count: 1, platform: 'win32' });
  assert.equal(launched, false);
});
