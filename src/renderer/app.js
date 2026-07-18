const api = window.easyMove;

const state = {
  platform: 'darwin',
  locations: {},
  volumes: [],
  layout: 2,
  activePane: 0,
  panes: [],
  clipboard: null,
  operation: null,
  paused: false,
  toastTimer: null,
  renameTarget: null,
  drag: null,
  customTheme: null,
  hoverTimer: null,
  hoverToken: 0
};

const elements = {
  panes: document.getElementById('panes'),
  quickNav: document.getElementById('quickNav'),
  volumeNav: document.getElementById('volumeNav'),
  globalSearch: document.getElementById('globalSearch'),
  selectionSummary: document.getElementById('selectionSummary'),
  transferBar: document.querySelector('.transfer-bar'),
  queueCount: document.getElementById('queueCount'),
  transferTitle: document.getElementById('transferTitle'),
  transferDetail: document.getElementById('transferDetail'),
  transferMeta: document.getElementById('transferMeta'),
  progressFill: document.getElementById('progressFill'),
  pauseTransfer: document.getElementById('pauseTransfer'),
  cancelTransfer: document.getElementById('cancelTransfer'),
  toast: document.getElementById('toast'),
  toastTitle: document.getElementById('toastTitle'),
  toastMessage: document.getElementById('toastMessage'),
  renameModal: document.getElementById('renameModal'),
  renameForm: document.getElementById('renameForm'),
  renameInput: document.getElementById('renameInput'),
  natureSoundToggle: document.getElementById('natureSoundToggle'),
  customThemeButton: document.getElementById('customThemeButton'),
  hoverPreview: document.getElementById('hoverPreview')
};

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#039;');
}

function encodePath(value) {
  return encodeURIComponent(value);
}

function decodePath(value) {
  return decodeURIComponent(value);
}

function icon(name) {
  return `<svg aria-hidden="true"><use href="#i-${name}"/></svg>`;
}

function showToast(message, title = 'EasyMove') {
  elements.toastTitle.textContent = title;
  elements.toastMessage.textContent = message;
  elements.toast.classList.add('show');
  clearTimeout(state.toastTimer);
  state.toastTimer = setTimeout(() => elements.toast.classList.remove('show'), 3000);
}

function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return '—';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 || unit === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

function formatDate(timestamp) {
  if (!timestamp) return '—';
  const date = new Date(timestamp);
  const today = new Date();
  const sameDay = date.toDateString() === today.toDateString();
  return sameDay
    ? `今天 ${date.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`
    : date.toLocaleDateString('zh-CN', { month: '2-digit', day: '2-digit', year: date.getFullYear() === today.getFullYear() ? undefined : 'numeric' });
}

function basename(filePath) {
  const normalized = filePath.replaceAll('\\', '/').replace(/\/$/, '');
  return normalized.split('/').pop() || filePath;
}

function parentPath(filePath) {
  const separator = state.platform === 'win32' ? '\\' : '/';
  const normalized = filePath.replace(/[\\/]+$/, '');
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  if (index <= 0) return state.platform === 'win32' ? normalized.slice(0, 3) : '/';
  return normalized.slice(0, index) || separator;
}

function makePane(id, path) {
  return {
    id,
    path,
    entries: [],
    selection: new Set(),
    history: [path],
    historyIndex: 0,
    loading: true,
    error: '',
    filter: '',
    showHidden: false,
    loadToken: 0,
    anchorPath: null,
    sort: { field: 'name', direction: 'asc' }
  };
}

async function loadPane(index, targetPath, options = {}) {
  const pane = state.panes[index];
  if (!pane) return;
  const token = pane.loadToken + 1;
  pane.loadToken = token;
  pane.loading = true;
  pane.error = '';
  pane.selection.clear();
  renderPanes();
  try {
    const result = await api.listDirectory(targetPath, pane.showHidden);
    if (pane.loadToken !== token) return;
    pane.path = result.path;
    pane.entries = result.entries.map((entry) => ({
      ...entry,
      folderSizeStatus: entry.isDirectory ? 'loading' : 'ready',
      previewStatus: 'loading',
      previewUrl: null,
      folderCover: false
    }));
    pane.loading = false;
    pane.error = '';
    if (options.pushHistory !== false && pane.history[pane.historyIndex] !== result.path) {
      pane.history = pane.history.slice(0, pane.historyIndex + 1);
      pane.history.push(result.path);
      pane.historyIndex = pane.history.length - 1;
    }
    if (index === state.activePane) elements.globalSearch.value = pane.filter;
    renderAll();

    const previewResults = await Promise.all(pane.entries.map(async (entry) => {
      const preview = await api.preview(entry.path);
      return { path: entry.path, ...preview };
    }));
    if (pane.loadToken !== token) return;
    const previewMap = new Map(previewResults.map((preview) => [preview.path, preview]));
    pane.entries = pane.entries.map((entry) => {
      const preview = previewMap.get(entry.path);
      return { ...entry, previewStatus: 'ready', previewUrl: preview?.url || null, previewKind: preview?.previewKind || null, previewText: preview?.previewText || null, previewError: preview?.error || null, folderCover: Boolean(preview?.folderCover), previewChildren: preview?.children || [] };
    });
    renderAll();

    const directories = pane.entries.filter((entry) => entry.isDirectory).map((entry) => entry.path);
    if (directories.length) {
      try {
        const sizes = await api.folderSizes(directories);
        if (pane.loadToken !== token) return;
        const sizeMap = new Map(sizes.map((item) => [item.path, item.size]));
        pane.entries = pane.entries.map((entry) => {
          if (!entry.isDirectory) return entry;
          const size = sizeMap.get(entry.path);
          return { ...entry, size: size ?? null, folderSizeStatus: Number.isFinite(size) ? 'ready' : 'unavailable' };
        });
        renderAll();
      } catch {
        if (pane.loadToken !== token) return;
        pane.entries = pane.entries.map((entry) => entry.isDirectory ? { ...entry, size: null, folderSizeStatus: 'unavailable' } : entry);
        renderAll();
      }
    }
  } catch (error) {
    if (pane.loadToken !== token) return;
    pane.loading = false;
    pane.error = error.message || String(error);
    renderPanes();
    showToast(pane.error, '无法打开文件夹');
  }
}

