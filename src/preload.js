const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('easyMove', {
  initialState: () => ipcRenderer.invoke('app:initial-state'),
  chooseFolder: () => ipcRenderer.invoke('dialog:choose-folder'),
  listDirectory: (path, showHidden = false) => ipcRenderer.invoke('fs:list', { path, showHidden }),
  createFolder: (path) => ipcRenderer.invoke('fs:create-folder', path),
  rename: (path, name) => ipcRenderer.invoke('fs:rename', { path, name }),
  trash: (paths) => ipcRenderer.invoke('fs:trash', paths),
  open: (path) => ipcRenderer.invoke('fs:open', path),
  reveal: (path) => ipcRenderer.invoke('fs:reveal', path),
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
  }
});
