const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');

const delay = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds));

async function waitFor(check, message, timeout = 15000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try {
      const value = await check();
      if (value) return value;
    } catch {}
    await delay(80);
  }
  throw new Error(`Timed out: ${message}`);
}

async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const { port } = server.address();
  await new Promise((resolve) => server.close(resolve));
  return port;
}

class DevToolsClient {
  constructor(url) {
    this.nextId = 1;
    this.pending = new Map();
    this.socket = new WebSocket(url);
  }

  async connect() {
    await new Promise((resolve, reject) => {
      this.socket.addEventListener('open', resolve, { once: true });
      this.socket.addEventListener('error', reject, { once: true });
    });
    this.socket.addEventListener('message', (event) => {
      const message = JSON.parse(event.data);
      if (!message.id || !this.pending.has(message.id)) return;
      const { resolve, reject } = this.pending.get(message.id);
      this.pending.delete(message.id);
      if (message.error) reject(new Error(message.error.message));
      else resolve(message.result);
    });
    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }

  send(method, params = {}) {
    const id = this.nextId++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true });
    if (response.exceptionDetails) {
      const message = response.exceptionDetails.text || 'Renderer evaluation failed';
      throw new Error(`${message}\nExpression: ${String(expression).replace(/\s+/g, ' ').slice(0, 240)}`);
    }
    return response.result.value;
  }

  close() {
    this.socket.close();
  }
}

async function clickAt(client, point, button = 'left') {
  await client.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button, clickCount: 1 });
  await client.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button, clickCount: 1 });
}

async function pressKey(client, key, code = key, modifiers = 0) {
  await client.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code, modifiers });
  await client.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code, modifiers });
}

async function centerOf(client, selector) {
  return client.evaluate(`(() => {
    const element = document.querySelector(${JSON.stringify(selector)});
    if (!element) return null;
    const rect = element.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  })()`);
}

async function folderManifest(root) {
  const manifest = [];
  async function visit(directory, relative = '') {
    const entries = await fs.readdir(directory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));
    for (const entry of entries) {
      const itemRelative = path.join(relative, entry.name);
      const itemPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        manifest.push({ path: itemRelative, type: 'directory' });
        await visit(itemPath, itemRelative);
      } else {
        manifest.push({ path: itemRelative, type: 'file', contents: (await fs.readFile(itemPath)).toString('base64') });
      }
    }
  }
  await visit(root);
  return manifest;
}

