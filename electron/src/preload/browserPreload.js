/**
 * browserPreload.js — Preload script for the browser chrome UI.
 * Bridges API requests between the browser UI renderer and the main process securely.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sebBrowser', {
  // Config & environment
  getConfig: () => ipcRenderer.invoke('admin:getConfig'),
  getExamPreloadPath: () => ipcRenderer.invoke('browser:getPreloadPath'),
  hasExitPassword: () => ipcRenderer.invoke('exam:hasExitPassword'),

  // Control & Exit
  quit: (password) => ipcRenderer.invoke('admin:quit', password),
  logEvent: (type, data) => ipcRenderer.send('exam-event', { type, ...data }),

  // IPC Event listeners
  onShowExitDialog: (callback) => {
    ipcRenderer.on('browser:show-exit-dialog', () => callback());
  },
  onOpenTab: (callback) => {
    ipcRenderer.on('browser:open-tab', (event, url) => callback(url));
  }
});
