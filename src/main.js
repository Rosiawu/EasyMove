const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeImage, protocol, net, clipboard } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { execFile, spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { promisify } = require('node:util');
const { pathToFileURL } = require('node:url');
const { FolderSizeService } = require('./folder-size-service');
const { ThumbnailService } = require('./thumbnail-service');
const { nativeContextMenuItems } = require('./native-context-menu');
const { OperationHistory } = require('./operation-history');
const { RecentItems } = require('./recent-items');
const { uploadToBaiduNetdiskMac } = require('./baidu-netdisk');
const { writeFilesToSystemClipboard } = require('./file-clipboard');
const { FileBasket, WorkspaceStore } = require('./persistent-collections');
const { ContentIndexService } = require('./content-index-service');
const { comparableFilePath, performExactBatchRename, archiveType, archiveBaseName, safeArchiveEntry } = require('./file-actions');
const { TransferJournal } = require('./transfer-journal');
const { captureTreeSnapshot, assertTreeMatchesSnapshot, copyStagingPath, verifiedAtomicCopy } = require('./verified-copy');
const { mountedVolumeFromPlist } = require('./volume-utils');
const { showFinderInfo } = require('./finder-info');

const execFileAsync = promisify(execFile);

const operations = new Map();
let folderSizes = null;
let thumbnails = null;
let mainWindow = null;
let operationHistory = null;
let recentItems = null;
let fileBasket = null;
let workspaceStore = null;
let contentIndex = null;
let transferJournal = null;
let volumeWatcher = null;
let volumeRefreshTimer = null;
const quickLookPaths = new Map();

app.setAppUserModelId('com.easymove.app');
protocol.registerSchemesAsPrivileged(['easymove-theme', 'easymove-thumb'].map((scheme) => ({
  scheme,
  privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true }
})));

function customThemeDirectory() {
  return path.join(app.getPath('userData'), 'themes');
}

function customThemeMetadataPath() {
  return path.join(customThemeDirectory(), 'custom-theme.json');
}

async function readCustomTheme() {
  try {
    const metadata = JSON.parse(await fsp.readFile(customThemeMetadataPath(), 'utf8'));
    const fileName = path.basename(String(metadata.fileName || ''));
    if (!fileName) return null;
    const filePath = path.join(customThemeDirectory(), fileName);
    const stat = await fsp.stat(filePath);
    if (!stat.isFile()) return null;
    return {
      filePath,
      fileName,
      name: String(metadata.name || '我的主题'),
      importedAt: Number(metadata.importedAt || stat.mtimeMs),
      url: `easymove-theme://custom/background?v=${Math.round(stat.mtimeMs)}`
    };
  } catch {
    return null;
  }
}

function publicCustomTheme(theme) {
  if (!theme) return null;
  return { name: theme.name, importedAt: theme.importedAt, url: theme.url };
}

async function installCustomTheme(sourcePath) {
  const stat = await fsp.stat(sourcePath);
  if (!stat.isFile()) throw new Error('请选择一张图片文件');
  if (stat.size > 50 * 1024 * 1024) throw new Error('图片不能超过 50 MB');
  const image = nativeImage.createFromPath(sourcePath);
  if (image.isEmpty()) throw new Error('无法读取这张图片，请选择 PNG、JPEG 或 WebP 文件');

  const originalExtension = path.extname(sourcePath).toLocaleLowerCase();
  if (!['.png', '.jpg', '.jpeg', '.webp'].includes(originalExtension)) {
    throw new Error('请选择 PNG、JPEG 或 WebP 图片');
  }
  const extension = originalExtension === '.jpeg'
    ? '.jpg'
    : originalExtension;
  const directory = customThemeDirectory();
  const fileName = `custom-background${extension}`;
  const destination = path.join(directory, fileName);
  const temporary = path.join(directory, `.custom-background-${Date.now()}${extension}`);
  await fsp.mkdir(directory, { recursive: true });
  await fsp.copyFile(sourcePath, temporary);
  await fsp.rm(destination, { force: true });
  await fsp.rename(temporary, destination);

  const metadata = {
    fileName,
    name: path.basename(sourcePath, path.extname(sourcePath)),
    importedAt: Date.now()
  };
  const metadataTemporary = `${customThemeMetadataPath()}.tmp`;
  await fsp.writeFile(metadataTemporary, JSON.stringify(metadata, null, 2));
  await fsp.rm(customThemeMetadataPath(), { force: true });
  await fsp.rename(metadataTemporary, customThemeMetadataPath());

  const entries = await fsp.readdir(directory);
  await Promise.all(entries
    .filter((entry) => entry.startsWith('custom-background.') && entry !== fileName)
    .map((entry) => fsp.rm(path.join(directory, entry), { force: true })));
  return readCustomTheme();
}

function registerThemeProtocol() {
  protocol.handle('easymove-theme', async (request) => {
    const requestUrl = new URL(request.url);
    if (requestUrl.hostname !== 'custom' || requestUrl.pathname !== '/background') {
      return new Response('Not found', { status: 404 });
    }
    const theme = await readCustomTheme();
    if (!theme) return new Response('No custom theme', { status: 404 });
    return net.fetch(pathToFileURL(theme.filePath).href);
  });
}

function registerThumbnailProtocol() {
  protocol.handle('easymove-thumb', async (request) => {
    try {
      const requestUrl = new URL(request.url);
      const key = requestUrl.pathname.split('/').filter(Boolean)[0] || requestUrl.hostname;
      const filePath = thumbnails?.pathForKey(key);
      if (!filePath) return new Response('Thumbnail not found', { status: 404 });
      const bytes = await fsp.readFile(filePath);
      return new Response(bytes, { headers: { 'Content-Type': 'image/png', 'Cache-Control': 'private, max-age=31536000, immutable' } });
    } catch (error) {
      console.error('[preview:protocol]', { code: error.code || 'PROTOCOL', message: error.message });
      return new Response('Thumbnail protocol error', { status: 500 });
    }
  });
}

function invalidateCaches() {
  folderSizes?.invalidate();
  thumbnails?.invalidate();
}

function createWindow() {
  const window = new BrowserWindow({
    width: 1480,
    height: 920,
    minWidth: 1080,
    minHeight: 680,
    show: false,
    title: 'EasyMove',
    backgroundColor: '#f2f4f8',
    titleBarStyle: process.platform === 'darwin' ? 'hiddenInset' : 'default',
    trafficLightPosition: { x: 30, y: 31 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  });
  mainWindow = window;

  const windowId = window.id;
  window.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  window.once('ready-to-show', () => {
    if (!window.isDestroyed()) window.show();
  });
  window.on('focus', () => scheduleVolumeRefresh(0));
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.on('closed', () => {
    quickLookPaths.delete(windowId);
    if (mainWindow === window) mainWindow = null;
  });
  return window;
}

function showOrCreateMainWindow() {
  const window = mainWindow && !mainWindow.isDestroyed()
    ? mainWindow
    : BrowserWindow.getAllWindows().find((candidate) => !candidate.isDestroyed());
  if (!window) return createWindow();

  mainWindow = window;
  if (window.isMinimized()) window.restore();
  window.show();
  window.focus();
  return window;
}

function buildMenu() {
  const commandItem = (label, accelerator, command) => ({
    label,
    accelerator,
    click: (_item, focusedWindow) => focusedWindow?.webContents.send('menu:command', command)
  });
  const template = [
    ...(process.platform === 'darwin' ? [{
      label: 'EasyMove',
      submenu: [
        { role: 'about' },
        { type: 'separator' },
        { role: 'hide' },
        { role: 'hideOthers' },
        { role: 'unhide' },
        { type: 'separator' },
        { role: 'quit' }
      ]
    }] : []),
    {
      label: '文件',
      submenu: [
        commandItem('新建文件夹', 'CommandOrControl+Shift+N', 'new-folder'),
        commandItem('重命名', process.platform === 'darwin' ? 'Enter' : 'F2', 'rename'),
        { type: 'separator' },
        commandItem(process.platform === 'darwin' ? '移到废纸篓' : '移到回收站', process.platform === 'darwin' ? 'CommandOrControl+Backspace' : 'Delete', 'trash')
      ]
    },
    {
      label: '编辑',
      submenu: [
        commandItem('撤销文件操作', 'CommandOrControl+Z', 'undo'),
        { role: 'redo' },
        { type: 'separator' },
        commandItem('剪切', 'CommandOrControl+X', 'cut'),
        commandItem('复制', 'CommandOrControl+C', 'copy'),
        commandItem('粘贴', 'CommandOrControl+V', 'paste'),
        ...(process.platform === 'darwin' ? [commandItem('移动项目到这里', 'CommandOrControl+Alt+V', 'paste-move')] : []),
        { type: 'separator' },
        commandItem('全选', 'CommandOrControl+A', 'select-all')
      ]
    },
    {
      label: '显示',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools', visible: !app.isPackaged },
        { type: 'separator' },
        { role: 'resetZoom' },
        { role: 'zoomIn' },
        { role: 'zoomOut' },
        { type: 'separator' },
        { role: 'togglefullscreen' }
      ]
    },
    { label: '窗口', submenu: [{ role: 'minimize' }, { role: 'close' }] }
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (app.isReady()) showOrCreateMainWindow();
  });
}

