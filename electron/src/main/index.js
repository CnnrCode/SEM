/**
 * index.js — Main process entry for SecureExam Browser
 *
 * App flow:
 *   1. First run or --admin flag → open Admin Config Panel (normal window)
 *   2. Configured → launch kiosk exam window with full lockdown
 *   3. Hidden combo (Ctrl+Shift+Alt+Q) → prompt for admin password → re-open admin panel
 *   4. Exit via admin panel with exit password verification
 */

const {
  app,
  BrowserWindow,
  ipcMain,
  globalShortcut,
  dialog,
  clipboard,
  Menu,
  MenuItem,
} = require('electron');
const path = require('path');

const config = require('./config');
const lockdown = require('./lockdown');
const screenGuard = require('./screenGuard');
const urlFilter = require('./urlFilter');
const auditLog = require('./auditLog');

// ─── State ────────────────────────────────────────────────────────────────────

let examWindow = null;
let adminWindow = null;
let examMode = false;

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  config.load();
  auditLog.init();
  urlFilter.init();
  setupDownloadHandler();

  // Create standard Edit menu so standard keyboard shortcuts (Copy, Paste, etc.) work
  const template = [
    {
      label: 'Edit',
      submenu: [
        { label: 'Undo', accelerator: 'CmdOrCtrl+Z', role: 'undo' },
        { label: 'Redo', accelerator: 'CmdOrCtrl+Shift+Z', role: 'redo' },
        { type: 'separator' },
        { label: 'Cut', accelerator: 'CmdOrCtrl+X', role: 'cut' },
        { label: 'Copy', accelerator: 'CmdOrCtrl+C', role: 'copy' },
        { label: 'Paste', accelerator: 'CmdOrCtrl+V', role: 'paste' },
        { label: 'Select All', accelerator: 'CmdOrCtrl+A', role: 'selectAll' }
      ]
    }
  ];
  const menu = Menu.buildFromTemplate(template);
  Menu.setApplicationMenu(menu);

  const isAdminFlag = process.argv.includes('--admin');

  if (isAdminFlag || config.isFirstRun()) {
    openAdminPanel();
  } else {
    launchExam();
  }

  // Register the secret admin escape combo (only works if you know it)
  // Ctrl+Shift+Alt+Q → triggers admin password prompt
  globalShortcut.register('Ctrl+Shift+Alt+Q', () => {
    if (examMode) {
      _promptAdminAccess();
    }
  });
});

app.on('before-quit', () => {
  const cfg = config.get();
  if (cfg.features.clearClipboardOnExit) {
    screenGuard.clearClipboard();
  }
  lockdown.unregisterAll();
  screenGuard.stopSnippingWatchdog();
  screenGuard.stopAiProcessWatchdog();
  screenGuard.stopClipboardWatchdog();
  auditLog.log('SESSION_END');
});

app.on('window-all-closed', () => {
  // On macOS apps usually stay in dock. Here we always quit.
  app.quit();
});

// ─── Exam window ──────────────────────────────────────────────────────────────

