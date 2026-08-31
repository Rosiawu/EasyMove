const fs = require('node:fs');
const fsp = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { execFile } = require('node:child_process');
const { promisify } = require('node:util');

const execFileAsync = promisify(execFile);
const BAIDU_BUNDLE_ID = 'com.baidu.netdisk';
const BAIDU_APP_GROUP = 'LKD5676Y5W.com.baidu.netdisk';
const BAIDU_UPLOAD_EVENT = 'upload_file';
const STAGING_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
let uploadQueue = Promise.resolve();

async function createUploadItems(paths, stat = fsp.stat) {
  const uniquePaths = [...new Set((paths || []).map((itemPath) => path.resolve(String(itemPath))))];
  if (!uniquePaths.length) throw new Error('请先选择要上传的文件或文件夹');

  const items = [];
  for (const itemPath of uniquePaths) {
    let itemStat;
    try {
      itemStat = await stat(itemPath);
    } catch {
      throw new Error(`找不到要上传的项目：${path.basename(itemPath)}`);
    }
    items.push({ local_path: itemPath, is_dir: itemStat.isDirectory() });
  }
  return items;
}

async function createUploadPayload(paths, stat = fsp.stat) {
  return JSON.stringify(await createUploadItems(paths, stat));
}

function defaultPreferenceDomain(homeDirectory = os.homedir()) {
  return path.join(
    homeDirectory,
    'Library',
    'Group Containers',
    BAIDU_APP_GROUP,
    'Library',
    'Preferences',
    BAIDU_APP_GROUP
  );
}

function defaultStagingRoot(homeDirectory = os.homedir()) {
  return path.join(
    homeDirectory,
    'Library',
    'Group Containers',
    BAIDU_APP_GROUP,
    'Library',
    'Caches',
    'EasyMoveUploadStaging'
  );
}

async function describeTree(root, fileSystem = fsp) {
  const descriptions = [];

  async function visit(itemPath, relativePath) {
    const itemStat = await fileSystem.lstat(itemPath);
    if (itemStat.isSymbolicLink()) {
      descriptions.push([relativePath, 'link', await fileSystem.readlink(itemPath)]);
      return;
    }
    if (itemStat.isDirectory()) {
      descriptions.push([relativePath, 'directory', 0]);
      const children = await fileSystem.readdir(itemPath);
      children.sort((left, right) => left.localeCompare(right));
      for (const child of children) {
        await visit(path.join(itemPath, child), path.join(relativePath, child));
      }
      return;
    }
    descriptions.push([relativePath, 'file', itemStat.size]);
  }

  await visit(root, '.');
  return descriptions;
}

async function copyItemToStaging(source, destination, options = {}) {
  const fileSystem = options.fileSystem || fsp;
  const constants = options.constants || fs.constants;
  const sourceBefore = await fileSystem.lstat(source);
  await fileSystem.mkdir(path.dirname(destination), { recursive: true });

  if (sourceBefore.isDirectory()) {
    await fileSystem.cp(source, destination, {
      recursive: true,
      preserveTimestamps: true,
      verbatimSymlinks: true,
      errorOnExist: true,
      force: false
    });
    const [sourceTree, destinationTree] = await Promise.all([
      describeTree(source, fileSystem),
      describeTree(destination, fileSystem)
    ]);
    if (JSON.stringify(sourceTree) !== JSON.stringify(destinationTree)) {
      throw new Error('复制后的文件夹结构与原文件夹不一致');
    }
    return;
  }

  if (sourceBefore.isSymbolicLink()) {
    await fileSystem.symlink(await fileSystem.readlink(source), destination);
    return;
  }

  try {
    await fileSystem.copyFile(source, destination, constants.COPYFILE_FICLONE_FORCE);
  } catch (error) {
    if (!['ENOTSUP', 'ENOSYS', 'EXDEV', 'EINVAL'].includes(error.code)) throw error;
    await fileSystem.copyFile(source, destination);
  }

  const [sourceAfter, destinationStat] = await Promise.all([
    fileSystem.stat(source),
    fileSystem.stat(destination)
  ]);
  if (sourceBefore.size !== sourceAfter.size || sourceAfter.size !== destinationStat.size) {
    throw new Error('复制期间文件发生了变化');
  }
}

