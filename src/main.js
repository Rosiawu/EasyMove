const { app, BrowserWindow, ipcMain, dialog, shell, Menu, nativeImage } = require('electron');
const fs = require('node:fs');
const fsp = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');

const operations = new Map();
let mainWindow = null;

app.setAppUserModelId('com.easymove.app');

function createWindow() {
  mainWindow = new BrowserWindow({
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

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  mainWindow.once('ready-to-show', () => mainWindow.show());
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
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
        { role: 'undo' },
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

app.whenReady().then(() => {
  buildMenu();
  registerIpc();
  createWindow();
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
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
        size: isDirectory ? 0 : stat.size,
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
    const volumes = [{ name: 'Macintosh HD', path: '/' }];
    try {
      const rootRealPath = await fsp.realpath('/');
      const names = await fsp.readdir('/Volumes');
      for (const name of names) {
        const volumePath = path.join('/Volumes', name);
        const realPath = await fsp.realpath(volumePath).catch(() => volumePath);
        if (realPath !== rootRealPath) volumes.push({ name, path: volumePath });
      }
    } catch {}
    return volumes;
  }
  return [{ name: '/', path: '/' }];
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
}

async function copyFileWithProgress(source, destination, operation, sender) {
  await fsp.mkdir(path.dirname(destination), { recursive: true });
  const sourceHandle = await fsp.open(source, 'r');
  const destinationHandle = await fsp.open(destination, 'w');
  const buffer = Buffer.allocUnsafe(1024 * 1024);
  let completed = false;
  try {
    let position = 0;
    while (true) {
      await waitWhilePaused(operation);
      const { bytesRead } = await sourceHandle.read(buffer, 0, buffer.length, position);
      if (!bytesRead) break;
      await destinationHandle.write(buffer, 0, bytesRead, position);
      position += bytesRead;
      operation.completed += bytesRead;
      emitProgress(sender, operation, path.basename(source));
    }
    const stat = await sourceHandle.stat();
    await destinationHandle.chmod(stat.mode);
    await fsp.utimes(destination, stat.atime, stat.mtime);
    completed = true;
  } finally {
    await Promise.allSettled([sourceHandle.close(), destinationHandle.close()]);
    if (!completed) await fsp.rm(destination, { force: true }).catch(() => {});
  }
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
    await fsp.rm(source, { recursive: true, force: true });
  }
}

async function runTransfer(sender, operation, sources, targetDirectory, mode) {
  const errors = [];
  try {
    const measured = [];
    for (const source of sources) {
      try {
        measured.push(await measurePath(source));
      } catch (error) {
        measured.push(0);
        errors.push(`${path.basename(source)}：${error.message}`);
      }
    }
    operation.total = Math.max(1, measured.reduce((sum, size) => sum + size, 0));
    emitProgress(sender, operation);

    for (let index = 0; index < sources.length; index += 1) {
      const source = path.resolve(sources[index]);
      await waitWhilePaused(operation);
      if (!fs.existsSync(source)) {
        errors.push(`${path.basename(source)}：源文件不存在`);
        continue;
      }
      const sourceParent = path.dirname(source);
      if (sourceParent === targetDirectory && mode === 'move') continue;
      if (targetDirectory === source || targetDirectory.startsWith(`${source}${path.sep}`)) {
        errors.push(`${path.basename(source)}：不能复制或移动到自身内部`);
        continue;
      }
      const destination = uniqueDestination(targetDirectory, path.basename(source));
      try {
        if (mode === 'move') {
          await moveEntry(source, destination, operation, sender, measured[index]);
        } else {
          await copyEntry(source, destination, operation, sender);
        }
      } catch (error) {
        await fsp.rm(destination, { recursive: true, force: true }).catch(() => {});
        if (error.code === 'EASYMOVE_CANCELLED') throw error;
        errors.push(`${path.basename(source)}：${error.message}`);
      }
    }

    if (!operation.cancelled) operation.completed = operation.total;
    emitProgress(sender, operation);
    sendOperation(sender, 'operation:complete', {
      id: operation.id,
      success: !operation.cancelled && errors.length === 0,
      cancelled: operation.cancelled,
      errors
    });
  } catch (error) {
    sendOperation(sender, 'operation:complete', {
      id: operation.id,
      success: false,
      cancelled: error.code === 'EASYMOVE_CANCELLED',
      errors: error.code === 'EASYMOVE_CANCELLED' ? [] : [error.message]
    });
  } finally {
    operations.delete(operation.id);
  }
}

function registerIpc() {
  ipcMain.on('app:native-edit', (event, command) => {
    const method = command === 'select-all' ? 'selectAll' : command;
    if (['copy', 'cut', 'paste', 'selectAll'].includes(method) && typeof event.sender[method] === 'function') {
      event.sender[method]();
    }
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

  ipcMain.handle('app:initial-state', async () => ({
    platform: process.platform,
    locations: defaultLocations(),
    volumes: await mountedVolumes()
  }));

  ipcMain.handle('dialog:choose-folder', async () => {
    const result = await dialog.showOpenDialog(mainWindow, { properties: ['openDirectory', 'createDirectory'] });
    return result.canceled ? null : result.filePaths[0];
  });

  ipcMain.handle('fs:list', async (_event, request) => {
    const directory = normalizeDirectory(request.path);
    const stat = await fsp.stat(directory);
    if (!stat.isDirectory()) throw new Error('该路径不是文件夹');
    return { path: directory, entries: await getDirectoryEntries(directory, request.showHidden) };
  });

  ipcMain.handle('fs:create-folder', async (_event, directory) => {
    const targetDirectory = normalizeDirectory(directory);
    const destination = uniqueDestination(targetDirectory, '未命名文件夹');
    await fsp.mkdir(destination);
    return destination;
  });

  ipcMain.handle('fs:rename', async (_event, request) => {
    const source = path.resolve(request.path);
    const cleanName = String(request.name || '').trim();
    if (!cleanName || cleanName.includes('/') || cleanName.includes('\\')) throw new Error('文件名无效');
    const destination = path.join(path.dirname(source), cleanName);
    if (fs.existsSync(destination)) throw new Error('同名文件已经存在');
    await fsp.rename(source, destination);
    return destination;
  });

  ipcMain.handle('fs:trash', async (_event, paths) => {
    const errors = [];
    for (const item of paths) {
      try {
        await shell.trashItem(path.resolve(item));
      } catch (error) {
        errors.push(`${path.basename(item)}：${error.message}`);
      }
    }
    return { success: errors.length === 0, errors };
  });

  ipcMain.handle('fs:open', async (_event, itemPath) => shell.openPath(path.resolve(itemPath)));
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
    const id = `op-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const operation = {
      id,
      total: 1,
      completed: 0,
      paused: false,
      cancelled: false,
      lastProgressAt: 0
    };
    const sources = Array.from(new Set((request.sources || []).map((item) => path.resolve(item))));
    const targetDirectory = normalizeDirectory(request.targetDirectory);
    const targetStat = await fsp.stat(targetDirectory);
    if (!targetStat.isDirectory()) throw new Error('目标路径不是文件夹');
    operations.set(id, operation);
    setImmediate(() => runTransfer(event.sender, operation, sources, targetDirectory, request.mode === 'move' ? 'move' : 'copy'));
    return { id };
  });

  ipcMain.handle('operation:control', async (_event, request) => {
    const operation = operations.get(request.id);
    if (!operation) return { found: false };
    if (request.action === 'pause') operation.paused = true;
    if (request.action === 'resume') operation.paused = false;
    if (request.action === 'cancel') operation.cancelled = true;
    return { found: true, paused: operation.paused, cancelled: operation.cancelled };
  });
}