function visiblePaneIndexes() {
  if (state.layout === 1) return [0];
  if (state.layout === 2) return [0, 1];
  return [0, 1, 2, 3];
}

function activePane() {
  return state.panes[state.activePane];
}

function otherPaneIndex() {
  const visible = visiblePaneIndexes();
  const currentPosition = visible.indexOf(state.activePane);
  if (currentPosition < 0) return visible[0];
  return visible[(currentPosition + 1) % visible.length] ?? 1;
}

function filteredEntries(pane) {
  const query = pane.filter.trim().toLocaleLowerCase();
  const entries = query ? pane.entries.filter((entry) => entry.name.toLocaleLowerCase().includes(query)) : pane.entries;
  return window.easyMoveSort.sortEntries(entries, pane.sort);
}

function sortIndicator(pane, field) {
  if (pane.sort.field !== field) return '';
  return `<span class="sort-indicator" aria-hidden="true">${pane.sort.direction === 'asc' ? '↑' : '↓'}</span>`;
}

function renderPane(pane) {
  const entries = filteredEntries(pane);
  const rows = entries.map((entry) => {
    const selected = pane.selection.has(entry.path) ? ' selected' : '';
    const cut = state.clipboard?.mode === 'move' && state.clipboard.paths.includes(entry.path) ? ' cut' : '';
    const fileIcon = entry.isDirectory ? icon('folder') : icon('image');
    const thumbnail = entry.previewUrl ? `<img src="${escapeHtml(entry.previewUrl)}" alt="">` : fileIcon;
    return `<tr class="file-row${selected}${cut}" data-pane="${pane.id}" data-path="${encodePath(entry.path)}" draggable="true" aria-selected="${pane.selection.has(entry.path) ? 'true' : 'false'}">
      <td><div class="file-name" title="${escapeHtml(entry.name)}"><span class="file-icon${entry.isDirectory ? (entry.folderCover ? ' folder-cover' : '') : ' file'}" data-preview-icon>${thumbnail}</span><span>${escapeHtml(entry.name)}</span></div></td>
      <td>${escapeHtml(entry.kind)}</td>
      <td>${escapeHtml(formatDate(entry.modified))}</td>
      <td class="size-cell${entry.folderSizeStatus === 'loading' ? ' calculating' : ''}">${entry.folderSizeStatus === 'loading' ? '计算中…' : escapeHtml(formatSize(entry.size))}</td>
    </tr>`;
  }).join('');

  const header = (field, label) => `<button class="sort-button" data-sort="${field}" data-pane="${pane.id}" aria-label="按${label}排序，当前${pane.sort.field === field ? (pane.sort.direction === 'asc' ? '升序' : '降序') : '未排序'}">${label}${sortIndicator(pane, field)}</button>`;
  let content = `<table class="file-table"><thead><tr><th>${header('name', '名称')}</th><th>${header('type', '类型')}</th><th>${header('modified', '修改时间')}</th><th>${header('size', '大小')}</th></tr></thead><tbody>${rows}</tbody></table>`;
  if (pane.loading) content = `<div class="empty-state"><div>${icon('refresh')}<br>正在读取文件夹…</div></div>`;
  else if (pane.error) content = `<div class="empty-state"><div>${icon('close')}<br>${escapeHtml(pane.error)}</div></div>`;
  else if (!entries.length) content = `<div class="empty-state"><div>${icon('bloom')}<br>${pane.filter ? '没有匹配的文件' : '这个文件夹是空的'}</div></div>`;

  const selectedSize = pane.entries.filter((entry) => pane.selection.has(entry.path) && entry.folderSizeStatus === 'ready').reduce((sum, entry) => sum + entry.size, 0);
  return `<section class="pane${pane.id === state.activePane ? ' active' : ''}" data-pane="${pane.id}">
    <div class="pane-tabs"><div class="pane-tab">${icon('folder')}<span>${escapeHtml(basename(pane.path) || pane.path)}</span></div></div>
    <div class="pane-address">
      <div class="address-buttons">
        <button class="mini-button" data-pane-action="back" data-pane="${pane.id}" ${pane.historyIndex <= 0 ? 'disabled' : ''} title="后退">${icon('back')}</button>
        <button class="mini-button" data-pane-action="forward" data-pane="${pane.id}" ${pane.historyIndex >= pane.history.length - 1 ? 'disabled' : ''} title="前进">${icon('next')}</button>
        <button class="mini-button" data-pane-action="up" data-pane="${pane.id}" title="上一级">${icon('up')}</button>
      </div>
      <input class="path-input" data-pane="${pane.id}" value="${escapeHtml(pane.path)}" aria-label="当前路径">
      <button class="mini-button" data-pane-action="refresh" data-pane="${pane.id}" title="刷新">${icon('refresh')}</button>
    </div>
    <div class="file-list">${content}</div>
    <div class="pane-status"><span>${pane.selection.size ? `已选择 ${pane.selection.size} 项` : `${pane.entries.length} 个项目`}</span><span>${selectedSize ? formatSize(selectedSize) : escapeHtml(pane.path)}</span></div>
  </section>`;
}

function renderPanes() {
  elements.panes.className = `panes layout-${state.layout}`;
  elements.panes.innerHTML = state.panes.map(renderPane).join('');
}