app.whenReady().then(async () => {
  if (!hasSingleInstanceLock) return;
  folderSizes = new FolderSizeService({ cacheFile: path.join(app.getPath('userData'), 'indexes', 'folder-sizes.json') });
  thumbnails = new ThumbnailService({ cacheDirectory: path.join(app.getPath('cache'), 'EasyMove', 'thumbnails') });
  operationHistory = new OperationHistory({ filePath: path.join(app.getPath('userData'), 'operations', 'history.json') });
  recentItems = new RecentItems({ filePath: path.join(app.getPath('userData'), 'recent-items.json') });
  fileBasket = new FileBasket({ filePath: path.join(app.getPath('userData'), 'collections', 'file-basket.json') });
  workspaceStore = new WorkspaceStore({ filePath: path.join(app.getPath('userData'), 'collections', 'workspaces.json') });
  transferJournal = new TransferJournal({ filePath: path.join(app.getPath('userData'), 'operations', 'transfer-queue.json') });
  await operationHistory.load().catch((error) => console.error('[operation-history:load]', error));
  await recentItems.load().catch((error) => console.error('[recent-items:load]', error));
  await fileBasket.load().catch((error) => console.error('[file-basket:load]', error));
  await workspaceStore.load().catch((error) => console.error('[workspace-store:load]', error));
  await transferJournal.load().catch((error) => console.error('[transfer-journal:load]', error));
  contentIndex = new ContentIndexService({
    databasePath: path.join(app.getPath('userData'), 'index', 'content.sqlite'),
    settingsPath: path.join(app.getPath('userData'), 'index', 'settings.json'),
    workerPath: app.isPackaged
      ? path.join(process.resourcesPath, 'app.asar.unpacked', 'src', 'content-index-worker.js')
      : path.join(__dirname, 'content-index-worker.js')
  });
  contentIndex.on('status', (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) mainWindow.webContents.send('index:status', status);
  });
  const locations = defaultLocations();
  const defaultIndexRoots = process.env.EASYMOVE_E2E === '1' ? [] : [locations.desktop, locations.documents, locations.downloads];
  await contentIndex.start(defaultIndexRoots).catch((error) => console.error('[content-index:start]', error));
  registerThemeProtocol();
  registerThumbnailProtocol();
  buildMenu();
  registerIpc();
  startVolumeWatcher();
  showOrCreateMainWindow();
  app.on('activate', showOrCreateMainWindow);
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  clearTimeout(volumeRefreshTimer);
  volumeWatcher?.close();
  volumeWatcher = null;
  folderSizes?.close().catch(() => {});
  contentIndex?.close().catch(() => {});
});

function normalizeDirectory(input) {
  const resolved = path.resolve(String(input || os.homedir()));
  return resolved;
}

async function getDirectoryEntries(directory, showHidden = false) {
  const resolved = normalizeDirectory(directory);
  const dirents = await fsp.readdir(resolved, { withFileTypes: true });
  const entries = await Promise.all(dirents
    .filter((entry) => showHidden || !entry.name.startsWith('.'))
    .map(async (entry) => {
      const fullPath = path.join(resolved, entry.name);
      let stat;
      try {
        stat = await fsp.lstat(fullPath);
      } catch {
        return null;
      }
      const isDirectory = entry.isDirectory();
      return {
        name: entry.name,
        path: fullPath,
        isDirectory,
        isSymbolicLink: entry.isSymbolicLink(),
        size: isDirectory ? null : stat.size,
        modified: stat.mtimeMs,
        extension: isDirectory ? '' : path.extname(entry.name).slice(1).toLowerCase(),
        kind: isDirectory ? '文件夹' : (path.extname(entry.name).slice(1).toUpperCase() || '文件')
      };
    }));

  return entries.filter(Boolean).sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: 'base' });
  });
}

async function recentEntry(itemPath, recentUsed) {
  try {
    const stat = await fsp.lstat(itemPath);
    const isDirectory = stat.isDirectory();
    return {
      name: path.basename(itemPath) || itemPath,
      path: itemPath,
      isDirectory,
      isSymbolicLink: stat.isSymbolicLink(),
      size: isDirectory ? null : stat.size,
      modified: stat.mtimeMs,
      recentUsed: Number(recentUsed) || Math.max(stat.atimeMs, stat.mtimeMs),
      extension: isDirectory ? '' : path.extname(itemPath).slice(1).toLowerCase(),
      kind: isDirectory ? '文件夹' : (path.extname(itemPath).slice(1).toUpperCase() || '文件')
    };
  } catch {
    return null;
  }
}

async function getFileBasketEntries() {
  return Promise.all((fileBasket?.list() || []).map(async (item) => {
    const entry = await recentEntry(item.path, item.addedAt);
    if (entry) return { ...entry, basketId: item.id, basketAddedAt: item.addedAt, unavailable: false };
    return {
      name: path.basename(item.path) || item.path,
      path: item.path,
      isDirectory: false,
      isSymbolicLink: false,
      size: null,
      modified: 0,
      extension: '',
      kind: '项目不可用',
      basketId: item.id,
      basketAddedAt: item.addedAt,
      unavailable: true
    };
  }));
}

async function getRecentEntries(showHidden = false) {
  const local = recentItems?.list() || [];
  const localTimes = new Map(local.map((item) => [item.path, item.usedAt]));
  let systemPaths = [];
  if (process.platform === 'darwin') {
    try {
      const { stdout } = await execFileAsync('/usr/bin/mdfind', [
        '-onlyin', os.homedir(),
        'kMDItemLastUsedDate >= $time.today(-30)'
      ], { maxBuffer: 4 * 1024 * 1024, timeout: 5000 });
      systemPaths = stdout.split('\n').map((item) => item.trim()).filter(Boolean);
    } catch {
      systemPaths = [];
    }
  }
  const blocked = [path.join(os.homedir(), '.Trash'), app.getPath('cache')];
  const paths = Array.from(new Set([...local.map((item) => item.path), ...systemPaths]))
    .filter((itemPath) => !blocked.some((root) => itemPath === root || itemPath.startsWith(`${root}${path.sep}`)))
    .filter((itemPath) => showHidden || !path.basename(itemPath).startsWith('.'))
    .slice(0, 120);
  const entries = await Promise.all(paths.map((itemPath, index) => recentEntry(
    itemPath,
    localTimes.get(itemPath) || (Date.now() - index)
  )));
  return entries.filter(Boolean);
}

function volumeRootPath() {
  return process.env.EASYMOVE_E2E_VOLUME_ROOT || '/Volumes';
}

async function macVolumeDetails(volumePath, name) {
  if (process.env.EASYMOVE_E2E_VOLUME_ROOT) {
    return { name, path: volumePath, kind: 'removable', removable: true, readOnly: false, protocol: 'Test', filesystem: '' };
  }
  try {
    const { stdout } = await execFileAsync('/usr/sbin/diskutil', ['info', '-plist', volumePath], {
      timeout: 5000,
      maxBuffer: 1024 * 1024
    });
    return mountedVolumeFromPlist(stdout, volumePath, name);
  } catch {
    return { name, path: volumePath, kind: 'volume', removable: false, readOnly: false, protocol: '', filesystem: '' };
  }
}

