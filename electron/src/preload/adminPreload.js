/**
 * adminPreload.js — IPC bridge for the Admin Configuration Panel
 * Exposes safe API methods to the renderer process via contextBridge.
 */

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('sebAdmin', {
  // Config
  getConfig: () => ipcRenderer.invoke('admin:getConfig'),
  saveConfig: (config) => ipcRenderer.invoke('admin:saveConfig', config),

  // Passwords
  setExitPassword: (password) => ipcRenderer.invoke('admin:setExitPassword', password),
  setAdminPassword: (password) => ipcRenderer.invoke('admin:setAdminPassword', password),
  verifyAdminPassword: (password) => ipcRenderer.invoke('admin:verifyAdminPassword', password),

  // Logs
  getLogDates: () => ipcRenderer.invoke('admin:getLogDates'),
  getLogsForDate: (date) => ipcRenderer.invoke('admin:getLogsForDate', date),
  clearAllLogs: () => ipcRenderer.invoke('admin:clearAllLogs'),

  // Session control
  launchExam: () => ipcRenderer.invoke('admin:launchExam'),
  quit: () => ipcRenderer.invoke('admin:quit'),

  // Platform info
  getPlatform: () => process.platform,
  getVersion: () => ipcRenderer.invoke('admin:getVersion'),

  // AI block list
  getBuiltinAiDomains: () => ipcRenderer.invoke('admin:getBuiltinAiDomains'),
  getBlockedAiDomains: () => ipcRenderer.invoke('admin:getBlockedAiDomains'),
  saveBlockedAiDomains: (domains) => ipcRenderer.invoke('admin:saveBlockedAiDomains', domains),
});