function renderSidebar() {
  const shortcuts = [
    ['home', '个人文件夹', 'home'],
    ['desktop', '桌面', 'home'],
    ['documents', '文稿', 'folder'],
    ['downloads', '下载', 'download'],
    ['pictures', '图片', 'image']
  ];
  elements.quickNav.innerHTML = shortcuts.map(([key, label, iconName]) => {
    const target = state.locations[key];
    const active = activePane()?.path === target ? ' active' : '';
    return `<button class="nav-item${active}" data-nav-path="${encodePath(target)}">${icon(iconName)}<span>${label}</span><small></small></button>`;
  }).join('');
  elements.volumeNav.innerHTML = state.volumes.map((volume) => {
    const active = activePane()?.path === volume.path ? ' active' : '';
    return `<button class="nav-item${active}" data-nav-path="${encodePath(volume.path)}">${icon('drive')}<span>${escapeHtml(volume.name)}</span><small></small></button>`;
  }).join('');
}

function renderSelectionSummary() {
  const pane = activePane();
  if (!pane || !pane.selection.size) {
    elements.selectionSummary.textContent = '未选择文件';
    return;
  }
  const selectedEntries = pane.entries.filter((entry) => pane.selection.has(entry.path));
  const size = selectedEntries.filter((entry) => entry.folderSizeStatus === 'ready').reduce((sum, entry) => sum + entry.size, 0);
  elements.selectionSummary.textContent = `已选择 ${pane.selection.size} 项${size ? ` · ${formatSize(size)}` : ''}`;
}

function renderAll() {
  renderPanes();
  renderSidebar();
  renderSelectionSummary();
}

function syncPaneInteractionState() {
  elements.panes.querySelectorAll('.pane').forEach((paneElement) => {
    const paneIndex = Number(paneElement.dataset.pane);
    const pane = state.panes[paneIndex];
    paneElement.classList.toggle('active', paneIndex === state.activePane);
    paneElement.querySelectorAll('.file-row').forEach((row) => {
      const filePath = decodePath(row.dataset.path);
      row.classList.toggle('selected', pane.selection.has(filePath));
      row.classList.toggle('cut', state.clipboard?.mode === 'move' && state.clipboard.paths.includes(filePath));
      row.setAttribute('aria-selected', pane.selection.has(filePath) ? 'true' : 'false');
    });

    const status = paneElement.querySelector('.pane-status');
    if (status) {
      const selectedSize = pane.entries
        .filter((entry) => pane.selection.has(entry.path) && entry.folderSizeStatus === 'ready')
        .reduce((sum, entry) => sum + entry.size, 0);
      status.children[0].textContent = pane.selection.size ? `已选择 ${pane.selection.size} 项` : `${pane.entries.length} 个项目`;
      status.children[1].textContent = selectedSize ? formatSize(selectedSize) : pane.path;
    }
  });
  elements.globalSearch.value = activePane().filter;
  renderSidebar();
  renderSelectionSummary();
}

function setActivePane(index) {
  if (!visiblePaneIndexes().includes(index)) return;
  state.activePane = index;
  syncPaneInteractionState();
}

function selectRow(paneIndex, path, event) {
  const pane = state.panes[paneIndex];
  const entries = filteredEntries(pane);
  if (event.shiftKey && pane.anchorPath) {
    const start = entries.findIndex((entry) => entry.path === pane.anchorPath);
    const end = entries.findIndex((entry) => entry.path === path);
    if (start >= 0 && end >= 0) {
      pane.selection.clear();
      const [from, to] = start < end ? [start, end] : [end, start];
      entries.slice(from, to + 1).forEach((entry) => pane.selection.add(entry.path));
    }
  } else if (event.metaKey || event.ctrlKey) {
    if (pane.selection.has(path)) pane.selection.delete(path);
    else pane.selection.add(path);
    pane.anchorPath = path;
  } else {
    pane.selection.clear();
    pane.selection.add(path);
    pane.anchorPath = path;
  }
  state.activePane = paneIndex;
  syncPaneInteractionState();
}

function selectedPaths() {
  return Array.from(activePane()?.selection || []);
}

function copySelection(mode) {
  const paths = selectedPaths();
  if (!paths.length) return showToast('请先选择文件或文件夹');
  state.clipboard = { paths, mode };
  syncPaneInteractionState();
  showToast(`${paths.length} 项已${mode === 'move' ? '剪切' : '复制'}，请选择目标窗格后粘贴`);
}

function selectAllEntries() {
  const pane = activePane();
  filteredEntries(pane).forEach((entry) => pane.selection.add(entry.path));
  syncPaneInteractionState();
}

async function startTransfer(paths, targetDirectory, mode) {
  if (!paths.length) return showToast('没有可传输的文件');
  if (state.operation) return showToast('当前已有传输任务，请等待完成');
  try {
    const result = await api.transfer(paths, targetDirectory, mode);
    state.operation = { id: result.id, mode, paths, targetDirectory };
    state.paused = false;
    elements.transferBar.classList.add('busy');
    elements.queueCount.textContent = '1 项';
    elements.transferTitle.textContent = mode === 'move' ? '正在移动文件' : '正在复制文件';
    elements.transferDetail.textContent = `${paths.length} 项 → ${targetDirectory}`;
    elements.pauseTransfer.disabled = false;
    elements.cancelTransfer.disabled = false;
  } catch (error) {
    showToast(error.message || String(error), '无法开始传输');
  }
}

async function pasteClipboard() {
  if (!state.clipboard?.paths.length) return showToast('剪贴板中没有 EasyMove 文件');
  await startTransfer(state.clipboard.paths, activePane().path, state.clipboard.mode);
}