async function mountedVolumes() {
  if (process.platform === 'win32') {
    const drives = [];
    for (let code = 65; code <= 90; code += 1) {
      const drive = `${String.fromCharCode(code)}:\\`;
      if (fs.existsSync(drive)) drives.push({ name: drive, path: drive });
    }
    return drives;
  }
  if (process.platform === 'darwin') {
    const volumes = [{ name: 'Macintosh HD', path: '/', kind: 'system', removable: false, readOnly: false, protocol: '', filesystem: '' }];
    try {
      const rootRealPath = await fsp.realpath('/');
      const rootPath = volumeRootPath();
      const names = await fsp.readdir(rootPath);
      const candidates = await Promise.all(names.map(async (name) => {
        const volumePath = path.join(rootPath, name);
        const realPath = await fsp.realpath(volumePath).catch(() => volumePath);
        if (realPath === rootRealPath) return null;
        return macVolumeDetails(volumePath, name);
      }));
      volumes.push(...candidates.filter(Boolean).sort((left, right) => {
        if (left.removable !== right.removable) return left.removable ? -1 : 1;
        return left.name.localeCompare(right.name, undefined, { numeric: true, sensitivity: 'base' });
      }));
    } catch {}
    return volumes;
  }
  return [{ name: '/', path: '/' }];
}

async function broadcastMountedVolumes() {
  const volumes = await mountedVolumes();
  BrowserWindow.getAllWindows().forEach((window) => {
    if (!window.isDestroyed() && !window.webContents.isDestroyed()) window.webContents.send('volumes:changed', volumes);
  });
  return volumes;
}

function scheduleVolumeRefresh(delay = 300) {
  clearTimeout(volumeRefreshTimer);
  volumeRefreshTimer = setTimeout(() => {
    volumeRefreshTimer = null;
    void broadcastMountedVolumes().catch((error) => console.error('[volumes:refresh]', error));
  }, delay);
}

function startVolumeWatcher() {
  volumeWatcher?.close();
  try {
    volumeWatcher = fs.watch(volumeRootPath(), { persistent: false }, () => scheduleVolumeRefresh());
  } catch (error) {
    console.error('[volumes:watch]', error);
  }
}

function defaultLocations() {
  const home = os.homedir();
  const candidates = {
    home,
    desktop: path.join(home, 'Desktop'),
    documents: path.join(home, 'Documents'),
    downloads: path.join(home, 'Downloads'),
    pictures: path.join(home, 'Pictures'),
    music: path.join(home, 'Music')
  };
  Object.keys(candidates).forEach((key) => {
    if (!fs.existsSync(candidates[key])) candidates[key] = home;
  });
  return candidates;
}

function uniqueDestination(targetDirectory, sourceName) {
  const initial = path.join(targetDirectory, sourceName);
  if (!fs.existsSync(initial)) return initial;
  const parsed = path.parse(sourceName);
  let index = 2;
  let candidate = path.join(targetDirectory, `${parsed.name} 副本${parsed.ext}`);
  while (fs.existsSync(candidate)) {
    candidate = path.join(targetDirectory, `${parsed.name} 副本 ${index}${parsed.ext}`);
    index += 1;
  }
  return candidate;
}

async function runAppleScript(lines, args = []) {
  const scriptArgs = lines.flatMap((line) => ['-e', line]);
  return execFileAsync('/usr/bin/osascript', [...scriptArgs, ...args], { maxBuffer: 1024 * 1024 });
}

async function openWithApplication(paths) {
  const { stdout } = await runAppleScript(['POSIX path of (choose application with prompt "选择用于打开所选项目的应用")']);
  const applicationPath = stdout.trim();
  if (applicationPath) await execFileAsync('/usr/bin/open', ['-a', applicationPath, ...paths]);
}

async function toggleQuickLook(browserWindow, itemPath, forceOpen = false) {
  if (process.platform !== 'darwin') throw new Error('Quick Look 仅在 macOS 上可用');
  if (!browserWindow || browserWindow.isDestroyed()) throw new Error('当前窗口不可用');
  const resolved = path.resolve(String(itemPath || ''));
  const stat = await fsp.stat(resolved);
  if (!stat.isFile() && !stat.isDirectory()) throw new Error('无法预览这个项目');

  const currentPath = quickLookPaths.get(browserWindow.id);
  if (!forceOpen && currentPath === resolved) {
    browserWindow.closeFilePreview();
    quickLookPaths.delete(browserWindow.id);
    return { open: false, path: resolved };
  }

  browserWindow.previewFile(resolved, path.basename(resolved));
  quickLookPaths.set(browserWindow.id, resolved);
  return { open: true, path: resolved };
}

async function performNativeContextAction(action, paths, browserWindow, sender) {
  try {
    if (action === 'open') {
      await Promise.all(paths.map((itemPath) => shell.openPath(itemPath)));
      return;
    }
    if (action === 'open-with') return openWithApplication(paths);
    if (action === 'quick-look') {
      if (paths[0]) await toggleQuickLook(browserWindow, paths[0], true);
      return;
    }
    if (action === 'baidu-upload') {
      let uploadCount = paths.length;
      if (process.platform === 'darwin') {
        sendOperation(sender, 'native-context-menu:notice', {
          message: `正在安全准备 ${paths.length} 项文件…`
        });
        const result = await uploadToBaiduNetdiskMac(paths);
        uploadCount = result.count;
      } else if (process.platform === 'win32') {
        const candidates = [
          path.join(process.env.APPDATA || '', 'BaiduNetdisk', 'BaiduNetdisk.exe'),
          path.join(process.env.LOCALAPPDATA || '', 'BaiduNetdisk', 'BaiduNetdisk.exe'),
          path.join(process.env.ProgramFiles || '', 'BaiduNetdisk', 'BaiduNetdisk.exe')
        ];
        const executable = candidates.find((candidate) => fs.existsSync(candidate));
        if (!executable) throw new Error('未找到百度网盘客户端，请先安装并登录');
        execFile(executable, paths, () => {});
      } else {
        throw new Error('当前系统暂不支持上传到百度网盘');
      }
      sendOperation(sender, 'native-context-menu:notice', {
        message: `${uploadCount} 项已交给百度网盘上传队列`
      });
      if (browserWindow && !browserWindow.isDestroyed()) browserWindow.focus();
      return;
    }
    if (action === 'get-info') return showFinderInfo(paths[0], runAppleScript);
    if (action === 'copy-path') {
      clipboard.writeText(paths.join('\n'));
      return;
    }
    if (action === 'reveal' && paths[0]) shell.showItemInFolder(paths[0]);
  } catch (error) {
    sendOperation(sender, 'native-context-menu:error', { message: error.message || String(error) });
  }
}

function nativeContextTemplate(descriptors, context, browserWindow, sender) {
  return descriptors.map((item) => {
    if (item.separator) return { type: 'separator' };
    if (item.role === 'shareMenu') {
      return { role: 'shareMenu', sharingItem: { filePaths: context.paths }, enabled: item.enabled !== false };
    }
    if (item.role === 'services') return { role: 'services' };
    if (item.nativeAction) {
      return {
        label: item.label,
        enabled: item.enabled !== false,
        click: () => void performNativeContextAction(item.nativeAction, context.paths, browserWindow, sender)
      };
    }
    return {
      label: item.label,
      accelerator: item.accelerator,
      enabled: item.enabled !== false,
      click: () => sendOperation(sender, 'native-context-menu:command', {
        command: item.command,
        paneIndex: context.paneIndex,
        targetDirectory: context.targetDirectory,
        currentDirectory: context.currentDirectory
      })
    };
  });
}

async function measurePath(source) {
  const stat = await fsp.lstat(source);
  if (stat.isDirectory()) {
    const children = await fsp.readdir(source);
    let total = 0;
    for (const child of children) total += await measurePath(path.join(source, child));
    return total;
  }
  return stat.isFile() ? stat.size : 0;
}

async function waitWhilePaused(operation) {
  while (operation.paused && !operation.cancelled) {
    await new Promise((resolve) => setTimeout(resolve, 120));
  }
  if (operation.cancelled) {
    const error = new Error('操作已取消');
    error.code = 'EASYMOVE_CANCELLED';
    throw error;
  }
}

function sendOperation(sender, channel, payload) {
  if (!sender.isDestroyed()) sender.send(channel, payload);
}

function publicTransferTasks() {
  return (transferJournal?.list() || []).map((task) => ({
    id: task.id,
    sources: task.sources,
    targetDirectory: task.targetDirectory,
    mode: task.mode,
    status: task.status,
    total: task.total,
    completed: task.completed,
    currentFile: task.currentFile,
    errors: task.errors || [],
    createdAt: task.createdAt,
    updatedAt: task.updatedAt
  }));
}

