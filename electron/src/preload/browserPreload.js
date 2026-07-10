/**
 * browserPreload.js — Preload script for the browser chrome UI.
 * Bridges API requests between the browser UI renderer and the main process securely.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sebBrowser', {
  // Config & environment
  getConfig: () => ipcRenderer.invoke('admin:getConfig'),
  saveConfig: (partial) => ipcRenderer.invoke('browser:saveConfig', partial),
  getExamPreloadPath: () => ipcRenderer.invoke('browser:getPreloadPath'),
  hasExitPassword: () => ipcRenderer.invoke('exam:hasExitPassword'),
  checkBlocked: (text) => ipcRenderer.invoke('browser:checkBlocked', text),
  getSuggestions: (query) => ipcRenderer.invoke('browser:getSuggestions', query),
  getHistory: () => ipcRenderer.invoke('browser:getHistory'),
  addHistory: (title, url) => ipcRenderer.invoke('browser:addHistory', { title, url }),
  deleteHistoryItem: (id) => ipcRenderer.invoke('browser:deleteHistoryItem', id),
  clearHistory: () => ipcRenderer.invoke('browser:clearHistory'),

  // Control & Exit
  quit: (password) => ipcRenderer.invoke('admin:quit', password),
  logEvent: (type, data) => ipcRenderer.send('exam-event', { type, ...data }),
  verifyAdminPassword: (password) => ipcRenderer.invoke('browser:verifyAdminPassword', password),
  openAdminPanel: () => ipcRenderer.invoke('browser:openAdminPanel'),

  // IPC Event listeners
  onTabSwitchShortcut: (callback) => {
    ipcRenderer.on('host:tab-switch-shortcut', (_, data) => callback(data.digit));
  },
  onFocusSearchShortcut: (callback) => {
    ipcRenderer.on('host:focus-search-shortcut', () => callback());
  },
  onHistoryShortcut: (callback) => {
    ipcRenderer.on('host:history-shortcut', () => callback());
  },
  onDownloadsShortcut: (callback) => {
    ipcRenderer.on('host:downloads-shortcut', () => callback());
  },
  onMagnifierShortcut: (callback) => {
    ipcRenderer.on('host:magnifier-shortcut', () => callback());
  },
  setExamActive: (isActive) => ipcRenderer.send('exam-status-changed', isActive),
  onReloadShortcut: (callback) => {
    ipcRenderer.on('host:reload-shortcut', (_, data) => callback(data));
  },
  onTabNextShortcut: (callback) => {
    ipcRenderer.on('host:tab-next-shortcut', () => callback());
  },
  onTabPrevShortcut: (callback) => {
    ipcRenderer.on('host:tab-prev-shortcut', () => callback());
  },
  onTabCloseShortcut: (callback) => {
    ipcRenderer.on('host:tab-close-shortcut', () => callback());
  },
  onTabReopenShortcut: (callback) => {
    ipcRenderer.on('host:tab-reopen-shortcut', () => callback());
  },
  onTabNewShortcut: (callback) => {
    ipcRenderer.on('host:tab-new-shortcut', () => callback());
  },
  onTabCloseAllShortcut: (callback) => {
    ipcRenderer.on('host:tab-close-all-shortcut', () => callback());
  },
  onShowAdminPrompt: (callback) => {
    ipcRenderer.on('browser:show-admin-prompt', () => callback());
  },
  onShowExitDialog: (callback) => {
    ipcRenderer.on('browser:show-exit-dialog', () => callback());
  },
  onOpenTab: (callback) => {
    ipcRenderer.on('browser:open-tab', (event, url) => callback(url));
  },
  onShowBlockedToast: (callback) => {
    ipcRenderer.on('browser:show-blocked-toast', (event, data) => callback(data));
  },
  onShowToast: (callback) => {
    ipcRenderer.on('browser:show-toast', (event, data) => callback(data));
  },
  onZoom: (callback) => {
    ipcRenderer.on('browser:zoom', (event, key) => callback(key));
  },
  isFullScreen: () => ipcRenderer.invoke('browser:isFullScreen'),
  toggleFullScreen: () => ipcRenderer.invoke('browser:toggleFullScreen'),
  setTitleBarOverlay: (opts) => ipcRenderer.invoke('browser:setTitleBarOverlay', opts),
  onFullscreenChanged: (callback) => {
    ipcRenderer.on('browser:fullscreen-changed', (event, isFS) => callback(isFS));
  },
  onMultiMonitor: (callback) => {
    ipcRenderer.on('browser:multi-monitor', (event, data) => callback(data));
  },
  
  // Downloads Tab Support API
  getDownloadsList: () => ipcRenderer.invoke('downloads:getList'),
  cancelDownload: (id) => ipcRenderer.invoke('browser:cancelDownload', id),
  showItemInFolder: (path) => ipcRenderer.invoke('browser:showItemInFolder', path),
  setThemeSource: (source) => ipcRenderer.invoke('browser:setThemeSource', source),
  onDownloadsUpdated: (callback) => {
    ipcRenderer.on('browser:downloads-updated', (event, list) => callback(list));
  }
});