async function pasteClipboardAsMove() {
  if (!state.clipboard?.paths.length) return showToast('剪贴板中没有 EasyMove 文件');
  await startTransfer(state.clipboard.paths, activePane().path, 'move');
}

async function transferToOther(mode) {
  const paths = selectedPaths();
  if (!paths.length) return showToast('请先选择要传输的文件');
  const target = state.panes[otherPaneIndex()];
  await startTransfer(paths, target.path, mode);
}

function volumeKey(filePath) {
  if (state.platform === 'win32') return filePath.slice(0, 2).toLocaleUpperCase();
  const normalized = filePath.replaceAll('\\', '/');
  const match = normalized.match(/^\/Volumes\/[^/]+/);
  return match?.[0] || '/';
}

function heuristicDragMode(paths, targetDirectory, event) {
  if (event.shiftKey) return 'move';
  if (event.ctrlKey || event.altKey) return 'copy';
  if (!paths.length) return 'copy';
  return paths.some((filePath) => volumeKey(filePath) !== volumeKey(targetDirectory)) ? 'copy' : 'move';
}

async function resolvedDragMode(paths, targetDirectory, event) {
  if (event.shiftKey) return 'move';
  if (event.ctrlKey || event.altKey) return 'copy';
  try {
    return await api.defaultDragMode(paths, targetDirectory);
  } catch {
    return heuristicDragMode(paths, targetDirectory, event);
  }
}

function resolveDropTarget(target) {
  const paneElement = target.closest?.('.pane');
  if (!paneElement) return null;
  const paneIndex = Number(paneElement.dataset.pane);
  const pane = state.panes[paneIndex];
  const row = target.closest?.('.file-row');
  if (row) {
    const filePath = decodePath(row.dataset.path);
    const entry = pane.entries.find((item) => item.path === filePath);
    if (entry?.isDirectory) return { paneIndex, directory: entry.path, paneElement, folderRow: row };
  }
  return { paneIndex, directory: pane.path, paneElement, folderRow: null };
}

function dragPathsFromEvent(event) {
  if (state.drag?.paths.length) return state.drag.paths;
  const encoded = event.dataTransfer?.getData('application/x-easymove-paths');
  if (!encoded) return [];
  try {
    const paths = JSON.parse(encoded);
    return Array.isArray(paths) ? paths : [];
  } catch {
    return [];
  }
}

function externalPathsFromEvent(event) {
  return Array.from(event.dataTransfer?.files || [])
    .map((file) => {
      try { return api.getPathForFile(file); } catch { return ''; }
    })
    .filter(Boolean);
}

function invalidDropReason(paths, targetDirectory, mode) {
  const normalize = (value) => {
    const normalized = value.replace(/[\\/]+$/, '') || (state.platform === 'win32' ? value.slice(0, 3) : '/');
    return state.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized;
  };
  const target = normalize(targetDirectory);
  for (const sourcePath of paths) {
    const source = normalize(sourcePath);
    if (source === target) return '不能拖到项目自身';
    const separator = state.platform === 'win32' ? '\\' : '/';
    if (target.startsWith(`${source}${separator}`)) return '不能拖到项目内部';
  }
  if (mode === 'move' && paths.length && paths.every((sourcePath) => normalize(parentPath(sourcePath)) === target)) {
    return '项目已经在这个文件夹中';
  }
  return '';
}

function clearDropFeedback() {
  elements.panes.classList.remove('is-dragging');
  elements.panes.querySelectorAll('.pane.drop-target').forEach((pane) => {
    pane.classList.remove('drop-target', 'drop-invalid');
    delete pane.dataset.dropLabel;
  });
  elements.panes.querySelectorAll('.file-row.folder-drop-target').forEach((row) => row.classList.remove('folder-drop-target'));
}

function showDropFeedback(target, mode, paths) {
  clearDropFeedback();
  elements.panes.classList.add('is-dragging');
  const reason = invalidDropReason(paths, target.directory, mode);
  target.paneElement.classList.add('drop-target');
  if (reason) target.paneElement.classList.add('drop-invalid');
  if (target.folderRow) target.folderRow.classList.add('folder-drop-target');
  target.paneElement.dataset.dropLabel = reason || `${mode === 'copy' ? '复制' : '移动'}到「${basename(target.directory)}」`;
  return !reason;
}

async function createFolder() {
  try {
    const created = await api.createFolder(activePane().path);
    await loadPane(state.activePane, activePane().path, { pushHistory: false });
    activePane().selection.add(created);
    renderAll();
    showToast('新文件夹已创建');
  } catch (error) {
    showToast(error.message || String(error), '创建失败');
  }
}

async function trashSelection() {
  const paths = selectedPaths();
  if (!paths.length) return showToast('请先选择要移入废纸篓的文件');
  try {
    const result = await api.trash(paths);
    await loadPane(state.activePane, activePane().path, { pushHistory: false });
    if (result.success) showToast(`${paths.length} 项已移入${state.platform === 'win32' ? '回收站' : '废纸篓'}`);
    else showToast(result.errors.join('；'), '部分文件未能删除');
  } catch (error) {
    showToast(error.message || String(error), '删除失败');
  }
}

function openRenameDialog() {
  const paths = selectedPaths();
  if (paths.length !== 1) return showToast('重命名时请选择一个项目');
  state.renameTarget = paths[0];
  elements.renameInput.value = basename(paths[0]);
  elements.renameModal.hidden = false;
  setTimeout(() => {
    elements.renameInput.focus();
    const dot = elements.renameInput.value.lastIndexOf('.');
    elements.renameInput.setSelectionRange(0, dot > 0 ? dot : elements.renameInput.value.length);
  }, 30);
}

function closeRenameDialog() {
  elements.renameModal.hidden = true;
  state.renameTarget = null;
}