function launchExam() {
  const cfg = config.get();

  if (!cfg.examUrl) {
    openAdminPanel('No exam URL configured.');
    return;
  }

  examMode = true;

  const isFullscreen = cfg.features.fullscreenLockdown !== false;
  const shouldBlockShortcuts = cfg.features.blockKeyboardShortcuts !== false;

  examWindow = new BrowserWindow({
    fullscreen: isFullscreen,
    kiosk: isFullscreen,
    alwaysOnTop: isFullscreen || shouldBlockShortcuts,
    // Modern frameless window style (hides standard white OS title bar)
    titleBarStyle: isFullscreen ? 'default' : 'hidden',
    titleBarOverlay: isFullscreen ? false : {
      color: '#13182b',
      symbolColor: '#f8fafc',
      height: 38
    },
    frame: false,
    resizable: !isFullscreen,
    movable: true, // Allow moving frameless window via webkit-app-region drag
    minimizable: false,
    closable: !isFullscreen,
    skipTaskbar: isFullscreen,
    autoHideMenuBar: true,
    width: isFullscreen ? undefined : 1280,
    height: isFullscreen ? undefined : 800,
    center: !isFullscreen,
    backgroundColor: '#0a0e1a',
    icon: path.join(__dirname, '../renderer/prodigy.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/browserPreload.js'),
      webviewTag: true,
      plugins: true,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Apply highest always-on-top level when shortcuts blocking is enabled in windowed mode
  if (!isFullscreen && shouldBlockShortcuts) {
    examWindow.setAlwaysOnTop(true, 'screen-saver');
  }

  // Attach URL filter
  urlFilter.attach(examWindow.webContents);

  // Set up keyboard shortcut input barrier
  lockdown.setupInputBarrier(examWindow);

  // Screen protection & AI process watchdog
  screenGuard.init(examWindow);
  if (cfg.features.blockScreenCapture) {
    screenGuard.enableScreenProtection();
    screenGuard.startSnippingWatchdog();
  }
  if (cfg.features.blockAiApiBackends !== false) {
    screenGuard.startAiProcessWatchdog();
  }
  if (cfg.features.blockCopyPaste !== false) {
    screenGuard.startClipboardWatchdog();
  }

  // Clear clipboard on start
  if (cfg.features.clearClipboardOnExit) {
    screenGuard.clearClipboard();
  }

  // Block shortcuts
  if (shouldBlockShortcuts) {
    lockdown.registerAll();
    // Register Alt+Tab at globalShortcut level so Windows sees it
    try {
      globalShortcut.register('Alt+Tab', () => {
        auditLog.log('SHORTCUT_BLOCKED', { shortcut: 'Alt+Tab' });
        if (examWindow && !examWindow.isDestroyed()) examWindow.focus();
      });
    } catch (e) {
      console.warn('[Lockdown] Could not register Alt+Tab globalShortcut:', e.message);
    }
  }

  // Load browser wrapper UI
  examWindow.loadFile(path.join(__dirname, '../renderer/browser.html'));

  // Prevent closing via OS & show exit dialog in renderer
  examWindow.on('close', (e) => {
    if (examMode) {
      e.preventDefault();
      auditLog.log('CLOSE_ATTEMPT_BLOCKED');
      examWindow.webContents.send('browser:show-exit-dialog');
    }
  });

  // Watchdog: restore fullscreen if lost (only when fullscreen lockdown is active)
  examWindow.on('leave-full-screen', () => {
    if (examMode && isFullscreen) {
      auditLog.log('FULLSCREEN_LOST');
      examWindow.setFullScreen(true);
      examWindow.setKiosk(true);
    } else {
      examWindow.webContents.send('browser:fullscreen-changed', false);
    }
  });

  examWindow.on('enter-full-screen', () => {
    examWindow.webContents.send('browser:fullscreen-changed', true);
  });

  examWindow.on('blur', () => {
    if (!examMode || !examWindow || examWindow.isDestroyed()) return;
    const latestCfg = config.get();
    const blockShortcuts = latestCfg.features.blockKeyboardShortcuts !== false;
    const fullscreen = latestCfg.features.fullscreenLockdown !== false;
    if (blockShortcuts || fullscreen) {
      // Immediately reclaim focus — no delay so the task switcher has no time to appear
      examWindow.focus();
    }
  });

  auditLog.log('EXAM_STARTED', { url: cfg.examUrl });
}

// ─── Admin panel ──────────────────────────────────────────────────────────────

function openAdminPanel(message = null) {
  if (adminWindow) {
    adminWindow.focus();
    return;
  }

  // Pause lockdown if in exam mode
  if (examMode) {
    lockdown.unregisterAll();
    screenGuard.disableScreenProtection();
    screenGuard.stopSnippingWatchdog();
    screenGuard.stopAiProcessWatchdog();
    screenGuard.stopClipboardWatchdog();
    if (examWindow) examWindow.minimize();
  }

  adminWindow = new BrowserWindow({
    width: 1100,
    height: 720,
    minWidth: 800,
    minHeight: 600,
    center: true,
    resizable: true,
    frame: true,
    backgroundColor: '#0a0e1a',
    titleBarStyle: 'hiddenInset',
    autoHideMenuBar: true,
    icon: path.join(__dirname, '../renderer/prodigy.png'),
    webPreferences: {
      preload: path.join(__dirname, '../preload/adminPreload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  adminWindow.loadFile(path.join(__dirname, '../renderer/admin.html'));

  // Enable native context menu (right-click) for copy-paste in Admin Panel
  adminWindow.webContents.on('context-menu', (e, props) => {
    const menu = new Menu();
    if (props.isEditable) {
      menu.append(new MenuItem({ label: 'Cut', role: 'cut', accelerator: 'CmdOrCtrl+X' }));
      menu.append(new MenuItem({ label: 'Copy', role: 'copy', accelerator: 'CmdOrCtrl+C' }));
      menu.append(new MenuItem({ label: 'Paste', role: 'paste', accelerator: 'CmdOrCtrl+V' }));
      menu.append(new MenuItem({ type: 'separator' }));
      menu.append(new MenuItem({ label: 'Select All', role: 'selectall', accelerator: 'CmdOrCtrl+A' }));
      menu.popup();
    } else if (props.selectionText && props.selectionText.trim() !== '') {
      menu.append(new MenuItem({ label: 'Copy', role: 'copy', accelerator: 'CmdOrCtrl+C' }));
      menu.popup();
    }
  });

  adminWindow.webContents.once('did-finish-load', () => {
    if (message) {
      adminWindow.webContents.send('admin:message', message);
    }
  });

  adminWindow.on('closed', () => {
    adminWindow = null;
    // If exam was running, restore it
    if (examMode && examWindow && !examWindow.isDestroyed()) {
      const cfg = config.get();
      lockdown.registerAll();
      examWindow.restore();
      examWindow.focus();
      if (cfg.features.fullscreenLockdown !== false) {
        examWindow.setKiosk(true);
        examWindow.setFullScreen(true);
      }
      // Restart watchdogs
      if (cfg.features.blockScreenCapture) {
        screenGuard.enableScreenProtection();
        screenGuard.startSnippingWatchdog();
      }
      if (cfg.features.blockAiApiBackends !== false) {
        screenGuard.startAiProcessWatchdog();
      }
      if (cfg.features.blockCopyPaste !== false) {
        screenGuard.startClipboardWatchdog();
      }
    }
  });
}

// ─── Secret admin access ──────────────────────────────────────────────────────

async function _promptAdminAccess() {
  // Use a simple dialog to avoid creating a new window
  const result = await dialog.showInputBox
    ? _inputDialogNative()
    : _inputDialogFallback();
}

function _inputDialogFallback() {
  // Since Electron doesn't have a built-in input dialog,
  // we show the admin panel with a password prompt screen.
  openAdminPanel();
}

// ─── IPC Handlers ─────────────────────────────────────────────────────────────

// Check if exit password is set
ipcMain.handle('exam:hasExitPassword', () => {
  const cfg = config.get();
  return !!cfg.exitPasswordHash;
});

// Get config
ipcMain.handle('admin:getConfig', () => {
  const cfg = { ...config.get() };
  // Never send password hashes to renderer
  delete cfg.exitPasswordHash;
  delete cfg.exitPasswordSalt;
  delete cfg.adminPasswordHash;
  delete cfg.adminPasswordSalt;
  return cfg;
});

// Save config
ipcMain.handle('admin:saveConfig', (_, newConfig) => {
  // Sanitize: only allow safe keys
  const allowed = ['examUrl', 'allowedDomains', 'blockedAiDomains', 'features', 'firstRun'];
  const sanitized = {};
  for (const key of allowed) {
    if (newConfig[key] !== undefined) sanitized[key] = newConfig[key];
  }
  sanitized.firstRun = false;
  config.save(sanitized);
  auditLog.log('CONFIG_SAVED');
  return { success: true };
});

// Set exit password
ipcMain.handle('admin:setExitPassword', (_, password) => {
  config.setExitPassword(password);
  auditLog.log('EXIT_PASSWORD_CHANGED');
  return { success: true };
});

// Set admin password
ipcMain.handle('admin:setAdminPassword', (_, password) => {
  config.setAdminPassword(password);
  auditLog.log('ADMIN_PASSWORD_CHANGED');
  return { success: true };
});

// Verify admin password
ipcMain.handle('admin:verifyAdminPassword', (_, password) => {
  return config.verifyAdminPassword(password);
});

// Audit log
ipcMain.handle('admin:getLogDates', () => auditLog.getLogDates());
ipcMain.handle('admin:getLogsForDate', (_, date) => auditLog.getLogsForDate(date));
ipcMain.handle('admin:clearAllLogs', () => {
  auditLog.clearAllLogs();
  auditLog.log('LOGS_CLEARED');
  return { success: true };
});

// Launch exam from admin panel
ipcMain.handle('admin:launchExam', () => {
  if (adminWindow) {
    adminWindow.close();
    adminWindow = null;
  }
  examMode = false; // reset so launchExam starts fresh
  launchExam();
  return { success: true };
});

// Get preload path for webviews
ipcMain.handle('browser:getPreloadPath', () => {
  const filePath = path.join(__dirname, '../preload/examPreload.js');
  return require('url').pathToFileURL(filePath).href;
});

// Check if exam window is in fullscreen
ipcMain.handle('browser:isFullScreen', () => {
  return examWindow ? examWindow.isFullScreen() : false;
});

// Toggle fullscreen state
ipcMain.handle('browser:toggleFullScreen', () => {
  if (examWindow && !examWindow.isDestroyed()) {
    const nextFS = !examWindow.isFullScreen();
    examWindow.setFullScreen(nextFS);
    examWindow.setKiosk(nextFS);
    return nextFS;
  }
  return false;
});

// Update native title bar overlay colors (for theme switching)
ipcMain.handle('browser:setTitleBarOverlay', (_, { color, symbolColor }) => {
  if (examWindow && !examWindow.isDestroyed() && !examWindow.isFullScreen()) {
    try {
      examWindow.setTitleBarOverlay({ color, symbolColor, height: 38 });
    } catch (e) {
      // setTitleBarOverlay not supported on this platform — silently ignore
    }
  }
});

// Check if user input is blocked (contains AI)
ipcMain.handle('browser:checkBlocked', (_, text) => {
  return urlFilter.isInputBlocked(text);
});

// Retrieve download manager state list
ipcMain.handle('downloads:getList', () => {
  return downloadsList;
});

// Cancel active download
ipcMain.handle('browser:cancelDownload', (_, id) => {
  const item = activeDownloads.get(id);
  if (item) {
    item.cancel();
    activeDownloads.delete(id);
    return true;
  }
  return false;
});

// Reveal file in Explorer
ipcMain.handle('browser:showItemInFolder', (_, filePath) => {
  if (filePath) {
    const { shell } = require('electron');
    try {
      shell.showItemInFolder(filePath);
      return true;
    } catch (e) {
      console.error('[Main] showItemInFolder failed:', e);
    }
  }
  return false;
});


// Version
ipcMain.handle('admin:getVersion', () => app.getVersion());

// AI block list — built-in domains (read-only) + admin-configured extras
ipcMain.handle('admin:getBuiltinAiDomains', () => {
  return urlFilter.getBuiltinAiDomains();
});

ipcMain.handle('admin:getBlockedAiDomains', () => {
  const cfg = config.get();
  return cfg.blockedAiDomains || [];
});

ipcMain.handle('admin:saveBlockedAiDomains', (_, domains) => {
  // Sanitize: ensure it's an array of non-empty strings
  const clean = (Array.isArray(domains) ? domains : [])
    .map((d) => String(d).trim().toLowerCase())
    .filter(Boolean);
  config.save({ blockedAiDomains: clean });
  auditLog.log('AI_BLOCKLIST_UPDATED', { count: clean.length });
  return { success: true };
});

// Quit with confirmation only (no exit password check needed)
ipcMain.handle('admin:quit', () => {
  auditLog.log('SESSION_EXIT', { authorized: true });
  examMode = false;
  if (examWindow && !examWindow.isDestroyed()) {
    examWindow.destroy();
  }
  app.quit();
  return { success: true };
});

// Log events from renderer preloads
ipcMain.on('exam-event', (event, { type, ...data }) => {
  auditLog.log(type, data);
});

// Secure Download Manager
const activeDownloads = new Map();
let downloadsList = [];

function setupDownloadHandler() {
  const { session } = require('electron');
  session.defaultSession.on('will-download', (event, item, webContents) => {
    const name = item.getFilename();
    const size = item.getTotalBytes();
    const downloadId = Date.now().toString();

    // Create tracking object
    const dlObj = {
      id: downloadId,
      filename: name,
      totalBytes: size,
      receivedBytes: 0,
      status: 'downloading',
      savePath: '',
      startTime: new Date().toISOString()
    };
    downloadsList.unshift(dlObj); // Add to beginning of downloads list
    activeDownloads.set(downloadId, item);

    // Broadcast updates to the renderer process
    const broadcastList = () => {
      if (examWindow && !examWindow.isDestroyed()) {
        examWindow.webContents.send('browser:downloads-updated', downloadsList);
      }
    };

    // Log download start
    auditLog.log('DOWNLOAD_STARTED', { filename: name, sizeBytes: size });
    if (examWindow && !examWindow.isDestroyed()) {
      examWindow.webContents.send('browser:show-toast', { message: `Download started: ${name}`, type: 'download' });
    }
    broadcastList();

    // Set default path to User Downloads folder
    item.setSaveDialogOptions({
      defaultPath: path.join(app.getPath('downloads'), name)
    });

    item.on('updated', (event, state) => {
      if (state === 'interrupted') {
        auditLog.log('DOWNLOAD_INTERRUPTED', { filename: name });
        dlObj.status = 'interrupted';
        if (examWindow && !examWindow.isDestroyed()) {
          examWindow.webContents.send('browser:show-toast', { message: `Download interrupted: ${name}`, type: 'download' });
        }
      } else if (state === 'progressing') {
        dlObj.receivedBytes = item.getReceivedBytes();
        dlObj.status = 'downloading';
      }
      broadcastList();
    });

    item.once('done', (event, state) => {
      activeDownloads.delete(downloadId);
      if (state === 'completed') {
        const savePath = item.getSavePath();
        dlObj.status = 'completed';
        dlObj.savePath = savePath;
        dlObj.receivedBytes = size;
        auditLog.log('DOWNLOAD_COMPLETED', { filename: name, path: savePath });
        if (examWindow && !examWindow.isDestroyed()) {
          examWindow.webContents.send('browser:show-toast', { message: `Download completed successfully: ${name}`, type: 'success' });
        }
      } else {
        dlObj.status = state === 'cancelled' ? 'cancelled' : 'failed';
        auditLog.log('DOWNLOAD_FAILED', { filename: name, reason: state });
        if (examWindow && !examWindow.isDestroyed() && state !== 'cancelled') {
          examWindow.webContents.send('browser:show-toast', { message: `Download failed: ${name} (${state})`, type: 'error' });
        }
      }
      broadcastList();
    });
  });
}

// (Webview registry removed - zoom and navigation are handled locally in renderer/preload)

// Attach URL filter to any webviews that get created, and push config into them
app.on('web-contents-created', (event, contents) => {
  if (contents.getType() === 'webview') {
    urlFilter.attach(contents);

    // Push config directly from the main process on every page load.
    contents.on('dom-ready', () => {
      const cfg = config.get();
      // Strip sensitive fields before sending
      const safeCfg = { ...cfg };
      delete safeCfg.exitPasswordHash;
      delete safeCfg.exitPasswordSalt;
      delete safeCfg.adminPasswordHash;
      delete safeCfg.adminPasswordSalt;
      contents.send('seb:config', safeCfg);
    });

    contents.on('console-message', (event, level, message, line, sourceId) => {
      console.log(`[Webview Console] ${message} (at ${sourceId}:${line})`);
    });
  }
});
