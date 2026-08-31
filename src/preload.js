const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('easyMove', {
  initialState: () => ipcRenderer.invoke('app:initial-state'),
  volumes: () => ipcRenderer.invoke('fs:volumes'),
  chooseCustomTheme: () => ipcRenderer.invoke('theme:choose-custom'),
  chooseFolder: () => ipcRenderer.invoke('dialog:choose-folder'),
  listDirectory: (path, showHidden = false) => ipcRenderer.invoke('fs:list', { path, showHidden }),
  resolvePath: (path) => ipcRenderer.invoke('fs:resolve-path', path),
  recentItems: (showHidden = false) => ipcRenderer.invoke('fs:recent', { showHidden }),
  folderSizes: (paths) => ipcRenderer.invoke('fs:folder-sizes', paths),
  preview: (path) => ipcRenderer.invoke('fs:preview', path),
  writeFileClipboard: (paths) => ipcRenderer.invoke('clipboard:write-files', paths),
  writeTextClipboard: (text) => ipcRenderer.invoke('clipboard:write-text', text),
  quickLook: (paths) => ipcRenderer.invoke('fs:quick-look', paths),
  createFolder: (path) => ipcRenderer.invoke('fs:create-folder', path),
  rename: (path, name) => ipcRenderer.invoke('fs:rename', { path, name }),
  batchRename: (changes) => ipcRenderer.invoke('fs:batch-rename', { changes }),
  trash: (paths) => ipcRenderer.invoke('fs:trash', paths),
  compress: (paths) => ipcRenderer.invoke('fs:compress', paths),
  extract: (path, mode) => ipcRenderer.invoke('fs:extract', { path, mode }),
  fileBasket: () => ipcRenderer.invoke('basket:list'),
  addToFileBasket: (paths) => ipcRenderer.invoke('basket:add', paths),
  removeFromFileBasket: (idsOrPaths) => ipcRenderer.invoke('basket:remove', idsOrPaths),
  clearFileBasket: () => ipcRenderer.invoke('basket:clear'),
  workspaces: () => ipcRenderer.invoke('workspace:list'),
  saveWorkspace: (workspace) => ipcRenderer.invoke('workspace:save', workspace),
  removeWorkspace: (id) => ipcRenderer.invoke('workspace:remove', id),
  contentIndexStatus: () => ipcRenderer.invoke('index:status'),
  searchContentIndex: (query, limit = 300) => ipcRenderer.invoke('index:search', { query, limit }),
  controlContentIndex: (action) => ipcRenderer.invoke('index:control', action),
  addContentIndexRoot: () => ipcRenderer.invoke('index:add-root'),
  removeContentIndexRoot: (root) => ipcRenderer.invoke('index:remove-root', root),
  setContentIndexRoots: (roots) => ipcRenderer.invoke('index:set-roots', roots),
  open: (path) => ipcRenderer.invoke('fs:open', path),
  reveal: (path) => ipcRenderer.invoke('fs:reveal', path),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  defaultDragMode: (sources, targetDirectory) => ipcRenderer.invoke('fs:drag-default-mode', { sources, targetDirectory }),
  startNativeDrag: (paths) => ipcRenderer.send('drag:start-native', paths),
  nativeEdit: (command) => ipcRenderer.send('app:native-edit', command),
  showNativeContextMenu: (context) => ipcRenderer.invoke('context-menu:show', context),
  transfer: (sources, targetDirectory, mode) => ipcRenderer.invoke('fs:transfer', { sources, targetDirectory, mode }),
  transferTasks: () => ipcRenderer.invoke('transfer:list'),
  resumeTransferTask: (id) => ipcRenderer.invoke('transfer:resume-task', id),
  removeTransferTask: (id) => ipcRenderer.invoke('transfer:remove-task', id),
  controlOperation: (id, action) => ipcRenderer.invoke('operation:control', { id, action }),
  resolveConflict: (request) => ipcRenderer.invoke('operation:resolve-conflict', request),
  operationHistory: () => ipcRenderer.invoke('history:list'),
  undoOperation: (id) => ipcRenderer.invoke('history:undo', id),
  retryOperation: (id) => ipcRenderer.invoke('history:retry', id),
  onOperationProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('operation:progress', listener);
    return () => ipcRenderer.removeListener('operation:progress', listener);
  },
  onTransferTasksChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('transfer:changed', listener);
    return () => ipcRenderer.removeListener('transfer:changed', listener);
  },
  onVolumesChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('volumes:changed', listener);
    return () => ipcRenderer.removeListener('volumes:changed', listener);
  },
  onOperationComplete: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('operation:complete', listener);
    return () => ipcRenderer.removeListener('operation:complete', listener);
  },
  onOperationConflict: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('operation:conflict', listener);
    return () => ipcRenderer.removeListener('operation:conflict', listener);
  },
  onHistoryChanged: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('history:changed', listener);
    return () => ipcRenderer.removeListener('history:changed', listener);
  },
  onContentIndexStatus: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('index:status', listener);
    return () => ipcRenderer.removeListener('index:status', listener);
  },
  onMenuCommand: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('menu:command', listener);
    return () => ipcRenderer.removeListener('menu:command', listener);
  },
  onNativeContextMenuCommand: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('native-context-menu:command', listener);
    return () => ipcRenderer.removeListener('native-context-menu:command', listener);
  },
  onNativeContextMenuError: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('native-context-menu:error', listener);
    return () => ipcRenderer.removeListener('native-context-menu:error', listener);
  },
  onNativeContextMenuNotice: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('native-context-menu:notice', listener);
    return () => ipcRenderer.removeListener('native-context-menu:notice', listener);
  }
});