async function executeCommand(command) {
  if (command === 'new-folder') return createFolder();
  if (command === 'copy') return copySelection('copy');
  if (command === 'cut') return copySelection('move');
  if (command === 'paste') return pasteClipboard();
  if (command === 'paste-move') return pasteClipboardAsMove();
  if (command === 'select-all') return selectAllEntries();
  if (command === 'rename') return openRenameDialog();
  if (command === 'trash') return trashSelection();
  if (command === 'copy-other') return transferToOther('copy');
  if (command === 'move-other') return transferToOther('move');
}

elements.panes.addEventListener('mousedown', (event) => {
  const paneElement = event.target.closest('.pane');
  if (!paneElement) return;
  const index = Number(paneElement.dataset.pane);
  if (index === state.activePane) return;
  state.activePane = index;
  elements.globalSearch.value = activePane().filter;
  elements.panes.querySelectorAll('.pane').forEach((pane) => pane.classList.toggle('active', Number(pane.dataset.pane) === index));
  renderSidebar();
  renderSelectionSummary();
});

elements.panes.addEventListener('dragstart', (event) => {
  const row = event.target.closest('.file-row');
  if (!row || !event.dataTransfer) return;
  const paneIndex = Number(row.dataset.pane);
  const filePath = decodePath(row.dataset.path);
  const pane = state.panes[paneIndex];
  if (!pane.selection.has(filePath)) {
    selectRow(paneIndex, filePath, { shiftKey: false, metaKey: false, ctrlKey: false });
  }
  const paths = Array.from(pane.selection);
  state.drag = { paths, sourcePane: paneIndex };
  event.dataTransfer.effectAllowed = 'copyMove';
  event.dataTransfer.setData('application/x-easymove-paths', JSON.stringify(paths));
  event.dataTransfer.setData('text/plain', paths.join('\n'));
  event.dataTransfer.setDragImage(row, 24, 16);
  if (event.isTrusted) {
    event.preventDefault();
    state.drag = null;
    clearDropFeedback();
    api.startNativeDrag(paths);
    return;
  }
  elements.panes.classList.add('is-dragging');
  requestAnimationFrame(() => {
    elements.panes.querySelectorAll('.file-row').forEach((item) => {
      item.classList.toggle('drag-source', paths.includes(decodePath(item.dataset.path)));
    });
  });
});

elements.panes.addEventListener('dragover', (event) => {
  const types = Array.from(event.dataTransfer?.types || []);
  if (!state.drag && !types.includes('Files')) return;
  const target = resolveDropTarget(event.target);
  if (!target) return;
  event.preventDefault();
  const paths = dragPathsFromEvent(event);
  if (!paths.length) paths.push(...externalPathsFromEvent(event));
  const mode = heuristicDragMode(paths, target.directory, event);
  const valid = showDropFeedback(target, mode, paths);
  event.dataTransfer.dropEffect = valid ? mode : 'none';
});

elements.panes.addEventListener('drop', async (event) => {
  const target = resolveDropTarget(event.target);
  if (!target) return;
  event.preventDefault();
  const paths = dragPathsFromEvent(event);
  if (!paths.length) paths.push(...externalPathsFromEvent(event));
  const modifier = { shiftKey: event.shiftKey, ctrlKey: event.ctrlKey, altKey: event.altKey };
  clearDropFeedback();
  state.drag = null;
  if (!paths.length) return showToast('没有识别到可拖放的文件');
  const mode = await resolvedDragMode(paths, target.directory, modifier);
  const reason = invalidDropReason(paths, target.directory, mode);
  if (reason) return showToast(reason, '无法完成拖放');
  state.activePane = target.paneIndex;
  syncPaneInteractionState();
  showToast(`${paths.length} 项将${mode === 'copy' ? '复制' : '移动'}到「${basename(target.directory)}」`, '拖放传输');
  await startTransfer(paths, target.directory, mode);
});

document.addEventListener('dragend', () => {
  state.drag = null;
  clearDropFeedback();
  elements.panes.querySelectorAll('.file-row.drag-source').forEach((row) => row.classList.remove('drag-source'));
});

window.addEventListener('dragover', (event) => {
  if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault();
});

window.addEventListener('drop', (event) => {
  if (!event.target.closest?.('.pane')) {
    event.preventDefault();
    state.drag = null;
    clearDropFeedback();
  }
});

elements.panes.addEventListener('click', (event) => {
  const sortButton = event.target.closest('[data-sort]');
  if (sortButton) {
    const pane = state.panes[Number(sortButton.dataset.pane)];
    const field = sortButton.dataset.sort;
    pane.sort = pane.sort.field === field ? { field, direction: pane.sort.direction === 'asc' ? 'desc' : 'asc' } : { field, direction: 'asc' };
    renderPanes();
    return;
  }
  const row = event.target.closest('.file-row');
  if (row) {
    selectRow(Number(row.dataset.pane), decodePath(row.dataset.path), event);
    return;
  }
  const action = event.target.closest('[data-pane-action]');
  if (!action || action.disabled) return;
  const index = Number(action.dataset.pane);
  const pane = state.panes[index];
  if (action.dataset.paneAction === 'back' && pane.historyIndex > 0) {
    pane.historyIndex -= 1;
    loadPane(index, pane.history[pane.historyIndex], { pushHistory: false });
  }
  if (action.dataset.paneAction === 'forward' && pane.historyIndex < pane.history.length - 1) {
    pane.historyIndex += 1;
    loadPane(index, pane.history[pane.historyIndex], { pushHistory: false });
  }
  if (action.dataset.paneAction === 'up') loadPane(index, parentPath(pane.path));
  if (action.dataset.paneAction === 'refresh') loadPane(index, pane.path, { pushHistory: false });
});

