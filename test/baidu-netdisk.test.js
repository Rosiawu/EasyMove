const assert = require('node:assert/strict');
const test = require('node:test');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const {
  BAIDU_APP_GROUP,
  BAIDU_UPLOAD_EVENT,
  cleanupExpiredStaging,
  createUploadPayload,
  defaultPreferenceDomain,
  defaultStagingRoot,
  monitorStagedUpload,
  stageUploadItems,
  uploadToBaiduNetdiskMac
} = require('../src/baidu-netdisk');

test('Baidu upload payload keeps files and folders in one de-duplicated batch', async () => {
  const root = path.resolve('/tmp/EasyMove 百度测试');
  const file = path.join(root, '文件.txt');
  const folder = path.join(root, '文件夹');
  const payload = await createUploadPayload([file, folder, file], async (itemPath) => ({
    isDirectory: () => itemPath === folder
  }));
  assert.deepEqual(JSON.parse(payload), [
    { local_path: file, is_dir: false },
    { local_path: folder, is_dir: true }
  ]);
});

test('Baidu preference domain targets its signed App Group', () => {
  assert.equal(
    defaultPreferenceDomain('/Users/tester'),
    `/Users/tester/Library/Group Containers/${BAIDU_APP_GROUP}/Library/Preferences/${BAIDU_APP_GROUP}`
  );
  assert.equal(
    defaultStagingRoot('/Users/tester'),
    `/Users/tester/Library/Group Containers/${BAIDU_APP_GROUP}/Library/Caches/EasyMoveUploadStaging`
  );
});

test('Baidu upload staging preserves file names and verifies folder structure', async (context) => {
  const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'easymove-baidu-stage-'));
  context.after(() => fsp.rm(temporaryRoot, { recursive: true, force: true }));
  const sourceRoot = path.join(temporaryRoot, 'source');
  const stagingRoot = path.join(temporaryRoot, 'staging');
  const file = path.join(sourceRoot, '照片.jpg');
  const folder = path.join(sourceRoot, '归档');
  await fsp.mkdir(path.join(folder, '子目录'), { recursive: true });
  await fsp.writeFile(file, 'image-data');
  await fsp.writeFile(path.join(folder, '子目录', '说明.txt'), '保持原内容');

  const batch = await stageUploadItems([
    { local_path: file, is_dir: false },
    { local_path: folder, is_dir: true }
  ], { stagingRoot, batchId: 'fixed-batch' });

  assert.equal(path.basename(batch.items[0].local_path), '照片.jpg');
  assert.equal(path.basename(batch.items[1].local_path), '归档');
  assert.equal(await fsp.readFile(batch.items[0].local_path, 'utf8'), 'image-data');
  assert.equal(
    await fsp.readFile(path.join(batch.items[1].local_path, '子目录', '说明.txt'), 'utf8'),
    '保持原内容'
  );
});

test('macOS Baidu upload stages inaccessible paths before posting one direct local queue event', async () => {
  const calls = [];
  const preferenceDomain = '/mock/BaiduGroup/Preferences/domain';
  const file = '/tmp/交给百度网盘.txt';
  const folder = '/tmp/交给百度网盘文件夹';
  const stagedFile = '/mock/AppGroup/0001/交给百度网盘.txt';
  const stagedFolder = '/mock/AppGroup/0002/交给百度网盘文件夹';
  const result = await uploadToBaiduNetdiskMac([file, folder], {
    preferenceDomain,
    stat: async (itemPath) => ({ isDirectory: () => itemPath === folder }),
    pathExists: (itemPath) => itemPath === `${preferenceDomain}.plist`,
    stageItems: async () => ({
      batchDirectory: '/mock/AppGroup',
      items: [
        { local_path: stagedFile, is_dir: false },
        { local_path: stagedFolder, is_dir: true }
      ]
    }),
    monitor: async () => ({ cleaned: true }),
    execute: async (command, args) => {
      calls.push([command, args]);
      return { stdout: '' };
    }
  });

  assert.deepEqual(calls[0], ['/usr/bin/open', ['-b', 'com.baidu.netdisk']]);
  assert.equal(calls[1][0], '/usr/bin/defaults');
  assert.deepEqual(calls[1][1].slice(0, 4), ['write', preferenceDomain, 'path', '-string']);
  assert.deepEqual(JSON.parse(calls[1][1][4]), [
    { local_path: stagedFile, is_dir: false },
    { local_path: stagedFolder, is_dir: true }
  ]);
  assert.deepEqual(calls[2], ['/usr/bin/defaults', ['write', preferenceDomain, 'status', '-string', '1']]);
  assert.deepEqual(calls[3], ['/usr/bin/notifyutil', ['-p', BAIDU_UPLOAD_EVENT]]);
  assert.equal(calls.some(([command]) => command.includes('osascript') || command.includes('Finder')), false);
  assert.deepEqual(result, {
    count: 2,
    destination: '我的网盘',
    method: 'baidu-local-ipc-staged',
    requiresConfirmation: false
  });
});