function broadcastTransferTasks(sender) {
  const tasks = publicTransferTasks();
  if (sender) sendOperation(sender, 'transfer:changed', tasks);
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.webContents !== sender) sendOperation(window.webContents, 'transfer:changed', tasks);
  }
}

async function updateTransferTask(sender, operation, changes) {
  const updated = await transferJournal?.update(operation.id, changes);
  if (updated) operation.task = updated;
  broadcastTransferTasks(sender);
  return updated;
}

function broadcastHistory(sender) {
  const entries = operationHistory?.list() || [];
  if (sender) sendOperation(sender, 'history:changed', entries);
  for (const window of BrowserWindow.getAllWindows()) {
    if (window.webContents !== sender) sendOperation(window.webContents, 'history:changed', entries);
  }
}

async function recordHistory(sender, input) {
  const entry = await operationHistory.record(input);
  broadcastHistory(sender);
  return entry;
}

async function movePath(source, destination) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  try {
    await fsp.rename(source, destination);
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await fsp.cp(source, destination, { recursive: true, force: false, errorOnExist: true, preserveTimestamps: true, verbatimSymlinks: true });
    await fsp.rm(source, { recursive: true, force: true });
  }
}

async function preflightArchive(source, type) {
  if (type === 'gz') return;
  const command = type === 'zip' ? '/usr/bin/unzip' : '/usr/bin/tar';
  const args = type === 'zip' ? ['-Z1', source] : ['-tf', source];
  const { stdout } = await execFileAsync(command, args, { maxBuffer: 16 * 1024 * 1024 });
  const unsafe = String(stdout).split(/\r?\n/).filter(Boolean).find((entry) => !safeArchiveEntry(entry));
  if (unsafe) throw new Error(`压缩包包含不安全路径：${unsafe}`);
}

async function ensureExtractedTreeSafe(root) {
  const stack = [root];
  while (stack.length) {
    const directory = stack.pop();
    for (const entry of await fsp.readdir(directory, { withFileTypes: true })) {
      const fullPath = path.join(directory, entry.name);
      const stat = await fsp.lstat(fullPath);
      if (stat.isSymbolicLink()) throw new Error(`压缩包包含符号链接：${entry.name}`);
      if (stat.isDirectory()) stack.push(fullPath);
    }
  }
}

async function gunzipTo(source, destination) {
  const child = spawn('/usr/bin/gzip', ['-dc', source], { stdio: ['ignore', 'pipe', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
  const exit = new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.trim() || `gzip 退出，代码 ${code}`)));
  });
  await Promise.all([pipeline(child.stdout, fs.createWriteStream(destination)), exit]);
}