function hideHoverPreview() {
  clearTimeout(state.hoverTimer);
  state.hoverToken += 1;
  elements.hoverPreview.hidden = true;
}

elements.panes.addEventListener('mouseover', (event) => {
  const previewIcon = event.target.closest('[data-preview-icon]');
  if (!previewIcon) return;
  const row = previewIcon.closest('.file-row');
  const pane = state.panes[Number(row.dataset.pane)];
  const entry = pane.entries.find((item) => item.path === decodePath(row.dataset.path));
  if (!entry) return;
  clearTimeout(state.hoverTimer);
  const token = ++state.hoverToken;
  state.hoverTimer = setTimeout(() => {
    if (token !== state.hoverToken || !previewIcon.isConnected) return;
    const media = entry.previewUrl ? `<img src="${escapeHtml(entry.previewUrl)}" alt="真实内容预览">` : entry.previewText ? `<div class="preview-fallback preview-content"><strong>真实内容</strong><span>${escapeHtml(entry.previewText.slice(0, 620))}</span></div>` : `<div class="preview-fallback"><strong>无法生成内容预览</strong><span>${escapeHtml(entry.previewError || '文件消失、权限不足、损坏或格式未支持')}</span></div>`;
    const content = entry.previewText ? `<div class="preview-text">${escapeHtml(entry.previewText.slice(0, 260))}</div>` : '';
    const children = entry.isDirectory && entry.previewChildren?.length ? `<div class="preview-children">${entry.previewChildren.map(escapeHtml).join(' · ')}</div>` : '';
    elements.hoverPreview.innerHTML = `${media}${content}<strong>${escapeHtml(entry.name)}</strong><span>${escapeHtml(entry.kind)} · ${escapeHtml(formatDate(entry.modified))} · ${escapeHtml(entry.folderSizeStatus === 'loading' ? '计算中…' : formatSize(entry.size))}</span>${children}`;
    elements.hoverPreview.hidden = false;
    const rect = previewIcon.getBoundingClientRect();
    const box = elements.hoverPreview.getBoundingClientRect();
    const left = Math.max(12, Math.min(window.innerWidth - box.width - 12, rect.right + 10));
    const top = Math.max(12, Math.min(window.innerHeight - box.height - 12, rect.top - 16));
    elements.hoverPreview.style.left = `${left}px`;
    elements.hoverPreview.style.top = `${top}px`;
  }, 400);
});

elements.panes.addEventListener('mouseout', (event) => {
  const previewIcon = event.target.closest('[data-preview-icon]');
  if (previewIcon && !previewIcon.contains(event.relatedTarget)) hideHoverPreview();
});

elements.panes.addEventListener('scroll', hideHoverPreview, true);

elements.panes.addEventListener('dblclick', async (event) => {
  const row = event.target.closest('.file-row');
  if (!row) return;
  const paneIndex = Number(row.dataset.pane);
  const filePath = decodePath(row.dataset.path);
  const entry = state.panes[paneIndex].entries.find((item) => item.path === filePath);
  if (!entry) return;
  if (entry.isDirectory) await loadPane(paneIndex, entry.path);
  else {
    const error = await api.open(entry.path);
    if (error) showToast(error, '无法打开文件');
  }
});

elements.panes.addEventListener('keydown', (event) => {
  const input = event.target.closest('.path-input');
  if (input && event.key === 'Enter') {
    event.preventDefault();
    loadPane(Number(input.dataset.pane), input.value.trim());
  }
});

document.querySelector('.content-toolbar').addEventListener('click', (event) => {
  const button = event.target.closest('[data-command]');
  if (button) executeCommand(button.dataset.command);
});

document.querySelectorAll('.layout-button').forEach((button) => {
  button.addEventListener('click', () => {
    state.layout = Number(button.dataset.layout);
    if (!visiblePaneIndexes().includes(state.activePane)) state.activePane = 0;
    document.querySelectorAll('.layout-button').forEach((item) => item.classList.toggle('active', item === button));
    renderAll();
    showToast(`已切换为${state.layout === 1 ? '单' : state.layout === 2 ? '双' : '四'}窗格`);
  });
});

const themeNames = {
  'theme-blue-mist': '蓝雾花笺',
  'theme-iris-dream': '鸢尾梦境',
  'theme-lakeside-journal': '湖畔手帐',
  'theme-custom': '我的主题'
};

function updateCustomTheme(theme) {
  state.customTheme = theme;
  elements.customThemeButton.classList.toggle('has-image', Boolean(theme?.url));
  elements.customThemeButton.title = theme?.url
    ? `使用「${theme.name || '我的主题'}」；启用后再次点击可更换图片`
    : '导入自己的主题图片';
  if (theme?.url) {
    document.documentElement.style.setProperty('--custom-theme-art', `url("${theme.url}")`);
  }
}

function applyTheme(theme, announce = true) {
  Object.keys(themeNames).forEach((item) => document.body.classList.remove(item));
  document.body.classList.add(theme);
  document.querySelectorAll('.theme-button').forEach((button) => {
    const buttonTheme = button === elements.customThemeButton ? 'theme-custom' : button.dataset.theme;
    button.classList.toggle('active', buttonTheme === theme);
  });
  localStorage.setItem('easymove-theme', theme);
  if (announce) showToast(`已切换为「${theme === 'theme-custom' ? (state.customTheme?.name || '我的主题') : themeNames[theme]}」`);
}

document.querySelectorAll('.theme-button[data-theme]').forEach((button) => {
  button.addEventListener('click', () => {
    applyTheme(button.dataset.theme);
  });
});

