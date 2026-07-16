const { contextBridge, ipcRenderer, webUtils } = require('electron');

contextBridge.exposeInMainWorld('easyMove', {
  initialState: () => ipcRenderer.invoke('app:initial-state'),
  chooseCustomTheme: () => ipcRenderer.invoke('theme:choose-custom'),
  chooseFolder: () => ipcRenderer.invoke('dialog:choose-folder'),
  listDirectory: (path, showHidden = false) => ipcRenderer.invoke('fs:list', { path, showHidden }),
  folderSizes: (paths) => ipcRenderer.invoke('fs:folder-sizes', paths),
  createFolder: (path) => ipcRenderer.invoke('fs:create-folder', path),
  rename: (path, name) => ipcRenderer.invoke('fs:rename', { path, name }),
  trash: (paths) => ipcRenderer.invoke('fs:trash', paths),
  open: (path) => ipcRenderer.invoke('fs:open', path),
  reveal: (path) => ipcRenderer.invoke('fs:reveal', path),
  getPathForFile: (file) => webUtils.getPathForFile(file),
  defaultDragMode: (sources, targetDirectory) => ipcRenderer.invoke('fs:drag-default-mode', { sources, targetDirectory }),
  startNativeDrag: (paths) => ipcRenderer.send('drag:start-native', paths),
  nativeEdit: (command) => ipcRenderer.send('app:native-edit', command),
  transfer: (sources, targetDirectory, mode) => ipcRenderer.invoke('fs:transfer', { sources, targetDirectory, mode }),
  controlOperation: (id, action) => ipcRenderer.invoke('operation:control', { id, action }),
  onOperationProgress: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('operation:progress', listener);
    return () => ipcRenderer.removeListener('operation:progress', listener);
  },
  onOperationComplete: (callback) => {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('operation:complete', listener);
    return () => ipcRenderer.removeListener('operation:complete', listener);
  },
  onMenuCommand: (callback) => {
    const listener = (_event, command) => callback(command);
    ipcRenderer.on('menu:command', listener);
    return () => ipcRenderer.removeListener('menu:command', listener);
  }
});