async function extractArchive(source, mode) {
  const type = archiveType(source);
  if (!type) throw new Error('暂不支持这种压缩格式');
  await preflightArchive(source, type);
  const directory = path.dirname(source);
  const staging = await fsp.mkdtemp(path.join(directory, '.easymove-extract-'));
  try {
    if (type === 'zip') await execFileAsync('/usr/bin/ditto', ['-x', '-k', '--sequesterRsrc', source, staging]);
    else if (type === 'tar' || type === 'tar.gz') await execFileAsync('/usr/bin/tar', ['-xf', source, '-C', staging]);
    else await gunzipTo(source, path.join(staging, archiveBaseName(source)));
    await ensureExtractedTreeSafe(staging);
    const destinations = [];
    if (mode === 'folder') {
      const destination = uniqueDestination(directory, archiveBaseName(source));
      await fsp.rename(staging, destination);
      destinations.push(destination);
    } else {
      for (const entry of await fsp.readdir(staging)) {
        const destination = uniqueDestination(directory, entry);
        await fsp.rename(path.join(staging, entry), destination);
        destinations.push(destination);
      }
      await fsp.rm(staging, { recursive: true, force: true });
    }
    return destinations;
  } catch (error) {
    await fsp.rm(staging, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
}

async function trashItemWithPath(itemPath) {
  const resolved = path.resolve(itemPath);
  if (process.platform !== 'darwin') {
    await shell.trashItem(resolved);
    return null;
  }
  const { stdout } = await runAppleScript([
    'on run argv',
    'set sourceItem to POSIX file (item 1 of argv) as alias',
    'tell application "Finder"',
    'set trashedItem to delete sourceItem',
    'return POSIX path of (trashedItem as alias)',
    'end tell',
    'end run'
  ], [resolved]);
  return stdout.trim() || null;
}

async function restoreTrashItem(item) {
  if (!item.trashPath || process.platform !== 'darwin') throw new Error('当前系统没有可用的恢复路径');
  if (fs.existsSync(item.source)) throw new Error(`${path.basename(item.source)}：原位置已有同名项目`);
  if (!fs.existsSync(item.trashPath)) throw new Error(`${path.basename(item.source)}：废纸篓中的项目已不存在`);
  await runAppleScript([
    'on run argv',
    'set trashedItem to POSIX file (item 1 of argv) as alias',
    'set targetFolder to POSIX file (item 2 of argv) as alias',
    'tell application "Finder" to move trashedItem to targetFolder',
    'end run'
  ], [item.trashPath, path.dirname(item.source)]);
}

async function undoHistoryEntry(sender, requestedId) {
  const entry = requestedId ? operationHistory.get(requestedId) : operationHistory.latestUndoable();
  if (!entry || !entry.canUndo || entry.status === 'undone') throw new Error('没有可以撤销的文件操作');
  const errors = [];
  if (entry.type === 'batch-rename') {
    try {
      await performExactBatchRename(entry.items.map((item) => ({ source: item.destination, destination: item.source })));
    } catch (error) {
      errors.push(error.message || String(error));
    }
  }
  for (const item of entry.type === 'batch-rename' ? [] : [...entry.items].reverse()) {
    try {
      const undoType = item.undo || entry.type;
      if (undoType === 'copy' || undoType === 'create-folder') {
        if (item.destination && fs.existsSync(item.destination)) await trashItemWithPath(item.destination);
      } else if (undoType === 'move' || undoType === 'rename') {
        if (!item.destination || !fs.existsSync(item.destination)) throw new Error(`${path.basename(item.destination || item.source)}：操作结果已不存在`);
        if (fs.existsSync(item.source)) throw new Error(`${path.basename(item.source)}：原位置已有同名项目`);
        await movePath(item.destination, item.source);
      } else if (undoType === 'trash') {
        await restoreTrashItem(item);
      } else if (undoType === 'replace') {
        if (item.mode === 'move') {
          if (fs.existsSync(item.source)) throw new Error(`${path.basename(item.source)}：原位置已有同名项目`);
          if (!item.destination || !fs.existsSync(item.destination)) throw new Error(`${path.basename(item.destination)}：移动后的项目已不存在`);
          await movePath(item.destination, item.source);
        } else if (item.destination && fs.existsSync(item.destination)) {
          await trashItemWithPath(item.destination);
        }
        if (!item.backupPath || !fs.existsSync(item.backupPath)) throw new Error(`${path.basename(item.destination)}：替换前项目的恢复副本已不存在`);
        await movePath(item.backupPath, item.destination);
      }
    } catch (error) {
      errors.push(error.message || String(error));
    }
  }
  const completed = errors.length === 0;
  await operationHistory.update(entry.id, {
    status: completed ? 'undone' : 'undo-failed',
    canUndo: !completed,
    undoneAt: completed ? Date.now() : null,
    undoErrors: errors
  });
  invalidateCaches();
  broadcastHistory(sender);
  return { success: completed, errors, entry: operationHistory.get(entry.id) };
}

function emitProgress(sender, operation, currentFile = '') {
  const now = Date.now();
  if (now - operation.lastProgressAt < 70 && operation.completed < operation.total) return;
  operation.lastProgressAt = now;
  sendOperation(sender, 'operation:progress', {
    id: operation.id,
    completed: operation.completed,
    total: operation.total,
    currentFile,
    paused: operation.paused
  });
  if (now - operation.lastJournalAt >= 900 || operation.completed >= operation.total) {
    operation.lastJournalAt = now;
    void updateTransferTask(sender, operation, { status: operation.paused ? 'paused' : 'active', completed: operation.completed, total: operation.total, currentFile }).catch(() => {});
  }
}

async function copyFileWithProgress(source, destination, operation, sender) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const sourceStat = await fsp.stat(source);
  const existingCheckpoint = operation.task.files?.[destination];
  if (fs.existsSync(destination)) {
    const destinationStat = await fsp.stat(destination);
    if (existingCheckpoint && destinationStat.isFile() && destinationStat.size === sourceStat.size
      && existingCheckpoint.size === sourceStat.size && existingCheckpoint.mtime === sourceStat.mtimeMs) {
      operation.completed += sourceStat.size;
      operation.task.files[destination] = { source, size: sourceStat.size, mtime: sourceStat.mtimeMs, status: 'completed' };
      await updateTransferTask(sender, operation, { files: operation.task.files, completed: operation.completed });
      emitProgress(sender, operation, path.basename(source));
      return;
    }
    throw new Error('目标文件与恢复记录不一致');
  }
  const temporary = `${destination}.easymove-part`;
  let offset = 0;
  if (fs.existsSync(temporary)) {
    const temporaryStat = await fsp.stat(temporary);
    const checkpoint = operation.task.files?.[destination];
    if (!checkpoint || checkpoint.size !== sourceStat.size || checkpoint.mtime !== sourceStat.mtimeMs || temporaryStat.size > sourceStat.size) {
      const error = new Error('源文件已变化，无法从原位置安全续传');
      error.code = 'EASYMOVE_SOURCE_CHANGED';
      throw error;
    }
    offset = temporaryStat.size;
  }
  operation.task.files[destination] = { source, temporary, size: sourceStat.size, mtime: sourceStat.mtimeMs, status: 'partial' };
  await updateTransferTask(sender, operation, { files: operation.task.files, status: 'active' });
  const sourceHandle = await fsp.open(source, 'r');
  const destinationHandle = await fsp.open(temporary, offset ? 'r+' : 'w');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let completed = false;
  try {
    let position = offset;
    operation.completed += offset;
    emitProgress(sender, operation, path.basename(source));
    while (true) {
      await waitWhilePaused(operation);
      const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      await destinationHandle.write(buffer, 0, bytesRead, position);
      position += bytesRead;
      operation.completed += bytesRead;
      emitProgress(sender, operation, path.basename(source));
      const testDelay = Number(process.env.EASYMOVE_TEST_TRANSFER_DELAY_MS || 0);
      if (testDelay > 0) await new Promise((resolve) => setTimeout(resolve, testDelay));
    }
    await destinationHandle.sync();
    await destinationHandle.chmod(sourceStat.mode);
    completed = true;
  } finally {
    await Promise.allSettled([sourceHandle.close(), destinationHandle.close()]);
    if (!completed && operation.cancelled) await fsp.rm(temporary, { force: true }).catch(() => {});
  }
  await fsp.utimes(temporary, sourceStat.atime, sourceStat.mtime);
  await fsp.rename(temporary, destination);
  operation.task.files[destination] = { source, size: sourceStat.size, mtime: sourceStat.mtimeMs, status: 'completed' };
  await updateTransferTask(sender, operation, { files: operation.task.files, completed: operation.completed, currentFile: path.basename(source) });
}

async function copyEntry(source, destination, operation, sender) {
  await waitWhilePaused(operation);
  const stat = await fsp.lstat(source);
  if (stat.isDirectory()) {
    await fsp.mkdir(destination, { recursive: true });
    const children = await fsp.readdir(source);
    for (const child of children) {
      await copyEntry(path.join(source, child), path.join(destination, child), operation, sender);
    }
    return;
  }
  if (stat.isSymbolicLink()) {
    const link = await fsp.readlink(source);
    await fsp.symlink(link, destination);
    return;
  }
  await copyFileWithProgress(source, destination, operation, sender);
}

async function moveEntry(source, destination, operation, sender, measuredSize) {
  await waitWhilePaused(operation);
  try {
    await fsp.rename(source, destination);
    operation.completed += measuredSize;
    emitProgress(sender, operation, path.basename(source));
  } catch (error) {
    if (error.code !== 'EXDEV') throw error;
    await copyEntry(source, destination, operation, sender);
    await assertTreeMatchesSnapshot(destination, await captureTreeSnapshot(source));
    await fsp.rm(source, { recursive: true, force: true });
  }
}

function clearTransferCheckpoints(operation, rootPath) {
  const root = path.resolve(rootPath);
  for (const destination of Object.keys(operation.task.files || {})) {
    const resolved = path.resolve(destination);
    if (resolved === root || resolved.startsWith(`${root}${path.sep}`)) delete operation.task.files[destination];
  }
}

async function copyEntryVerified(source, destination, operation, sender, prepared, measuredSize) {
  const staging = prepared.stagingDestination || copyStagingPath(destination, operation.id);
  prepared.stagingDestination = staging;
  operation.task.plans[source] = prepared;
  await updateTransferTask(sender, operation, { plans: operation.task.plans });
  const completedBefore = operation.completed;
  try {
    const result = await verifiedAtomicCopy({
      source,
      destination,
      staging,
      copyTree: (copySource, copyDestination) => copyEntry(copySource, copyDestination, operation, sender)
    });
    if (result.recovered) {
      operation.completed += measuredSize;
      emitProgress(sender, operation, path.basename(source));
    }
    prepared.copyCommitted = true;
    operation.task.plans[source] = prepared;
    await updateTransferTask(sender, operation, { plans: operation.task.plans, completed: operation.completed });
  } catch (error) {
    if (['EASYMOVE_COPY_VERIFICATION_FAILED', 'EASYMOVE_SOURCE_CHANGED'].includes(error.code)) {
      operation.completed = completedBefore;
      clearTransferCheckpoints(operation, staging);
      await updateTransferTask(sender, operation, { files: operation.task.files, completed: operation.completed });
    }
    throw error;
  }
}

async function conflictItemInfo(itemPath) {
  try {
    const stat = await fsp.lstat(itemPath);
    return {
      path: itemPath,
      name: path.basename(itemPath),
      isDirectory: stat.isDirectory(),
      size: stat.isDirectory() ? null : stat.size,
      modified: stat.mtimeMs
    };
  } catch {
    return { path: itemPath, name: path.basename(itemPath), missing: true };
  }
}

async function waitForConflictDecision(sender, operation, source, destination) {
  if (operation.conflictDecision) return operation.conflictDecision;
  const conflictId = `conflict-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const decision = await new Promise(async (resolve) => {
    operation.pendingConflict = { id: conflictId, resolve };
    sendOperation(sender, 'operation:conflict', {
      operationId: operation.id,
      conflictId,
      source: await conflictItemInfo(source),
      destination: await conflictItemInfo(destination)
    });
  });
  operation.pendingConflict = null;
  if (decision.applyAll) {
    operation.conflictDecision = decision;
    operation.task.conflictDecision = decision;
    await updateTransferTask(sender, operation, { conflictDecision: decision });
  }
  return decision;
}

async function prepareTransferDestination(sender, operation, source, targetDirectory, mode) {
  const initial = path.join(targetDirectory, path.basename(source));
  if (!fs.existsSync(initial)) return { destination: initial, decision: 'new', backupPath: null };
  if (path.resolve(source) === path.resolve(initial) && mode === 'copy') {
    return { destination: uniqueDestination(targetDirectory, path.basename(source)), decision: 'keep-both', backupPath: null };
  }
  const result = await waitForConflictDecision(sender, operation, source, initial);
  if (result.action === 'cancel') {
    operation.cancelled = true;
    const error = new Error('操作已取消');
    error.code = 'EASYMOVE_CANCELLED';
    throw error;
  }
  if (result.action === 'skip') return { destination: null, decision: 'skip', backupPath: null };
  if (result.action === 'keep-both') {
    return { destination: uniqueDestination(targetDirectory, path.basename(source)), decision: 'keep-both', backupPath: null };
  }
  if (result.action !== 'replace') throw new Error('未识别的重名处理方式');
  const backupDirectory = path.join(app.getPath('userData'), 'operations', 'recovery', operation.id);
  await fsp.mkdir(backupDirectory, { recursive: true });
  const backupPath = uniqueDestination(backupDirectory, path.basename(initial));
  const plan = { destination: initial, decision: 'replace', backupPath };
  operation.task.plans[source] = plan;
  await updateTransferTask(sender, operation, { plans: operation.task.plans });
  await movePath(initial, backupPath);
  return plan;
}

async function runTransfer(sender, operation, sources, targetDirectory, mode) {
  const errors = [];
  const historyItems = [...(operation.task.historyItems || [])];
  const destinations = historyItems.map((item) => item.destination);
  const failedSources = [];
  try {
    const measured = [];
    for (const source of sources) {
      try {
        measured.push(await measurePath(source));
      } catch {
        measured.push(0);
      }
    }
    operation.total = Math.max(1, measured.reduce((sum, size) => sum + size, 0));
    operation.task.total = operation.total;
    operation.task.errors = [];
    await updateTransferTask(sender, operation, { status: 'active', total: operation.total, completed: 0, errors: [] });
    emitProgress(sender, operation);

    for (let index = 0; index < sources.length; index += 1) {
      const source = path.resolve(sources[index]);
      if (historyItems.some((item) => comparableFilePath(item.source) === comparableFilePath(source))) {
        operation.completed += measured[index];
        emitProgress(sender, operation, path.basename(source));
        continue;
      }
      await waitWhilePaused(operation);
      if (!fs.existsSync(source)) {
        const savedPlan = operation.task.plans?.[source];
        if (mode === 'move' && savedPlan?.sameDevice && savedPlan.destination && fs.existsSync(savedPlan.destination)) {
          const destinationStat = await fsp.lstat(savedPlan.destination);
          if (destinationStat.size === savedPlan.sourceSize && destinationStat.mtimeMs === savedPlan.sourceMtime) {
            const recoveredItem = { source, destination: savedPlan.destination, mode, undo: savedPlan.decision === 'replace' ? 'replace' : mode, backupPath: savedPlan.backupPath };
            historyItems.push(recoveredItem);
            destinations.push(savedPlan.destination);
            operation.task.historyItems = historyItems;
            await updateTransferTask(sender, operation, { historyItems });
            continue;
          }
        }
        errors.push(`${path.basename(source)}：源文件不存在`);
        failedSources.push(source);
        continue;
      }
      const sourceParent = path.dirname(source);
      if (sourceParent === targetDirectory && mode === 'move') continue;
      if (targetDirectory === source || targetDirectory.startsWith(`${source}${path.sep}`)) {
        errors.push(`${path.basename(source)}：不能复制或移动到自身内部`);
        failedSources.push(source);
        continue;
      }
      const prepared = operation.task.plans?.[source] || await prepareTransferDestination(sender, operation, source, targetDirectory, mode);
      if (!prepared.destination) continue;
      const { destination, decision, backupPath } = prepared;
      const [sourceStat, targetStat] = await Promise.all([fsp.lstat(source), fsp.stat(targetDirectory)]);
      prepared.sourceSize = sourceStat.size;
      prepared.sourceMtime = sourceStat.mtimeMs;
      prepared.sameDevice = sourceStat.dev === targetStat.dev;
      operation.task.plans[source] = prepared;
      await updateTransferTask(sender, operation, { plans: operation.task.plans });
      try {
        if (mode === 'move') {
          await moveEntry(source, destination, operation, sender, measured[index]);
        } else {
          await copyEntryVerified(source, destination, operation, sender, prepared, measured[index]);
        }
        destinations.push(destination);
        historyItems.push({
          source,
          destination,
          mode,
          undo: decision === 'replace' ? 'replace' : mode,
          backupPath
        });
        operation.task.historyItems = historyItems;
        await updateTransferTask(sender, operation, { historyItems, completed: operation.completed });
      } catch (error) {
        if (error.code === 'EASYMOVE_CANCELLED') {
          await fsp.rm(destination, { recursive: true, force: true }).catch(() => {});
          if (prepared.stagingDestination) await fsp.rm(prepared.stagingDestination, { recursive: true, force: true }).catch(() => {});
          if (backupPath && fs.existsSync(backupPath)) await movePath(backupPath, destination).catch(() => {});
        }
        if (error.code === 'EASYMOVE_CANCELLED') throw error;
        errors.push(`${path.basename(source)}：${error.message}`);
        failedSources.push(source);
      }
    }

    if (!operation.cancelled && errors.length === 0) operation.completed = operation.total;
    emitProgress(sender, operation);
    const historyEntry = historyItems.length || errors.length ? await recordHistory(sender, {
      type: mode,
      label: `${mode === 'move' ? '移动' : '复制'} ${historyItems.length} 项`,
      canUndo: historyItems.length > 0,
      items: historyItems,
      errors,
      status: errors.length ? 'partial' : 'completed',
      retry: failedSources.length ? { sources: failedSources, targetDirectory, mode } : null
    }) : null;
    const taskStatus = errors.length
      ? (failedSources.length && failedSources.every((source) => !fs.existsSync(source)) ? 'waiting-volume' : 'partial')
      : 'completed';
    await updateTransferTask(sender, operation, { status: taskStatus, completed: operation.completed, total: operation.total, errors, currentFile: '' });
    sendOperation(sender, 'operation:complete', {
      id: operation.id,
      success: !operation.cancelled && errors.length === 0,
      cancelled: operation.cancelled,
      errors,
      destinations,
      historyEntry
    });
  } catch (error) {
    const historyEntry = historyItems.length || errors.length ? await recordHistory(sender, {
      type: mode,
      label: `${mode === 'move' ? '移动' : '复制'} ${historyItems.length} 项`,
      canUndo: historyItems.length > 0,
      items: historyItems,
      errors: error.code === 'EASYMOVE_CANCELLED' ? errors : [...errors, error.message],
      status: error.code === 'EASYMOVE_CANCELLED' ? 'cancelled' : 'partial',
      retry: failedSources.length ? { sources: failedSources, targetDirectory, mode } : null
    }) : null;
    sendOperation(sender, 'operation:complete', {
      id: operation.id,
      success: false,
      cancelled: error.code === 'EASYMOVE_CANCELLED',
      errors: error.code === 'EASYMOVE_CANCELLED' ? [] : [error.message],
      destinations,
      historyEntry
    });
    await updateTransferTask(sender, operation, {
      status: error.code === 'EASYMOVE_CANCELLED' ? 'cancelled' : error.code === 'ENOENT' ? 'waiting-volume' : 'needs-attention',
      completed: operation.completed,
      total: operation.total,
      errors: error.code === 'EASYMOVE_CANCELLED' ? [] : [error.message]
    });
  } finally {
    invalidateCaches();
    operations.delete(operation.id);
  }
}

async function beginTransfer(sender, request) {
  const id = `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const sources = Array.from(new Set((request.sources || []).map((item) => path.resolve(item))));
  const targetDirectory = normalizeDirectory(request.targetDirectory);
  const targetStat = await fsp.stat(targetDirectory);
  if (!targetStat.isDirectory()) throw new Error('目标路径不是文件夹');
  const task = await transferJournal.create({ id, sources, targetDirectory, mode: request.mode });
  const operation = {
    id,
    total: 1,
    completed: 0,
    paused: false,
    cancelled: false,
    lastProgressAt: 0,
    lastJournalAt: 0,
    pendingConflict: null,
    conflictDecision: null,
    task
  };
  operations.set(id, operation);
  broadcastTransferTasks(sender);
  setImmediate(() => runTransfer(sender, operation, sources, targetDirectory, request.mode === 'move' ? 'move' : 'copy'));
  return { id };
}

async function resumeTransfer(sender, id) {
  if (operations.has(id)) return { id, alreadyRunning: true };
  const task = transferJournal.get(id);
  if (!task) throw new Error('没有找到这项传输记录');
  if (['completed', 'cancelled'].includes(task.status)) throw new Error('这项传输已经结束');
  try {
    const targetStat = await fsp.stat(task.targetDirectory);
    if (!targetStat.isDirectory()) throw new Error('目标位置不是文件夹');
  } catch (error) {
    await transferJournal.update(id, { status: 'waiting-volume', errors: [`目标位置不可用：${task.targetDirectory}`] });
    broadcastTransferTasks(sender);
    throw new Error('目标磁盘或文件夹尚未连接');
  }
  const operation = {
    id,
    total: task.total || 1,
    completed: 0,
    paused: false,
    cancelled: false,
    lastProgressAt: 0,
    lastJournalAt: 0,
    pendingConflict: null,
    conflictDecision: task.conflictDecision || null,
    task
  };
  operations.set(id, operation);
  await updateTransferTask(sender, operation, { status: 'active', errors: [] });
  setImmediate(() => runTransfer(sender, operation, task.sources, task.targetDirectory, task.mode));
  return { id, resumed: true };
}

function registerIpc() {
  ipcMain.on('app:native-edit', (event, command) => {
    const method = command === 'select-all' ? 'selectAll' : command;
    if (['copy', 'cut', 'paste', 'selectAll'].includes(method) && typeof event.sender[method] === 'function') {
      event.sender[method]();
    }
  });

  ipcMain.handle('clipboard:write-files', async (_event, requestedPaths) => {
    if (process.env.EASYMOVE_E2E === '1' && process.env.EASYMOVE_VERIFY_SYSTEM_CLIPBOARD !== '1') {
      return { written: true, count: Array.isArray(requestedPaths) ? requestedPaths.length : 0, test: true };
    }
    return writeFilesToSystemClipboard(requestedPaths || []);
  });

  ipcMain.handle('clipboard:write-text', (_event, requestedText) => {
    const text = String(requestedText || '');
    const result = { text, count: text ? text.split('\n').length : 0 };
    if (process.env.EASYMOVE_E2E === '1' && process.env.EASYMOVE_VERIFY_SYSTEM_CLIPBOARD !== '1') return { ...result, test: true };
    clipboard.writeText(text);
    return result;
  });

  ipcMain.on('drag:start-native', (event, requestedPaths) => {
    const files = Array.from(new Set((requestedPaths || [])
      .map((item) => path.resolve(String(item)))
      .filter((item) => fs.existsSync(item))));
    if (!files.length) return;
    const iconPath = path.join(__dirname, '..', 'assets', 'drag-icon.png');
    const icon = nativeImage.createFromPath(iconPath).resize({ width: 36, height: 36 });
    event.sender.startDrag({ file: files[0], files, icon });
  });

  ipcMain.handle('context-menu:show', async (event, request = {}) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    const currentDirectory = normalizeDirectory(request.currentDirectory);
    const targetDirectory = normalizeDirectory(request.targetDirectory || currentDirectory);
    const selectedPaths = Array.from(new Set((request.paths || [])
      .map((item) => path.resolve(String(item)))
      .filter((item) => fs.existsSync(item))));
    const itemContext = Boolean(request.itemContext && selectedPaths.length);
    const paths = itemContext ? selectedPaths : [currentDirectory];
    const context = {
      itemContext,
      hasSelection: selectedPaths.length > 0,
      canPaste: Boolean(request.canPaste),
      platform: process.platform,
      selectionCount: selectedPaths.length,
      virtualContext: Boolean(request.virtualContext),
      virtualMode: request.virtualMode || null,
      paths,
      paneIndex: Number(request.paneIndex) || 0,
      targetDirectory,
      currentDirectory
    };
    context.canExtract = selectedPaths.length === 1 && Boolean(archiveType(selectedPaths[0]));
    const descriptors = nativeContextMenuItems(context);
    const menu = Menu.buildFromTemplate(nativeContextTemplate(descriptors, context, browserWindow, event.sender));
    if (process.env.EASYMOVE_E2E_SUPPRESS_MENUS !== '1') menu.popup({ window: browserWindow });
    return {
      native: true,
      targetDirectory,
      items: descriptors.filter((item) => item.id).map((item) => ({
        id: item.id,
        role: item.role || null,
        enabled: item.enabled !== false
      }))
    };
  });

  ipcMain.handle('fs:quick-look', async (event, requestedPaths) => {
    const browserWindow = BrowserWindow.fromWebContents(event.sender);
    const firstPath = Array.from(new Set((requestedPaths || [])
      .map((item) => path.resolve(String(item)))
      .filter((item) => fs.existsSync(item))))[0];
    if (!firstPath) throw new Error('请先选择要预览的文件或文件夹');
    void recentItems?.touch(firstPath).catch((error) => console.error('[recent-items:touch]', error));
    return toggleQuickLook(browserWindow, firstPath);
  });

  ipcMain.handle('app:initial-state', async () => ({
    version: app.getVersion(),
    platform: process.platform,
    locations: defaultLocations(),
    volumes: await mountedVolumes(),
    customTheme: publicCustomTheme(await readCustomTheme()),
    operationHistory: operationHistory?.list() || [],
    fileBasketCount: fileBasket?.list().length || 0,
    workspaces: workspaceStore?.list() || [],
    contentIndex: contentIndex?.snapshot() || { phase: 'idle', roots: [] },
    transferTasks: publicTransferTasks()
  }));

  ipcMain.handle('fs:volumes', () => mountedVolumes());

  ipcMain.handle('theme:choose-custom', async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: '选择自定义主题图片',
      properties: ['openFile'],
      filters: [
        { name: '图片', extensions: ['png', 'jpg', 'jpeg', 'webp'] }
      ]
    });
    if (result.canceled || !result.filePaths[0]) return { canceled: true, theme: publicCustomTheme(await readCustomTheme()) };
    const theme = await installCustomTheme(result.filePaths[0]);
    return { canceled: false, theme: publicCustomTheme(theme) };
  });

  ipcMain.handle('dialog:choose-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('fs:list', async (_event, request) => {
    const directory = normalizeDirectory(request.path);
    const stat = await fsp.stat(directory);
    if (!stat.isDirectory()) throw new Error('该路径不是文件夹');
    const entries = await getDirectoryEntries(directory, request.showHidden);
    void recentItems?.touch(directory).catch((error) => console.error('[recent-items:touch]', error));
    return { path: directory, entries };
  });

  ipcMain.handle('fs:resolve-path', async (_event, requestedPath) => {
    const resolved = path.resolve(String(requestedPath || ''));
    const stat = await fsp.stat(resolved);
    return {
      path: resolved,
      isDirectory: stat.isDirectory(),
      parentDirectory: stat.isDirectory() ? resolved : path.dirname(resolved)
    };
  });

  ipcMain.handle('fs:recent', async (_event, request = {}) => ({ path: 'easymove://recent', entries: await getRecentEntries(Boolean(request.showHidden)) }));

  ipcMain.handle('basket:list', async () => ({ path: 'easymove://basket', entries: await getFileBasketEntries() }));
  ipcMain.handle('basket:add', async (_event, requestedPaths) => {
    const paths = Array.from(new Set((requestedPaths || []).map((item) => path.resolve(String(item))).filter((item) => fs.existsSync(item))));
    await fileBasket.add(paths);
    return { count: fileBasket.list().length, entries: await getFileBasketEntries() };
  });
  ipcMain.handle('basket:remove', async (_event, idsOrPaths) => {
    await fileBasket.remove(idsOrPaths || []);
    return { count: fileBasket.list().length, entries: await getFileBasketEntries() };
  });
  ipcMain.handle('basket:clear', async () => {
    await fileBasket.clear();
    return { count: 0, entries: [] };
  });

  ipcMain.handle('workspace:list', async () => workspaceStore?.list() || []);
  ipcMain.handle('workspace:save', async (_event, request) => {
    const workspace = await workspaceStore.save(request || {});
    return { workspace, workspaces: workspaceStore.list() };
  });
  ipcMain.handle('workspace:remove', async (_event, id) => ({ workspaces: await workspaceStore.remove(id) }));

  ipcMain.handle('index:status', async () => contentIndex?.snapshot() || { phase: 'idle', roots: [] });
  ipcMain.handle('index:search', async (_event, request = {}) => ({
    path: 'easymove://search',
    query: String(request.query || ''),
    entries: await contentIndex.search(String(request.query || ''), request.limit || 300),
    status: contentIndex.snapshot()
  }));
  ipcMain.handle('index:control', async (_event, action) => {
    if (!['pause', 'resume', 'refresh', 'rebuild', 'clear'].includes(action)) throw new Error('未知的索引操作');
    await contentIndex[action]();
    return contentIndex.snapshot();
  });
  ipcMain.handle('index:add-root', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { title: '添加索引文件夹', properties: ['openDirectory'] });
    if (result.canceled || !result.filePaths[0]) return contentIndex.snapshot();
    return contentIndex.setRoots([...contentIndex.roots, result.filePaths[0]]);
  });
  ipcMain.handle('index:remove-root', async (_event, root) => contentIndex.setRoots(contentIndex.roots.filter((item) => item !== path.resolve(String(root)))));
  ipcMain.handle('index:set-roots', async (_event, roots) => contentIndex.setRoots(roots || []));

  ipcMain.handle('fs:folder-sizes', async (_event, paths) => folderSizes?.measure(paths || []) || []);

  ipcMain.handle('fs:preview', async (_event, itemPath) => {
    try {
      const preview = await thumbnails.describe(path.resolve(itemPath));
      return { ...preview, url: preview.thumbnail ? `easymove-thumb://cache/${preview.thumbnail}/preview.png` : null };
    } catch (error) {
      const code = error.previewCode || error.code || 'UNAVAILABLE';
      console.error('[preview:ipc]', { code, pathHash: require('node:crypto').createHash('sha256').update(String(itemPath)).digest('hex').slice(0, 12), message: error.message });
      return { url: null, folderCover: false, children: [], error: code };
    }
  });

  ipcMain.handle('fs:create-folder', async (event, directory) => {
    const targetDirectory = normalizeDirectory(directory);
    const destination = uniqueDestination(targetDirectory, '未命名文件夹');
    await fsp.mkdir(destination);
    invalidateCaches();
    await recordHistory(event.sender, {
      type: 'create-folder',
      label: '新建文件夹',
      canUndo: true,
      items: [{ destination }]
    });
    return destination;
  });

  ipcMain.handle('fs:rename', async (event, request) => {
    const source = path.resolve(request.path);
    const cleanName = String(request.name || '').trim();
    if (!cleanName || cleanName.includes('/') || cleanName.includes('\\')) throw new Error('文件名无效');
    const destination = path.join(path.dirname(source), cleanName);
    if (fs.existsSync(destination)) throw new Error('同名文件已经存在');
    await fsp.rename(source, destination);
    invalidateCaches();
    await recordHistory(event.sender, {
      type: 'rename',
      label: `重命名“${path.basename(source)}”`,
      canUndo: true,
      items: [{ source, destination }]
    });
    return destination;
  });

  ipcMain.handle('fs:batch-rename', async (event, request = {}) => {
    const changes = (request.changes || []).map((change) => {
      const source = path.resolve(String(change.path || ''));
      const name = String(change.name || '').trim();
      if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') throw new Error(`${name || '空名称'}：文件名无效`);
      return { source, destination: path.join(path.dirname(source), name) };
    });
    if (changes.length < 2) throw new Error('批量重命名至少需要两个项目');
    const completed = await performExactBatchRename(changes);
    invalidateCaches();
    const entry = await recordHistory(event.sender, {
      type: 'batch-rename',
      label: `批量重命名 ${completed.length} 项`,
      canUndo: true,
      items: completed
    });
    return { destinations: completed.map((item) => item.destination), historyEntry: entry };
  });

  ipcMain.handle('fs:trash', async (event, paths) => {
    const errors = [];
    const items = [];
    for (const item of paths) {
      try {
        const source = path.resolve(item);
        const trashPath = await trashItemWithPath(source);
        items.push({ source, trashPath });
      } catch (error) {
        errors.push(`${path.basename(item)}：${error.message}`);
      }
    }
    invalidateCaches();
    const entry = await recordHistory(event.sender, {
      type: 'trash',
      label: `移入${process.platform === 'darwin' ? '废纸篓' : '回收站'} ${items.length} 项`,
      canUndo: items.length > 0 && items.every((item) => item.trashPath),
      items,
      errors,
      status: errors.length ? 'partial' : 'completed'
    });
    return { success: errors.length === 0, errors, historyEntry: entry };
  });

  ipcMain.handle('fs:compress', async (_event, requestedPaths) => {
    if (process.platform !== 'darwin') throw new Error('当前系统暂不支持原生压缩');
    const sources = Array.from(new Set((requestedPaths || [])
      .map((item) => path.resolve(String(item)))
      .filter((item) => fs.existsSync(item))));
    if (!sources.length) throw new Error('没有可压缩的项目');
    const parents = new Set(sources.map((item) => path.dirname(item)));
    if (parents.size !== 1) throw new Error('请选择同一文件夹内的项目进行压缩');
    const directory = path.dirname(sources[0]);
    const archiveName = sources.length === 1 ? `${path.basename(sources[0])}.zip` : '归档.zip';
    const destination = uniqueDestination(directory, archiveName);
    if (sources.length === 1) {
      await execFileAsync('/usr/bin/ditto', ['-c', '-k', '--sequesterRsrc', '--keepParent', sources[0], destination]);
    } else {
      await execFileAsync('/usr/bin/zip', ['-r', '-y', destination, ...sources.map((item) => path.basename(item))], {
        cwd: directory,
        maxBuffer: 8 * 1024 * 1024
      });
    }
    invalidateCaches();
    return { destination };
  });

  ipcMain.handle('fs:extract', async (event, request = {}) => {
    const source = path.resolve(String(request.path || ''));
    if (!fs.existsSync(source)) throw new Error('压缩包已经不存在');
    const destinations = await extractArchive(source, request.mode === 'folder' ? 'folder' : 'here');
    invalidateCaches();
    const entry = await recordHistory(event.sender, {
      type: 'extract',
      label: `解压“${path.basename(source)}”`,
      canUndo: destinations.length > 0,
      items: destinations.map((destination) => ({ destination, undo: 'copy' }))
    });
    return { destinations, historyEntry: entry };
  });

  ipcMain.handle('fs:open', async (_event, itemPath) => {
    const resolved = path.resolve(itemPath);
    void recentItems?.touch(resolved).catch((error) => console.error('[recent-items:touch]', error));
    return shell.openPath(resolved);
  });
  ipcMain.handle('fs:reveal', async (_event, itemPath) => shell.showItemInFolder(path.resolve(itemPath)));

  ipcMain.handle('fs:drag-default-mode', async (_event, request) => {
    const targetDirectory = normalizeDirectory(request.targetDirectory);
    const targetStat = await fsp.stat(targetDirectory);
    const sources = Array.from(new Set((request.sources || []).map((item) => path.resolve(item))));
    for (const source of sources) {
      const sourceStat = await fsp.stat(source);
      if (sourceStat.dev !== targetStat.dev) return 'copy';
    }
    return 'move';
  });

  ipcMain.handle('fs:transfer', async (event, request) => {
    return beginTransfer(event.sender, request);
  });
  ipcMain.handle('transfer:list', async () => publicTransferTasks());
  ipcMain.handle('transfer:resume-task', async (event, id) => resumeTransfer(event.sender, id));
  ipcMain.handle('transfer:remove-task', async (event, id) => {
    if (operations.has(id)) throw new Error('请先暂停或取消正在进行的传输');
    await transferJournal.remove(id);
    broadcastTransferTasks(event.sender);
    return publicTransferTasks();
  });

  ipcMain.handle('history:list', async () => operationHistory?.list() || []);

  ipcMain.handle('history:undo', async (event, id) => undoHistoryEntry(event.sender, id));

  ipcMain.handle('history:retry', async (event, id) => {
    const entry = operationHistory.get(id);
    if (!entry?.retry?.sources?.length) throw new Error('这条记录没有可以重试的失败项目');
    const sources = entry.retry.sources.filter((item) => fs.existsSync(item));
    if (!sources.length) throw new Error('失败项目的源文件已不存在');
    return beginTransfer(event.sender, { ...entry.retry, sources });
  });

  ipcMain.handle('operation:resolve-conflict', async (_event, request) => {
    const operation = operations.get(request.operationId);
    const pending = operation?.pendingConflict;
    if (!pending || pending.id !== request.conflictId) return { found: false };
    const action = ['replace', 'keep-both', 'skip', 'cancel'].includes(request.action) ? request.action : 'cancel';
    pending.resolve({ action, applyAll: Boolean(request.applyAll) });
    return { found: true };
  });

  ipcMain.handle('operation:control', async (_event, request) => {
    const operation = operations.get(request.id);
    if (!operation) return { found: false };
    if (request.action === 'pause') operation.paused = true;
    if (request.action === 'resume') operation.paused = false;
    if (request.action === 'cancel') {
      operation.cancelled = true;
      operation.pendingConflict?.resolve({ action: 'cancel', applyAll: false });
    }
    await updateTransferTask(null, operation, { status: operation.cancelled ? 'cancelled' : operation.paused ? 'paused' : 'active' });
    return { found: true, paused: operation.paused, cancelled: operation.cancelled };
  });
}