elements.customThemeButton.addEventListener('click', async () => {
  if (state.customTheme?.url && !document.body.classList.contains('theme-custom')) {
    applyTheme('theme-custom');
    return;
  }
  try {
    const result = await api.chooseCustomTheme();
    if (result?.canceled) return;
    updateCustomTheme(result?.theme || null);
    if (!state.customTheme?.url) return showToast('没有找到可用的自定义图片', '主题导入失败');
    applyTheme('theme-custom', false);
    showToast(`「${state.customTheme.name || '我的主题'}」已保存并应用`, '自定义主题');
  } catch (error) {
    showToast(error.message || String(error), '主题导入失败');
  }
});

elements.quickNav.addEventListener('click', (event) => {
  const item = event.target.closest('[data-nav-path]');
  if (item) loadPane(state.activePane, decodePath(item.dataset.navPath));
});
elements.volumeNav.addEventListener('click', (event) => {
  const item = event.target.closest('[data-nav-path]');
  if (item) loadPane(state.activePane, decodePath(item.dataset.navPath));
});

document.getElementById('chooseFolderButton').addEventListener('click', async () => {
  const selected = await api.chooseFolder();
  if (selected) loadPane(state.activePane, selected);
});

elements.globalSearch.addEventListener('input', () => {
  activePane().filter = elements.globalSearch.value;
  renderPanes();
});
elements.globalSearch.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  const value = elements.globalSearch.value.trim();
  const looksLikePath = value.startsWith('/') || value.startsWith('~') || /^[A-Za-z]:[\\/]/.test(value);
  if (looksLikePath) {
    activePane().filter = '';
    loadPane(state.activePane, value.replace(/^~/, state.locations.home));
  }
});

elements.renameForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  if (!state.renameTarget) return;
  try {
    await api.rename(state.renameTarget, elements.renameInput.value);
    closeRenameDialog();
    await loadPane(state.activePane, activePane().path, { pushHistory: false });
    showToast('重命名完成');
  } catch (error) {
    showToast(error.message || String(error), '重命名失败');
  }
});
document.getElementById('renameCancel').addEventListener('click', closeRenameDialog);
elements.renameModal.addEventListener('mousedown', (event) => {
  if (event.target === elements.renameModal) closeRenameDialog();
});

elements.pauseTransfer.addEventListener('click', async () => {
  if (!state.operation) return;
  state.paused = !state.paused;
  await api.controlOperation(state.operation.id, state.paused ? 'pause' : 'resume');
  elements.pauseTransfer.innerHTML = state.paused ? icon('play') : icon('pause');
  elements.transferTitle.textContent = state.paused ? '传输已暂停' : (state.operation.mode === 'move' ? '正在移动文件' : '正在复制文件');
});
elements.cancelTransfer.addEventListener('click', async () => {
  if (state.operation) await api.controlOperation(state.operation.id, 'cancel');
});

api.onOperationProgress((progress) => {
  if (!state.operation || state.operation.id !== progress.id) return;
  const percent = Math.max(0, Math.min(100, Math.round((progress.completed / Math.max(1, progress.total)) * 100)));
  elements.progressFill.style.width = `${percent}%`;
  elements.transferMeta.textContent = `${percent}%`;
  if (progress.currentFile) elements.transferDetail.textContent = progress.currentFile;
});

api.onOperationComplete(async (result) => {
  if (!state.operation || state.operation.id !== result.id) return;
  const operation = state.operation;
  state.operation = null;
  state.paused = false;
  elements.transferBar.classList.remove('busy');
  elements.queueCount.textContent = '空闲';
  elements.pauseTransfer.innerHTML = icon('pause');
  elements.pauseTransfer.disabled = true;
  elements.cancelTransfer.disabled = true;
  elements.progressFill.style.width = result.success ? '100%' : '0%';
  elements.transferMeta.textContent = result.success ? '完成' : (result.cancelled ? '已取消' : '失败');
  elements.transferTitle.textContent = result.success ? '传输完成' : (result.cancelled ? '传输已取消' : '部分文件失败');
  elements.transferDetail.textContent = result.errors?.join('；') || `${operation.paths.length} 项已处理`;
  if (operation.mode === 'move') state.clipboard = null;
  await Promise.all(state.panes.map((pane, index) => loadPane(index, pane.path, { pushHistory: false })));
  showToast(result.success ? '文件传输已完成' : (result.cancelled ? '传输已取消' : elements.transferDetail.textContent), result.success ? '完成' : 'EasyMove');
});

document.addEventListener('keydown', (event) => {
  const modifier = event.metaKey || event.ctrlKey;
  const editing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (modifier && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    elements.globalSearch.focus();
    elements.globalSearch.select();
    return;
  }
  if (editing) {
    if (event.key === 'Escape') closeRenameDialog();
    return;
  }
  if (modifier && event.shiftKey && event.key.toLowerCase() === 'n') { event.preventDefault(); createFolder(); return; }
  if (modifier && event.altKey && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteClipboardAsMove(); return; }
  if (modifier && event.key.toLowerCase() === 'c') { event.preventDefault(); copySelection('copy'); }
  if (modifier && event.key.toLowerCase() === 'x') { event.preventDefault(); copySelection('move'); }
  if (modifier && event.key.toLowerCase() === 'v') { event.preventDefault(); pasteClipboard(); }
  if (modifier && event.key.toLowerCase() === 'a') {
    event.preventDefault();
    selectAllEntries();
  }
  if (state.platform === 'darwin' && modifier && event.key === 'Backspace') { event.preventDefault(); trashSelection(); }
  if (state.platform === 'darwin' && event.key === 'Enter') { event.preventDefault(); openRenameDialog(); }
  if (event.key === 'F2') { event.preventDefault(); openRenameDialog(); }
  if (event.key === 'Delete') { event.preventDefault(); trashSelection(); }
  if (event.key === 'Escape') closeRenameDialog();
});