async function cleanupExpiredStaging(stagingRoot, options = {}) {
  const fileSystem = options.fileSystem || fsp;
  const now = options.now || Date.now();
  const retentionMs = options.retentionMs || STAGING_RETENTION_MS;
  let entries;
  try {
    entries = await fileSystem.readdir(stagingRoot, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
    const batchDirectory = path.join(stagingRoot, entry.name);
    const itemStat = await fileSystem.stat(batchDirectory);
    if (now - itemStat.mtimeMs > retentionMs) {
      await fileSystem.rm(batchDirectory, { recursive: true, force: true });
    }
  }));
}

async function stageUploadItems(items, options = {}) {
  const fileSystem = options.fileSystem || fsp;
  const stagingRoot = options.stagingRoot || defaultStagingRoot(options.homeDirectory);
  const batchId = options.batchId || `${Date.now()}-${process.pid}-${randomUUID()}`;
  const batchDirectory = path.join(stagingRoot, batchId);
  const stagedItems = [];

  await cleanupExpiredStaging(stagingRoot, { fileSystem }).catch(() => {});
  try {
    await fileSystem.mkdir(batchDirectory, { recursive: true });
    for (let index = 0; index < items.length; index += 1) {
      const item = items[index];
      const destination = path.join(
        batchDirectory,
        String(index + 1).padStart(4, '0'),
        path.basename(item.local_path)
      );
      await copyItemToStaging(item.local_path, destination, {
        fileSystem,
        constants: options.constants
      });
      stagedItems.push({ local_path: destination, is_dir: item.is_dir });
    }
    await fileSystem.writeFile(path.join(batchDirectory, '.easymove-upload.json'), JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      originalItems: items,
      stagedItems
    }, null, 2));
    return { batchDirectory, items: stagedItems };
  } catch (error) {
    await fileSystem.rm(batchDirectory, { recursive: true, force: true }).catch(() => {});
    throw new Error(`无法准备上传文件：${error.message || error}`);
  }
}

async function findUploadDatabases(homeDirectory = os.homedir(), fileSystem = fsp) {
  const applicationSupport = path.join(
    homeDirectory,
    'Library',
    'Containers',
    BAIDU_BUNDLE_ID,
    'Data',
    'Library',
    'Application Support',
    BAIDU_BUNDLE_ID
  );
  let entries;
  try {
    entries = await fileSystem.readdir(applicationSupport, { withFileTypes: true });
  } catch {
    return [];
  }
  const candidates = entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => path.join(applicationSupport, entry.name, 'upload.db'));
  const existing = [];
  for (const candidate of candidates) {
    try {
      await fileSystem.access(candidate);
      existing.push(candidate);
    } catch {}
  }
  return existing;
}

async function readBaiduUploadState(localPath, options = {}) {
  const databasePaths = options.databasePaths || await findUploadDatabases(options.homeDirectory, options.fileSystem);
  if (!databasePaths.length) return { state: 'waiting' };

  let DatabaseSync;
  try {
    ({ DatabaseSync } = require('node:sqlite'));
  } catch {
    return { state: 'waiting' };
  }

  for (const databasePath of databasePaths) {
    let database;
    try {
      database = new DatabaseSync(databasePath, { readOnly: true });
      const history = database.prepare(
        'SELECT error_code FROM upload_history_file WHERE local_path = ? ORDER BY op_endtime DESC LIMIT 1'
      ).get(localPath);
      if (history) return { state: Number(history.error_code) === 0 ? 'success' : 'failed', errorCode: history.error_code };
      const active = database.prepare(
        'SELECT status, error_code FROM upload_file WHERE local_path = ? ORDER BY add_time DESC LIMIT 1'
      ).get(localPath);
      if (active && (Number(active.status) === 5 || Number(active.error_code) !== 0)) {
        return { state: 'failed', errorCode: active.error_code };
      }
      if (active) return { state: 'uploading' };
    } catch {
      // A database can be transiently locked while Baidu Netdisk updates it.
    } finally {
      if (database) database.close();
    }
  }
  return { state: 'waiting' };
}

