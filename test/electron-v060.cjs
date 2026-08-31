const assert = require('node:assert/strict');
const { spawn, execFileSync } = require('node:child_process');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { copyStagingPath } = require('../src/verified-copy');

const delay = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
async function waitFor(check, message, timeout = 20000) {
  const started = Date.now();
  while (Date.now() - started < timeout) {
    try { const value = await check(); if (value) return value; } catch {}
    await delay(40);
  }
  throw new Error(`Timed out: ${message}`);
}
async function availablePort() {
  const server = net.createServer();
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', resolve).once('error', reject));
  const port = server.address().port;
  await new Promise((resolve) => server.close(resolve));
  return port;
}

class Client {
  constructor(url) { this.id = 0; this.pending = new Map(); this.socket = new WebSocket(url); }
  async connect() {
    await new Promise((resolve, reject) => { this.socket.onopen = resolve; this.socket.onerror = reject; });
    this.socket.onmessage = (event) => {
      const message = JSON.parse(event.data);
      const callback = this.pending.get(message.id);
      if (callback) { this.pending.delete(message.id); callback(message); }
    };
    await this.send('Runtime.enable');
    await this.send('Page.enable');
  }
  send(method, params = {}) {
    return new Promise((resolve) => { const id = ++this.id; this.pending.set(id, resolve); this.socket.send(JSON.stringify({ id, method, params })); });
  }
  async evaluate(expression) {
    const response = await this.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
    if (response.result.exceptionDetails) throw new Error(response.result.exceptionDetails.text || 'renderer error');
    return response.result.result.value;
  }
  async click(selector, button = 'left') {
    const point = await this.evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)return null;const rect=element.getBoundingClientRect();return{x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()`);
    if (!point) throw new Error(`Missing click target: ${selector}`);
    await this.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: point.x, y: point.y, button, clickCount: 1 });
    await this.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: point.x, y: point.y, button, clickCount: 1 });
  }
  async hover(selector) {
    const point = await this.evaluate(`(()=>{const element=document.querySelector(${JSON.stringify(selector)});if(!element)return null;const rect=element.getBoundingClientRect();return{x:rect.left+rect.width/2,y:rect.top+rect.height/2}})()`);
    if (!point) throw new Error(`Missing hover target: ${selector}`);
    await this.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: point.x, y: point.y, button: 'none' });
  }
  async pressKey(key, code = key) {
    await this.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', key, code });
    await this.send('Input.dispatchKeyEvent', { type: 'keyUp', key, code });
  }
  async screenshot(filePath) {
    const response = await this.send('Page.captureScreenshot', { format: 'png', captureBeyondViewport: false });
    await fs.writeFile(filePath, response.result.data, 'base64');
  }
  close() { this.socket.close(); }
}

async function launch(profile) {
  const port = await availablePort();
  const executable = process.env.EASYMOVE_TEST_EXECUTABLE || require('electron');
  const args = [...(process.env.EASYMOVE_TEST_EXECUTABLE ? [] : ['.']), `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`];
  const output = [];
  const child = spawn(executable, args, {
    cwd: path.join(__dirname, '..'),
    env: { ...process.env, EASYMOVE_E2E: '1', EASYMOVE_E2E_SUPPRESS_MENUS: '1', EASYMOVE_TEST_TRANSFER_DELAY_MS: '12' },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  child.stdout.on('data', (chunk) => output.push(chunk.toString()));
  child.stderr.on('data', (chunk) => output.push(chunk.toString()));
  const page = await waitFor(async () => {
    const response = await fetch(`http://127.0.0.1:${port}/json`);
    const pages = await response.json();
    return pages.find((item) => item.type === 'page' && item.url.includes('index.html'));
  }, 'v0.6 Electron page');
  const client = new Client(page.webSocketDebuggerUrl);
  await client.connect();
  await client.send('Page.bringToFront');
  await waitFor(() => client.evaluate('Boolean(window.easyMove && state.panes.length === 4)'), 'v0.6 renderer ready');
  return { child, client, output };
}