api.onMenuCommand((command) => {
  const editing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (editing && ['copy', 'cut', 'paste', 'select-all'].includes(command)) {
    api.nativeEdit(command);
    return;
  }
  executeCommand(command);
});

let natureSound = null;
let birdTimer = null;

function createWaterNoise(ctx) {
  const length = ctx.sampleRate * 5;
  const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
  for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
    const data = buffer.getChannelData(channel);
    let last = 0;
    for (let index = 0; index < length; index += 1) {
      const white = Math.random() * 2 - 1;
      last = (last + white * .025) / 1.025;
      data[index] = Math.max(-1, Math.min(1, last * 3.2 + white * .07));
    }
  }
  return buffer;
}

function addWaterLayer(ctx, buffer, master, type, frequency, volume) {
  const source = ctx.createBufferSource();
  const filter = ctx.createBiquadFilter();
  const gain = ctx.createGain();
  source.buffer = buffer;
  source.loop = true;
  filter.type = type;
  filter.frequency.value = frequency;
  filter.Q.value = .55;
  gain.gain.value = volume;
  source.connect(filter).connect(gain).connect(master);
  source.start();
  return gain;
}

function playBird(engine) {
  if (natureSound !== engine || engine.ctx.state === 'closed') return;
  const start = engine.ctx.currentTime + .04;
  const base = 1500 + Math.random() * 720;
  const panner = engine.ctx.createStereoPanner ? engine.ctx.createStereoPanner() : engine.ctx.createGain();
  if ('pan' in panner) panner.pan.value = Math.random() * 1.4 - .7;
  panner.connect(engine.master);
  [0, .15, .31].forEach((offset, index) => {
    const oscillator = engine.ctx.createOscillator();
    const gain = engine.ctx.createGain();
    const note = start + offset;
    oscillator.type = index === 1 ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(base * (1 + index * .035), note);
    oscillator.frequency.exponentialRampToValueAtTime(base * 1.58, note + .075);
    oscillator.frequency.exponentialRampToValueAtTime(base * 1.12, note + .22);
    gain.gain.setValueAtTime(.0001, note);
    gain.gain.exponentialRampToValueAtTime(.05 - index * .007, note + .025);
    gain.gain.exponentialRampToValueAtTime(.0001, note + .25);
    oscillator.connect(gain).connect(panner);
    oscillator.start(note);
    oscillator.stop(note + .28);
  });
}

function scheduleBird(engine, delay = 1500) {
  clearTimeout(birdTimer);
  birdTimer = setTimeout(() => {
    playBird(engine);
    scheduleBird(engine, 4200 + Math.random() * 6200);
  }, delay);
}

async function startNatureSound() {
  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  if (!AudioContextClass) return showToast('当前系统不支持自然声播放');
  const ctx = new AudioContextClass();
  const master = ctx.createGain();
  const compressor = ctx.createDynamicsCompressor();
  master.gain.value = .42;
  compressor.threshold.value = -24;
  compressor.ratio.value = 3;
  master.connect(compressor).connect(ctx.destination);
  const noise = createWaterNoise(ctx);
  const lowWater = addWaterLayer(ctx, noise, master, 'lowpass', 980, .17);
  addWaterLayer(ctx, noise, master, 'bandpass', 2850, .052);
  const tide = ctx.createOscillator();
  const tideDepth = ctx.createGain();
  tide.frequency.value = .075;
  tideDepth.gain.value = .026;
  tide.connect(tideDepth).connect(lowWater.gain);
  tide.start();
  natureSound = { ctx, master };
  await ctx.resume();
  scheduleBird(natureSound, 1200 + Math.random() * 1200);
  elements.natureSoundToggle.classList.add('is-playing');
  elements.natureSoundToggle.setAttribute('aria-pressed', 'true');
  elements.natureSoundToggle.title = '关闭流水与鸟鸣';
  showToast('自然声已开启 · 流水与鸟鸣');
}

function stopNatureSound() {
  if (!natureSound) return;
  clearTimeout(birdTimer);
  const engine = natureSound;
  natureSound = null;
  const now = engine.ctx.currentTime;
  engine.master.gain.cancelScheduledValues(now);
  engine.master.gain.setValueAtTime(Math.max(engine.master.gain.value, .0001), now);
  engine.master.gain.exponentialRampToValueAtTime(.0001, now + .35);
  setTimeout(() => engine.ctx.close(), 420);
  elements.natureSoundToggle.classList.remove('is-playing');
  elements.natureSoundToggle.setAttribute('aria-pressed', 'false');
  elements.natureSoundToggle.title = '开启流水与鸟鸣';
  showToast('自然声已关闭');
}

elements.natureSoundToggle.addEventListener('click', () => {
  if (natureSound) stopNatureSound();
  else startNatureSound();
});

async function initialize() {
  try {
    const initial = await api.initialState();
    state.platform = initial.platform;
    state.locations = initial.locations;
    state.volumes = initial.volumes;
    updateCustomTheme(initial.customTheme || null);
    document.body.classList.add(`platform-${state.platform}`);
    const savedTheme = localStorage.getItem('easymove-theme');
    const usableTheme = savedTheme === 'theme-custom' && !state.customTheme?.url ? 'theme-blue-mist' : savedTheme;
    if (usableTheme && themeNames[usableTheme]) applyTheme(usableTheme, false);
    state.panes = [
      makePane(0, state.locations.home),
      makePane(1, state.locations.downloads),
      makePane(2, state.locations.desktop),
      makePane(3, state.locations.documents)
    ];
    elements.pauseTransfer.disabled = true;
    elements.cancelTransfer.disabled = true;
    renderAll();
    await Promise.all(state.panes.map((pane, index) => loadPane(index, pane.path, { pushHistory: false })));
  } catch (error) {
    showToast(error.message || String(error), 'EasyMove 启动失败');
  }
}

initialize();