async function monitorStagedUpload(batch, options = {}) {
  const fileSystem = options.fileSystem || fsp;
  const readState = options.readState || ((localPath) => readBaiduUploadState(localPath, options));
  const pause = options.pause || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const pollMs = options.pollMs || 2000;
  const maxPolls = options.maxPolls || 43200;

  for (let attempt = 0; attempt < maxPolls; attempt += 1) {
    const states = await Promise.all(batch.items.map((item) => readState(item.local_path)));
    if (states.every((result) => result.state === 'success')) {
      await fileSystem.rm(batch.batchDirectory, { recursive: true, force: true });
      return { cleaned: true, states };
    }
    if (states.some((result) => result.state === 'failed')) return { cleaned: false, states };
    await pause(pollMs);
  }
  return { cleaned: false, states: [] };
}

async function performMacUpload(paths, options = {}) {
  const execute = options.execute || execFileAsync;
  const pathExists = options.pathExists || fs.existsSync;
  const pause = options.pause || ((milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds)));
  const preferenceDomain = options.preferenceDomain || defaultPreferenceDomain(options.homeDirectory);
  const originalItems = await createUploadItems(paths, options.stat);

  try {
    await execute('/usr/bin/open', ['-b', BAIDU_BUNDLE_ID]);
  } catch {
    throw new Error('未找到百度网盘客户端，请先安装并登录');
  }

  if (!pathExists(`${preferenceDomain}.plist`)) await pause(900);
  if (!pathExists(`${preferenceDomain}.plist`)) {
    throw new Error('百度网盘尚未完成初始化，请打开客户端并登录后重试');
  }

  const stageItems = options.stageItems || ((items) => stageUploadItems(items, options));
  const batch = await stageItems(originalItems);
  const payload = JSON.stringify(batch.items);

  try {
    await execute('/usr/bin/defaults', ['write', preferenceDomain, 'path', '-string', payload]);
    await execute('/usr/bin/defaults', ['write', preferenceDomain, 'status', '-string', '1']);
    await execute('/usr/bin/notifyutil', ['-p', BAIDU_UPLOAD_EVENT]);
  } catch {
    await (options.fileSystem || fsp).rm(batch.batchDirectory, { recursive: true, force: true }).catch(() => {});
    throw new Error('未能连接百度网盘上传队列，请重新启动百度网盘后重试');
  }

  const monitor = options.monitor || monitorStagedUpload;
  Promise.resolve(monitor(batch, options)).catch(() => {});

  return {
    count: batch.items.length,
    destination: '我的网盘',
    method: 'baidu-local-ipc-staged',
    requiresConfirmation: false
  };
}

function uploadToBaiduNetdiskMac(paths, options = {}) {
  const current = uploadQueue.then(() => performMacUpload(paths, options));
  uploadQueue = current.catch(() => {});
  return current;
}

module.exports = {
  BAIDU_APP_GROUP,
  BAIDU_BUNDLE_ID,
  BAIDU_UPLOAD_EVENT,
  cleanupExpiredStaging,
  copyItemToStaging,
  createUploadPayload,
  defaultPreferenceDomain,
  defaultStagingRoot,
  findUploadDatabases,
  monitorStagedUpload,
  readBaiduUploadState,
  stageUploadItems,
  uploadToBaiduNetdiskMac
};
