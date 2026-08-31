const test = require('node:test');
const assert = require('node:assert/strict');
const { finderInfoAppleScriptLines, showFinderInfo } = require('../src/finder-info');

test('Finder Get Info activates Finder before and after opening the information window', async () => {
  const calls = [];
  const itemPath = '/Volumes/SD_Card/DCIM/DJI_001/照片.JPG';
  await showFinderInfo(itemPath, async (lines, args) => calls.push({ lines, args }));

  assert.deepEqual(calls[0].args, [itemPath]);
  assert.equal(calls[0].lines.filter((line) => line === 'activate').length, 2);
  assert.ok(calls[0].lines.includes('set infoWindow to open information window of targetItem'));
  assert.deepEqual(calls[0].lines, finderInfoAppleScriptLines());
});

test('Finder Get Info rejects an empty selection', async () => {
  await assert.rejects(showFinderInfo('', async () => {}), /请先选择一个项目/);
});
