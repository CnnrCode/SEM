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

  examWindow = new BrowserWindow({
    fullscreen: isFullscreen,
    kiosk: isFullscreen,
    alwaysOnTop: isFullscreen,
    frame: !isFullscreen,
    resizable: !isFullscreen,
    movable: !isFullscreen,
    minimizable: !isFullscreen,
    closable: !isFullscreen,
    skipTaskbar: isFullscreen,
    autoHideMenuBar: true,
    width: isFullscreen ? undefined : 1280,
    height: isFullscreen ? undefined : 800,
    center: !isFullscreen,
    backgroundColor: '#0a0e1a',
    webPreferences: {
      preload: path.join(__dirname, '../preload/browserPreload.js'),
      webviewTag: true,
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
    },
  });

  // Attach URL filter
  urlFilter.attach(examWindow.webContents);

  // Screen protection
  screenGuard.init(examWindow);
  if (cfg.features.blockScreenCapture) {
    screenGuard.enableScreenProtection();
    screenGuard.startSnippingWatchdog();
  }

  // Clear clipboard on start
  if (cfg.features.clearClipboardOnExit) {
    screenGuard.clearClipboard();
  }

  // Block shortcuts
  if (cfg.features.blockKeyboardShortcuts) {
    lockdown.registerAll();
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
    }
  });

  examWindow.on('blur', () => {
    if (examMode && examWindow && isFullscreen) {
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
    webPreferences: {
      preload: path.join(__dirname, '../preload/adminPreload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  adminWindow.loadFile(path.join(__dirname, '../renderer/admin.html'));

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
  return path.join(__dirname, '../preload/examPreload.js');
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

// Quit with exit password verification
ipcMain.handle('admin:quit', (_, password) => {
  if (config.verifyExitPassword(password)) {
    auditLog.log('SESSION_EXIT', { authorized: true });
    examMode = false;
    if (examWindow && !examWindow.isDestroyed()) {
      examWindow.destroy();
    }
    app.quit();
    return { success: true };
  } else {
    auditLog.log('EXIT_DENIED', { reason: 'wrong_password' });
    return { success: false, error: 'Incorrect exit password.' };
  }
});

// Log events from renderer preloads
ipcMain.on('exam-event', (_, { type, ...data }) => {
  auditLog.log(type, data);
});

// Attach URL filter to any webviews that get created
app.on('web-contents-created', (event, contents) => {
  if (contents.getType() === 'webview') {
    urlFilter.attach(contents);
  }
});