async function main() {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'easymove-context-menu-'));
  const expectedRealVolume = process.env.EASYMOVE_EXPECT_REAL_VOLUME || '';
  const profile = path.join(fixture, 'profile');
  const volumeRoot = path.join(fixture, 'volumes');
  const source = path.join(fixture, '剪切定位测试.txt');
  const copySource = path.join(fixture, '复制定位测试.txt');
  const destination = path.join(fixture, '目标文件夹');
  const expandedFolder = path.join(fixture, '保持展开');
  const expandedChild = path.join(expandedFolder, '展开状态测试.txt');
  const shiftedDecoyFolder = path.join(fixture, '樊振东品牌档案馆');
  const intendedFolder = path.join(fixture, '女将军地标打卡');
  const compressionSource = path.join(fixture, '原生压缩测试.txt');
  const conflictSource = path.join(fixture, '重名冲突.txt');
  const conflictDestination = path.join(destination, '重名冲突.txt');
  const conflictDuplicate = path.join(destination, '重名冲突 副本.txt');
  const retrySource = path.join(fixture, '失败后重试.txt');
  const retryDestination = path.join(destination, '失败后重试.txt');
  const hiddenSource = path.join(fixture, '.隐藏文件快捷键.txt');
  const quickLookA = path.join(fixture, '连续预览-A.txt');
  const quickLookB = path.join(fixture, '连续预览-B.txt');
  const archiveFolder = path.join(fixture, '归档');
  const trashName = `快捷键删除测试-${process.pid}-${Date.now()}.txt`;
  const trashSource = path.join(fixture, trashName);
  const trashCleanupPath = path.join(os.homedir(), '.Trash', trashName);
  await fs.writeFile(source, 'EasyMove context menu integration test\n');
  await fs.mkdir(volumeRoot);
  await fs.writeFile(copySource, 'EasyMove copy and reveal integration test\n');
  await fs.writeFile(compressionSource, 'EasyMove native compression integration test\n');
  await fs.writeFile(conflictSource, 'incoming conflict content\n');
  await fs.writeFile(retrySource, 'retry after permission recovery\n');
  await fs.writeFile(hiddenSource, 'hidden shortcut integration test\n');
  await fs.writeFile(quickLookA, 'continuous Quick Look A\n');
  await fs.writeFile(quickLookB, 'continuous Quick Look B\n');
  await fs.chmod(retrySource, 0o000);
  await fs.writeFile(trashSource, 'EasyMove keyboard trash integration test\n');
  await fs.mkdir(destination);
  await fs.writeFile(conflictDestination, 'existing conflict content\n');
  await fs.mkdir(expandedFolder);
  await fs.writeFile(expandedChild, 'The column must remain expanded after transfers.\n');
  await fs.mkdir(shiftedDecoyFolder);
  await fs.mkdir(intendedFolder);
  await fs.mkdir(path.join(archiveFolder, '照片'), { recursive: true });
  await fs.writeFile(path.join(archiveFolder, '封面.png'), Buffer.alloc(8193, 17));
  await fs.writeFile(path.join(archiveFolder, '照片', '第一张.jpg'), Buffer.alloc(16385, 29));
  await fs.writeFile(path.join(archiveFolder, '照片', '第二张.jpg'), Buffer.alloc(32771, 43));

  const port = await availablePort();
  const packagedExecutable = process.env.EASYMOVE_TEST_EXECUTABLE;
  const executable = packagedExecutable || require('electron');
  const launchArguments = [
    ...(packagedExecutable ? [] : ['.']),
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${profile}`
  ];
  const output = [];
  const launchEnvironment = {
    ...process.env,
    ELECTRON_ENABLE_LOGGING: '1',
    EASYMOVE_E2E: '1',
    ...(expectedRealVolume ? {} : { EASYMOVE_E2E_VOLUME_ROOT: volumeRoot })
  };
  const child = spawn(executable, launchArguments, {
    cwd: path.join(__dirname, '..'),
    env: launchEnvironment,
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));

  let client;
  try {
    const page = await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/json`);
      if (!response.ok) return null;
      const pages = await response.json();
      return pages.find((item) => item.type === 'page' && item.url.includes('index.html'));
    }, 'Electron renderer DevTools endpoint');

    client = new DevToolsClient(page.webSocketDebuggerUrl);
    await client.connect();
    await client.send('Page.bringToFront');
    await waitFor(() => client.evaluate("document.querySelectorAll('.path-input').length === 4"), 'EasyMove initial render');
    if (expectedRealVolume) {
      const realVolume = await waitFor(() => client.evaluate(`(() => {
        const volume = state.volumes.find((item) => item.path === ${JSON.stringify(expectedRealVolume)});
        const button = document.querySelector('[data-nav-path="${encodeURIComponent(expectedRealVolume)}"]');
        return volume && button ? { volume, label: button.querySelector('small')?.textContent || '' } : null;
      })()`), 'real mounted SD card appeared in the sidebar');
      assert.equal(realVolume.volume.removable, true, 'real SD card must be identified as removable');
      assert.equal(realVolume.label, realVolume.volume.readOnly ? '只读' : '外置', 'the sidebar label must match the SD card current write state');
      assert.equal(await client.evaluate("state.volumes.some((volume) => volume.protocol === 'Disk Image')"), false, 'mounted installer images must be hidden from the volume list');
    } else {
      const testSdCard = path.join(volumeRoot, 'Rosia测试SD卡');
      await fs.mkdir(testSdCard);
      await waitFor(() => client.evaluate(`state.volumes.some((volume) => volume.path === ${JSON.stringify(testSdCard)})
        && Boolean(document.querySelector('[data-nav-path="${encodeURIComponent(testSdCard)}"]'))`), 'hot-plugged SD card appeared in the sidebar');
      assert.equal(await client.evaluate(`(() => {
        const volume = state.volumes.find((item) => item.path === ${JSON.stringify(testSdCard)});
        return volume?.removable === true && volume?.readOnly === false;
      })()`), true, 'hot-plugged SD card must be identified as a writable removable volume');
      await fs.rmdir(testSdCard);
      await waitFor(() => client.evaluate(`!state.volumes.some((volume) => volume.path === ${JSON.stringify(testSdCard)})
        && !document.querySelector('[data-nav-path="${encodeURIComponent(testSdCard)}"]')`), 'removed SD card disappeared from the sidebar');
    }
    const themeDimensions = await client.evaluate(`Promise.all([
      '../../assets/theme-blue-floral.webp',
      '../../assets/theme-iris.webp',
      '../../assets/theme-lakeside.webp'
    ].map((source) => new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve([image.naturalWidth, image.naturalHeight]);
      image.onerror = () => reject(new Error('Failed to load theme: ' + source));
      image.src = source;
    })))`);
    assert.deepEqual(themeDimensions, [[1672, 941], [1672, 941], [1672, 941]], 'compressed themes must load at their original dimensions');
    const toolbarShortcuts = await client.evaluate(`Object.fromEntries([...document.querySelectorAll('.content-toolbar [data-command]')]
      .filter((button) => button.getAttribute('aria-keyshortcuts'))
      .map((button) => [button.dataset.command, {
        aria: button.getAttribute('aria-keyshortcuts'),
        ariaLabel: button.getAttribute('aria-label'),
        description: button.dataset.tooltipDescription,
        shortcut: button.dataset.tooltipShortcut,
        title: button.title
      }]))`);
    assert.deepEqual(toolbarShortcuts, {
      'new-folder': { aria: 'Meta+Shift+N', ariaLabel: '新建文件夹：在当前窗格创建文件夹。快捷键 ⌘⇧N', description: '在当前窗格创建文件夹', shortcut: '快捷键  ⌘⇧N', title: '' },
      copy: { aria: 'Meta+C', ariaLabel: '复制：复制所选项目。快捷键 ⌘C', description: '复制所选项目', shortcut: '快捷键  ⌘C', title: '' },
      cut: { aria: 'Meta+X', ariaLabel: '剪切：剪切所选项目。快捷键 ⌘X', description: '剪切所选项目', shortcut: '快捷键  ⌘X', title: '' },
      paste: { aria: 'Meta+V', ariaLabel: '粘贴：粘贴到当前窗格。快捷键 ⌘V', description: '粘贴到当前窗格', shortcut: '快捷键  ⌘V', title: '' },
      rename: { aria: 'Enter', ariaLabel: '重命名：重命名所选项目。快捷键 Return', description: '重命名所选项目', shortcut: '快捷键  Return', title: '' },
      trash: { aria: 'Backspace', ariaLabel: '废纸篓：将所选项目移到废纸篓。快捷键 ⌫', description: '将所选项目移到废纸篓', shortcut: '快捷键  ⌫', title: '' }
    });
    const copyButtonCenter = await centerOf(client, '[data-command="copy"]');
    await client.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: copyButtonCenter.x, y: copyButtonCenter.y });
    const visibleShortcutTooltip = await waitFor(() => client.evaluate(`(() => {
      const button = document.querySelector('[data-command="copy"]');
      const style = getComputedStyle(button, '::after');
      return style.opacity === '1' ? { content: style.content, opacity: style.opacity } : null;
    })()`), 'toolbar teaching tooltip became visible');
    assert.equal(visibleShortcutTooltip.opacity, '1');
    assert.match(visibleShortcutTooltip.content, /复制所选项目/);
    assert.match(visibleShortcutTooltip.content, /⌘C/);
    const brandOffset = await client.evaluate(`(() => {
      const brand = document.querySelector('.brand');
      const matrix = new DOMMatrixReadOnly(getComputedStyle(brand).transform);
      return { x: matrix.m41, y: matrix.m42 };
    })()`);
    assert.deepEqual(brandOffset, { x: 32, y: 0 }, 'macOS brand group must move right without shifting the rest of the titlebar');
    const signature = await client.evaluate(`(() => {
      const element = document.querySelector('.creator-signature');
      const style = getComputedStyle(element);
      return { text: element.textContent.trim(), fontSize: style.fontSize, fontWeight: style.fontWeight, height: element.getBoundingClientRect().height };
    })()`);
    assert.deepEqual({ text: signature.text, fontSize: signature.fontSize, fontWeight: signature.fontWeight }, { text: 'Designed with care by Rosiawu', fontSize: '9px', fontWeight: '500' }, 'creator signature must remain elegant while clearly visible');
    assert.ok(signature.height <= 12, 'creator signature must not increase the footer height');

    await client.evaluate(`Promise.all([
      loadPane(0, ${JSON.stringify(fixture)}, { pushHistory: false }),
      loadPane(1, ${JSON.stringify(destination)}, { pushHistory: false })
    ])`);

    const sourceSelector = `.file-row[data-path="${encodeURIComponent(source)}"]`;
    const copySourceSelector = `.file-row[data-path="${encodeURIComponent(copySource)}"]`;
    const folderSelector = `.file-row[data-path="${encodeURIComponent(destination)}"]`;
    const expandedFolderSelector = `.file-row[data-path="${encodeURIComponent(expandedFolder)}"]`;
    await waitFor(() => client.evaluate(`Boolean(document.querySelector(${JSON.stringify(sourceSelector)}))`), 'fixture file row');

    const archiveManifest = await folderManifest(archiveFolder);
    const archiveCopies = [path.join(fixture, '归档 副本'), path.join(fixture, '归档 副本 2'), path.join(fixture, '归档 副本 3')];
    for (let index = 0; index < archiveCopies.length; index += 1) {
      await client.evaluate(`startTransfer([${JSON.stringify(archiveFolder)}], ${JSON.stringify(fixture)}, 'copy')`);
      await waitFor(() => client.evaluate('state.operation === null'), `verified archive copy ${index + 1}`, 30000);
      assert.deepEqual(await folderManifest(archiveCopies[index]), archiveManifest, `archive copy ${index + 1} must match every source file byte-for-byte`);
    }
    assert.equal((await fs.readdir(fixture)).some((name) => name.startsWith('.easymove-copy-')), false, 'verified copies must not leave staging folders visible');

    const recentSelector = `[data-nav-path="${encodeURIComponent('easymove://recent')}"]`;
    await clickAt(client, await centerOf(client, recentSelector));
    await waitFor(() => client.evaluate(`state.panes[0].virtualMode === 'recent' && document.querySelector('.path-input[data-pane="0"]')?.value === '最近访问'`), 'recent items sidebar shortcut');
    await waitFor(() => client.evaluate(`Boolean(document.querySelector('.file-row[data-pane="0"][data-path="${encodeURIComponent(fixture)}"]'))`), 'visited fixture appears in recent items');
    assert.equal(await client.evaluate(`document.querySelector(${JSON.stringify(recentSelector)})?.classList.contains('active')`), true, 'recent sidebar shortcut must show its active state');
    await client.evaluate(`loadPane(0, ${JSON.stringify(fixture)}, { pushHistory: false })`);
    await waitFor(() => client.evaluate(`Boolean(document.querySelector(${JSON.stringify(sourceSelector)}))`), 'return from recent items');

    const keyboardNavigation = await client.evaluate(`(() => {
      state.activePane = 0;
      const entries = filteredEntries(state.panes[0]);
      selectRow(0, entries[0].path, { shiftKey: false, metaKey: false, ctrlKey: false });
      return entries.slice(0, 3).map((entry) => entry.path);
    })()`);
    assert.equal(keyboardNavigation.length, 3, 'fixture must provide at least three keyboard navigation items');
    await pressKey(client, 'ArrowDown', 'ArrowDown');
    assert.deepEqual(await client.evaluate(`({
      focus: state.panes[0].keyboardFocusPath,
      selected: [...state.panes[0].selection]
    })`), { focus: keyboardNavigation[1], selected: [keyboardNavigation[1]] }, 'ArrowDown must move the active selection');
    await pressKey(client, 'ArrowDown', 'ArrowDown', 8);
    assert.deepEqual(await client.evaluate(`({
      focus: state.panes[0].keyboardFocusPath,
      selected: [...state.panes[0].selection]
    })`), { focus: keyboardNavigation[2], selected: keyboardNavigation.slice(1, 3) }, 'Shift+ArrowDown must extend selection from its anchor');
    await pressKey(client, 'ArrowUp', 'ArrowUp');
    assert.deepEqual(await client.evaluate('[...state.panes[0].selection]'), [keyboardNavigation[1]], 'plain ArrowUp must collapse the range to one item');

    const paneWidthBeforeHidden = await client.evaluate("document.querySelector('.pane[data-pane=\"0\"]').getBoundingClientRect().width");
    const hiddenSelector = `.file-row[data-pane="0"][data-path="${encodeURIComponent(hiddenSource)}"]`;
    assert.equal(await client.evaluate(`Boolean(document.querySelector(${JSON.stringify(hiddenSelector)}))`), false, 'hidden dotfile must start hidden');
    await pressKey(client, '.', 'Period', 12);
    await waitFor(() => client.evaluate(`state.panes[0].showHidden && Boolean(document.querySelector(${JSON.stringify(hiddenSelector)}))`), 'Command+Shift+Period showed hidden files');
    assert.ok(Math.abs((await client.evaluate("document.querySelector('.pane[data-pane=\"0\"]').getBoundingClientRect().width")) - paneWidthBeforeHidden) < 1, 'hidden-file toggle must not resize panes');
    await pressKey(client, '.', 'Period', 12);
    await waitFor(() => client.evaluate(`!state.panes[0].showHidden && !document.querySelector(${JSON.stringify(hiddenSelector)})`), 'second hidden-file shortcut hid dotfiles');

    await client.evaluate(`selectRow(0, ${JSON.stringify(intendedFolder)}, { shiftKey: false, metaKey: false, ctrlKey: false })`);
    await pressKey(client, 'ArrowDown', 'ArrowDown', 4);
    await waitFor(() => client.evaluate(`document.querySelector('.path-input[data-pane="0"]')?.value === ${JSON.stringify(intendedFolder)}`), 'Command+Down opened the selected folder');
    await pressKey(client, 'ArrowUp', 'ArrowUp', 4);
    await waitFor(() => client.evaluate(`document.querySelector('.path-input[data-pane="0"]')?.value === ${JSON.stringify(fixture)}`), 'Command+Up returned to the parent folder');

    await client.evaluate(`(() => {
      selectRow(0, ${JSON.stringify(quickLookA)}, { shiftKey: false, metaKey: false, ctrlKey: false });
      state.quickLook = null;
    })()`);
    await pressKey(client, ' ', 'Space');
    await waitFor(() => client.evaluate(`state.quickLook?.open && state.quickLook.path === ${JSON.stringify(quickLookA)}`), 'continuous Quick Look opened first item');
    await pressKey(client, 'ArrowDown', 'ArrowDown');
    await waitFor(() => client.evaluate(`state.quickLook?.open && state.quickLook.path === ${JSON.stringify(quickLookB)} && state.panes[0].keyboardFocusPath === ${JSON.stringify(quickLookB)}`), 'ArrowDown switched the open Quick Look preview');
    await pressKey(client, ' ', 'Space');
    await waitFor(() => client.evaluate(`state.quickLook?.open === false && state.quickLook.path === ${JSON.stringify(quickLookB)}`), 'Space closed the continuously switched Quick Look preview');

    await client.evaluate(`(() => {
      state.platform = 'win32';
      selectRow(0, ${JSON.stringify(intendedFolder)}, { shiftKey: false, metaKey: false, ctrlKey: false });
    })()`);
    await pressKey(client, 'Enter', 'Enter');
    await waitFor(() => client.evaluate(`document.querySelector('.path-input[data-pane="0"]')?.value === ${JSON.stringify(intendedFolder)}`), 'Windows Enter opened the selected folder');
    await pressKey(client, 'ArrowUp', 'ArrowUp', 1);
    await waitFor(() => client.evaluate(`document.querySelector('.path-input[data-pane="0"]')?.value === ${JSON.stringify(fixture)}`), 'Windows Alt+Up returned to the parent folder');
    await pressKey(client, 'H', 'KeyH', 2);
    await waitFor(() => client.evaluate(`state.panes[0].showHidden && Boolean(document.querySelector(${JSON.stringify(hiddenSelector)}))`), 'Windows Ctrl+H showed hidden files');
    await pressKey(client, 'H', 'KeyH', 2);
    await waitFor(() => client.evaluate(`!state.panes[0].showHidden && !document.querySelector(${JSON.stringify(hiddenSelector)})`), 'second Windows hidden-file shortcut hid dotfiles');
    await client.evaluate("state.platform = 'darwin'");

    const compressionResult = await client.evaluate(`api.compress([${JSON.stringify(compressionSource)}])`);
    assert.equal(compressionResult.destination, `${compressionSource}.zip`);
    await fs.access(compressionResult.destination);

    await pressKey(client, 'N', 'KeyN', 12);
    const newFolder = path.join(fixture, '未命名文件夹');
    const newFolderSelector = `.file-row[data-pane="0"][data-path="${encodeURIComponent(newFolder)}"]`;
    await waitFor(async () => {
      try {
        await fs.access(newFolder);
        return client.evaluate(`document.querySelector(${JSON.stringify(newFolderSelector)})?.classList.contains('selected')`);
      } catch {
        return false;
      }
    }, 'new-folder keyboard shortcut');
    await pressKey(client, 'Enter', 'Enter');
    await waitFor(() => client.evaluate("!document.getElementById('renameModal').hidden"), 'rename keyboard shortcut');
    const renamedFolder = path.join(fixture, '快捷键新建并重命名');
    await client.evaluate(`(() => {
      const input = document.getElementById('renameInput');
      input.value = ${JSON.stringify(path.basename(renamedFolder))};
      document.getElementById('renameForm').requestSubmit();
    })()`);
    await waitFor(async () => {
      try {
        await fs.access(renamedFolder);
        return true;
      } catch {
        return false;
      }
    }, 'renamed folder on disk');
    const renamedFolderSelector = `.file-row[data-pane="0"][data-path="${encodeURIComponent(renamedFolder)}"]`;
    await waitFor(() => client.evaluate(`document.getElementById('renameModal').hidden
      && document.getElementById('toastMessage').textContent === '重命名完成'
      && Boolean(document.querySelector(${JSON.stringify(renamedFolderSelector)}))`), 'rename refresh settled before keyboard trash');

    const trashSelector = `.file-row[data-pane="0"][data-path="${encodeURIComponent(trashSource)}"]`;
    await client.evaluate(`(() => {
      selectRow(0, ${JSON.stringify(trashSource)}, { shiftKey: false, metaKey: false, ctrlKey: false });
      document.querySelector(${JSON.stringify(trashSelector)})?.scrollIntoView({ block: 'center' });
    })()`);
    await waitFor(() => client.evaluate(`document.querySelector(${JSON.stringify(trashSelector)})?.classList.contains('selected')`), 'trash fixture selected before editing guard');
    await client.evaluate("document.getElementById('globalSearch').focus()");
    await pressKey(client, 'Backspace', 'Backspace');
    await fs.access(trashSource);
    await client.send('Page.bringToFront');
    await client.evaluate(`(() => {
      document.getElementById('globalSearch').blur();
      selectRow(0, ${JSON.stringify(trashSource)}, { shiftKey: false, metaKey: false, ctrlKey: false });
    })()`);
    await waitFor(() => client.evaluate(`document.querySelector(${JSON.stringify(trashSelector)})?.classList.contains('selected') && document.activeElement?.id !== 'globalSearch'`), 'trash fixture selected after leaving search');
    await pressKey(client, 'Backspace', 'Backspace');
    await waitFor(async () => {
      try {
        await fs.access(trashSource);
        return false;
      } catch {
        return true;
      }
    }, 'bare macOS Delete/Backspace moved the selected file to Trash');
    await waitFor(() => client.evaluate("document.getElementById('toastMessage').textContent.includes('废纸篓')"), 'trash keyboard confirmation');
    await pressKey(client, 'Z', 'KeyZ', 4);
    await waitFor(async () => {
      try {
        await fs.access(trashSource);
        return true;
      } catch {
        return false;
      }
    }, 'Command+Z restored the trashed file');
    await waitFor(() => client.evaluate("document.getElementById('toastMessage').textContent.includes('已撤销')"), 'trash undo confirmation');

    await clickAt(client, await centerOf(client, '.transfer-bar'));
    await waitFor(() => client.evaluate("!document.getElementById('operationHistoryPanel').hidden && document.getElementById('operationHistoryList').textContent.includes('移入废纸篓')"), 'operation history overlay');
    await client.evaluate("document.getElementById('closeOperationHistory').click()");

    await client.evaluate(`document.querySelector('[data-view-mode="column"][data-pane="0"]').click()`);
    await waitFor(() => client.evaluate(`document.querySelector('[data-view-mode="column"][data-pane="0"]')?.classList.contains('active') && Boolean(document.querySelector('.pane[data-pane="0"] .column-browser'))`), 'column view activation');
    await clickAt(client, await centerOf(client, expandedFolderSelector));
    await waitFor(() => client.evaluate(`document.querySelector('.pane[data-pane="0"] .column:nth-child(2)')?.textContent.includes(${JSON.stringify(path.basename(expandedChild))})`), 'expanded source column');
    await pressKey(client, 'ArrowRight', 'ArrowRight');
    assert.equal(await client.evaluate('state.panes[0].keyboardFocusPath'), expandedChild, 'column ArrowRight must enter the expanded child column');
    await pressKey(client, 'ArrowLeft', 'ArrowLeft');
    assert.equal(await client.evaluate('state.panes[0].keyboardFocusPath'), expandedFolder, 'column ArrowLeft must return to the parent column item');
    const paneWidthWithoutPreview = await client.evaluate("document.querySelector('.pane[data-pane=\"0\"]').getBoundingClientRect().width");
    await clickAt(client, await centerOf(client, copySourceSelector));
    assert.equal(await client.evaluate("document.getElementById('selectionPreview').hidden"), true, 'single click must not open an overlay over another pane');
    const paneWidthAfterSelection = await client.evaluate("document.querySelector('.pane[data-pane=\"0\"]').getBoundingClientRect().width");
    assert.ok(Math.abs(paneWidthAfterSelection - paneWidthWithoutPreview) < 1, 'single click must keep the source pane stable');

    await client.evaluate('state.quickLook = null');
    await pressKey(client, ' ', 'Space');
    const openedQuickLook = await waitFor(() => client.evaluate('state.quickLook?.open ? state.quickLook : null'), 'Space opened native Quick Look');
    assert.deepEqual(openedQuickLook, { open: true, path: copySource });
    await pressKey(client, ' ', 'Space');
    const closedQuickLook = await waitFor(() => client.evaluate('state.quickLook?.open === false ? state.quickLook : null'), 'second Space closed native Quick Look');
    assert.deepEqual(closedQuickLook, { open: false, path: copySource });

    await client.evaluate(`(() => {
      state.quickLook = null;
      document.getElementById('globalSearch').focus();
    })()`);
    await pressKey(client, ' ', 'Space');
    await delay(200);
    assert.equal(await client.evaluate('state.quickLook'), null, 'Space in an input must not open Quick Look');
    await clickAt(client, await centerOf(client, copySourceSelector));

    await clickAt(client, await centerOf(client, copySourceSelector), 'right');
    const firstMenu = await waitFor(() => client.evaluate('state.nativeContextMenu'), 'native macOS file context menu');
    assert.equal(firstMenu.native, true);
    assert.deepEqual(firstMenu.items.map((item) => item.id), [
      'open', 'open-with', 'quick-look', 'cut', 'copy', 'basket-add', 'paste', 'rename',
      'duplicate', 'compress', 'baidu-upload', 'trash', 'get-info', 'share',
      'services', 'copy-path', 'reveal'
    ]);
    assert.equal(firstMenu.items.find((item) => item.id === 'paste').enabled, false);
    assert.equal(firstMenu.items.find((item) => item.id === 'share').role, 'shareMenu');
    assert.equal(firstMenu.items.find((item) => item.id === 'services').role, 'services');
    const copiedPathResult = await client.evaluate(`executeCommand('copy-path')`);
    assert.equal(copiedPathResult.text, copySource, 'copy-path must copy the complete selected path');
    assert.equal(copiedPathResult.count, 1);
    assert.equal(await client.evaluate(`document.getElementById('renameModal').hidden`), true, 'copy-path must never open rename');
    await waitFor(() => client.evaluate(`document.getElementById('toastMessage').textContent.includes('已拷贝完整路径')`), 'copy-path confirmation');

    await pressKey(client, 'Escape', 'Escape');
    await pressKey(client, 'C', 'KeyC', 4);
    await waitFor(() => client.evaluate("document.getElementById('toastMessage').textContent.includes('已复制')"), 'copy confirmation');

    await clickAt(client, await centerOf(client, '.pane[data-pane="1"] .file-list'));
    await pressKey(client, 'V', 'KeyV', 4);
    const copiedPath = path.join(destination, path.basename(copySource));
    await waitFor(async () => {
      try {
        await fs.access(copiedPath);
        return true;
      } catch {
        return false;
      }
    }, 'copied item on disk');
    const copiedSelector = `.file-row[data-pane="1"][data-path="${encodeURIComponent(copiedPath)}"]`;
    await waitFor(() => client.evaluate(`(() => {
      const row = document.querySelector(${JSON.stringify(copiedSelector)});
      const viewport = document.querySelector('.pane[data-pane="1"] .file-list');
      if (!row || !viewport) return false;
      const rowRect = row.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      return row.classList.contains('selected') && row.classList.contains('transfer-reveal') && rowRect.top >= viewportRect.top && rowRect.bottom <= viewportRect.bottom;
    })()`), 'copied item reveal');

    await pressKey(client, 'Z', 'KeyZ', 4);
    await waitFor(async () => {
      try {
        await fs.access(copiedPath);
        return false;
      } catch {
        return true;
      }
    }, 'Command+Z removed the copied item');
    await fs.access(copySource);

    const conflictPaneWidth = await client.evaluate("document.querySelector('.pane[data-pane=\"1\"]').getBoundingClientRect().width");
    await client.evaluate(`startTransfer([${JSON.stringify(conflictSource)}], ${JSON.stringify(destination)}, 'copy')`);
    await waitFor(() => client.evaluate("!document.getElementById('conflictModal').hidden"), 'name conflict dialog');
    assert.ok(Math.abs((await client.evaluate("document.querySelector('.pane[data-pane=\"1\"]').getBoundingClientRect().width")) - conflictPaneWidth) < 1, 'conflict dialog must not resize panes');
    await client.evaluate("document.querySelector('[data-conflict-action=\"keep-both\"]').click()");
    await waitFor(async () => {
      try {
        return (await fs.readFile(conflictDuplicate, 'utf8')) === 'incoming conflict content\n';
      } catch {
        return false;
      }
    }, 'keep-both conflict decision');
    await waitFor(() => client.evaluate('state.operation === null'), 'keep-both transfer completion');
    assert.equal(await fs.readFile(conflictDestination, 'utf8'), 'existing conflict content\n');
    await pressKey(client, 'Z', 'KeyZ', 4);
    await waitFor(async () => {
      try {
        await fs.access(conflictDuplicate);
        return false;
      } catch {
        return true;
      }
    }, 'undo keep-both copy');

    await client.evaluate(`startTransfer([${JSON.stringify(conflictSource)}], ${JSON.stringify(destination)}, 'copy')`);
    await waitFor(() => client.evaluate("!document.getElementById('conflictModal').hidden"), 'replace conflict dialog');
    await client.evaluate("document.querySelector('[data-conflict-action=\"replace\"]').click()");
    await waitFor(async () => (await fs.readFile(conflictDestination, 'utf8').catch(() => '')) === 'incoming conflict content\n', 'replace conflict decision');
    await waitFor(() => client.evaluate('state.operation === null'), 'replace transfer completion');
    await pressKey(client, 'Z', 'KeyZ', 4);
    await waitFor(async () => (await fs.readFile(conflictDestination, 'utf8').catch(() => '')) === 'existing conflict content\n', 'undo replace restored original destination');
    assert.equal(await fs.readFile(conflictSource, 'utf8'), 'incoming conflict content\n');

    await client.evaluate(`startTransfer([${JSON.stringify(retrySource)}], ${JSON.stringify(destination)}, 'copy')`);
    await waitFor(() => client.evaluate("state.operation === null && state.operationHistory.some((entry) => entry.retry?.sources?.length)"), 'failed transfer entered operation history');
    await fs.chmod(retrySource, 0o644);
    await clickAt(client, await centerOf(client, '.transfer-bar'));
    await waitFor(() => client.evaluate("!document.getElementById('operationHistoryPanel').hidden && Boolean(document.querySelector('[data-history-action=\"retry\"]'))"), 'retry action in operation history');
    await client.evaluate("document.querySelector('[data-history-action=\"retry\"]').click()");
    await waitFor(async () => (await fs.readFile(retryDestination, 'utf8').catch(() => '')) === 'retry after permission recovery\n', 'failed item retry completion');
    await waitFor(() => client.evaluate('state.operation === null'), 'retry operation completion');

    await client.evaluate('state.nativeContextMenu = null');
    await clickAt(client, await centerOf(client, sourceSelector), 'right');
    await waitFor(() => client.evaluate("state.nativeContextMenu?.items.some((item) => item.id === 'trash')"), 'second native file context menu');
    const paneWidthBeforeCut = await client.evaluate("document.querySelector('.pane[data-pane=\"0\"]').getBoundingClientRect().width");
    await pressKey(client, 'Escape', 'Escape');
    await pressKey(client, 'X', 'KeyX', 4);
    await waitFor(() => client.evaluate(`document.querySelector(${JSON.stringify(sourceSelector)}).classList.contains('cut')`), 'cut visual state');
    const cutLayout = await client.evaluate(`({
      previewOpen: document.getElementById('contentStage').classList.contains('has-selection-preview'),
      paneWidth: document.querySelector('.pane[data-pane="0"]').getBoundingClientRect().width
    })`);
    assert.equal(cutLayout.previewOpen, false, 'cut must not open an overlay over another pane');
    assert.ok(Math.abs(cutLayout.paneWidth - paneWidthBeforeCut) < 1, 'cut must keep the source pane width stable');

    await client.evaluate('state.nativeContextMenu = null');
    await clickAt(client, await centerOf(client, folderSelector), 'right');
    const folderMenu = await waitFor(() => client.evaluate('state.nativeContextMenu'), 'native folder context menu');
    assert.equal(folderMenu.targetDirectory, destination);
    assert.equal(folderMenu.items.find((item) => item.id === 'paste').enabled, true);
    await pressKey(client, 'Escape', 'Escape');

    await client.evaluate('state.nativeContextMenu = null');
    await clickAt(client, await centerOf(client, '.pane[data-pane="1"] .file-list'), 'right');
    const targetMenu = await waitFor(() => client.evaluate('state.nativeContextMenu'), 'native pane background context menu');
    assert.deepEqual(targetMenu.items.map((item) => item.id), ['new-folder', 'paste', 'select-all', 'get-info', 'services']);
    assert.equal(targetMenu.items.find((item) => item.id === 'paste').enabled, true);
    await pressKey(client, 'Escape', 'Escape');
    await pressKey(client, 'V', 'KeyV', 4);
    await waitFor(async () => {
      try {
        await fs.access(path.join(destination, path.basename(source)));
        return true;
      } catch {
        return false;
      }
    }, 'cut item pasted into the right-clicked folder');
    await assert.rejects(fs.access(source));
    await waitFor(() => client.evaluate("document.getElementById('transferMeta').textContent === '完成'"), 'Electron transfer completion');
    assert.equal(await client.evaluate(`document.querySelector('.pane[data-pane="0"] .column:nth-child(2)')?.textContent.includes(${JSON.stringify(path.basename(expandedChild))})`), true, 'unrelated expanded source column must survive transfer refresh');
    const pastedPath = path.join(destination, path.basename(source));
    const pastedSelector = `.file-row[data-pane="1"][data-path="${encodeURIComponent(pastedPath)}"]`;
    const revealedItem = await waitFor(() => client.evaluate(`(() => {
      const row = document.querySelector(${JSON.stringify(pastedSelector)});
      const viewport = document.querySelector('.pane[data-pane="1"] .file-list');
      if (!row || !viewport) return null;
      const rowRect = row.getBoundingClientRect();
      const viewportRect = viewport.getBoundingClientRect();
      const result = {
        selected: row.classList.contains('selected'),
        highlighted: row.classList.contains('transfer-reveal'),
        inView: rowRect.top >= viewportRect.top && rowRect.bottom <= viewportRect.bottom
      };
      return result.selected && result.highlighted && result.inView ? result : null;
    })()`), 'pasted item reveal');
    assert.deepEqual(revealedItem, { selected: true, highlighted: true, inView: true });

    await client.evaluate(`loadPane(1, ${JSON.stringify(fixture)}, { pushHistory: false })`);
    await waitFor(() => client.evaluate(`Boolean(document.querySelector('.file-row[data-pane="1"][data-path="${encodeURIComponent(intendedFolder)}"]'))`), 'folder activation fixture');
    await client.evaluate(`document.querySelector('[data-view-mode="icon"][data-pane="1"]').click()`);
    await waitFor(() => client.evaluate(`document.querySelector('[data-view-mode="icon"][data-pane="1"]')?.classList.contains('active')`), 'icon view activation');
    const iconKeyboardStart = await client.evaluate(`(() => {
      state.activePane = 1;
      const first = filteredEntries(state.panes[1])[0].path;
      selectRow(1, first, { shiftKey: false, metaKey: false, ctrlKey: false });
      return first;
    })()`);
    await pressKey(client, 'ArrowRight', 'ArrowRight');
    assert.notEqual(await client.evaluate('state.panes[1].keyboardFocusPath'), iconKeyboardStart, 'icon ArrowRight must move spatially to the next item');
    await client.evaluate(`(() => {
      const intended = document.querySelector('.file-row[data-pane="1"][data-path="${encodeURIComponent(intendedFolder)}"]');
      const shifted = document.querySelector('.file-row[data-pane="1"][data-path="${encodeURIComponent(shiftedDecoyFolder)}"]');
      intended.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }));
      shifted.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 2 }));
      shifted.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, detail: 2 }));
    })()`);
    await waitFor(() => client.evaluate(`document.querySelector('.path-input[data-pane="1"]')?.value === ${JSON.stringify(intendedFolder)}`), 'stable double-click target after a row shift');
    if (process.env.EASYMOVE_E2E_SCREENSHOT) {
      const screenshot = await client.send('Page.captureScreenshot', { format: 'png' });
      await fs.writeFile(process.env.EASYMOVE_E2E_SCREENSHOT, Buffer.from(screenshot.data, 'base64'));
    }

    console.log('Electron interaction passed: three verified folder copies, keyboard navigation, continuous Quick Look, hidden files, undo history, conflicts, retry, native menus, Trash, and stable panes.');
  } catch (error) {
    if (client) {
      const diagnostic = await client.evaluate(`({
        paths: [...document.querySelectorAll('.path-input')].map((input) => input.value),
        rows: [...document.querySelectorAll('.file-row')].map((row) => decodeURIComponent(row.dataset.path)).filter((itemPath) => itemPath.startsWith(${JSON.stringify(fixture)})),
        toast: document.getElementById('toastMessage').textContent
      })`).catch(() => null);
      error.message += `\nRenderer state: ${JSON.stringify(diagnostic)}`;
    }
    error.message += `\nElectron output:\n${output.slice(-20).join('')}`;
    throw error;
  } finally {
    client?.close();
    child.kill('SIGTERM');
    await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(2000)]);
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGKILL');
      await Promise.race([new Promise((resolve) => child.once('exit', resolve)), delay(2000)]);
    }
    await fs.rm(trashCleanupPath, { force: true }).catch(() => {});
    await fs.rm(fixture, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