test('successful Baidu upload cleanup removes only its completed staging batch', async (context) => {
  const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'easymove-baidu-cleanup-'));
  context.after(() => fsp.rm(temporaryRoot, { recursive: true, force: true }));
  const batchDirectory = path.join(temporaryRoot, 'batch');
  const stagedFile = path.join(batchDirectory, '0001', 'photo.jpg');
  await fsp.mkdir(path.dirname(stagedFile), { recursive: true });
  await fsp.writeFile(stagedFile, 'photo');

  const result = await monitorStagedUpload({
    batchDirectory,
    items: [{ local_path: stagedFile, is_dir: false }]
  }, {
    readState: async () => ({ state: 'success' }),
    pause: async () => {},
    maxPolls: 1
  });

  assert.equal(result.cleaned, true);
  await assert.rejects(fsp.access(batchDirectory), /ENOENT/);
});

test('failed Baidu upload keeps staging data available for retry', async (context) => {
  const temporaryRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'easymove-baidu-failed-'));
  context.after(() => fsp.rm(temporaryRoot, { recursive: true, force: true }));
  const stagedFile = path.join(temporaryRoot, 'photo.jpg');
  await fsp.writeFile(stagedFile, 'photo');
  const result = await monitorStagedUpload({
    batchDirectory: temporaryRoot,
    items: [{ local_path: stagedFile, is_dir: false }]
  }, {
    readState: async () => ({ state: 'failed', errorCode: 1000025 }),
    pause: async () => {},
    maxPolls: 1
  });
  assert.equal(result.cleaned, false);
  assert.equal(await fsp.readFile(stagedFile, 'utf8'), 'photo');
});

test('expired Baidu upload staging is removed without touching current batches', async (context) => {
  const stagingRoot = await fsp.mkdtemp(path.join(os.tmpdir(), 'easymove-baidu-expired-'));
  context.after(() => fsp.rm(stagingRoot, { recursive: true, force: true }));
  const oldBatch = path.join(stagingRoot, 'old');
  const currentBatch = path.join(stagingRoot, 'current');
  await fsp.mkdir(oldBatch);
  await fsp.mkdir(currentBatch);
  const oldDate = new Date('2026-08-01T00:00:00Z');
  await fsp.utimes(oldBatch, oldDate, oldDate);
  await cleanupExpiredStaging(stagingRoot, {
    now: Date.parse('2026-08-31T00:00:00Z'),
    retentionMs: 7 * 24 * 60 * 60 * 1000
  });
  await assert.rejects(fsp.access(oldBatch), /ENOENT/);
  await fsp.access(currentBatch);
});

test('macOS Baidu upload explains when the client App Group is not initialized', async () => {
  await assert.rejects(
    uploadToBaiduNetdiskMac(['/tmp/test.txt'], {
      preferenceDomain: '/missing/BaiduGroup/domain',
      stat: async () => ({ isDirectory: () => false }),
      pathExists: () => false,
      pause: async () => {},
      execute: async () => ({ stdout: '' })
    }),
    /尚未完成初始化/
  );
});

test('macOS Baidu upload reports a local queue connection failure honestly', async () => {
  let call = 0;
  await assert.rejects(
    uploadToBaiduNetdiskMac(['/tmp/test.txt'], {
      preferenceDomain: '/mock/BaiduGroup/domain',
      stat: async () => ({ isDirectory: () => false }),
      pathExists: () => true,
      stageItems: async () => ({
        batchDirectory: '/tmp/easymove-baidu-queue-failure',
        items: [{ local_path: '/tmp/easymove-baidu-queue-failure/test.txt', is_dir: false }]
      }),
      execute: async () => {
        call += 1;
        if (call > 1) throw new Error('queue unavailable');
        return { stdout: '' };
      }
    }),
    /未能连接百度网盘上传队列/
  );
});
