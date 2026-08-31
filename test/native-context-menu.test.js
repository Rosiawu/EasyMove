const test = require('node:test');
const assert = require('node:assert/strict');
const { nativeContextMenuItems } = require('../src/native-context-menu');

test('macOS item menu uses native Finder-style actions, Share, and Services', () => {
  const items = nativeContextMenuItems({
    itemContext: true,
    hasSelection: true,
    canPaste: true,
    platform: 'darwin',
    selectionCount: 1
  });
  const ids = items.filter((item) => item.id).map((item) => item.id);
  assert.deepEqual(ids, [
    'open', 'open-with', 'quick-look', 'cut', 'copy', 'basket-add', 'paste', 'rename',
    'duplicate', 'compress', 'baidu-upload', 'trash', 'get-info', 'share',
    'services', 'copy-path', 'reveal'
  ]);
  assert.equal(items.find((item) => item.id === 'share').role, 'shareMenu');
  assert.equal(items.find((item) => item.id === 'services').role, 'services');
  assert.equal(items.find((item) => item.id === 'baidu-upload').nativeAction, 'baidu-upload');
  assert.deepEqual(items.find((item) => item.id === 'copy-path'), { id: 'copy-path', label: '拷贝完整路径', command: 'copy-path', accelerator: undefined, enabled: true });
});

test('native background menu keeps folder creation, paste, selection, and Finder services', () => {
  const items = nativeContextMenuItems({ itemContext: false, canPaste: false, platform: 'darwin' });
  assert.deepEqual(items.filter((item) => item.id).map((item) => item.id), ['new-folder', 'paste', 'select-all', 'get-info', 'services']);
  assert.equal(items.find((item) => item.id === 'paste').enabled, false);
});

test('recent collection background only exposes safe selection actions', () => {
  const items = nativeContextMenuItems({ itemContext: false, virtualContext: true, platform: 'darwin' });
  assert.deepEqual(items.filter((item) => item.id).map((item) => item.id), ['select-all']);
});

test('multi-selection disables rename and labels batch actions', () => {
  const items = nativeContextMenuItems({ itemContext: true, hasSelection: true, platform: 'darwin', selectionCount: 3 });
  assert.equal(items.find((item) => item.id === 'rename'), undefined);
  assert.equal(items.find((item) => item.id === 'batch-rename').label, '批量重命名 3 个项目…');
  assert.equal(items.find((item) => item.id === 'open').label, '打开 3 个项目');
  assert.equal(items.find((item) => item.id === 'compress').label, '压缩 3 个项目');
});

test('supported archives expose two safe extraction destinations', () => {
  const items = nativeContextMenuItems({ itemContext: true, hasSelection: true, platform: 'darwin', selectionCount: 1, canExtract: true });
  const ids = items.filter((item) => item.id).map((item) => item.id);
  assert.ok(ids.includes('extract-here'));
  assert.ok(ids.includes('extract-folder'));
});

test('file basket item menu removes references instead of adding duplicates', () => {
  const items = nativeContextMenuItems({ itemContext: true, hasSelection: true, platform: 'darwin', selectionCount: 1, virtualMode: 'basket' });
  const ids = items.filter((item) => item.id).map((item) => item.id);
  assert.ok(ids.includes('basket-remove'));
  assert.ok(!ids.includes('basket-add'));
  assert.ok(!ids.includes('make-alias'));
});
