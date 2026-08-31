const api = window.easyMove;
const contextMenuUtils = window.EasyMoveContextMenu;
const RECENT_PATH = 'easymove://recent';
const BASKET_PATH = 'easymove://basket';
const SEARCH_PATH = 'easymove://search';
const PHOTO_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic', 'tif', 'tiff']);
const CLICK_PREVIEW_DELAY_MS = 2000;

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
  hoverToken: 0,
  selectionPreviewToken: 0,
  selectionPreview: null,
  renderPending: false,
  pointerActive: false,
  nativeContextMenu: null,
  quickLook: null,
  operationHistory: [],
  transferTasks: [],
  fileBasketCount: 0,
  workspaces: [],
  currentWorkspaceId: null,
  contentIndex: { phase: 'idle', roots: [] },
  operationConflict: null,
  quickLookToken: 0,
  photoViewer: null,
  photoViewerToken: 0,
  transferReveal: null,
  transferRevealTimer: null,
  activationCandidate: null,
  batchRenameTargets: [],
  sidebarRenderKey: '',
  volumeRenderKey: ''
};

const elements = {
  panes: document.getElementById('panes'),
  quickNav: document.getElementById('quickNav'),
  volumeNav: document.getElementById('volumeNav'),
  globalSearch: document.getElementById('globalSearch'),
  appVersion: document.getElementById('appVersion'),
  selectionSummary: document.getElementById('selectionSummary'),
  transferBar: document.querySelector('.transfer-bar'),
  queueCount: document.getElementById('queueCount'),
  transferTitle: document.getElementById('transferTitle'),
  transferDetail: document.getElementById('transferDetail'),
  transferMeta: document.getElementById('transferMeta'),
  progressFill: document.getElementById('progressFill'),
  pauseTransfer: document.getElementById('pauseTransfer'),
  cancelTransfer: document.getElementById('cancelTransfer'),
  operationHistoryPanel: document.getElementById('operationHistoryPanel'),
  operationHistoryList: document.getElementById('operationHistoryList'),
  closeOperationHistory: document.getElementById('closeOperationHistory'),
  toast: document.getElementById('toast'),
  toastTitle: document.getElementById('toastTitle'),
  toastMessage: document.getElementById('toastMessage'),
  renameModal: document.getElementById('renameModal'),
  renameForm: document.getElementById('renameForm'),
  renameInput: document.getElementById('renameInput'),
  conflictModal: document.getElementById('conflictModal'),
  conflictDescription: document.getElementById('conflictDescription'),
  conflictComparison: document.getElementById('conflictComparison'),
  conflictApplyAll: document.getElementById('conflictApplyAll'),
  natureSoundToggle: document.getElementById('natureSoundToggle'),
  customThemeButton: document.getElementById('customThemeButton'),
  hoverPreview: document.getElementById('hoverPreview'),
  contentStage: document.getElementById('contentStage'),
  selectionPreview: document.getElementById('selectionPreview'),
  photoViewer: document.getElementById('photoViewer'),
  photoViewerName: document.getElementById('photoViewerName'),
  photoViewerMedia: document.getElementById('photoViewerMedia'),
  photoViewerCount: document.getElementById('photoViewerCount'),
  workspacePanel: document.getElementById('workspacePanel'),
  workspaceList: document.getElementById('workspaceList'),
  closeWorkspacePanel: document.getElementById('closeWorkspacePanel'),
  workspaceModal: document.getElementById('workspaceModal'),
  workspaceForm: document.getElementById('workspaceForm'),
  workspaceNameInput: document.getElementById('workspaceNameInput'),
  saveWorkspaceButton: document.getElementById('saveWorkspaceButton'),
  currentWorkspaceName: document.getElementById('currentWorkspaceName'),
  currentWorkspaceDetail: document.getElementById('currentWorkspaceDetail'),
  indexModal: document.getElementById('indexModal'),
  indexStatusLabel: document.getElementById('indexStatusLabel'),
  indexStatusDetail: document.getElementById('indexStatusDetail'),
  indexProgressFill: document.getElementById('indexProgressFill'),
  indexRootList: document.getElementById('indexRootList'),
  indexPause: document.getElementById('indexPause'),
  batchRenameModal: document.getElementById('batchRenameModal'),
  batchRenameForm: document.getElementById('batchRenameForm'),
  batchRenameTitle: document.getElementById('batchRenameTitle'),
  batchRule: document.getElementById('batchRule'),
  batchValue: document.getElementById('batchValue'),
  batchReplacement: document.getElementById('batchReplacement'),
  batchValueLabel: document.getElementById('batchValueLabel'),
  batchReplacementLabel: document.getElementById('batchReplacementLabel'),
  batchPreview: document.getElementById('batchPreview'),
  batchError: document.getElementById('batchError'),
  batchRenameConfirm: document.getElementById('batchRenameConfirm')
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

function looksLikeFilesystemPath(value) {
  const text = normalizeFilesystemPathInput(value);
  return text.startsWith('/') || text.startsWith('~') || /^[A-Za-z]:[\\/]/.test(text);
}

function normalizeFilesystemPathInput(value) {
  let text = String(value || '').trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    text = text.slice(1, -1).trim();
  }
  if (/^file:\/\//i.test(text)) {
    try {
      const fileUrl = new URL(text);
      text = decodeURIComponent(fileUrl.pathname);
      if (state.platform === 'win32' && /^\/[A-Za-z]:\//.test(text)) text = text.slice(1);
    } catch {}
  }
  return text;
}

function readableFileError(error) {
  const raw = error?.message || String(error);
  const message = raw.replace(/^Error invoking remote method '[^']+': Error:\s*/i, '');
  const missingPath = message.match(/ENOENT:[^']*'([^']+)'/i)?.[1];
  return missingPath ? `找不到这个文件夹：${missingPath}` : message;
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

function formatEntrySize(entry) {
  if (entry.folderSizeStatus === 'loading') return '计算中…';
  if (entry.isDirectory && entry.folderSizeStatus !== 'ready') return '—';
  return formatSize(entry.size);
}

function selectedPaneEntries(pane) {
  const unique = new Map([...pane.entries, ...pane.columnEntries].map((entry) => [entry.path, entry]));
  return Array.from(pane.selection, (filePath) => unique.get(filePath)).filter(Boolean);
}

function selectedSizeLabel(pane) {
  if (!pane?.selection.size) return '';
  const entries = selectedPaneEntries(pane);
  if (entries.length !== pane.selection.size) return '—';
  if (entries.some((entry) => entry.folderSizeStatus === 'loading' || entry.folderSizeStatus === 'idle')) return '计算中…';
  if (entries.some((entry) => entry.folderSizeStatus !== 'ready' || !Number.isFinite(entry.size))) return '—';
  return formatSize(entries.reduce((sum, entry) => sum + entry.size, 0));
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

function relativeHistoryTime(timestamp) {
  const elapsed = Math.max(0, Date.now() - Number(timestamp || 0));
  if (elapsed < 60_000) return '刚刚';
  if (elapsed < 3_600_000) return `${Math.floor(elapsed / 60_000)} 分钟前`;
  if (elapsed < 86_400_000) return `${Math.floor(elapsed / 3_600_000)} 小时前`;
  return `${Math.floor(elapsed / 86_400_000)} 天前`;
}

function operationHistoryDetail(entry) {
  if (entry.status === 'undone') return '已撤销';
  if (entry.errors?.length) return entry.errors.join('；');
  const first = entry.items?.[0];
  if (!first) return '没有完成的项目';
  if (entry.type === 'trash') return first.source;
  if (first.source && first.destination) return `${basename(first.source)} → ${parentPath(first.destination)}`;
  return first.destination || first.source || '';
}

function renderOperationHistory() {
  const entries = state.operationHistory || [];
  const pendingTasks = (state.transferTasks || []).filter((task) => task.status !== 'completed' || Date.now() - task.updatedAt < 86_400_000);
  const taskRows = pendingTasks.map((task) => {
    const percent = Math.max(0, Math.min(100, Math.round((task.completed / Math.max(1, task.total)) * 100)));
    const labels = { active: '进行中', measuring: '准备中', paused: '已暂停', interrupted: '可恢复', partial: '部分完成', 'needs-attention': '需要处理', 'waiting-volume': '等待磁盘', cancelled: '已取消', completed: '已完成' };
    const resumable = ['paused', 'interrupted', 'partial', 'needs-attention', 'waiting-volume'].includes(task.status);
    return `<div class="operation-history-row transfer-task-row ${escapeHtml(task.status)}">
      <span class="operation-history-icon">${task.status === 'completed' ? '✓' : task.status === 'waiting-volume' ? '!' : '↻'}</span>
      <strong title="${escapeHtml(task.sources.map(basename).join('、'))}">${task.mode === 'move' ? '移动' : '复制'} ${task.sources.length} 项</strong>
      <span title="${escapeHtml(task.targetDirectory)}">${escapeHtml(task.currentFile || task.targetDirectory)} · ${percent}%</span>
      <small class="operation-history-time">${labels[task.status] || task.status}</small>
      <span class="operation-history-actions">${resumable ? `<button data-history-action="resume-task" data-task-id="${escapeHtml(task.id)}">继续</button>` : ''}${task.status !== 'active' && task.status !== 'measuring' ? `<button data-history-action="remove-task" data-task-id="${escapeHtml(task.id)}">移除</button>` : ''}</span>
    </div>`;
  }).join('');
  const historyRows = entries.map((entry) => {
    const undoDisabled = !entry.canUndo || entry.status === 'undone';
    const retry = entry.retry?.sources?.length ? `<button data-history-action="retry" data-history-id="${escapeHtml(entry.id)}">重试</button>` : '';
    return `<div class="operation-history-row ${escapeHtml(entry.status)}">
      <span class="operation-history-icon">${entry.status === 'undone' ? '↶' : (entry.errors?.length ? '!' : '✓')}</span>
      <strong title="${escapeHtml(entry.label)}">${escapeHtml(entry.label)}</strong>
      <span title="${escapeHtml(operationHistoryDetail(entry))}">${escapeHtml(operationHistoryDetail(entry))}</span>
      <small class="operation-history-time">${escapeHtml(relativeHistoryTime(entry.createdAt))}</small>
      <span class="operation-history-actions"><button data-history-action="undo" data-history-id="${escapeHtml(entry.id)}" ${undoDisabled ? 'disabled' : ''}>撤销</button>${retry}</span>
    </div>`;
  }).join('');
  elements.operationHistoryList.innerHTML = taskRows || historyRows ? `${taskRows}${historyRows}` : `<div class="operation-history-empty">${icon('bloom')}<br>还没有传输或文件操作记录</div>`;
  const undoable = entries.filter((entry) => entry.canUndo && entry.status !== 'undone').length;
  const activeTasks = pendingTasks.filter((task) => !['completed', 'cancelled'].includes(task.status)).length;
  if (!state.operation) elements.queueCount.textContent = activeTasks ? `${activeTasks} 项待处理` : undoable ? `${undoable} 项可撤销` : '空闲';
}

async function refreshAfterHistoryEntry(entry) {
  const paths = (entry?.items || []).flatMap((item) => [item.source, item.destination].filter(Boolean));
  if (paths.length) await refreshPanesAfterRemoval(paths);
}

async function undoOperation(id) {
  try {
    const target = id ? state.operationHistory.find((entry) => entry.id === id) : state.operationHistory.find((entry) => entry.canUndo && entry.status !== 'undone');
    if (!target) return showToast('没有可以撤销的文件操作');
    const result = await api.undoOperation(target.id);
    if (!result.success) return showToast(result.errors.join('；'), '无法完整撤销');
    await refreshAfterHistoryEntry(target);
    showToast('文件操作已撤销');
  } catch (error) {
    showToast(error.message || String(error), '撤销失败');
  }
}

async function retryOperation(id) {
  try {
    if (state.operation) return showToast('请等待当前文件操作完成');
    const entry = state.operationHistory.find((item) => item.id === id);
    const retry = entry?.retry;
    if (!retry) return showToast('这条记录没有可以重试的项目');
    await startTransfer(retry.sources, retry.targetDirectory, retry.mode);
    elements.operationHistoryPanel.hidden = true;
  } catch (error) {
    showToast(error.message || String(error), '重试失败');
  }
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
    loadingSlow: false,
    indexing: false,
    indexingSlow: false,
    error: '',
    filter: '',
    showHidden: false,
    loadToken: 0,
    anchorPath: null,
    keyboardFocusPath: null,
    sort: { field: 'name', direction: 'asc' },
    viewMode: localStorage.getItem(`easymove-pane-${id}-view`) || 'list',
    columnPath: null,
    columnEntries: [],
    columnLoading: false,
    columnToken: 0,
    virtualMode: null,
    searchQuery: '',
    recentPreviousSort: null
  };
}

const EAGER_PREVIEW_LIMIT = 32;
const EAGER_SIZE_LIMIT = 16;
const EAGER_IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'webp', 'gif', 'bmp', 'heic', 'tif', 'tiff']);

function updatePaneActivity(index) {
  const pane = state.panes[index];
  const paneElement = elements.panes.querySelector(`.pane[data-pane="${index}"]`);
  if (!paneElement) return;
  if (pane.loading && pane.loadingSlow) {
    const stateElement = paneElement.querySelector('.empty-state div');
    if (stateElement) stateElement.innerHTML = `${icon('refresh')}<br>建立索引中，请稍候`;
    return;
  }
  const status = paneElement.querySelector('.pane-status');
  if (status && pane.indexingSlow) status.children[0].textContent = '建立索引中，请稍候';
}

async function hydratePaneIndex(index, token) {
  const pane = state.panes[index];
  if (!pane || pane.loadToken !== token) return;
  const slowTimer = setTimeout(() => {
    if (pane.loadToken !== token || !pane.indexing) return;
    pane.indexingSlow = true;
    updatePaneActivity(index);
  }, 2000);
  const previewEntries = pane.entries
    .filter((entry) => entry.isDirectory || EAGER_IMAGE_EXTENSIONS.has(entry.extension))
    .slice(0, EAGER_PREVIEW_LIMIT);
  const directories = pane.entries.filter((entry) => entry.isDirectory);

  const previewTask = (async () => {
    for (let offset = 0; offset < previewEntries.length; offset += 8) {
      const batch = previewEntries.slice(offset, offset + 8);
      const results = await Promise.all(batch.map(async (entry) => ({ path: entry.path, ...(await api.preview(entry.path)) })));
      if (pane.loadToken !== token) return;
      const previewMap = new Map(results.map((preview) => [preview.path, preview]));
      pane.entries = pane.entries.map((entry) => {
        const preview = previewMap.get(entry.path);
        if (!preview) return entry;
        return { ...entry, previewStatus: 'ready', previewUrl: preview.url || null, previewKind: preview.previewKind || null, previewText: preview.previewText || null, previewError: preview.error || null, folderCover: Boolean(preview.folderCover), previewChildren: preview.children || [] };
      });
    }
  })();

  const sizeTask = (async () => {
    for (let offset = 0; offset < directories.length; offset += 8) {
      if (pane.loadToken !== token) return;
      const batch = directories.slice(offset, offset + 8);
      const batchPaths = new Set(batch.map((entry) => entry.path));
      pane.entries = pane.entries.map((entry) => batchPaths.has(entry.path) && entry.folderSizeStatus === 'idle'
        ? { ...entry, folderSizeStatus: 'loading' }
        : entry);
      renderAllWhenIdle();
      try {
        const sizes = await api.folderSizes(batch.map((entry) => entry.path));
        if (pane.loadToken !== token) return;
        const sizeMap = new Map(sizes.map((item) => [item.path, item.size]));
        pane.entries = pane.entries.map((entry) => {
          if (!batchPaths.has(entry.path)) return entry;
          const size = sizeMap.get(entry.path);
          return { ...entry, size: Number.isFinite(size) ? size : null, folderSizeStatus: Number.isFinite(size) ? 'ready' : 'unavailable' };
        });
      } catch {
        if (pane.loadToken !== token) return;
        pane.entries = pane.entries.map((entry) => batchPaths.has(entry.path)
          ? { ...entry, size: null, folderSizeStatus: 'unavailable' }
          : entry);
      }
      renderAllWhenIdle();
    }
  })();

  await Promise.allSettled([previewTask, sizeTask]);
  clearTimeout(slowTimer);
  if (pane.loadToken !== token) return;
  pane.indexing = false;
  pane.indexingSlow = false;
  renderAllWhenIdle();
}

async function loadRecentPane(index, options = {}) {
  const pane = state.panes[index];
  if (!pane) return;
  const preserveInteraction = options.preserveInteraction === true;
  const previousSelection = preserveInteraction ? new Set(pane.selection) : new Set();
  const token = ++pane.loadToken;
  if (pane.virtualMode !== 'recent') pane.recentPreviousSort = { ...pane.sort };
  pane.virtualMode = 'recent';
  pane.path = RECENT_PATH;
  pane.sort = { field: 'modified', direction: 'desc' };
  pane.loading = true;
  pane.error = '';
  pane.selection.clear();
  pane.anchorPath = null;
  pane.keyboardFocusPath = null;
  pane.columnPath = null;
  pane.columnEntries = [];
  if (state.selectionPreview?.paneIndex === index) closeSelectionPreview();
  renderPanes();
  try {
    const result = await api.recentItems(pane.showHidden);
    if (pane.loadToken !== token) return;
    pane.entries = result.entries.map((entry) => ({
      ...entry,
      folderSizeStatus: entry.isDirectory ? 'idle' : 'ready',
      previewStatus: 'idle',
      previewUrl: null,
      folderCover: false
    }));
    if (preserveInteraction) {
      const availablePaths = new Set(pane.entries.map((entry) => entry.path));
      pane.selection = new Set([...previousSelection].filter((filePath) => availablePaths.has(filePath)));
    }
    pane.loading = false;
    pane.error = '';
    if (options.pushHistory !== false && pane.history[pane.historyIndex] !== RECENT_PATH) {
      pane.history = pane.history.slice(0, pane.historyIndex + 1);
      pane.history.push(RECENT_PATH);
      pane.historyIndex = pane.history.length - 1;
    }
    pane.indexing = pane.entries.length > 0;
    renderAllWhenIdle();
    if (pane.indexing) void hydratePaneIndex(index, token);
  } catch (error) {
    if (pane.loadToken !== token) return;
    pane.loading = false;
    pane.error = readableFileError(error);
    renderPanes();
    showToast(pane.error, '无法读取最近访问');
  }
}

async function loadBasketPane(index, options = {}) {
  const pane = state.panes[index];
  if (!pane) return;
  const preserveInteraction = options.preserveInteraction === true;
  const previousSelection = preserveInteraction ? new Set(pane.selection) : new Set();
  const token = ++pane.loadToken;
  if (!pane.virtualMode) pane.recentPreviousSort = { ...pane.sort };
  pane.virtualMode = 'basket';
  pane.path = BASKET_PATH;
  pane.sort = { field: 'modified', direction: 'desc' };
  pane.loading = true;
  pane.error = '';
  pane.selection.clear();
  pane.anchorPath = null;
  pane.keyboardFocusPath = null;
  pane.columnPath = null;
  pane.columnEntries = [];
  if (state.selectionPreview?.paneIndex === index) closeSelectionPreview();
  renderPanes();
  try {
    const result = await api.fileBasket();
    if (pane.loadToken !== token) return;
    state.fileBasketCount = result.entries.length;
    pane.entries = result.entries.map((entry) => ({
      ...entry,
      folderSizeStatus: entry.isDirectory && !entry.unavailable ? 'idle' : 'ready',
      previewStatus: entry.unavailable ? 'ready' : 'idle',
      previewUrl: null,
      folderCover: false
    }));
    if (preserveInteraction) {
      const availablePaths = new Set(pane.entries.map((entry) => entry.path));
      pane.selection = new Set([...previousSelection].filter((filePath) => availablePaths.has(filePath)));
    }
    pane.loading = false;
    pane.error = '';
    if (options.pushHistory !== false && pane.history[pane.historyIndex] !== BASKET_PATH) {
      pane.history = pane.history.slice(0, pane.historyIndex + 1);
      pane.history.push(BASKET_PATH);
      pane.historyIndex = pane.history.length - 1;
    }
    pane.indexing = pane.entries.some((entry) => !entry.unavailable);
    renderAllWhenIdle();
    if (pane.indexing) void hydratePaneIndex(index, token);
  } catch (error) {
    if (pane.loadToken !== token) return;
    pane.loading = false;
    pane.error = error.message || String(error);
    renderPanes();
    showToast(pane.error, '无法读取临时文件篮');
  }
}

async function loadSearchPane(index, query, options = {}) {
  const pane = state.panes[index];
  if (!pane) return;
  const cleanQuery = String(query || '').trim();
  const token = ++pane.loadToken;
  if (!pane.virtualMode) pane.recentPreviousSort = { ...pane.sort };
  pane.virtualMode = 'search';
  pane.searchQuery = cleanQuery;
  pane.path = SEARCH_PATH;
  pane.entries = [];
  pane.sort = { field: 'modified', direction: 'desc' };
  pane.loading = Boolean(cleanQuery);
  pane.error = '';
  pane.selection.clear();
  pane.anchorPath = null;
  pane.keyboardFocusPath = null;
  pane.columnPath = null;
  pane.columnEntries = [];
  if (state.selectionPreview?.paneIndex === index) closeSelectionPreview();
  renderAllWhenIdle();
  if (!cleanQuery) return;
  try {
    const result = await api.searchContentIndex(cleanQuery, 300);
    if (pane.loadToken !== token) return;
    state.contentIndex = result.status || state.contentIndex;
    pane.entries = result.entries.map((entry) => ({
      ...entry,
      size: entry.isDirectory ? null : entry.size,
      folderSizeStatus: entry.isDirectory ? 'idle' : 'ready',
      previewStatus: 'idle',
      previewUrl: null,
      folderCover: false
    }));
    pane.loading = false;
    if (options.pushHistory !== false) {
      const historyPath = `${SEARCH_PATH}?q=${encodeURIComponent(cleanQuery)}`;
      if (pane.history[pane.historyIndex] !== historyPath) {
        pane.history = pane.history.slice(0, pane.historyIndex + 1);
        pane.history.push(historyPath);
        pane.historyIndex = pane.history.length - 1;
      }
    }
    renderAllWhenIdle();
  } catch (error) {
    if (pane.loadToken !== token) return;
    pane.loading = false;
    pane.error = error.message || String(error);
    renderPanes();
    showToast(pane.error, '全局搜索失败');
  }
}

async function loadPane(index, targetPath, options = {}) {
  const pane = state.panes[index];
  if (!pane) return;
  if (targetPath === RECENT_PATH) return loadRecentPane(index, options);
  if (targetPath === BASKET_PATH) return loadBasketPane(index, options);
  if (String(targetPath).startsWith(SEARCH_PATH)) {
    const query = String(targetPath).includes('?q=') ? decodeURIComponent(String(targetPath).split('?q=')[1]) : '';
    return loadSearchPane(index, query, options);
  }
  if (pane.virtualMode) {
    pane.virtualMode = null;
    if (pane.recentPreviousSort) pane.sort = pane.recentPreviousSort;
    pane.recentPreviousSort = null;
  }
  const preserveInteraction = options.preserveInteraction === true;
  const silent = options.silent === true;
  const previousSelection = preserveInteraction ? new Set(pane.selection) : null;
  const previousAnchorPath = preserveInteraction ? pane.anchorPath : null;
  const previousKeyboardFocusPath = preserveInteraction ? pane.keyboardFocusPath : null;
  const previousColumnPath = preserveInteraction ? pane.columnPath : null;
  const previousColumnEntries = preserveInteraction ? pane.columnEntries : null;
  const previousPreviewPath = preserveInteraction && state.selectionPreview?.paneIndex === index
    ? state.selectionPreview.path
    : null;
  const token = pane.loadToken + 1;
  pane.loadToken = token;
  pane.loading = !silent;
  pane.loadingSlow = false;
  pane.indexing = false;
  pane.indexingSlow = false;
  pane.error = '';
  if (!preserveInteraction) {
    pane.selection.clear();
    pane.anchorPath = null;
    pane.keyboardFocusPath = null;
  }
  if (!preserveInteraction && state.selectionPreview?.paneIndex === index) closeSelectionPreview();
  if (!silent) renderPanes();
  const loadingTimer = silent ? null : setTimeout(() => {
    if (pane.loadToken !== token || !pane.loading) return;
    pane.loadingSlow = true;
    updatePaneActivity(index);
  }, 2000);
  try {
    const result = await api.listDirectory(targetPath, pane.showHidden);
    clearTimeout(loadingTimer);
    if (pane.loadToken !== token) return;
    pane.path = result.path;
    localStorage.setItem(`easymove-pane-${pane.id}-path`, pane.path);
    pane.columnPath = preserveInteraction ? previousColumnPath : null;
    pane.columnEntries = preserveInteraction ? previousColumnEntries : [];
    pane.entries = result.entries.map((entry, entryIndex) => ({
      ...entry,
      size: entry.isDirectory ? null : entry.size,
      folderSizeStatus: entry.isDirectory ? (entryIndex < EAGER_SIZE_LIMIT ? 'loading' : 'idle') : 'ready',
      previewStatus: 'idle',
      previewUrl: null,
      folderCover: false
    }));
    if (preserveInteraction) {
      const availablePaths = new Set([...pane.entries, ...pane.columnEntries].map((entry) => entry.path));
      pane.selection = new Set([...previousSelection].filter((itemPath) => availablePaths.has(itemPath)));
      pane.anchorPath = availablePaths.has(previousAnchorPath) ? previousAnchorPath : null;
      pane.keyboardFocusPath = availablePaths.has(previousKeyboardFocusPath) ? previousKeyboardFocusPath : null;
      if (previousPreviewPath && !availablePaths.has(previousPreviewPath)) closeSelectionPreview();
    }
    pane.loading = false;
    pane.loadingSlow = false;
    pane.error = '';
    if (options.pushHistory !== false && pane.history[pane.historyIndex] !== result.path) {
      pane.history = pane.history.slice(0, pane.historyIndex + 1);
      pane.history.push(result.path);
      pane.historyIndex = pane.history.length - 1;
    }
    if (index === state.activePane) elements.globalSearch.value = pane.filter;
    pane.indexing = pane.entries.length > 0;
    renderAllWhenIdle();
    if (pane.indexing) void hydratePaneIndex(index, token);
  } catch (error) {
    clearTimeout(loadingTimer);
    if (pane.loadToken !== token) return;
    pane.loading = false;
    pane.loadingSlow = false;
    pane.indexing = false;
    pane.indexingSlow = false;
    pane.error = error.message || String(error);
    renderPanes();
    showToast(pane.error, '无法打开文件夹');
  }
}

async function navigateToFilesystemPath(index, requestedPath) {
  const expandedPath = normalizeFilesystemPathInput(requestedPath).replace(/^~/, state.locations.home);
  try {
    const target = await api.resolvePath(expandedPath);
    if (target.isDirectory) {
      await loadPane(index, target.path);
      return;
    }

    const pane = state.panes[index];
    await loadPane(index, target.parentDirectory);
    if (pane.error) return;
    if (!pane.entries.some((entry) => samePath(entry.path, target.path)) && basename(target.path).startsWith('.') && !pane.showHidden) {
      pane.showHidden = true;
      await loadPane(index, target.parentDirectory, { pushHistory: false });
    }
    const entry = pane.entries.find((item) => samePath(item.path, target.path));
    if (!entry) throw new Error(`文件存在，但无法在当前视图中定位：${target.path}`);
    const revealed = revealOperationDestinations({ targetPaneIndex: index, targetDirectory: target.parentDirectory }, [target.path]);
    if (!revealed) throw new Error(`无法在当前窗格中定位：${target.path}`);
    pane.keyboardFocusPath = target.path;
    syncPaneInteractionState();
    showToast(`已定位“${entry.name}”`, '路径直达');
  } catch (error) {
    showToast(readableFileError(error), '无法定位路径');
  }
}

function comparablePath(filePath) {
  const normalized = String(filePath || '').replace(/[\\/]+$/, '') || (state.platform === 'win32' ? String(filePath || '').slice(0, 3) : '/');
  return state.platform === 'win32' ? normalized.toLocaleLowerCase() : normalized;
}

function samePath(left, right) {
  return comparablePath(left) === comparablePath(right);
}

function createColumnEntry(entry) {
  return {
    ...entry,
    size: entry.isDirectory ? null : entry.size,
    folderSizeStatus: entry.isDirectory ? 'loading' : 'ready',
    previewStatus: 'idle',
    previewUrl: null,
    previewKind: null,
    previewText: null,
    previewError: null,
    previewChildren: [],
    folderCover: false
  };
}

async function hydrateColumnEntries(paneIndex, columnPath, token) {
  const pane = state.panes[paneIndex];
  const isCurrent = () => pane.columnToken === token && samePath(pane.columnPath, columnPath);
  const previewEntries = pane.columnEntries
    .filter((entry) => entry.isDirectory || EAGER_IMAGE_EXTENSIONS.has(entry.extension))
    .slice(0, EAGER_PREVIEW_LIMIT);
  const directories = pane.columnEntries.filter((entry) => entry.isDirectory);

  const previewTask = (async () => {
    for (let offset = 0; offset < previewEntries.length; offset += 8) {
      const batch = previewEntries.slice(offset, offset + 8);
      const results = await Promise.all(batch.map(async (entry) => ({ path: entry.path, result: await api.preview(entry.path) })));
      if (!isCurrent()) return;
      for (const { path: itemPath, result } of results) {
        const current = pane.columnEntries.find((entry) => samePath(entry.path, itemPath));
        if (current) applyPreviewResult(current, result);
      }
      renderAllWhenIdle();
    }
  })();

  const sizeTask = (async () => {
    for (let offset = 0; offset < directories.length; offset += 8) {
      const batch = directories.slice(offset, offset + 8);
      let results = [];
      try { results = await api.folderSizes(batch.map((entry) => entry.path)); } catch {}
      if (!isCurrent()) return;
      const measured = new Map(results.map((result) => [result.path, result.size]));
      for (const item of batch) {
        const current = pane.columnEntries.find((entry) => samePath(entry.path, item.path));
        if (!current) continue;
        const size = measured.get(item.path);
        current.size = Number.isFinite(size) ? size : null;
        current.folderSizeStatus = Number.isFinite(size) ? 'ready' : 'unavailable';
      }
      renderAllWhenIdle();
    }
  })();

  await Promise.allSettled([previewTask, sizeTask]);
}

async function refreshColumnContents(index) {
  const pane = state.panes[index];
  const columnPath = pane?.columnPath;
  if (!pane || !columnPath) return;
  const token = ++pane.columnToken;
  const previousSelection = new Set(pane.selection);
  try {
    const result = await api.listDirectory(columnPath, pane.showHidden);
    if (pane.columnToken !== token || !samePath(pane.columnPath, columnPath)) return;
    pane.columnEntries = result.entries.map(createColumnEntry);
    const availablePaths = new Set([...pane.entries, ...pane.columnEntries].map((entry) => entry.path));
    pane.selection = new Set([...previousSelection].filter((itemPath) => availablePaths.has(itemPath)));
    if (state.selectionPreview?.paneIndex === index && !availablePaths.has(state.selectionPreview.path)) closeSelectionPreview();
    renderPanes();
    await hydrateColumnEntries(index, columnPath, token);
  } catch (error) {
    if (pane.columnToken !== token) return;
    showToast(error.message || String(error), '无法刷新已展开的文件夹');
  }
}

async function refreshPanesAfterOperation(operation) {
  const sourceParents = operation.mode === 'move' ? operation.paths.map(parentPath) : [];
  const targetParent = parentPath(operation.targetDirectory);
  const refreshes = [];
  state.panes.forEach((pane, index) => {
    if (pane.virtualMode === 'recent') {
      refreshes.push(loadRecentPane(index, { pushHistory: false, preserveInteraction: true }));
      return;
    }
    if (pane.virtualMode === 'basket') {
      refreshes.push(loadBasketPane(index, { pushHistory: false, preserveInteraction: true }));
      return;
    }
    const mainChanged = samePath(pane.path, operation.targetDirectory)
      || samePath(pane.path, targetParent)
      || sourceParents.some((sourceParent) => samePath(pane.path, sourceParent));
    if (mainChanged) {
      refreshes.push(loadPane(index, pane.path, { pushHistory: false, preserveInteraction: true, silent: true }));
      return;
    }
    const columnChanged = pane.columnPath && (
      samePath(pane.columnPath, operation.targetDirectory)
      || sourceParents.some((sourceParent) => samePath(pane.columnPath, sourceParent))
    );
    if (columnChanged) refreshes.push(refreshColumnContents(index));
  });
  await Promise.all(refreshes);
}

async function refreshPanesAfterRemoval(paths) {
  const sourceParents = paths.map(parentPath);
  const refreshes = [];
  state.panes.forEach((pane, index) => {
    if (pane.virtualMode === 'recent') {
      refreshes.push(loadRecentPane(index, { pushHistory: false, preserveInteraction: true }));
      return;
    }
    if (pane.virtualMode === 'basket') {
      refreshes.push(loadBasketPane(index, { pushHistory: false, preserveInteraction: true }));
      return;
    }
    const mainChanged = sourceParents.some((sourceParent) => samePath(pane.path, sourceParent));
    const columnChanged = pane.columnPath
      && sourceParents.some((sourceParent) => samePath(pane.columnPath, sourceParent));
    if (mainChanged && columnChanged) {
      refreshes.push((async () => {
        await loadPane(index, pane.path, { pushHistory: false, preserveInteraction: true, silent: true });
        await refreshColumnContents(index);
      })());
    } else if (mainChanged) {
      refreshes.push(loadPane(index, pane.path, { pushHistory: false, preserveInteraction: true, silent: true }));
    } else if (columnChanged) {
      refreshes.push(refreshColumnContents(index));
    }
  });
  await Promise.all(refreshes);
}

function revealOperationDestinations(operation, destinations) {
  if (!destinations.length) return false;
  const destinationSet = new Set(destinations.map(comparablePath));
  const preferredIndexes = [operation.targetPaneIndex, ...visiblePaneIndexes()]
    .filter((index, position, indexes) => Number.isInteger(index) && indexes.indexOf(index) === position);
  let revealedPaneIndex = -1;

  for (const index of preferredIndexes) {
    const pane = state.panes[index];
    if (!pane) continue;
    const targetEntries = samePath(pane.path, operation.targetDirectory)
      ? pane.entries
      : (pane.columnPath && samePath(pane.columnPath, operation.targetDirectory) ? pane.columnEntries : null);
    if (!targetEntries) continue;
    const visibleDestinations = targetEntries.filter((entry) => destinationSet.has(comparablePath(entry.path)));
    if (!visibleDestinations.length) continue;
    pane.selection.clear();
    visibleDestinations.forEach((entry) => pane.selection.add(entry.path));
    pane.anchorPath = visibleDestinations[0].path;
    state.activePane = index;
    revealedPaneIndex = index;
    break;
  }

  if (revealedPaneIndex < 0) return false;
  clearTimeout(state.transferRevealTimer);
  state.transferReveal = { paneIndex: revealedPaneIndex, paths: destinations, hasScrolled: false };
  renderAll();
  state.transferRevealTimer = setTimeout(() => {
    state.transferReveal = null;
    elements.panes.querySelectorAll('.file-row.transfer-reveal').forEach((row) => row.classList.remove('transfer-reveal'));
  }, 6000);
  return true;
}

function applyTransferReveal() {
  const reveal = state.transferReveal;
  const pane = reveal && state.panes[reveal.paneIndex];
  if (!pane) return;
  requestAnimationFrame(() => {
    if (state.transferReveal !== reveal) return;
    const rows = reveal.paths.map((destination) => elements.panes.querySelector(
      `.file-row[data-pane="${pane.id}"][data-path="${CSS.escape(encodePath(destination))}"]`
    )).filter(Boolean);
    rows.forEach((row) => row.classList.add('transfer-reveal'));
    if (rows[0]) {
      rows[0].scrollIntoView({ block: 'center', inline: 'nearest', behavior: reveal.hasScrolled ? 'auto' : 'smooth' });
      reveal.hasScrolled = true;
    }
  });
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
  if (pane.virtualMode && pane.sort.field === 'modified') {
    const direction = pane.sort.direction === 'asc' ? 1 : -1;
    return [...entries].sort((left, right) => direction * ((left.basketAddedAt || left.recentUsed || left.modified) - (right.basketAddedAt || right.recentUsed || right.modified)));
  }
  return window.easyMoveSort.sortEntries(entries, pane.sort);
}

function paneDisplayPath(pane) {
  if (pane.virtualMode === 'recent') return '最近访问';
  if (pane.virtualMode === 'basket') return '临时文件篮';
  if (pane.virtualMode === 'search') return pane.searchQuery ? `全局搜索 · ${pane.searchQuery}` : '全局搜索';
  return pane.path;
}

function sortIndicator(pane, field) {
  if (pane.sort.field !== field) return '';
  return `<span class="sort-indicator" aria-hidden="true">${pane.sort.direction === 'asc' ? '↑' : '↓'}</span>`;
}

const viewModes = [['icon', '图标视图', 'view-icon'], ['list', '列表视图', 'view-list'], ['column', '分栏视图', 'view-column'], ['gallery', '画廊视图', 'view-gallery']];

function itemMarkup(pane, entry, extraClass = '') {
  const selected = pane.selection.has(entry.path) ? ' selected' : '';
  const keyboardFocused = pane.keyboardFocusPath === entry.path ? ' keyboard-focused' : '';
  const cut = state.clipboard?.mode === 'move' && state.clipboard.paths.includes(entry.path) ? ' cut' : '';
  const fallback = entry.isDirectory ? icon('folder') : icon('image');
  const thumbnail = entry.previewUrl ? `<img src="${escapeHtml(entry.previewUrl)}" alt="">` : fallback;
  return `<div class="file-row ${extraClass}${selected}${keyboardFocused}${cut}${entry.unavailable ? ' unavailable' : ''}" data-pane="${pane.id}" data-path="${encodePath(entry.path)}" draggable="${entry.unavailable ? 'false' : 'true'}" tabindex="0" aria-selected="${pane.selection.has(entry.path)}" title="${escapeHtml(entry.unavailable ? `${entry.name}（原位置已不可用）` : entry.name)}"><span class="file-icon${entry.isDirectory ? (entry.folderCover ? ' folder-cover' : '') : ' file'}" data-preview-icon>${thumbnail}</span><span class="item-name">${escapeHtml(entry.name)}</span><span class="item-kind">${escapeHtml(entry.kind)}</span><span class="item-date">${escapeHtml(formatDate(entry.basketAddedAt || entry.modified))}</span><span class="item-size">${escapeHtml(formatEntrySize(entry))}</span></div>`;
}

function viewControls(pane) {
  return `<div class="view-switch" role="radiogroup" aria-label="窗格视图">${viewModes.map(([mode, label, iconName]) => `<button class="view-button${pane.viewMode === mode ? ' active' : ''}" data-view-mode="${mode}" data-pane="${pane.id}" role="radio" aria-checked="${pane.viewMode === mode}" aria-label="${label}" title="${label}">${icon(iconName)}</button>`).join('')}</div>`;
}

function previewMarkup(entry, large = false) {
  if (!entry) return `<div class="preview-empty">选择一个项目</div>`;
  if (entry.previewUrl) return `<img class="content-preview${large ? ' large' : ''}" src="${escapeHtml(entry.previewUrl)}" alt="${escapeHtml(entry.name)} 预览">`;
  if (entry.previewText) return `<div class="preview-document">${escapeHtml(entry.previewText.slice(0, 1800))}</div>`;
  return `<div class="preview-error"><strong>无法预览</strong><span>${escapeHtml(previewErrorMessage(entry.previewError))}</span><button data-open-path="${encodePath(entry.path)}">用系统应用打开</button><button data-retry-preview="${encodePath(entry.path)}">重试</button></div>`;
}

function applyPreviewResult(entry, result = {}) {
  Object.assign(entry, {
    previewStatus: 'ready',
    previewUrl: result.url || result.previewUrl || null,
    previewKind: result.previewKind || null,
    previewText: result.previewText || null,
    previewError: result.error || result.previewError || null,
    folderCover: Boolean(result.folderCover),
    previewChildren: result.children || result.previewChildren || []
  });
  return entry;
}

async function ensureEntryPreview(entry) {
  if (!entry || entry.previewStatus === 'ready') return entry;
  if (entry.previewPromise) return entry.previewPromise;
  entry.previewStatus = 'loading';
  entry.previewPromise = api.preview(entry.path)
    .then((result) => applyPreviewResult(entry, result))
    .catch((error) => applyPreviewResult(entry, { error: error.message || 'UNAVAILABLE' }))
    .finally(() => { delete entry.previewPromise; });
  return entry.previewPromise;
}

async function ensureEntrySize(entry) {
  if (!entry?.isDirectory || entry.folderSizeStatus === 'ready' || entry.folderSizeStatus === 'unavailable') return entry;
  if (entry.folderSizePromise) return entry.folderSizePromise;
  entry.folderSizeStatus = 'loading';
  entry.folderSizePromise = api.folderSizes([entry.path])
    .then((results) => {
      const measured = results.find((item) => samePath(item.path, entry.path));
      entry.size = Number.isFinite(measured?.size) ? measured.size : null;
      entry.folderSizeStatus = Number.isFinite(measured?.size) ? 'ready' : 'unavailable';
      return entry;
    })
    .catch(() => {
      entry.size = null;
      entry.folderSizeStatus = 'unavailable';
      return entry;
    })
    .finally(() => { delete entry.folderSizePromise; });
  return entry.folderSizePromise;
}

function previewMediaMarkup(entry, context = 'selection') {
  if (entry.previewStatus === 'loading') {
    return `<div class="preview-fallback preview-loading">${icon('refresh')}<strong>正在建立预览…</strong><span>超过 2 秒时会继续提示索引状态</span></div>`;
  }
  if (entry.previewUrl) return `<img class="${context}-preview-image" src="${escapeHtml(entry.previewUrl)}" alt="${escapeHtml(entry.name)} 预览">`;
  if (entry.isDirectory) {
    const children = entry.previewChildren?.length
      ? `<div class="folder-preview-children">${entry.previewChildren.slice(0, 8).map((name) => `<span>${icon('folder')} ${escapeHtml(name)}</span>`).join('')}</div>`
      : `<span class="preview-muted">${entry.previewStatus === 'ready' ? '空文件夹，或内容暂不可读' : '读取文件夹摘要'}</span>`;
    return `<div class="preview-fallback folder-preview">${icon('folder')}<strong>文件夹</strong>${children}</div>`;
  }
  if (entry.previewText) return `<pre class="${context}-preview-text">${escapeHtml(entry.previewText.slice(0, context === 'selection' ? 5000 : 620))}</pre>`;
  return `<div class="preview-fallback file-preview">${icon('image')}<strong>${escapeHtml(entry.kind || '文件')}</strong><span>${escapeHtml(previewErrorMessage(entry.previewError))}</span></div>`;
}

function galleryPreviewMarkup(entry) {
  if (!entry) return `<div class="preview-empty">从下方选择一个项目进行预览</div>`;
  const retryActions = entry.previewError && !entry.isDirectory
    ? `<div class="gallery-preview-actions"><button data-open-path="${encodePath(entry.path)}">用系统应用打开</button><button data-retry-preview="${encodePath(entry.path)}">重试</button></div>`
    : '';
  return `${previewMediaMarkup(entry, 'gallery')}${retryActions}`;
}

function selectionPreviewMarkup(entry, slow = false) {
  const actionLabel = entry.isDirectory ? '打开文件夹' : '用系统应用打开';
  const folderSummary = entry.isDirectory && entry.previewUrl && entry.previewChildren?.length
    ? `<div class="selection-folder-summary"><strong>文件夹内容</strong><div class="folder-preview-children">${entry.previewChildren.slice(0, 8).map((name) => `<span>${icon('folder')} ${escapeHtml(name)}</span>`).join('')}</div></div>`
    : '';
  return `<div class="selection-preview-header"><div><span>所选项目</span><strong>${escapeHtml(entry.name)}</strong></div><button data-preview-close aria-label="关闭预览" title="关闭预览">${icon('close')}</button></div>
    <div class="selection-preview-body">
      ${slow ? `<div class="selection-indexing">建立索引中，请稍候</div>` : ''}
      <div class="selection-preview-media">${previewMediaMarkup(entry)}</div>
      ${folderSummary}
      <dl class="preview-metadata">
        <div><dt>类型</dt><dd>${escapeHtml(entry.kind || (entry.isDirectory ? '文件夹' : '文件'))}</dd></div>
        <div><dt>修改时间</dt><dd>${escapeHtml(formatDate(entry.modified))}</dd></div>
        <div><dt>大小</dt><dd>${escapeHtml(formatEntrySize(entry))}</dd></div>
        <div><dt>位置</dt><dd title="${escapeHtml(entry.path)}">${escapeHtml(parentPath(entry.path))}</dd></div>
      </dl>
    </div>
    <div class="selection-preview-actions"><button class="preview-open-button" data-preview-open="${encodePath(entry.path)}" data-preview-pane="${state.selectionPreview?.paneIndex ?? state.activePane}" data-preview-directory="${entry.isDirectory ? 'true' : 'false'}">${actionLabel}</button>${entry.previewError && !entry.isDirectory ? `<button data-preview-retry="${encodePath(entry.path)}">重新生成预览</button>` : ''}</div>`;
}

function closeSelectionPreview() {
  state.selectionPreviewToken += 1;
  state.selectionPreview = null;
  elements.selectionPreview.hidden = true;
  elements.selectionPreview.innerHTML = '';
  elements.contentStage.classList.remove('has-selection-preview');
}

async function showSelectionPreview(paneIndex, entry) {
  if (!entry) return closeSelectionPreview();
  const token = ++state.selectionPreviewToken;
  state.selectionPreview = { paneIndex, path: entry.path };
  elements.contentStage.classList.add('has-selection-preview');
  elements.selectionPreview.hidden = false;
  elements.selectionPreview.innerHTML = selectionPreviewMarkup(entry);
  if (entry.previewStatus === 'ready' && (!entry.isDirectory || ['ready', 'unavailable'].includes(entry.folderSizeStatus))) return;
  const slowTimer = setTimeout(() => {
    if (token !== state.selectionPreviewToken) return;
    elements.selectionPreview.innerHTML = selectionPreviewMarkup(entry, true);
  }, 2000);
  await Promise.all([ensureEntryPreview(entry), ensureEntrySize(entry)]);
  clearTimeout(slowTimer);
  if (token !== state.selectionPreviewToken || state.selectionPreview?.path !== entry.path) return;
  elements.selectionPreview.innerHTML = selectionPreviewMarkup(entry);
  const row = elements.panes.querySelector(`.file-row[data-pane="${paneIndex}"][data-path="${CSS.escape(encodePath(entry.path))}"]`);
  const previewIcon = row?.querySelector('[data-preview-icon]');
  if (previewIcon && entry.previewUrl) previewIcon.innerHTML = `<img src="${escapeHtml(entry.previewUrl)}" alt="">`;
  previewIcon?.classList.toggle('folder-cover', Boolean(entry.folderCover));
}

function previewErrorMessage(code) {
  return ({ ENOENT: '文件已不存在', EACCES: '没有文件读取权限', EPERM: 'macOS 阻止了访问', DECODE_FAILED: '图片解码失败', QUICK_LOOK_TIMEOUT: 'Quick Look 生成超时', QUICK_LOOK_FAILED: 'Quick Look 无法生成预览', PROTOCOL: '缩略图协议读取失败' })[code] || '此格式暂时无法生成内容预览';
}

function renderPane(pane) {
  const entries = filteredEntries(pane);
  const rows = entries.map((entry) => {
    const selected = pane.selection.has(entry.path) ? ' selected' : '';
    const keyboardFocused = pane.keyboardFocusPath === entry.path ? ' keyboard-focused' : '';
    const cut = state.clipboard?.mode === 'move' && state.clipboard.paths.includes(entry.path) ? ' cut' : '';
    const fileIcon = entry.isDirectory ? icon('folder') : icon('image');
    const thumbnail = entry.previewUrl ? `<img src="${escapeHtml(entry.previewUrl)}" alt="">` : fileIcon;
    return `<tr class="file-row${selected}${keyboardFocused}${cut}${entry.unavailable ? ' unavailable' : ''}" data-pane="${pane.id}" data-path="${encodePath(entry.path)}" draggable="${entry.unavailable ? 'false' : 'true'}" tabindex="0" aria-selected="${pane.selection.has(entry.path) ? 'true' : 'false'}">
      <td><div class="file-name" title="${escapeHtml(entry.name)}"><span class="file-icon${entry.isDirectory ? (entry.folderCover ? ' folder-cover' : '') : ' file'}" data-preview-icon>${thumbnail}</span><span class="file-name-content"><span>${escapeHtml(entry.name)}</span>${entry.searchSnippet ? `<small class="search-snippet">${escapeHtml(entry.searchSnippet)}</small>` : ''}</span></div></td>
      <td>${escapeHtml(entry.kind)}</td>
      <td>${escapeHtml(formatDate(pane.virtualMode === 'recent' ? entry.recentUsed : pane.virtualMode === 'basket' ? entry.basketAddedAt : entry.modified))}</td>
      <td class="size-cell${entry.folderSizeStatus === 'loading' ? ' calculating' : ''}">${escapeHtml(formatEntrySize(entry))}</td>
    </tr>`;
  }).join('');

  const header = (field, label) => `<button class="sort-button" data-sort="${field}" data-pane="${pane.id}" aria-label="按${label}排序，当前${pane.sort.field === field ? (pane.sort.direction === 'asc' ? '升序' : '降序') : '未排序'}">${label}${sortIndicator(pane, field)}</button>`;
  const dateLabel = pane.virtualMode === 'recent' ? '最近访问' : pane.virtualMode === 'basket' ? '加入时间' : '修改时间';
  let content = `<table class="file-table"><thead><tr><th>${header('name', '名称')}</th><th>${header('type', '类型')}</th><th>${header('modified', dateLabel)}</th><th>${header('size', '大小')}</th></tr></thead><tbody>${rows}</tbody></table>`;
  if (pane.viewMode === 'icon') content = `<div class="icon-grid">${entries.map((entry) => itemMarkup(pane, entry, 'icon-item')).join('')}</div>`;
  if (pane.viewMode === 'column') {
    const child = pane.columnLoading ? `<div class="column-state">正在读取…</div>` : pane.columnPath ? pane.columnEntries.map((entry) => itemMarkup(pane, entry, 'column-item')).join('') || `<div class="column-state">文件夹为空</div>` : `<div class="column-state">选择文件夹以展开下一栏</div>`;
    const selected = pane.entries.find((entry) => pane.selection.has(entry.path) && !entry.isDirectory);
    content = `<div class="column-browser"><div class="column">${entries.map((entry) => itemMarkup(pane, entry, 'column-item')).join('')}</div><div class="column">${child}</div>${selected ? `<div class="column column-preview">${previewMarkup(selected, true)}<strong>${escapeHtml(selected.name)}</strong><span>${escapeHtml(selected.kind)} · ${escapeHtml(formatEntrySize(selected))}</span></div>` : ''}</div>`;
  }
  if (pane.viewMode === 'gallery') {
    const selected = entries.find((entry) => pane.selection.has(entry.path)) || entries[0];
    content = `<div class="gallery"><div class="gallery-stage"><span class="gallery-mode-label">画廊预览</span>${galleryPreviewMarkup(selected)}${selected ? `<strong>${escapeHtml(selected.name)}</strong><span>${escapeHtml(selected.kind)} · ${escapeHtml(formatEntrySize(selected))}</span>` : ''}</div><div class="gallery-strip" aria-label="画廊项目胶片条">${entries.map((entry) => itemMarkup(pane, entry, 'gallery-item')).join('')}</div></div>`;
  }
  if (pane.loading) content = `<div class="empty-state"><div>${icon('refresh')}<br>${pane.loadingSlow ? '建立索引中，请稍候' : '正在读取文件夹…'}</div></div>`;
  else if (pane.error) content = `<div class="empty-state"><div>${icon('close')}<br>${escapeHtml(pane.error)}</div></div>`;
  else if (!entries.length) content = `<div class="empty-state"><div>${icon('bloom')}<br>${pane.virtualMode === 'search' ? (pane.searchQuery ? '没有找到匹配项目' : '输入关键词搜索文件名与内容') : pane.virtualMode === 'basket' ? '临时文件篮还是空的' : pane.filter ? '没有匹配的文件' : '这个文件夹是空的'}</div></div>`;

  const selectedSize = selectedSizeLabel(pane);
  const statusDetail = pane.virtualMode === 'search'
    ? `本机索引 · ${Number(state.contentIndex.count || 0).toLocaleString('zh-CN')} 项 · <button class="inline-link" data-index-settings>索引设置</button>`
    : pane.virtualMode === 'basket'
      ? `仅保存文件引用 · <button class="inline-link" data-basket-clear ${pane.entries.length ? '' : 'disabled'}>清空文件篮</button>`
      : selectedSize || escapeHtml(paneDisplayPath(pane));
  const pathInputValue = pane.virtualMode === 'search' ? pane.searchQuery : paneDisplayPath(pane);
  const pathInputPlaceholder = pane.virtualMode === 'search' ? '输入关键词，搜索文件名与内容…' : '';
  const pathInputReadOnly = pane.virtualMode && pane.virtualMode !== 'search' ? 'readonly' : '';
  const pathInputLabel = pane.virtualMode === 'search' ? '全局搜索关键词' : '当前路径';
  return `<section class="pane${pane.id === state.activePane ? ' active' : ''}" data-pane="${pane.id}">
    <div class="pane-header">
      <div class="pane-tabs"><div class="pane-tab">${icon(pane.virtualMode === 'recent' ? 'clock' : pane.virtualMode === 'basket' ? 'star' : pane.virtualMode === 'search' ? 'search' : 'folder')}<span>${escapeHtml(pane.virtualMode ? paneDisplayPath(pane) : (basename(pane.path) || pane.path))}</span></div></div>
      <div class="pane-address">
        <div class="address-buttons">
          <button class="mini-button" data-pane-action="back" data-pane="${pane.id}" ${pane.historyIndex <= 0 ? 'disabled' : ''} title="后退">${icon('back')}</button>
          <button class="mini-button" data-pane-action="forward" data-pane="${pane.id}" ${pane.historyIndex >= pane.history.length - 1 ? 'disabled' : ''} title="前进">${icon('next')}</button>
          <button class="mini-button" data-pane-action="up" data-pane="${pane.id}" title="上一级">${icon('up')}</button>
        </div>
        <input class="path-input${pane.virtualMode === 'search' ? ' search-input' : ''}" data-pane="${pane.id}" value="${escapeHtml(pathInputValue)}" placeholder="${escapeHtml(pathInputPlaceholder)}" aria-label="${pathInputLabel}" ${pathInputReadOnly}>
        ${viewControls(pane)}
        <button class="mini-button" data-pane-action="refresh" data-pane="${pane.id}" title="刷新" aria-label="刷新">${icon('refresh')}</button>
      </div>
    </div>
    <div class="file-list">${content}</div>
    <div class="pane-status"><span>${pane.indexingSlow ? '建立索引中，请稍候' : pane.selection.size ? `已选择 ${pane.selection.size} 项` : `${pane.entries.length} 个项目`}</span><span>${statusDetail}</span></div>
  </section>`;
}

function renderPanes() {
  elements.panes.className = `panes layout-${state.layout}`;
  elements.panes.innerHTML = state.panes.map(renderPane).join('');
  applyTransferReveal();
}

function renderSidebar() {
  const shortcuts = [
    ['home', '个人文件夹', 'home'],
    ['desktop', '桌面', 'home'],
    ['documents', '文稿', 'folder'],
    ['downloads', '下载', 'download'],
    ['pictures', '图片', 'image'],
    ['recent', '最近访问', 'clock']
  ];
  const locations = shortcuts.map(([key, label, iconName]) => {
    const target = key === 'recent' ? RECENT_PATH : state.locations[key];
    const active = key === 'recent' ? (activePane()?.virtualMode === 'recent' ? ' active' : '') : (activePane()?.path === target ? ' active' : '');
    return `<button class="nav-item${active}" data-nav-path="${encodePath(target)}">${icon(iconName)}<span>${label}</span><small></small></button>`;
  }).join('');
  const basketActive = activePane()?.virtualMode === 'basket' ? ' active' : '';
  const quickMarkup = `${locations}<span class="nav-divider"></span>
    <button class="nav-item${basketActive}" data-nav-path="${encodePath(BASKET_PATH)}">${icon('folder')}<span>临时文件篮</span><small>${state.fileBasketCount || ''}</small></button>
    <button class="nav-item${activePane()?.virtualMode === 'search' ? ' active' : ''}" data-global-search>${icon('search')}<span>全局搜索</span><small class="nav-status-dot ${escapeHtml(state.contentIndex.phase || 'idle')}"></small></button>
    <button class="nav-item${state.currentWorkspaceId ? ' active' : ''}" data-workspaces>${icon('star')}<span>工作区</span><small>${state.workspaces.length || ''}</small></button>`;
  const quickKey = JSON.stringify({
    locations: state.locations,
    activePath: activePane()?.path,
    activeVirtualMode: activePane()?.virtualMode,
    fileBasketCount: state.fileBasketCount,
    workspaceCount: state.workspaces.length,
    currentWorkspaceId: state.currentWorkspaceId
  });
  if (quickKey !== state.sidebarRenderKey) {
    elements.quickNav.innerHTML = quickMarkup;
    state.sidebarRenderKey = quickKey;
  }
  const volumeMarkup = state.volumes.map((volume) => {
    const active = activePane()?.path === volume.path ? ' active' : '';
    const status = volume.readOnly ? '只读' : (volume.removable ? '外置' : '');
    const title = volume.readOnly ? `${volume.name}（只读，无法写入）` : volume.name;
    return `<button class="nav-item${active}" data-nav-path="${encodePath(volume.path)}" title="${escapeHtml(title)}">${icon('drive')}<span>${escapeHtml(volume.name)}</span><small>${status}</small></button>`;
  }).join('');
  const volumeKey = JSON.stringify({ volumes: state.volumes, activePath: activePane()?.virtualMode ? '' : activePane()?.path });
  if (volumeKey !== state.volumeRenderKey) {
    elements.volumeNav.innerHTML = volumeMarkup;
    state.volumeRenderKey = volumeKey;
  }
}

function updateContentIndexSidebarStatus() {
  const dot = elements.quickNav.querySelector('[data-global-search] .nav-status-dot');
  if (dot) dot.className = `nav-status-dot ${state.contentIndex.phase || 'idle'}`;
}

function workspaceDetail(workspace) {
  const names = (workspace.panes || []).slice(0, workspace.layout).map((pane) => basename(pane.path)).filter(Boolean);
  return `${workspace.layout === 1 ? '单' : workspace.layout === 2 ? '双' : '四'}窗格${names.length ? ` · ${names.join(' / ')}` : ''}`;
}

function renderWorkspacePanel() {
  elements.workspaceList.innerHTML = state.workspaces.length ? state.workspaces.map((workspace) => `<div class="workspace-row">
    <button class="workspace-row-main" data-workspace-open="${escapeHtml(workspace.id)}"><strong>${escapeHtml(workspace.name)}</strong><span>${escapeHtml(workspaceDetail(workspace))}</span></button>
    <button class="workspace-row-delete" data-workspace-delete="${escapeHtml(workspace.id)}" title="删除">×</button>
  </div>`).join('') : `<div class="operation-history-empty">${icon('bloom')}<br>还没有保存工作区</div>`;
  const current = state.workspaces.find((workspace) => workspace.id === state.currentWorkspaceId);
  elements.currentWorkspaceName.textContent = current?.name || '四季工作区';
  elements.currentWorkspaceDetail.textContent = current ? workspaceDetail(current) : '保存窗格布局、路径、视图与排序，稍后继续整理。';
}

function renderContentIndexStatus() {
  const current = state.contentIndex || { phase: 'idle', roots: [] };
  const labels = { idle: '索引尚未建立', indexing: '正在建立本机索引', paused: '索引已暂停', ready: '索引已是最新', error: '索引需要处理' };
  elements.indexStatusLabel.textContent = labels[current.phase] || '本机内容索引';
  elements.indexStatusDetail.textContent = current.phase === 'indexing'
    ? `已处理 ${Number(current.processed || 0).toLocaleString('zh-CN')} 项${current.currentPath ? ` · ${basename(current.currentPath)}` : ''}`
    : `${Number(current.count || 0).toLocaleString('zh-CN')} 项 · ${formatSize(current.bytes || 0)} · ${current.errors?.length || 0} 个目录被跳过`;
  elements.indexProgressFill.style.width = current.phase === 'ready' ? '100%' : current.phase === 'indexing' ? '62%' : '0%';
  elements.indexPause.textContent = current.phase === 'paused' ? '继续' : '暂停';
  elements.indexRootList.innerHTML = (current.roots || []).length ? current.roots.map((root) => `<div class="index-root-row"><span>✓</span><span><strong>${escapeHtml(basename(root) || root)}</strong><span title="${escapeHtml(root)}">${escapeHtml(root)}</span></span><button data-index-remove-root="${encodePath(root)}" title="从索引范围移除">×</button></div>`).join('') : `<div class="operation-history-empty">还没有索引文件夹</div>`;
  renderSidebar();
}

function captureWorkspace(name, id = null) {
  return {
    id,
    name,
    layout: state.layout,
    panes: state.panes.map((pane) => ({
      path: pane.virtualMode ? state.locations.home : pane.path,
      viewMode: pane.viewMode,
      sort: { ...pane.sort },
      showHidden: pane.showHidden,
      columnPath: pane.viewMode === 'column' ? pane.columnPath : null
    }))
  };
}

async function restoreWorkspace(workspace) {
  state.currentWorkspaceId = workspace.id;
  state.layout = workspace.layout;
  document.querySelectorAll('.layout-button').forEach((button) => button.classList.toggle('active', Number(button.dataset.layout) === state.layout));
  const failures = [];
  await Promise.all((workspace.panes || []).map(async (savedPane, index) => {
    const pane = state.panes[index];
    if (!pane) return;
    pane.viewMode = savedPane.viewMode;
    pane.sort = { ...savedPane.sort };
    pane.showHidden = savedPane.showHidden;
    await loadPane(index, savedPane.path, { pushHistory: false });
    if (pane.error) failures.push(savedPane.path);
    if (!pane.error && savedPane.columnPath && pane.viewMode === 'column') {
      const entry = pane.entries.find((item) => item.isDirectory && samePath(item.path, savedPane.columnPath));
      if (entry) await expandColumnFolder(index, entry);
    }
  }));
  if (!visiblePaneIndexes().includes(state.activePane)) state.activePane = 0;
  elements.workspacePanel.hidden = true;
  renderAll();
  renderWorkspacePanel();
  showToast(failures.length ? `已恢复可用窗格，${failures.length} 个位置需要重新定位` : `已恢复“${workspace.name}”`, failures.length ? '工作区部分恢复' : '工作区');
}

function renderSelectionSummary() {
  const pane = activePane();
  if (!pane || !pane.selection.size) {
    elements.selectionSummary.textContent = '未选择文件';
    return;
  }
  const size = selectedSizeLabel(pane);
  elements.selectionSummary.textContent = `已选择 ${pane.selection.size} 项${size ? ` · ${size}` : ''}`;
}

function renderAll() {
  renderPanes();
  renderSidebar();
  renderSelectionSummary();
}

function renderAllWhenIdle() {
  if (state.pointerActive || state.drag || elements.panes.classList.contains('is-dragging')) {
    state.renderPending = true;
    return;
  }
  state.renderPending = false;
  renderAll();
}

function flushPendingRender() {
  if (!state.renderPending || state.pointerActive || state.drag || elements.panes.classList.contains('is-dragging')) return;
  state.renderPending = false;
  renderAll();
}

function syncPaneInteractionState() {
  elements.panes.querySelectorAll('.pane').forEach((paneElement) => {
    const paneIndex = Number(paneElement.dataset.pane);
    const pane = state.panes[paneIndex];
    paneElement.classList.toggle('active', paneIndex === state.activePane);
    paneElement.querySelectorAll('.file-row').forEach((row) => {
      const filePath = decodePath(row.dataset.path);
      row.classList.toggle('selected', pane.selection.has(filePath));
      row.classList.toggle('keyboard-focused', pane.keyboardFocusPath === filePath);
      row.classList.toggle('cut', state.clipboard?.mode === 'move' && state.clipboard.paths.includes(filePath));
      row.setAttribute('aria-selected', pane.selection.has(filePath) ? 'true' : 'false');
    });

    const status = paneElement.querySelector('.pane-status');
    if (status) {
      const selectedSize = selectedSizeLabel(pane);
      status.children[0].textContent = pane.selection.size ? `已选择 ${pane.selection.size} 项` : `${pane.entries.length} 个项目`;
      status.children[1].textContent = selectedSize || paneDisplayPath(pane);
    }
  });
  elements.globalSearch.value = activePane().virtualMode === 'search' ? activePane().searchQuery : activePane().filter;
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
  } else if (contextMenuUtils.isPrimaryModifier(event)) {
    if (pane.selection.has(path)) pane.selection.delete(path);
    else pane.selection.add(path);
    pane.anchorPath = path;
  } else {
    pane.selection.clear();
    pane.selection.add(path);
    pane.anchorPath = path;
  }
  pane.keyboardFocusPath = path;
  state.activePane = paneIndex;
  syncPaneInteractionState();
}

function paneEntry(pane, filePath) {
  return [...pane.entries, ...pane.columnEntries].find((entry) => entry.path === filePath);
}

function keyboardSequence(pane, filePath = pane.keyboardFocusPath) {
  if (pane.viewMode === 'column' && pane.columnEntries.some((entry) => entry.path === filePath)) {
    return pane.columnEntries;
  }
  return filteredEntries(pane);
}

function focusedSelectionPath(pane = activePane()) {
  if (!pane) return null;
  if (pane.keyboardFocusPath && paneEntry(pane, pane.keyboardFocusPath)) return pane.keyboardFocusPath;
  const selected = Array.from(pane.selection);
  return selected.findLast((filePath) => Boolean(paneEntry(pane, filePath))) || null;
}

function scrollKeyboardFocusIntoView(paneIndex, filePath) {
  requestAnimationFrame(() => {
    const row = elements.panes.querySelector(`.file-row[data-pane="${paneIndex}"][data-path="${CSS.escape(encodePath(filePath))}"]`);
    row?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  });
}

async function updateOpenQuickLook(filePath) {
  if (!state.quickLook?.open || !filePath) return;
  const token = ++state.quickLookToken;
  try {
    const result = await api.quickLook([filePath]);
    if (token === state.quickLookToken) state.quickLook = result;
  } catch (error) {
    if (token === state.quickLookToken) showToast(error.message || String(error), 'Quick Look 预览失败');
  }
}

function applyKeyboardSelection(paneIndex, filePath, event, sequence = keyboardSequence(state.panes[paneIndex], filePath)) {
  const pane = state.panes[paneIndex];
  const previousFocus = focusedSelectionPath(pane);
  const primary = contextMenuUtils.isPrimaryModifier(event);
  if (event.shiftKey) {
    const anchor = pane.anchorPath || previousFocus || filePath;
    const start = sequence.findIndex((entry) => entry.path === anchor);
    const end = sequence.findIndex((entry) => entry.path === filePath);
    if (start >= 0 && end >= 0) {
      pane.selection.clear();
      const [from, to] = start < end ? [start, end] : [end, start];
      sequence.slice(from, to + 1).forEach((entry) => pane.selection.add(entry.path));
      pane.anchorPath = anchor;
    } else {
      pane.selection.clear();
      pane.selection.add(filePath);
      pane.anchorPath = filePath;
    }
  } else if (!primary) {
    pane.selection.clear();
    pane.selection.add(filePath);
    pane.anchorPath = filePath;
  } else if (!pane.selection.size) {
    pane.selection.add(filePath);
    pane.anchorPath = filePath;
  }
  pane.keyboardFocusPath = filePath;
  state.activePane = paneIndex;
  syncPaneInteractionState();
  scrollKeyboardFocusIntoView(paneIndex, filePath);
  if (previousFocus !== filePath) void updateOpenQuickLook(filePath);
}

function geometricKeyboardTarget(paneIndex, currentPath, key, allowedPaths = null) {
  const paneElement = elements.panes.querySelector(`.pane[data-pane="${paneIndex}"]`);
  const items = Array.from(paneElement?.querySelectorAll('.file-row[data-path]') || [])
    .filter((element) => element.getClientRects().length)
    .map((element) => ({ element, path: decodePath(element.dataset.path), rect: element.getBoundingClientRect() }));
  const availableItems = allowedPaths ? items.filter((item) => allowedPaths.has(item.path)) : items;
  const current = availableItems.find((item) => item.path === currentPath);
  if (!current) return availableItems[0]?.path || null;
  const cx = current.rect.left + current.rect.width / 2;
  const cy = current.rect.top + current.rect.height / 2;
  let best = null;
  for (const candidate of availableItems) {
    if (candidate.element === current.element) continue;
    const x = candidate.rect.left + candidate.rect.width / 2;
    const y = candidate.rect.top + candidate.rect.height / 2;
    const dx = x - cx;
    const dy = y - cy;
    const valid = key === 'ArrowLeft' ? dx < -3 : key === 'ArrowRight' ? dx > 3 : key === 'ArrowUp' ? dy < -3 : dy > 3;
    if (!valid) continue;
    const primaryDistance = key === 'ArrowLeft' || key === 'ArrowRight' ? Math.abs(dx) : Math.abs(dy);
    const crossDistance = key === 'ArrowLeft' || key === 'ArrowRight' ? Math.abs(dy) : Math.abs(dx);
    const score = primaryDistance + crossDistance * 5;
    if (!best || score < best.score) best = { path: candidate.path, score };
  }
  return best?.path || currentPath;
}

async function expandColumnFolder(paneIndex, entry) {
  const pane = state.panes[paneIndex];
  if (!entry?.isDirectory || !pane.entries.some((item) => item.path === entry.path)) return pane.columnEntries;
  if (samePath(pane.columnPath, entry.path) && !pane.columnLoading) return pane.columnEntries;
  const token = ++pane.columnToken;
  pane.columnPath = entry.path;
  pane.columnLoading = true;
  renderPanes();
  try {
    const result = await api.listDirectory(entry.path, pane.showHidden);
    if (pane.columnToken !== token) return [];
    pane.columnEntries = result.entries.map(createColumnEntry);
    pane.columnLoading = false;
    renderPanes();
    await hydrateColumnEntries(paneIndex, entry.path, token);
  } catch (error) {
    if (pane.columnToken !== token) return [];
    pane.columnEntries = [];
    showToast(error.message || String(error), '无法展开文件夹');
  }
  pane.columnLoading = false;
  renderAllWhenIdle();
  return pane.columnEntries;
}

async function moveKeyboardSelection(event) {
  const paneIndex = state.activePane;
  const pane = activePane();
  if (!pane || pane.loading) return;
  const key = event.key;
  let currentPath = focusedSelectionPath(pane);
  let sequence = keyboardSequence(pane, currentPath);
  if (!sequence.length) return;

  if (!currentPath || !sequence.some((entry) => entry.path === currentPath)) {
    currentPath = sequence[key === 'ArrowUp' || key === 'ArrowLeft' ? sequence.length - 1 : 0].path;
    applyKeyboardSelection(paneIndex, currentPath, event, sequence);
    if (pane.viewMode === 'column') await expandColumnFolder(paneIndex, paneEntry(pane, currentPath));
    return;
  }

  if (pane.viewMode === 'column' && key === 'ArrowRight') {
    const currentEntry = paneEntry(pane, currentPath);
    const children = await expandColumnFolder(paneIndex, currentEntry);
    if (currentEntry?.isDirectory && children.length) applyKeyboardSelection(paneIndex, children[0].path, event, children);
    return;
  }
  if (pane.viewMode === 'column' && key === 'ArrowLeft') {
    if (pane.columnEntries.some((entry) => entry.path === currentPath) && pane.columnPath) {
      applyKeyboardSelection(paneIndex, pane.columnPath, event, filteredEntries(pane));
    }
    return;
  }

  let targetPath = currentPath;
  if (pane.viewMode === 'icon') {
    targetPath = geometricKeyboardTarget(paneIndex, currentPath, key);
  } else if (pane.viewMode === 'gallery') {
    const offset = key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1;
    const index = sequence.findIndex((entry) => entry.path === currentPath);
    targetPath = sequence[Math.max(0, Math.min(sequence.length - 1, index + offset))].path;
  } else if (key === 'ArrowUp' || key === 'ArrowDown') {
    const offset = key === 'ArrowUp' ? -1 : 1;
    const index = sequence.findIndex((entry) => entry.path === currentPath);
    targetPath = sequence[Math.max(0, Math.min(sequence.length - 1, index + offset))].path;
  } else {
    return;
  }

  applyKeyboardSelection(paneIndex, targetPath, event, sequence);
  if (pane.viewMode === 'column') await expandColumnFolder(paneIndex, paneEntry(pane, targetPath));
  if (pane.viewMode === 'gallery') renderPanes();
}

async function openKeyboardSelection() {
  const pane = activePane();
  const filePath = focusedSelectionPath(pane);
  const entry = paneEntry(pane, filePath);
  if (!entry) return showToast('请先选择要打开的项目');
  if (entry.isDirectory) return loadPane(state.activePane, entry.path);
  const error = await api.open(entry.path);
  if (error) showToast(error, '无法打开文件');
}

function isPhotoEntry(entry) {
  return Boolean(entry && !entry.isDirectory && PHOTO_EXTENSIONS.has(String(entry.extension || '').toLowerCase()));
}

function panePhotos(pane) {
  return keyboardSequence(pane).filter(isPhotoEntry);
}

function renderPhotoViewer(entry, loading = false) {
  const viewer = state.photoViewer;
  if (!viewer || !entry) return;
  const pane = state.panes[viewer.paneIndex];
  const photos = panePhotos(pane);
  const index = photos.findIndex((item) => item.path === entry.path);
  elements.photoViewerName.textContent = entry.name;
  elements.photoViewerCount.textContent = `${Math.max(0, index) + 1} / ${photos.length}`;
  if (loading) {
    elements.photoViewerMedia.innerHTML = `<div class="photo-viewer-loading">${icon('refresh')}<span>正在生成照片预览…</span></div>`;
  } else if (entry.previewUrl) {
    elements.photoViewerMedia.innerHTML = `<img src="${escapeHtml(entry.previewUrl)}" alt="${escapeHtml(entry.name)}">`;
  } else {
    elements.photoViewerMedia.innerHTML = `<div class="photo-viewer-loading"><span>${escapeHtml(previewErrorMessage(entry.previewError))}</span><button data-photo-open-system="${encodePath(entry.path)}">用系统应用打开</button></div>`;
  }
  elements.photoViewer.hidden = false;
}

async function showPhotoViewerEntry(paneIndex, entry) {
  if (!isPhotoEntry(entry)) return;
  const token = ++state.photoViewerToken;
  state.photoViewer = { open: true, paneIndex, path: entry.path };
  renderPhotoViewer(entry, entry.previewStatus !== 'ready');
  if (entry.previewStatus !== 'ready') {
    const result = await api.preview(entry.path).catch((error) => ({ error: error.message || 'UNAVAILABLE' }));
    if (token !== state.photoViewerToken || state.photoViewer?.path !== entry.path) return;
    const current = paneEntry(state.panes[paneIndex], entry.path) || entry;
    applyPreviewResult(current, result);
    entry = current;
  }
  if (token === state.photoViewerToken && state.photoViewer?.path === entry.path) renderPhotoViewer(entry);
}

function closePhotoViewer() {
  state.photoViewerToken += 1;
  state.photoViewer = null;
  elements.photoViewer.hidden = true;
  elements.photoViewerMedia.innerHTML = '';
}

async function movePhotoViewerSelection(event) {
  const viewer = state.photoViewer;
  if (!viewer?.open) return;
  const pane = state.panes[viewer.paneIndex];
  const photos = panePhotos(pane);
  if (!photos.length) return closePhotoViewer();
  const currentIndex = Math.max(0, photos.findIndex((entry) => entry.path === viewer.path));
  let targetPath = viewer.path;
  if (pane.viewMode === 'icon') {
    targetPath = geometricKeyboardTarget(viewer.paneIndex, viewer.path, event.key, new Set(photos.map((entry) => entry.path)));
  } else {
    const offset = event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1;
    targetPath = photos[Math.max(0, Math.min(photos.length - 1, currentIndex + offset))].path;
  }
  const entry = photos.find((item) => item.path === targetPath);
  if (!entry) return;
  applyKeyboardSelection(viewer.paneIndex, entry.path, { shiftKey: false, metaKey: false, ctrlKey: false }, photos);
  await showPhotoViewerEntry(viewer.paneIndex, entry);
}

function restorePaneScroll(paneIndex, scroll) {
  requestAnimationFrame(() => {
    const paneElement = elements.panes.querySelector(`.pane[data-pane="${paneIndex}"]`);
    const fileList = paneElement?.querySelector('.file-list');
    if (fileList) {
      fileList.scrollTop = scroll.top;
      fileList.scrollLeft = scroll.left;
    }
  });
}

async function toggleHiddenFiles() {
  const paneIndex = state.activePane;
  const pane = activePane();
  const fileList = elements.panes.querySelector(`.pane[data-pane="${paneIndex}"] .file-list`);
  const scroll = { top: fileList?.scrollTop || 0, left: fileList?.scrollLeft || 0 };
  pane.showHidden = !pane.showHidden;
  await loadPane(paneIndex, pane.path, { pushHistory: false, preserveInteraction: true, silent: true });
  if (pane.columnPath) await refreshColumnContents(paneIndex);
  restorePaneScroll(paneIndex, scroll);
  showToast(pane.showHidden ? '已显示隐藏文件' : '已隐藏点文件');
}

function selectedPaths() {
  return Array.from(activePane()?.selection || []);
}

async function copySelection(mode) {
  const paths = selectedPaths();
  if (!paths.length) return showToast('请先选择文件或文件夹');
  hideHoverPreview();
  state.clipboard = { paths, mode };
  syncPaneInteractionState();
  try {
    const systemClipboard = await api.writeFileClipboard(paths);
    const externalHint = systemClipboard?.written ? '，也可直接粘贴到微信或 Finder' : '';
    showToast(`${paths.length} 项已${mode === 'move' ? '剪切' : '复制'}${externalHint}`);
  } catch (error) {
    showToast(`已写入 EasyMove 剪贴板；${error.message || '系统剪贴板写入失败'}`, '系统复制失败');
  }
}

function selectAllEntries() {
  const pane = activePane();
  filteredEntries(pane).forEach((entry) => pane.selection.add(entry.path));
  syncPaneInteractionState();
}

async function startTransfer(paths, targetDirectory, mode) {
  if (!paths.length) return showToast('没有可传输的文件');
  if (state.operation) return showToast('当前已有传输任务，请等待完成');
  hideHoverPreview();
  try {
    const result = await api.transfer(paths, targetDirectory, mode);
    state.operation = { id: result.id, mode, paths, targetDirectory, targetPaneIndex: state.activePane };
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

async function pasteClipboard(targetDirectory) {
  if (!state.clipboard?.paths.length) return showToast('剪贴板中没有 EasyMove 文件');
  if (!targetDirectory && activePane().virtualMode) return showToast('当前是虚拟位置，请先打开目标文件夹');
  targetDirectory ||= activePane().path;
  await startTransfer(state.clipboard.paths, targetDirectory, state.clipboard.mode);
}

async function pasteClipboardAsMove() {
  if (!state.clipboard?.paths.length) return showToast('剪贴板中没有 EasyMove 文件');
  if (activePane().virtualMode) return showToast('当前是虚拟位置，请先打开一个目标文件夹');
  await startTransfer(state.clipboard.paths, activePane().path, 'move');
}

async function transferToOther(mode) {
  const paths = selectedPaths();
  if (!paths.length) return showToast('请先选择要传输的文件');
  const target = state.panes[otherPaneIndex()];
  if (target.virtualMode) return showToast('另一窗格正在显示虚拟位置，请先打开目标文件夹');
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
  if (pane.virtualMode) return null;
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
  if (activePane().virtualMode) return showToast('当前是虚拟位置，请先打开一个文件夹');
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
    await refreshPanesAfterRemoval(paths);
    if (result.success) showToast(`${paths.length} 项已移入${state.platform === 'win32' ? '回收站' : '废纸篓'}`);
    else showToast(result.errors.join('；'), '部分文件未能删除');
  } catch (error) {
    showToast(error.message || String(error), '删除失败');
  }
}

async function duplicateSelection() {
  const paths = selectedPaths();
  if (!paths.length) return showToast('请先选择要制作副本的项目');
  const parents = new Set(paths.map(parentPath));
  if (parents.size !== 1) return showToast('请选择同一文件夹内的项目', '无法制作副本');
  await startTransfer(paths, parentPath(paths[0]), 'copy');
}

async function revealNativeDestinations(paths, destinations, successMessage) {
  const resolved = destinations.filter(Boolean);
  if (!resolved.length) return;
  const operation = {
    mode: 'copy',
    paths,
    targetDirectory: parentPath(resolved[0]),
    targetPaneIndex: state.activePane
  };
  await refreshPanesAfterOperation(operation);
  revealOperationDestinations(operation, resolved);
  showToast(successMessage);
}

async function compressSelection() {
  const paths = selectedPaths();
  if (!paths.length) return showToast('请先选择要压缩的项目');
  try {
    const result = await api.compress(paths);
    await revealNativeDestinations(paths, [result.destination], '压缩文件已创建');
  } catch (error) {
    showToast(error.message || String(error), '压缩失败');
  }
}

async function addSelectionToBasket() {
  const paths = selectedPaths();
  if (!paths.length) return showToast('请先选择要放入临时文件篮的项目');
  try {
    const result = await api.addToFileBasket(paths);
    state.fileBasketCount = result.count;
    await Promise.all(state.panes.map((pane, index) => pane.virtualMode === 'basket' ? loadBasketPane(index, { pushHistory: false, preserveInteraction: true }) : null));
    renderSidebar();
    showToast(`${paths.length} 项已放入临时文件篮`);
  } catch (error) {
    showToast(error.message || String(error), '无法加入临时文件篮');
  }
}

async function removeSelectionFromBasket() {
  const pane = activePane();
  if (pane?.virtualMode !== 'basket') return;
  const entries = pane.entries.filter((entry) => pane.selection.has(entry.path));
  if (!entries.length) return showToast('请先选择要移出的项目');
  const result = await api.removeFromFileBasket(entries.map((entry) => entry.basketId || entry.path));
  state.fileBasketCount = result.count;
  await loadBasketPane(state.activePane, { pushHistory: false });
  showToast(`${entries.length} 项已从临时文件篮移除`);
}

function splitFileName(name, isDirectory) {
  if (isDirectory) return { stem: name, extension: '' };
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return { stem: name, extension: '' };
  return { stem: name.slice(0, dot), extension: name.slice(dot) };
}

function batchNameFor(entry, index) {
  const { stem, extension } = splitFileName(entry.name, entry.isDirectory);
  const value = elements.batchValue.value;
  if (elements.batchRule.value === 'prefix') return `${value}${stem}${extension}`;
  if (elements.batchRule.value === 'suffix') return `${stem}${value}${extension}`;
  if (elements.batchRule.value === 'replace') return `${stem.replaceAll(value, elements.batchReplacement.value)}${extension}`;
  if (elements.batchRule.value === 'number') {
    const start = Number.parseInt(value, 10) || 1;
    const width = Math.max(2, String(start + state.batchRenameTargets.length - 1).length);
    return `${String(start + index).padStart(width, '0')}_${stem}${extension}`;
  }
  const date = value.trim() || new Date().toISOString().slice(0, 10);
  return `${date}_${stem}${extension}`;
}

function updateBatchRenamePreview() {
  const changes = state.batchRenameTargets.map((entry, index) => ({ path: entry.path, name: batchNameFor(entry, index), original: entry.name }));
  const names = new Set();
  const errors = [];
  for (const change of changes) {
    const comparable = state.platform === 'win32' ? change.name.toLocaleLowerCase() : change.name;
    if (!change.name.trim() || /[\\/]/.test(change.name) || change.name === '.' || change.name === '..') errors.push(`${change.name || '空名称'}：名称无效`);
    if (names.has(comparable)) errors.push(`${change.name}：新名称重复`);
    names.add(comparable);
  }
  if (elements.batchRule.value === 'replace' && !elements.batchValue.value) errors.push('请输入要查找的文字');
  elements.batchPreview.innerHTML = changes.map((change) => `<div class="batch-preview-row${errors.some((error) => error.startsWith(`${change.name}：`)) ? ' invalid' : ''}"><span title="${escapeHtml(change.original)}">${escapeHtml(change.original)}</span><span>→</span><strong title="${escapeHtml(change.name)}">${escapeHtml(change.name)}</strong></div>`).join('');
  elements.batchError.hidden = errors.length === 0;
  elements.batchError.textContent = errors[0] || '';
  elements.batchRenameConfirm.disabled = errors.length > 0;
  return { changes, errors };
}

function openBatchRenameDialog() {
  const pane = activePane();
  const targets = pane.entries.filter((entry) => pane.selection.has(entry.path) && !entry.unavailable);
  if (targets.length < 2) return showToast('批量重命名至少选择两个项目');
  state.batchRenameTargets = targets;
  elements.batchRenameTitle.textContent = `批量重命名 ${targets.length} 个项目`;
  elements.batchRule.value = 'prefix';
  elements.batchValue.value = '';
  elements.batchReplacement.value = '';
  elements.batchRenameModal.hidden = false;
  updateBatchRuleFields();
  updateBatchRenamePreview();
  setTimeout(() => elements.batchValue.focus(), 20);
}

function updateBatchRuleFields() {
  const rule = elements.batchRule.value;
  const labels = { prefix: '前缀文字', suffix: '后缀文字', replace: '查找文字', number: '起始编号', date: '日期文字' };
  elements.batchValueLabel.textContent = labels[rule];
  elements.batchReplacementLabel.textContent = '替换为';
  elements.batchReplacement.disabled = rule !== 'replace';
  if (rule === 'number' && !/^\d+$/.test(elements.batchValue.value)) elements.batchValue.value = '1';
  if (rule === 'date' && !elements.batchValue.value) elements.batchValue.value = new Date().toISOString().slice(0, 10);
}

async function extractSelection(mode) {
  const paths = selectedPaths();
  if (paths.length !== 1) return showToast('请选择一个压缩包');
  try {
    const result = await api.extract(paths[0], mode);
    await revealNativeDestinations(paths, result.destinations || [], `已解压 ${result.destinations?.length || 0} 个项目`);
  } catch (error) {
    showToast(error.message || String(error), '解压失败');
  }
}

function openRenameDialog() {
  const paths = selectedPaths();
  if (paths.length > 1) return openBatchRenameDialog();
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

async function quickLookSelection() {
  if (state.photoViewer?.open) return closePhotoViewer();
  const pane = activePane();
  const focusPath = focusedSelectionPath(pane);
  const paths = [...new Set([focusPath, ...selectedPaths()].filter(Boolean))];
  if (!paths.length) return showToast('请先选择要预览的文件或文件夹');
  const entry = paneEntry(pane, focusPath);
  if (isPhotoEntry(entry)) return showPhotoViewerEntry(state.activePane, entry);
  const token = ++state.quickLookToken;
  try {
    const result = await api.quickLook(paths);
    if (token === state.quickLookToken) state.quickLook = result;
  } catch (error) {
    if (token === state.quickLookToken) showToast(error.message || String(error), 'Quick Look 预览失败');
  }
}

async function copySelectionPaths() {
  const paths = selectedPaths();
  if (!paths.length) return showToast('请先选择要拷贝路径的文件或文件夹');
  const result = await api.writeTextClipboard(paths.join('\n'));
  showToast(paths.length === 1 ? '已拷贝完整路径' : `已拷贝 ${paths.length} 条完整路径`, '路径');
  return result;
}

async function executeCommand(command, options = {}) {
  if (command === 'undo') return undoOperation();
  if (command === 'new-folder') return createFolder();
  if (command === 'copy') return copySelection('copy');
  if (command === 'cut') return copySelection('move');
  if (command === 'paste') return pasteClipboard(options.targetDirectory);
  if (command === 'paste-move') return pasteClipboardAsMove();
  if (command === 'select-all') return selectAllEntries();
  if (command === 'toggle-hidden') return toggleHiddenFiles();
  if (command === 'quick-look') return quickLookSelection();
  if (command === 'copy-path') return copySelectionPaths();
  if (command === 'rename') return openRenameDialog();
  if (command === 'batch-rename') return openBatchRenameDialog();
  if (command === 'trash') return trashSelection();
  if (command === 'duplicate') return duplicateSelection();
  if (command === 'compress') return compressSelection();
  if (command === 'extract-here') return extractSelection('here');
  if (command === 'extract-folder') return extractSelection('folder');
  if (command === 'basket-add') return addSelectionToBasket();
  if (command === 'basket-remove') return removeSelectionFromBasket();
  if (command === 'copy-other') return transferToOther('copy');
  if (command === 'move-other') return transferToOther('move');
}

async function showFileContextMenu(event) {
  const paneElement = event.target.closest('.pane');
  const fileList = event.target.closest('.file-list');
  if (!paneElement || !fileList) return;
  event.preventDefault();
  hideHoverPreview();

  const paneIndex = Number(paneElement.dataset.pane);
  const pane = state.panes[paneIndex];
  const row = event.target.closest('.file-row');
  let targetDirectory = pane.virtualMode ? state.locations.home : pane.path;

  if (row) {
    const filePath = decodePath(row.dataset.path);
    if (!pane.selection.has(filePath)) {
      selectRow(paneIndex, filePath, { shiftKey: false, metaKey: false, ctrlKey: false });
      closeSelectionPreview();
    } else {
      state.activePane = paneIndex;
      syncPaneInteractionState();
    }
    const entry = [...pane.entries, ...pane.columnEntries].find((item) => item.path === filePath);
    if (entry) targetDirectory = entry.isDirectory ? entry.path : parentPath(entry.path);
  } else {
    state.activePane = paneIndex;
    syncPaneInteractionState();
  }
  try {
    state.nativeContextMenu = null;
    state.nativeContextMenu = await api.showNativeContextMenu({
      itemContext: Boolean(row),
      paneIndex,
      paths: Array.from(pane.selection),
      currentDirectory: pane.virtualMode ? targetDirectory : pane.path,
      targetDirectory,
      canPaste: Boolean(state.clipboard?.paths.length) && !state.operation && (Boolean(row) || !pane.virtualMode),
      virtualContext: Boolean(pane.virtualMode),
      virtualMode: pane.virtualMode
    });
  } catch (error) {
    showToast(error.message || String(error), '无法打开系统菜单');
  }
}

async function showPhotoContextMenu(event) {
  const viewer = state.photoViewer;
  if (!viewer?.open) return;
  event.preventDefault();
  event.stopPropagation();
  hideHoverPreview();

  const pane = state.panes[viewer.paneIndex];
  const entry = paneEntry(pane, viewer.path);
  if (!entry || entry.isDirectory) return;
  state.activePane = viewer.paneIndex;
  pane.selection = new Set([entry.path]);
  pane.anchorPath = entry.path;
  pane.keyboardFocusPath = entry.path;
  syncPaneInteractionState();

  const targetDirectory = parentPath(entry.path);
  try {
    state.nativeContextMenu = null;
    state.nativeContextMenu = await api.showNativeContextMenu({
      itemContext: true,
      paneIndex: viewer.paneIndex,
      paths: [entry.path],
      currentDirectory: pane.virtualMode ? targetDirectory : pane.path,
      targetDirectory,
      canPaste: Boolean(state.clipboard?.paths.length) && !state.operation,
      virtualContext: Boolean(pane.virtualMode),
      virtualMode: pane.virtualMode
    });
  } catch (error) {
    showToast(error.message || String(error), '无法打开照片菜单');
  }
}

elements.panes.addEventListener('mousedown', (event) => {
  state.pointerActive = true;
  const paneElement = event.target.closest('.pane');
  if (!paneElement) return;
  const index = Number(paneElement.dataset.pane);
  if (index === state.activePane) return;
  state.activePane = index;
  elements.globalSearch.value = activePane().virtualMode === 'search' ? activePane().searchQuery : activePane().filter;
  elements.panes.querySelectorAll('.pane').forEach((pane) => pane.classList.toggle('active', Number(pane.dataset.pane) === index));
  renderSidebar();
  renderSelectionSummary();
});

window.addEventListener('mouseup', () => {
  state.pointerActive = false;
  requestAnimationFrame(flushPendingRender);
}, true);

window.addEventListener('blur', () => {
  state.pointerActive = false;
  flushPendingRender();
});

elements.panes.addEventListener('contextmenu', showFileContextMenu);
elements.photoViewer.addEventListener('contextmenu', showPhotoContextMenu);

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
  hideHoverPreview();
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
  flushPendingRender();
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
  flushPendingRender();
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

elements.panes.addEventListener('click', async (event) => {
  hideHoverPreview();
  const clearBasketButton = event.target.closest('[data-basket-clear]');
  if (clearBasketButton && !clearBasketButton.disabled) {
    try {
      const result = await api.clearFileBasket();
      state.fileBasketCount = result.count;
      await loadBasketPane(state.activePane, { pushHistory: false, preserveInteraction: true });
      showToast('已清空临时文件篮，原文件没有被删除', '临时文件篮');
    } catch (error) {
      showToast(error.message || String(error), '无法清空文件篮');
    }
    return;
  }
  if (event.target.closest('[data-index-settings]')) {
    renderContentIndexStatus();
    elements.indexModal.hidden = false;
    return;
  }
  const viewButton = event.target.closest('[data-view-mode]');
  if (viewButton) {
    const pane = state.panes[Number(viewButton.dataset.pane)];
    pane.viewMode = viewButton.dataset.viewMode;
    localStorage.setItem(`easymove-pane-${pane.id}-view`, pane.viewMode);
    renderPanes();
    if (pane.viewMode === 'gallery') {
      const entry = filteredEntries(pane).find((item) => pane.selection.has(item.path)) || filteredEntries(pane)[0];
      if (entry) {
        await Promise.all([ensureEntryPreview(entry), ensureEntrySize(entry)]);
        if (pane.viewMode === 'gallery') renderPanes();
      }
    }
    return;
  }
  const openButton = event.target.closest('[data-open-path]');
  if (openButton) { await api.open(decodePath(openButton.dataset.openPath)); return; }
  const retryButton = event.target.closest('[data-retry-preview]');
  if (retryButton) {
    const filePath = decodePath(retryButton.dataset.retryPreview);
    const pane = state.panes.find((item) => item.entries.some((entry) => entry.path === filePath));
    const entry = pane?.entries.find((item) => item.path === filePath);
    if (entry) Object.assign(entry, await api.preview(filePath));
    renderAll();
    return;
  }
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
    const paneIndex = Number(row.dataset.pane);
    const rowPath = decodePath(row.dataset.path);
    const candidate = state.activationCandidate;
    const reuseCandidate = event.detail > 1
      && candidate?.paneIndex === paneIndex
      && Date.now() - candidate.createdAt < 900;
    const filePath = reuseCandidate ? candidate.path : rowPath;
    if (!reuseCandidate) state.activationCandidate = { paneIndex, path: rowPath, createdAt: Date.now() };
    const pane = state.panes[paneIndex];
    selectRow(paneIndex, filePath, event);
    const entry = [...pane.entries, ...pane.columnEntries].find((item) => item.path === filePath);
    if (event.detail === 1 && entry) scheduleClickPreview(row, paneIndex, filePath);
    if (state.selectionPreview) closeSelectionPreview();
    if (pane.viewMode === 'column' && entry?.isDirectory) await expandColumnFolder(paneIndex, entry);
    else if (pane.viewMode === 'gallery') {
      renderPanes();
      if (entry) {
        await Promise.all([ensureEntryPreview(entry), ensureEntrySize(entry)]);
        if (pane.viewMode === 'gallery' && pane.selection.has(filePath)) renderPanes();
      }
    }
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
  if (action.dataset.paneAction === 'up') loadPane(index, pane.virtualMode ? state.locations.home : parentPath(pane.path));
  if (action.dataset.paneAction === 'refresh') {
    if (pane.virtualMode === 'search') loadSearchPane(index, pane.searchQuery, { pushHistory: false });
    else loadPane(index, pane.virtualMode === 'recent' ? RECENT_PATH : pane.virtualMode === 'basket' ? BASKET_PATH : pane.path, { pushHistory: false, preserveInteraction: true });
  }
});

function hideHoverPreview() {
  clearTimeout(state.hoverTimer);
  state.hoverToken += 1;
  elements.hoverPreview.hidden = true;
}

function scheduleClickPreview(row, paneIndex, entryPath) {
  const pane = state.panes[paneIndex];
  const entry = [...pane.entries, ...pane.columnEntries].find((item) => item.path === entryPath);
  if (!entry) return;
  const currentRow = () => row.isConnected
    ? row
    : elements.panes.querySelector(`.file-row[data-pane="${paneIndex}"][data-path="${encodePath(entryPath)}"]`);
  clearTimeout(state.hoverTimer);
  const token = ++state.hoverToken;
  elements.hoverPreview.hidden = true;
  state.hoverTimer = setTimeout(async () => {
    let activeRow = currentRow();
    if (token !== state.hoverToken || !activeRow) return;
    let slowTimer;
    const needsPreview = entry.previewStatus !== 'ready';
    const needsSize = entry.isDirectory && !['ready', 'unavailable'].includes(entry.folderSizeStatus);
    if (needsPreview || needsSize) {
      slowTimer = setTimeout(() => {
        const pendingRow = currentRow();
        if (token !== state.hoverToken || !pendingRow) return;
        elements.hoverPreview.innerHTML = `<div class="preview-fallback"><strong>正在核对文件夹数据…</strong><span>读取内容预览与真实占用大小</span></div><strong>${escapeHtml(entry.name)}</strong>`;
        elements.hoverPreview.hidden = false;
        const rect = pendingRow.getBoundingClientRect();
        const box = elements.hoverPreview.getBoundingClientRect();
        elements.hoverPreview.style.left = `${Math.max(12, Math.min(window.innerWidth - box.width - 12, rect.right + 10))}px`;
        elements.hoverPreview.style.top = `${Math.max(12, Math.min(window.innerHeight - box.height - 12, rect.top - 16))}px`;
      }, 2000);
      await Promise.all([ensureEntryPreview(entry), ensureEntrySize(entry)]);
      clearTimeout(slowTimer);
    }
    activeRow = currentRow();
    if (token !== state.hoverToken || !activeRow) return;
    const previewIcon = activeRow.querySelector('[data-preview-icon]');
    if (previewIcon && entry.previewUrl) previewIcon.innerHTML = `<img src="${escapeHtml(entry.previewUrl)}" alt="">`;
    previewIcon?.classList.toggle('folder-cover', Boolean(entry.folderCover));
    const media = previewMediaMarkup(entry, 'hover');
    const children = entry.isDirectory && entry.previewChildren?.length ? `<div class="preview-children">${entry.previewChildren.map(escapeHtml).join(' · ')}</div>` : '';
    elements.hoverPreview.innerHTML = `${media}<strong>${escapeHtml(entry.name)}</strong><span>${escapeHtml(entry.kind)} · ${escapeHtml(formatDate(entry.modified))} · ${escapeHtml(formatEntrySize(entry))}</span>${children}`;
    elements.hoverPreview.hidden = false;
    const rect = activeRow.getBoundingClientRect();
    const box = elements.hoverPreview.getBoundingClientRect();
    const left = Math.max(12, Math.min(window.innerWidth - box.width - 12, rect.right + 10));
    const top = Math.max(12, Math.min(window.innerHeight - box.height - 12, rect.top - 16));
    elements.hoverPreview.style.left = `${left}px`;
    elements.hoverPreview.style.top = `${top}px`;
  }, CLICK_PREVIEW_DELAY_MS);
}

elements.panes.addEventListener('mouseout', (event) => {
  const row = event.target.closest('.file-row');
  if (row && !row.contains(event.relatedTarget)) hideHoverPreview();
});

elements.panes.addEventListener('scroll', hideHoverPreview, true);

elements.panes.addEventListener('dblclick', async (event) => {
  const row = event.target.closest('.file-row');
  if (!row) return;
  const paneIndex = Number(row.dataset.pane);
  const rowPath = decodePath(row.dataset.path);
  const candidate = state.activationCandidate;
  const filePath = candidate?.paneIndex === paneIndex && Date.now() - candidate.createdAt < 900
    ? candidate.path
    : rowPath;
  state.activationCandidate = null;
  const pane = state.panes[paneIndex];
  const entry = [...pane.entries, ...pane.columnEntries].find((item) => item.path === filePath);
  if (!entry) return;
  if (entry.isDirectory) await loadPane(paneIndex, entry.path);
  else {
    const error = await api.open(entry.path);
    if (error) showToast(error, '无法打开文件');
  }
});

elements.selectionPreview.addEventListener('click', async (event) => {
  if (event.target.closest('[data-preview-close]')) return closeSelectionPreview();
  const openButton = event.target.closest('[data-preview-open]');
  if (openButton) {
    const filePath = decodePath(openButton.dataset.previewOpen);
    if (openButton.dataset.previewDirectory === 'true') await loadPane(Number(openButton.dataset.previewPane), filePath);
    else {
      const error = await api.open(filePath);
      if (error) showToast(error, '无法打开文件');
    }
    return;
  }
  const retryButton = event.target.closest('[data-preview-retry]');
  if (!retryButton || !state.selectionPreview) return;
  const pane = state.panes[state.selectionPreview.paneIndex];
  const entry = [...pane.entries, ...pane.columnEntries].find((item) => item.path === decodePath(retryButton.dataset.previewRetry));
  if (!entry) return;
  entry.previewStatus = 'idle';
  entry.previewError = null;
  await showSelectionPreview(state.selectionPreview.paneIndex, entry);
});

elements.panes.addEventListener('keydown', (event) => {
  const input = event.target.closest('.path-input');
  if (input && event.key === 'Enter' && !input.readOnly) {
    event.preventDefault();
    event.stopPropagation();
    const paneIndex = Number(input.dataset.pane);
    const pane = state.panes[paneIndex];
    const value = input.value.trim();
    if (pane.virtualMode === 'search' || !looksLikeFilesystemPath(value)) {
      elements.globalSearch.value = value;
      pane.filter = '';
      loadSearchPane(paneIndex, value);
    } else {
      void navigateToFilesystemPath(paneIndex, value);
    }
  }
});

elements.panes.addEventListener('paste', (event) => {
  const input = event.target.closest('.path-input');
  if (!input || input.readOnly) return;
  const value = normalizeFilesystemPathInput(event.clipboardData?.getData('text/plain'));
  if (!looksLikeFilesystemPath(value)) return;
  event.preventDefault();
  event.stopPropagation();
  input.value = value;
  const paneIndex = Number(input.dataset.pane);
  state.panes[paneIndex].filter = '';
  void navigateToFilesystemPath(paneIndex, value);
});

elements.panes.addEventListener('input', (event) => {
  const input = event.target.closest('.path-input.search-input');
  if (!input) return;
  elements.globalSearch.value = input.value;
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
  const workspaceButton = event.target.closest('[data-workspaces]');
  if (workspaceButton) {
    renderWorkspacePanel();
    elements.workspacePanel.hidden = false;
    return;
  }
  if (event.target.closest('[data-global-search]')) {
    const query = elements.globalSearch.value.trim();
    activePane().filter = '';
    const focusSearchInput = () => {
      const input = elements.panes.querySelector(`.path-input.search-input[data-pane="${state.activePane}"]`);
      input?.focus();
      input?.select();
    };
    const searchLoad = loadSearchPane(state.activePane, query);
    focusSearchInput();
    void searchLoad.finally(focusSearchInput);
    return;
  }
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

elements.saveWorkspaceButton.addEventListener('click', () => {
  const current = state.workspaces.find((workspace) => workspace.id === state.currentWorkspaceId);
  elements.workspaceNameInput.value = current?.name || '';
  elements.workspaceModal.hidden = false;
  setTimeout(() => elements.workspaceNameInput.focus(), 20);
});

elements.workspaceForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  try {
    const name = elements.workspaceNameInput.value.trim();
    const result = await api.saveWorkspace(captureWorkspace(name, state.currentWorkspaceId));
    state.workspaces = result.workspaces;
    state.currentWorkspaceId = result.workspace.id;
    elements.workspaceModal.hidden = true;
    renderSidebar();
    renderWorkspacePanel();
    showToast(`“${result.workspace.name}”已保存当前布局`, '工作区已保存');
  } catch (error) {
    showToast(error.message || String(error), '保存工作区失败');
  }
});

document.getElementById('workspaceCancel').addEventListener('click', () => { elements.workspaceModal.hidden = true; });
elements.closeWorkspacePanel.addEventListener('click', () => { elements.workspacePanel.hidden = true; });
elements.workspaceList.addEventListener('click', async (event) => {
  const openButton = event.target.closest('[data-workspace-open]');
  if (openButton) {
    const workspace = state.workspaces.find((item) => item.id === openButton.dataset.workspaceOpen);
    if (workspace) await restoreWorkspace(workspace);
    return;
  }
  const deleteButton = event.target.closest('[data-workspace-delete]');
  if (!deleteButton) return;
  const result = await api.removeWorkspace(deleteButton.dataset.workspaceDelete);
  state.workspaces = result.workspaces;
  if (state.currentWorkspaceId === deleteButton.dataset.workspaceDelete) state.currentWorkspaceId = null;
  renderSidebar();
  renderWorkspacePanel();
});

elements.globalSearch.addEventListener('input', () => {
  if (activePane().virtualMode === 'search') {
    const input = elements.panes.querySelector(`.path-input.search-input[data-pane="${state.activePane}"]`);
    if (input && input !== document.activeElement) input.value = elements.globalSearch.value;
    return;
  }
  activePane().filter = elements.globalSearch.value;
  renderPanes();
});
elements.globalSearch.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  event.stopPropagation();
  const value = elements.globalSearch.value.trim();
  if (looksLikeFilesystemPath(value)) {
    activePane().filter = '';
    void navigateToFilesystemPath(state.activePane, value);
  } else if (value) {
    activePane().filter = '';
    loadSearchPane(state.activePane, value);
  }
});

elements.globalSearch.addEventListener('paste', (event) => {
  const value = normalizeFilesystemPathInput(event.clipboardData?.getData('text/plain'));
  if (!looksLikeFilesystemPath(value)) return;
  event.preventDefault();
  event.stopPropagation();
  elements.globalSearch.value = value;
  activePane().filter = '';
  void navigateToFilesystemPath(state.activePane, value);
});

document.getElementById('indexDone').addEventListener('click', () => { elements.indexModal.hidden = true; });
document.getElementById('indexAddRoot').addEventListener('click', async () => {
  state.contentIndex = await api.addContentIndexRoot();
  renderContentIndexStatus();
});
document.getElementById('indexRebuild').addEventListener('click', async () => {
  state.contentIndex = await api.controlContentIndex('rebuild');
  renderContentIndexStatus();
});
document.getElementById('indexClear').addEventListener('click', async () => {
  state.contentIndex = await api.controlContentIndex('clear');
  renderContentIndexStatus();
  state.panes.filter((pane) => pane.virtualMode === 'search').forEach((pane) => { pane.entries = []; });
  renderPanes();
});
elements.indexPause.addEventListener('click', async () => {
  state.contentIndex = await api.controlContentIndex(state.contentIndex.phase === 'paused' ? 'resume' : 'pause');
  renderContentIndexStatus();
});
elements.indexRootList.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-index-remove-root]');
  if (!button) return;
  state.contentIndex = await api.removeContentIndexRoot(decodePath(button.dataset.indexRemoveRoot));
  renderContentIndexStatus();
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

elements.batchRule.addEventListener('change', () => { updateBatchRuleFields(); updateBatchRenamePreview(); });
elements.batchValue.addEventListener('input', updateBatchRenamePreview);
elements.batchReplacement.addEventListener('input', updateBatchRenamePreview);
document.getElementById('batchRenameCancel').addEventListener('click', () => {
  elements.batchRenameModal.hidden = true;
  state.batchRenameTargets = [];
});
elements.batchRenameForm.addEventListener('submit', async (event) => {
  event.preventDefault();
  const { changes, errors } = updateBatchRenamePreview();
  if (errors.length) return;
  const sourcePaths = changes.map((change) => change.path);
  try {
    const result = await api.batchRename(changes);
    const operation = { mode: 'move', paths: sourcePaths, targetDirectory: parentPath(result.destinations[0]), targetPaneIndex: state.activePane };
    elements.batchRenameModal.hidden = true;
    state.batchRenameTargets = [];
    await refreshPanesAfterOperation(operation);
    revealOperationDestinations(operation, result.destinations);
    showToast(`${result.destinations.length} 个项目已重命名，可使用 ⌘Z / Ctrl+Z 撤销`, '批量重命名完成');
  } catch (error) {
    elements.batchError.hidden = false;
    elements.batchError.textContent = error.message || String(error);
  }
});

elements.transferBar.addEventListener('click', (event) => {
  if (event.target.closest('.transfer-actions')) return;
  renderOperationHistory();
  elements.operationHistoryPanel.hidden = false;
});

elements.closeOperationHistory.addEventListener('click', () => {
  elements.operationHistoryPanel.hidden = true;
});

elements.operationHistoryList.addEventListener('click', (event) => {
  const button = event.target.closest('[data-history-action]');
  if (!button || button.disabled) return;
  if (button.dataset.historyAction === 'undo') undoOperation(button.dataset.historyId);
  if (button.dataset.historyAction === 'retry') retryOperation(button.dataset.historyId);
  if (button.dataset.historyAction === 'resume-task') {
    const task = state.transferTasks.find((item) => item.id === button.dataset.taskId);
    if (!task || state.operation) return showToast('当前已有传输任务，请等待完成');
    api.resumeTransferTask(task.id).then(() => {
      state.operation = { id: task.id, mode: task.mode, paths: task.sources, targetDirectory: task.targetDirectory, targetPaneIndex: state.activePane };
      state.paused = false;
      elements.transferBar.classList.add('busy');
      elements.pauseTransfer.disabled = false;
      elements.cancelTransfer.disabled = false;
      elements.transferTitle.textContent = '正在恢复传输';
      elements.transferDetail.textContent = `${task.sources.length} 项 → ${task.targetDirectory}`;
      elements.operationHistoryPanel.hidden = true;
    }).catch((error) => showToast(error.message || String(error), '无法恢复传输'));
  }
  if (button.dataset.historyAction === 'remove-task') {
    api.removeTransferTask(button.dataset.taskId).then((tasks) => {
      state.transferTasks = tasks;
      renderOperationHistory();
    }).catch((error) => showToast(error.message || String(error), '无法移除队列记录'));
  }
});

elements.conflictModal.addEventListener('click', async (event) => {
  const button = event.target.closest('[data-conflict-action]');
  if (!button || !state.operationConflict) return;
  const conflict = state.operationConflict;
  state.operationConflict = null;
  elements.conflictModal.hidden = true;
  await api.resolveConflict({
    operationId: conflict.operationId,
    conflictId: conflict.conflictId,
    action: button.dataset.conflictAction,
    applyAll: elements.conflictApplyAll.checked
  });
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

api.onOperationConflict((conflict) => {
  state.operationConflict = conflict;
  elements.conflictApplyAll.checked = false;
  elements.conflictDescription.textContent = `“${conflict.source.name}”已存在于目标位置，请选择处理方式。`;
  const describe = (item, label) => `<div class="conflict-item"><strong>${escapeHtml(label)}：${escapeHtml(item.name)}</strong><span>${item.isDirectory ? '文件夹' : formatSize(item.size || 0)} · ${item.modified ? formatDate(item.modified) : '时间未知'}</span></div>`;
  elements.conflictComparison.innerHTML = `${describe(conflict.destination, '现有')}${describe(conflict.source, '传入')}`;
  elements.conflictModal.hidden = false;
});

api.onHistoryChanged((entries) => {
  state.operationHistory = Array.isArray(entries) ? entries : [];
  renderOperationHistory();
});

api.onTransferTasksChanged((tasks) => {
  state.transferTasks = Array.isArray(tasks) ? tasks : [];
  renderOperationHistory();
});

api.onVolumesChanged((volumes) => {
  state.volumes = Array.isArray(volumes) ? volumes : [];
  state.volumeRenderKey = '';
  renderSidebar();
});

api.onContentIndexStatus((indexStatus) => {
  state.contentIndex = indexStatus || state.contentIndex;
  if (!elements.indexModal.hidden) renderContentIndexStatus();
  else updateContentIndexSidebarStatus();
  state.panes.forEach((pane, index) => {
    if (pane.virtualMode === 'search' && pane.loading && indexStatus.phase === 'ready') void loadSearchPane(index, pane.searchQuery, { pushHistory: false });
  });
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
  await refreshPanesAfterOperation(operation);
  const destinations = Array.isArray(result.destinations) ? result.destinations : [];
  const revealed = revealOperationDestinations(operation, destinations);
  if (revealed) elements.transferDetail.textContent = `${destinations.length} 项已完成，已在目标窗格中选中`;
  showToast(result.success ? '文件传输已完成' : (result.cancelled ? '传输已取消' : elements.transferDetail.textContent), result.success ? '完成' : 'EasyMove');
});

elements.photoViewer.addEventListener('click', async (event) => {
  if (event.target.closest('[data-photo-close]')) return closePhotoViewer();
  const direction = event.target.closest('[data-photo-direction]');
  if (direction) return movePhotoViewerSelection({ key: direction.dataset.photoDirection });
  const openButton = event.target.closest('[data-photo-open-system]');
  if (openButton) {
    const error = await api.open(decodePath(openButton.dataset.photoOpenSystem));
    if (error) showToast(error, '无法打开照片');
  }
});

document.addEventListener('keydown', (event) => {
  if (event.defaultPrevented) return;
  const modifier = contextMenuUtils.isPrimaryModifier(event);
  const editing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName);
  if (event.key === 'Escape' && !elements.conflictModal.hidden) {
    event.preventDefault();
    elements.conflictModal.querySelector('[data-conflict-action="cancel"]')?.click();
    return;
  }
  if (state.photoViewer?.open) {
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) && !event.altKey && !modifier) {
      event.preventDefault();
      void movePhotoViewerSelection(event);
      return;
    }
    if (event.key === 'Escape' || event.key === ' ' || event.key === 'Spacebar') {
      event.preventDefault();
      closePhotoViewer();
      return;
    }
  }
  if (modifier && event.key.toLowerCase() === 'k') {
    event.preventDefault();
    elements.globalSearch.focus();
    elements.globalSearch.select();
    return;
  }
  if (editing) {
    if (event.key === 'Escape') {
      closeRenameDialog();
    }
    return;
  }
  if (event.isComposing) return;
  if (!event.repeat && state.platform === 'darwin' && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === 'ArrowDown') {
    event.preventDefault();
    void openKeyboardSelection();
    return;
  }
  if (!event.repeat && state.platform === 'darwin' && event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey && event.key === 'ArrowUp') {
    event.preventDefault();
    void loadPane(state.activePane, activePane().virtualMode ? state.locations.home : parentPath(activePane().path));
    return;
  }
  if (!event.repeat && state.platform === 'win32' && event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === 'ArrowUp') {
    event.preventDefault();
    void loadPane(state.activePane, activePane().virtualMode ? state.locations.home : parentPath(activePane().path));
    return;
  }
  if (!event.repeat && state.platform === 'win32' && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.key === 'Enter') {
    event.preventDefault();
    void openKeyboardSelection();
    return;
  }
  if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(event.key) && !event.altKey) {
    event.preventDefault();
    void moveKeyboardSelection(event);
    return;
  }
  const command = contextMenuUtils.commandForShortcut(event, state.platform);
  if (command) {
    event.preventDefault();
    executeCommand(command);
    return;
  }
  if (event.key === 'Escape') {
    closeRenameDialog();
  }
});