function waitForExit(child) { return new Promise((resolve) => child.once('exit', resolve)); }
async function hash(filePath) {
  const value = crypto.createHash('sha256');
  const handle = await fs.open(filePath, 'r');
  try {
    const buffer = Buffer.alloc(1024 * 1024);
    let position = 0;
    while (true) { const { bytesRead } = await handle.read(buffer, 0, buffer.length, position); if (!bytesRead) break; value.update(buffer.subarray(0, bytesRead)); position += bytesRead; }
  } finally { await handle.close(); }
  return value.digest('hex');
}

async function main() {
  const fixture = await fs.mkdtemp(path.join(os.tmpdir(), 'easymove-v060-'));
  const verifySystemClipboard = process.platform === 'darwin' && process.env.EASYMOVE_VERIFY_SYSTEM_CLIPBOARD === '1';
  const clipboardHelper = path.join(__dirname, '..', 'assets', 'easymove-file-clipboard');
  const clipboardSnapshot = path.join(fixture, 'pasteboard-before-test.plist');
  if (verifySystemClipboard) execFileSync(clipboardHelper, ['--snapshot', clipboardSnapshot]);
  const profile = path.join(fixture, 'profile');
  const indexRoot = path.join(fixture, '索引目录');
  const target = path.join(fixture, '目标');
  await fs.mkdir(target); await fs.mkdir(indexRoot);
  const galleryFolder = path.join(fixture, '画廊文件夹');
  const galleryChild = path.join(galleryFolder, '课程说明.txt');
  await fs.mkdir(galleryFolder);
  await fs.writeFile(galleryChild, 'gallery folder summary');
  const columnParent = path.join(fixture, '分栏统计目录');
  const columnSizedFolder = path.join(columnParent, '真实大小文件夹');
  const columnEmptyFolder = path.join(columnParent, '空文件夹');
  const columnPayload = path.join(columnSizedFolder, 'payload.bin');
  await fs.mkdir(columnSizedFolder, { recursive: true });
  await fs.mkdir(columnEmptyFolder);
  await fs.writeFile(columnPayload, Buffer.alloc(4097, 7));
  const photoPaths = Array.from({ length: 12 }, (_, index) => path.join(fixture, `00-photo-${String(index + 1).padStart(2, '0')}.jpg`));
  const photoSeed = path.join(fixture, '.photo-seed.jpg');
  execFileSync('/usr/bin/sips', ['-s', 'format', 'jpeg', path.join(__dirname, '..', 'assets', 'drag-icon.png'), '--out', photoSeed]);
  await Promise.all(photoPaths.map((photoPath) => fs.copyFile(photoSeed, photoPath)));
  await fs.unlink(photoSeed);
  const indexed = path.join(indexRoot, '独立索引脚本.md');
  await fs.writeFile(indexed, '灯下白视频播客从教学现场开始。');
  const first = path.join(fixture, '第一课.txt');
  const second = path.join(fixture, '第二课.txt');
  await fs.writeFile(first, 'first'); await fs.writeFile(second, 'second');
  const archiveSource = path.join(fixture, '压缩内容.txt');
  await fs.writeFile(archiveSource, 'archive body');
  execFileSync('/usr/bin/zip', ['-j', path.join(fixture, '资料.zip'), archiveSource]);
  const large = path.join(fixture, '断点续传.bin');
  const handle = await fs.open(large, 'w'); await handle.truncate(32 * 1024 * 1024); await handle.close();

  let app = await launch(profile);
  try {
    assert.equal(await app.client.evaluate(`document.getElementById('appVersion').textContent`), require('../package.json').version, 'title bar must use the packaged application version');
    await app.client.evaluate(`easyMove.setContentIndexRoots([${JSON.stringify(indexRoot)}])`);
    await waitFor(() => app.client.evaluate("state.contentIndex.phase === 'ready'"), 'content index ready');
    const search = await app.client.evaluate(`easyMove.searchContentIndex('视频播客')`);
    assert.ok(search.entries.some((entry) => entry.path === indexed), 'global content index must find Chinese body text');
    await app.client.click('[data-global-search]');
    await waitFor(() => app.client.evaluate(`(()=>{const input=document.querySelector('.path-input.search-input[data-pane="0"]');return Boolean(input && !input.readOnly && input.placeholder.includes('搜索文件名与内容'))})()`), 'global search pane input editable');
    await app.client.evaluate(`(()=>{const input=document.querySelector('.path-input.search-input[data-pane="0"]');input.value='视频播客';input.dispatchEvent(new Event('input',{bubbles:true}));input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`);
    await waitFor(() => app.client.evaluate(`state.panes[state.activePane].virtualMode === 'search' && state.panes[state.activePane].searchQuery === '视频播客' && document.getElementById('globalSearch').value === '视频播客' && Boolean(document.querySelector('.file-row[data-path="${encodeURIComponent(indexed)}"]'))`), 'editable global search pane UI');

    await app.client.evaluate(`loadPane(0,${JSON.stringify(fixture)},{pushHistory:false})`);
    await waitFor(() => app.client.evaluate(`state.panes[0].virtualMode === null && document.querySelector('.path-input[data-pane="0"]')?.value === ${JSON.stringify(fixture)}`), 'regular folder address restored');
    await app.client.evaluate(`(()=>{const input=document.querySelector('.path-input[data-pane="0"]');input.value='灯下白';input.dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))})()`);
    await waitFor(() => app.client.evaluate(`state.panes[0].virtualMode === 'search' && state.panes[0].searchQuery === '灯下白' && !state.panes[0].error`), 'plain keyword in pane address falls back to global search');
    await app.client.evaluate(`(()=>{const input=document.getElementById('globalSearch');input.focus();const data=new DataTransfer();data.setData('text/plain',${JSON.stringify(photoPaths[0])});input.dispatchEvent(new ClipboardEvent('paste',{clipboardData:data,bubbles:true,cancelable:true}))})()`);
    await waitFor(() => app.client.evaluate(`(()=>{const pane=state.panes[0];const row=document.querySelector('.file-row[data-pane="0"][data-path="${encodeURIComponent(photoPaths[0])}"]');return pane.virtualMode===null && pane.path===${JSON.stringify(fixture)} && pane.selection.has(${JSON.stringify(photoPaths[0])}) && row?.classList.contains('selected') && row?.classList.contains('transfer-reveal')})()`), 'pasted file pathname opens its parent and reveals the exact file');
    assert.equal(await app.client.evaluate(`document.getElementById('renameModal').hidden`), true, 'pasting a path must never trigger rename');
    await app.client.evaluate(`(()=>{const input=document.getElementById('globalSearch');input.focus();input.value=${JSON.stringify(`file://${photoPaths[1]}`)}})()`);
    await app.client.pressKey('Enter', 'Enter');
    await waitFor(() => app.client.evaluate(`state.panes[0].selection.has(${JSON.stringify(photoPaths[1])}) && document.getElementById('renameModal').hidden`), 'Return in the address field navigates without triggering rename');
    await app.client.evaluate(`loadPane(0,${JSON.stringify(fixture)},{pushHistory:false})`);
    await waitFor(() => app.client.evaluate(`Boolean(document.querySelector('.file-row[data-path="${encodeURIComponent(galleryFolder)}"]'))`), 'gallery fixture folder');
    await app.client.click('[data-view-mode="gallery"][data-pane="0"]');
    await waitFor(() => app.client.evaluate(`(()=>{const entry=state.panes[0].entries.find((item)=>item.path===${JSON.stringify(galleryFolder)});return state.panes[0].viewMode==='gallery' && entry?.previewStatus==='ready' && Boolean(document.querySelector('.gallery-item[data-path="${encodeURIComponent(galleryFolder)}"]'))})()`), 'gallery render settled before selecting folder');
    await app.client.click(`.gallery-item[data-path="${encodeURIComponent(galleryFolder)}"]`);
    try {
      await waitFor(() => app.client.evaluate(`document.querySelector('.gallery-stage')?.textContent.includes('课程说明.txt') && !document.querySelector('.gallery-stage')?.textContent.includes('无法预览')`), 'gallery folder summary preview');
    } catch (error) {
      const galleryState = await app.client.evaluate(`(()=>{const pane=state.panes[0];const entry=pane.entries.find((item)=>item.path===${JSON.stringify(galleryFolder)});return{selection:[...pane.selection],entry,stage:document.querySelector('.gallery-stage')?.textContent,html:document.querySelector('.gallery-stage')?.innerHTML.slice(0,1200)}})()`);
      throw new Error(`${error.message}: ${JSON.stringify(galleryState)}`);
    }
    assert.equal(await app.client.evaluate(`document.querySelector('.gallery-mode-label')?.textContent.trim()`), '画廊预览');
    if (process.env.EASYMOVE_V060_SCREENSHOT) await app.client.screenshot(process.env.EASYMOVE_V060_SCREENSHOT);

    await app.client.evaluate(`(async()=>{await loadPane(0,${JSON.stringify(fixture)},{pushHistory:false});const pane=state.panes[0];pane.viewMode='column';renderPanes();await expandColumnFolder(0,pane.entries.find((entry)=>entry.path===${JSON.stringify(columnParent)}))})()`);
    const columnStats = await app.client.evaluate(`(()=>{const pane=state.panes[0];const sized=pane.columnEntries.find((entry)=>entry.path===${JSON.stringify(columnSizedFolder)});const empty=pane.columnEntries.find((entry)=>entry.path===${JSON.stringify(columnEmptyFolder)});return{sized:{size:sized?.size,status:sized?.folderSizeStatus,label:formatEntrySize(sized),children:sized?.previewChildren},empty:{size:empty?.size,status:empty?.folderSizeStatus,label:formatEntrySize(empty)}}})()`);
    assert.deepEqual(columnStats.sized, { size: 4097, status: 'ready', label: '4.0 KB', children: ['payload.bin'] }, 'column folder must use measured bytes and normalized preview data');
    assert.deepEqual(columnStats.empty, { size: 0, status: 'ready', label: '0 B' }, 'only a genuinely empty folder may display 0 B');
    await waitFor(() => app.client.evaluate(`!state.panes[0].indexing && !state.panes[0].indexingSlow`), 'folder statistics hydration settled');
    const clickPreviewSelector = `.column:nth-child(2) .file-row[data-path="${encodeURIComponent(columnSizedFolder)}"]`;
    await app.client.hover(clickPreviewSelector);
    await delay(2200);
    assert.equal(await app.client.evaluate(`document.getElementById('hoverPreview').hidden`), true, 'hovering without a click must not open the delayed preview');
    await app.client.click(clickPreviewSelector);
    await delay(1700);
    assert.equal(await app.client.evaluate(`document.getElementById('hoverPreview').hidden`), true, 'click preview must stay hidden during the first two seconds');
    await waitFor(() => app.client.evaluate(`!document.getElementById('hoverPreview').hidden && document.getElementById('hoverPreview').textContent.includes('4.0 KB') && !document.getElementById('hoverPreview').textContent.includes('0 B')`), 'single-click preview appears after two seconds');
    if (process.env.EASYMOVE_STATS_SCREENSHOT) await app.client.screenshot(process.env.EASYMOVE_STATS_SCREENSHOT);
    await app.client.evaluate('hideHoverPreview()');
    await app.client.evaluate(`(()=>{const pane=state.panes[0];selectRow(0,${JSON.stringify(columnEmptyFolder)},{shiftKey:false,metaKey:false,ctrlKey:false});renderSelectionSummary()})()`);
    assert.equal(await app.client.evaluate(`document.getElementById('selectionSummary').textContent.includes('0 B') && document.querySelector('.pane[data-pane="0"] .pane-status').textContent.includes('0 B')`), true, 'column selection summaries must include exact zero-byte folder size');

    const photoStart = photoPaths[6];
    await app.client.evaluate(`(()=>{const pane=state.panes[0];pane.viewMode='icon';pane.selection=new Set([${JSON.stringify(photoStart)}]);pane.anchorPath=${JSON.stringify(photoStart)};pane.keyboardFocusPath=${JSON.stringify(photoStart)};renderPanes()})()`);
    await app.client.pressKey(' ', 'Space');
    await waitFor(() => app.client.evaluate(`state.photoViewer?.open && state.photoViewer.path===${JSON.stringify(photoStart)} && !document.getElementById('photoViewer').hidden && Boolean(document.querySelector('#photoViewerMedia img'))`), 'photo viewer opened selected image');
    const viewerBounds = await app.client.evaluate(`(()=>{const rect=document.getElementById('photoViewer').getBoundingClientRect();return{left:rect.left,top:rect.top,right:rect.right,bottom:rect.bottom,width:innerWidth,height:innerHeight,covers:rect.left<=9&&rect.top<=9&&rect.right>=innerWidth-9&&rect.bottom>=innerHeight-9}})()`);
    assert.equal(viewerBounds.covers, true, `photo viewer must cover the complete EasyMove window: ${JSON.stringify(viewerBounds)}`);
    await app.client.evaluate('state.nativeContextMenu=null');
    await app.client.click('#photoViewerMedia', 'right');
    await waitFor(() => app.client.evaluate(`state.nativeContextMenu?.items.some((item)=>item.id==='copy') && state.nativeContextMenu?.items.some((item)=>item.id==='cut') && state.nativeContextMenu?.items.some((item)=>item.id==='trash') && state.nativeContextMenu?.items.some((item)=>item.id==='share')`), 'immersive photo native context menu');
    assert.deepEqual(await app.client.evaluate('[...state.panes[0].selection]'), [photoStart], 'photo context menu must target the currently previewed image');
    await app.client.evaluate(`document.dispatchEvent(new KeyboardEvent('keydown',{key:'c',metaKey:true,bubbles:true}))`);
    assert.deepEqual(await app.client.evaluate('state.clipboard'), { paths: [photoStart], mode: 'copy' }, 'Command+C must copy the immersive preview photo');
    await waitFor(() => app.client.evaluate(`document.getElementById('toastMessage').textContent.includes('微信')`), 'external clipboard copy confirmation');
    if (verifySystemClipboard) {
      await waitFor(() => {
        try {
          return execFileSync(clipboardHelper, ['--read'], { encoding: 'utf8' }).split(/\r?\n/).includes(photoStart);
        } catch { return false; }
      }, 'independent process reads the preview photo from macOS Pasteboard');
    }
    assert.equal(await app.client.evaluate(`Number(getComputedStyle(document.getElementById('toast')).zIndex)>Number(getComputedStyle(document.getElementById('photoViewer')).zIndex)`), true, 'photo copy feedback must remain visible above the immersive viewer');
    if (process.env.EASYMOVE_PHOTO_SCREENSHOT) await app.client.screenshot(process.env.EASYMOVE_PHOTO_SCREENSHOT);
    for (const key of ['ArrowRight', 'ArrowLeft', 'ArrowDown', 'ArrowUp']) {
      const expected = await app.client.evaluate(`geometricKeyboardTarget(0,state.photoViewer.path,${JSON.stringify(key)},new Set(${JSON.stringify(photoPaths)}))`);
      assert.notEqual(expected, await app.client.evaluate('state.photoViewer.path'), `${key} must have a photo target`);
      await app.client.pressKey(key, key);
      await waitFor(() => app.client.evaluate(`state.photoViewer?.path===${JSON.stringify(expected)}`), `photo viewer ${key}`);
    }
    await app.client.pressKey(' ', 'Space');
    await waitFor(() => app.client.evaluate(`!state.photoViewer && document.getElementById('photoViewer').hidden`), 'Space closed photo viewer');

    await app.client.evaluate(`(async()=>{await loadPane(0,${JSON.stringify(indexRoot)},{pushHistory:false});state.activePane=0;state.panes[0].selection=new Set([${JSON.stringify(indexed)}]);renderAll();await addSelectionToBasket()})()`);
    await app.client.click(`[data-nav-path="${encodeURIComponent('easymove://basket')}"]`);
    await waitFor(() => app.client.evaluate(`state.panes[0].virtualMode === 'basket' && Boolean(document.querySelector('.file-row[data-path="${encodeURIComponent(indexed)}"]'))`), 'file basket sidebar UI');

    await app.client.click('#saveWorkspaceButton');
    await app.client.evaluate(`(()=>{const input=document.getElementById('workspaceNameInput');input.value='v0.6 测试工作区';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await app.client.click('#workspaceForm .confirm');
    await waitFor(() => app.client.evaluate(`state.workspaces.some((item)=>item.name==='v0.6 测试工作区') && document.getElementById('workspaceModal').hidden`), 'workspace saved through UI');
    await app.client.click('[data-workspaces]');
    assert.equal(await app.client.evaluate(`!document.getElementById('workspacePanel').hidden && document.getElementById('workspaceList').textContent.includes('v0.6 测试工作区')`), true);
    await app.client.click('#closeWorkspacePanel');

    await app.client.evaluate(`(async()=>{await loadPane(0,${JSON.stringify(fixture)},{pushHistory:false});state.activePane=0;state.panes[0].selection=new Set([${JSON.stringify(first)},${JSON.stringify(second)}]);renderAll()})()`);
    await app.client.click('[data-command="rename"]');
    await waitFor(() => app.client.evaluate('!document.getElementById("batchRenameModal").hidden'), 'batch rename modal');
    await app.client.evaluate(`(()=>{const input=document.getElementById('batchValue');input.value='课程_';input.dispatchEvent(new Event('input',{bubbles:true}))})()`);
    await app.client.click('#batchRenameConfirm');
    await waitFor(async () => { try { await fs.access(path.join(fixture, '课程_第一课.txt')); return true; } catch { return false; } }, 'batch rename completed through UI');

    const extracted = await app.client.evaluate(`easyMove.extract(${JSON.stringify(path.join(fixture, '资料.zip'))},'folder')`);
    assert.equal(extracted.destinations.length, 1);
    await fs.access(path.join(extracted.destinations[0], '压缩内容.txt'));

    const transfer = await app.client.evaluate(`easyMove.transfer([${JSON.stringify(large)}],${JSON.stringify(target)},'copy')`);
    const destination = path.join(target, '断点续传.bin');
    const staging = copyStagingPath(destination, transfer.id);
    const partial = `${staging}.easymove-part`;
    await waitFor(async () => { try { const stat = await fs.stat(partial); return stat.size >= 2 * 1024 * 1024 && stat.size < 32 * 1024 * 1024; } catch { return false; } }, 'partial transfer checkpoint');
    app.client.close();
    app.child.kill('SIGKILL');
    await waitForExit(app.child);

    app = await launch(profile);
    const restored = await app.client.evaluate('easyMove.transferTasks()');
    const interrupted = restored.find((task) => task.id === transfer.id);
    assert.equal(interrupted.status, 'interrupted');
    await app.client.click('.transfer-bar');
    await waitFor(() => app.client.evaluate(`Boolean(document.querySelector('[data-history-action="resume-task"][data-task-id="${transfer.id}"]'))`), 'recoverable queue row visible');
    await app.client.click(`[data-history-action="resume-task"][data-task-id="${transfer.id}"]`);
    await waitFor(async () => { try { return (await fs.stat(destination)).size === 32 * 1024 * 1024; } catch { return false; } }, 'resumed transfer completed', 30000);
    await waitFor(async () => (await app.client.evaluate('easyMove.transferTasks()')).find((task) => task.id === transfer.id)?.status === 'completed', 'journal marked completed');
    assert.equal(await hash(large), await hash(destination));
    await assert.rejects(fs.access(partial));
    await assert.rejects(fs.access(staging));
    process.stdout.write(`Electron v0.6 interaction passed: editable global search, gallery, accurate column statistics, immersive photo navigation and native context menu${verifySystemClipboard ? ', cross-app macOS file clipboard' : ''}, content index, file basket, workspace, batch rename, safe extraction, and interrupted transfer resume.\n`);
  } finally {
    app.client?.close();
    if (app.child && app.child.exitCode === null) { app.child.kill('SIGTERM'); await waitForExit(app.child); }
    if (verifySystemClipboard) {
      try { execFileSync(clipboardHelper, ['--restore', clipboardSnapshot]); } catch {}
    }
    await fs.rm(fixture, { recursive: true, force: true });
  }
}

main().catch((error) => { console.error(error.stack || error); process.exitCode = 1; });