function applyToolbarShortcutHints() {
  document.querySelectorAll('.content-toolbar [data-command]').forEach((button) => {
    const command = button.dataset.command;
    const shortcut = contextMenuUtils.shortcutForCommand(command, state.platform);
    if (!shortcut) return;
    const label = button.querySelector('span')?.textContent?.trim() || command;
    button.title = `${label}（${shortcut}）`;
    button.setAttribute('aria-keyshortcuts', contextMenuUtils.ariaShortcutForCommand(command, state.platform));
  });
}

api.onMenuCommand((command) => {
  const editing = ['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName) || document.activeElement?.isContentEditable;
  if (editing) {
    if (['copy', 'cut', 'paste', 'select-all'].includes(command)) api.nativeEdit(command);
    return;
  }
  executeCommand(command);
});

api.onNativeContextMenuCommand((payload) => {
  if (!payload || !Number.isInteger(payload.paneIndex)) return;
  state.activePane = payload.paneIndex;
  syncPaneInteractionState();
  if (state.photoViewer?.open && ['rename', 'batch-rename', 'trash', 'duplicate', 'compress', 'extract-here', 'extract-folder'].includes(payload.command)) {
    closePhotoViewer();
  }
  executeCommand(payload.command, { targetDirectory: payload.targetDirectory });
});

api.onNativeContextMenuError((payload) => {
  showToast(payload?.message || '系统操作失败', 'macOS 系统菜单');
});

api.onNativeContextMenuNotice((payload) => {
  showToast(payload?.message || '已交给百度网盘上传队列', '百度网盘');
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
    elements.appVersion.textContent = initial.version || '';
    state.platform = initial.platform;
    state.locations = initial.locations;
    state.volumes = initial.volumes;
    state.operationHistory = initial.operationHistory || [];
    state.transferTasks = initial.transferTasks || [];
    state.fileBasketCount = Number(initial.fileBasketCount || 0);
    state.workspaces = initial.workspaces || [];
    state.contentIndex = initial.contentIndex || { phase: 'idle', roots: [] };
    updateCustomTheme(initial.customTheme || null);
    document.body.classList.add(`platform-${state.platform}`);
    applyToolbarShortcutHints();
    const savedTheme = localStorage.getItem('easymove-theme');
    const usableTheme = savedTheme === 'theme-custom' && !state.customTheme?.url ? 'theme-blue-mist' : savedTheme;
    if (usableTheme && themeNames[usableTheme]) applyTheme(usableTheme, false);
    state.panes = [
      makePane(0, localStorage.getItem('easymove-pane-0-path') || state.locations.home),
      makePane(1, localStorage.getItem('easymove-pane-1-path') || state.locations.downloads),
      makePane(2, localStorage.getItem('easymove-pane-2-path') || state.locations.desktop),
      makePane(3, localStorage.getItem('easymove-pane-3-path') || state.locations.documents)
    ];
    elements.pauseTransfer.disabled = true;
    elements.cancelTransfer.disabled = true;
    renderAll();
    renderOperationHistory();
    renderWorkspacePanel();
    renderContentIndexStatus();
    await Promise.all(state.panes.map((pane, index) => loadPane(index, pane.path, { pushHistory: false })));
  } catch (error) {
    showToast(error.message || String(error), 'EasyMove 启动失败');
  }
}

initialize();
