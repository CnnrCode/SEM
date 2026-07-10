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
  session,
  screen,
} = require('electron');
const path = require('path');
const os = require('os');
const fs = require('fs');
const { exec } = require('child_process');

const config = require('./config');
const lockdown = require('./lockdown');
const screenGuard = require('./screenGuard');
const urlFilter = require('./urlFilter');
const auditLog = require('./auditLog');
const history = require('./history');
const downloads = require('./downloads');

// ─── Global Exception Guard ───────────────────────────────────────────────────
//
// Electron has several known race conditions that can trigger when any site
// performs rapid multi-step redirects, SPA navigations, or heavy iframe usage.
// In these scenarios a render frame is disposed mid-flight and Electron's own
// internal code (browser_init.js / api/web_contents.js) throws before our
// application-level try/catch can intercept it.
//
// The errors are benign — the navigation already succeeded — but without this
// guard they show the native "JavaScript error in main process" dialog to users.
//
// We match on error messages that are known Electron-internal race strings.
// All OTHER uncaught errors are still surfaced normally so genuine bugs remain
// visible during development.

const BENIGN_ELECTRON_ERRORS = [
  // Frame disposed between dom-ready/did-navigate and IPC send
  'Render frame was disposed before WebFrameMain could be accessed',
  // WebContents destroyed while an async IPC was in flight
  'Object has been destroyed',
  // executeJavaScript called on a detached webview
  'ERR_ABORTED',
  // WebFrameMain gone before a synchronous IPC completes
  'WebFrameMain is no longer valid',
  // Happens when a webview is detached mid-navigation
  'The webContents has been destroyed',
  // Chromium internal abort on rapid navigation
  'Navigation was cancelled',
];

function isBenignElectronError(err) {
  if (!err || typeof err.message !== 'string') return false;
  return BENIGN_ELECTRON_ERRORS.some(msg => err.message.includes(msg));
}

// Synchronous uncaught exceptions (from event callbacks, internal Electron code)
process.on('uncaughtException', (err) => {
  if (isBenignElectronError(err)) {
    console.warn('[Main] Suppressed benign Electron race condition:', err.message);
    return;
  }
  // Genuine uncaught exception — let Electron handle it normally
  console.error('[Main] Uncaught exception:', err);
  throw err;
});

// Asynchronous Promise rejections (from executeJavaScript, IPC handles, etc.)
process.on('unhandledRejection', (reason) => {
  if (isBenignElectronError(reason)) {
    console.warn('[Main] Suppressed benign Electron async rejection:', reason && reason.message);
    return;
  }
  // Genuine unhandled rejection — log but don't crash the main process
  console.error('[Main] Unhandled rejection:', reason);
});


// ─── State ────────────────────────────────────────────────────────────────────

let examWindow = null;
let adminWindow = null;
let splashWindow = null;
let examMode = false;
let isExamActiveGlobal = false;
let isVmDetected = false;
let blackoutWindows = [];
let mockMultiMonitor = false;
let heartbeatInterval = null;

// ─── App lifecycle ────────────────────────────────────────────────────────────

app.whenReady().then(() => {
  config.load();
  auditLog.init();
  urlFilter.init();
  setupDownloadHandler();

  // Set modern desktop Chrome User Agent as the default to ensure site compatibility
  const CHROME_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';
  const FIREFOX_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:138.0) Gecko/20100101 Firefox/138.0';
  session.defaultSession.setUserAgent(CHROME_UA);

  // Dynamically rewrite User-Agent header for Google Accounts sign-in to bypass blocks
  session.defaultSession.webRequest.onBeforeSendHeaders(
    { urls: ['*://*/*'] },
    (details, callback) => {
      const url = details.url.toLowerCase();
      if (url.includes('accounts.google.com')) {
        details.requestHeaders['User-Agent'] = FIREFOX_UA;
      } else {
        details.requestHeaders['User-Agent'] = CHROME_UA;
      }
      callback({ cancel: false, requestHeaders: details.requestHeaders });
    }
  );

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
  const hasAdmin = fs.existsSync(path.join(__dirname, '../renderer/admin.html'));

  if (hasAdmin && (isAdminFlag || config.isFirstRun())) {
    openAdminPanel();
  } else {
    if (config.isFirstRun()) {
      config.save({ firstRun: false });
    }
    showSplash();
    const cfg = config.get();
    if (cfg.remoteServerUrl && cfg.features.syncConfigOnStartup) {
      syncRemoteConfig().finally(() => {
        launchExam();
      });
    } else {
      launchExam();
    }
  }

  ipcMain.on('exam-status-changed', (event, isActive) => {
    isExamActiveGlobal = isActive;
  });

  // Handle multi-monitor hotplugging dynamically
  screen.on('display-added', () => {
    if (examMode) {
      handleMultiMonitorChange();
    }
  });

  screen.on('display-removed', () => {
    if (examMode) {
      handleMultiMonitorChange();
    }
  });

  // Register the secret admin escape combo (only works if you know it)
  // Ctrl+Shift+Alt+Q → triggers admin password prompt
  if (hasAdmin) {
    globalShortcut.register('Ctrl+Shift+Alt+Q', () => {
      if (examMode) {
        _promptAdminAccess();
      }
    });
  }

  // Register developer testing shortcut for simulating multiple monitors
  // Ctrl+Shift+Alt+M → toggles simulated display hotplug
  globalShortcut.register('Ctrl+Shift+Alt+M', () => {
    if (examMode) {
      mockMultiMonitor = !mockMultiMonitor;
      console.log(`[Dev] Multi-monitor mock toggled: ${mockMultiMonitor ? 'ON' : 'OFF'}`);
      handleMultiMonitorChange();
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
  closeBlackoutWindows();
  auditLog.log('SESSION_END');
});

app.on('window-all-closed', () => {
  // On macOS apps usually stay in dock. Here we always quit.
  app.quit();
});

// ─── Exam window ──────────────────────────────────────────────────────────────

function showSplash() {
  splashWindow = new BrowserWindow({
    width: 420,
    height: 260,
    center: true,
    frame: false,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    alwaysOnTop: true,
    skipTaskbar: true,
    backgroundColor: '#070913',
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  splashWindow.loadFile(path.join(__dirname, '../renderer/splash.html'));
  splashWindow.once('ready-to-show', () => {
    splashWindow.show();
  });
}

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
    show: false, // Create hidden to optimize startup rendering and prevent visual flashes
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
    maximizable: !isFullscreen,
    closable: !isFullscreen,
    skipTaskbar: isFullscreen,
    autoHideMenuBar: true,
    width: 1280,
    height: 800,
    center: true,
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

  // Smoothly enter kiosk mode and show the window once first paint is ready
  examWindow.once('ready-to-show', () => {
    // Show window first so OS registers visual window context before fullscreen transition
    examWindow.show();
    if (isFullscreen) {
      examWindow.setFullScreen(true);
      examWindow.setKiosk(true);
    }
    examWindow.focus();
    handleMultiMonitorChange();

    // Destroy the splash window once main window is ready
    if (splashWindow && !splashWindow.isDestroyed()) {
      splashWindow.destroy();
      splashWindow = null;
    }
  });

  // Attach URL filter
  urlFilter.attach(examWindow.webContents);

  // Set up keyboard shortcut input barrier
  lockdown.setupInputBarrier(examWindow);

  // Intercept navigation keys in the main window context (even inside iframes like newtab)
  examWindow.webContents.on('before-input-event', (inputEvent, input) => {
    if (input.type !== 'keyDown') return;

    const isControl = input.control;
    const isShift = input.shift;
    const isAlt = input.alt;
    const code = input.code;

    // 1. Reload shortcuts (F5, Ctrl+R, Ctrl+Shift+R, Ctrl+F5)
    const isF5Reload = (code === 'F5' && !isControl && !isAlt && !isShift);
    const isCtrlRReload = (isControl && !isAlt && code === 'KeyR');
    const isCtrlF5Reload = (isControl && code === 'F5');

    if (isF5Reload || isCtrlRReload || isCtrlF5Reload) {
      inputEvent.preventDefault();
      if (isExamActiveGlobal) {
        examWindow.webContents.send('browser:show-toast', { message: 'Reloading is blocked during an active exam.', type: 'error' });
      } else {
        const ignoreCache = isShift || isCtrlF5Reload;
        examWindow.webContents.send('host:reload-shortcut', { ignoreCache });
      }
      return;
    }

    // 2. Ctrl + Tab (Next tab) / Ctrl + Shift + Tab (Prev tab)
    if (isControl && !isAlt && code === 'Tab') {
      inputEvent.preventDefault();
      if (isExamActiveGlobal) {
        examWindow.webContents.send('browser:show-toast', { message: 'You cannot switch tabs while taking an active exam.', type: 'error' });
      } else {
        if (isShift) {
          examWindow.webContents.send('host:tab-prev-shortcut');
        } else {
          examWindow.webContents.send('host:tab-next-shortcut');
        }
      }
      return;
    }

    if (isControl && !isAlt) {
      // Tab switching Ctrl+1 to Ctrl+9
      const match = code.match(/^Digit([1-9])$/);
      if (match && !isShift) {
        inputEvent.preventDefault();
        if (isExamActiveGlobal) {
          examWindow.webContents.send('browser:show-toast', { message: 'You cannot switch tabs while taking an active exam.', type: 'error' });
        } else {
          const digit = parseInt(match[1], 10);
          examWindow.webContents.send('host:tab-switch-shortcut', { digit });
        }
        return;
      }

      // Ctrl + Shift + T
      if (isShift && code === 'KeyT') {
        inputEvent.preventDefault();
        if (isExamActiveGlobal) {
          examWindow.webContents.send('browser:show-toast', { message: 'You cannot open new tabs while taking an active exam.', type: 'error' });
        } else {
          examWindow.webContents.send('host:tab-reopen-shortcut');
        }
        return;
      }

      // Ctrl + T (New Tab)
      if (!isShift && code === 'KeyT') {
        inputEvent.preventDefault();
        if (isExamActiveGlobal) {
          examWindow.webContents.send('browser:show-toast', { message: 'You cannot open new tabs while taking an active exam.', type: 'error' });
        } else {
          examWindow.webContents.send('host:tab-new-shortcut');
        }
        return;
      }

      // Ctrl + Shift + W (Close all tabs)
      if (isShift && code === 'KeyW') {
        inputEvent.preventDefault();
        if (isExamActiveGlobal) {
          examWindow.webContents.send('browser:show-toast', { message: 'You cannot close tabs while taking an active exam.', type: 'error' });
        } else {
          examWindow.webContents.send('host:tab-close-all-shortcut');
        }
        return;
      }

      // Ctrl + W
      if (!isShift && code === 'KeyW') {
        inputEvent.preventDefault();
        if (isExamActiveGlobal) {
          examWindow.webContents.send('browser:show-toast', { message: 'You cannot close tabs while taking an active exam.', type: 'error' });
        } else {
          examWindow.webContents.send('host:tab-close-shortcut');
        }
        return;
      }

      // Ctrl + E (Focus Search)
      if (!isShift && code === 'KeyE') {
        inputEvent.preventDefault();
        examWindow.webContents.send('host:focus-search-shortcut');
        return;
      }

      // Ctrl + H (History)
      if (!isShift && code === 'KeyH') {
        inputEvent.preventDefault();
        examWindow.webContents.send('host:history-shortcut');
        return;
      }

      // Ctrl + J (Downloads)
      if (!isShift && code === 'KeyJ') {
        inputEvent.preventDefault();
        examWindow.webContents.send('host:downloads-shortcut');
        return;
      }

      // Ctrl + M (Magnifier)
      if (!isShift && code === 'KeyM') {
        inputEvent.preventDefault();
        examWindow.webContents.send('host:magnifier-shortcut');
        return;
      }
    }
  });

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

  // Check for Virtual Machine presence on startup to protect environment integrity
  checkVirtualMachine((isVm) => {
    if (isVm) {
      isVmDetected = true;
      auditLog.log('VM_DETECTION_TRIGGERED');
      console.warn('[Security] Virtual Machine environment detected! Locking down app.');
      examWindow.loadFile(path.join(__dirname, '../renderer/vm-block.html'));
    } else {
      // Load browser wrapper UI normally
      examWindow.loadFile(path.join(__dirname, '../renderer/browser.html'));
    }
  });

  // Prevent closing via OS & show exit dialog in renderer (unless inside blocked VM mode)
  examWindow.on('close', (e) => {
    if (examMode && !isVmDetected) {
      e.preventDefault();
      auditLog.log('CLOSE_ATTEMPT_BLOCKED');
      examWindow.webContents.send('browser:show-exit-dialog');
    }
  });

  // Watchdog: restore fullscreen if lost (only when fullscreen lockdown is active and VM not detected)
  examWindow.on('leave-full-screen', () => {
    if (examMode && isFullscreen && !isVmDetected) {
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
    
    // Immediately push black overlay to renderer BEFORE doing anything else.
    // This ensures Windows' Alt+Tab thumbnail captures a black screen, not exam content.
    examWindow.webContents.send('browser:window-blur');

    // Log focus loss audit log trail
    if (!isVmDetected) {
      auditLog.log('FOCUS_LOST');
    }
    
    const latestCfg = config.get();
    const blockShortcuts = latestCfg.features.blockKeyboardShortcuts !== false;
    const fullscreen = latestCfg.features.fullscreenLockdown !== false;
    if ((blockShortcuts || fullscreen) && !isVmDetected) {
      // Immediately reclaim focus — no delay so the task switcher has no time to appear
      examWindow.focus();
      examWindow.webContents.focus();
    }
  });

  examWindow.on('focus', () => {
    if (examWindow && !examWindow.isDestroyed()) {
      examWindow.webContents.send('browser:window-focus');
    }
    if (examMode && !isVmDetected) {
      auditLog.log('FOCUS_GAINED');
    }
  });

  if (!isVmDetected) {
    auditLog.log('EXAM_STARTED', { url: cfg.examUrl });
    startHeartbeat();
  }
}

// ─── Multi-Monitor Prevention Management ─────────────────────────────────────

function handleMultiMonitorChange() {
  const cfg = config.get();
  const action = cfg.features.multiMonitorAction || 'block';
  
  let displays = screen.getAllDisplays();
  if (mockMultiMonitor) {
    // Simulated mock display
    displays = [
      screen.getPrimaryDisplay(),
      {
        id: 999999,
        bounds: { x: 100, y: 100, width: 800, height: 600 },
        workArea: { x: 100, y: 100, width: 800, height: 560 }
      }
    ];
  }

  if (displays.length > 1) {
    if (action === 'block') {
      closeBlackoutWindows();
      if (examWindow && !examWindow.isDestroyed()) {
        examWindow.webContents.send('browser:multi-monitor', { blocked: true });
      }
    } else if (action === 'blackout') {
      if (examWindow && !examWindow.isDestroyed()) {
        examWindow.webContents.send('browser:multi-monitor', { blocked: false });
      }
      createBlackoutWindows();
    } else {
      closeBlackoutWindows();
      if (examWindow && !examWindow.isDestroyed()) {
        examWindow.webContents.send('browser:multi-monitor', { blocked: false });
      }
    }
    auditLog.log('MULTIPLE_MONITORS_DETECTED', { count: displays.length, action });
  } else {
    closeBlackoutWindows();
    if (examWindow && !examWindow.isDestroyed()) {
      examWindow.webContents.send('browser:multi-monitor', { blocked: false });
    }
  }
}

function createBlackoutWindows() {
  closeBlackoutWindows();
  const displays = screen.getAllDisplays();
  const primaryDisplay = screen.getPrimaryDisplay();

  for (const display of displays) {
    if (display.id === primaryDisplay.id) continue;

    const isMocked = (display.id === 999999);
    const winOptions = {
      x: display.bounds.x,
      y: display.bounds.y,
      width: display.bounds.width,
      height: display.bounds.height,
      frame: false,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreen: !isMocked,
      kiosk: !isMocked,
      alwaysOnTop: true,
      skipTaskbar: true,
      focusable: false,
      backgroundColor: '#000000',
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
      }
    };

    // If mocked, make it slightly smaller and centered on primary screen so the developer can see it
    if (isMocked) {
      winOptions.width = 600;
      winOptions.height = 400;
      winOptions.x = primaryDisplay.bounds.width / 2 - 300;
      winOptions.y = primaryDisplay.bounds.height / 2 - 200;
      winOptions.frame = true;
      winOptions.movable = true;
      winOptions.resizable = true;
    }

    const blackoutWin = new BrowserWindow(winOptions);

    const cfg = config.get();
    if (cfg.features.blockScreenCapture) {
      blackoutWin.setContentProtection(true);
    }

    blackoutWin.loadURL('data:text/html,<html><head><title>Locked (Simulated Screen)</title></head><body style="background-color:%2305070f;color:%23ef4444;display:flex;flex-direction:column;justify-content:center;align-items:center;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;height:100vh;margin:0;overflow:hidden;"><div style="border:1px solid rgba(239,68,68,0.2);padding:24px;border-radius:12px;background:rgba(239,68,68,0.02);text-align:center;max-width:400px;box-shadow:0 10px 30px rgba(0,0,0,0.5);"><div style="font-size:36px;margin-bottom:12px;">🖥️🔒</div><h3 style="margin:0 0 10px 0;font-size:18px;font-weight:600;letter-spacing:0.02em;">Screen Locked</h3><p style="margin:0;font-size:12px;color:%2394a3b8;line-height:1.6;">This secondary monitor is locked during the exam session to ensure integrity.</p></div></body></html>');
    
    blackoutWin.show();
    blackoutWindows.push(blackoutWin);
  }
}

function closeBlackoutWindows() {
  for (const win of blackoutWindows) {
    if (win && !win.isDestroyed()) {
      win.destroy();
    }
  }
  blackoutWindows = [];
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
    closeBlackoutWindows();
    stopHeartbeat();
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
      handleMultiMonitorChange();
      startHeartbeat();
    }
  });
}

// ─── Secret admin access ──────────────────────────────────────────────────────

function _promptAdminAccess() {
  if (examWindow && !examWindow.isDestroyed()) {
    examWindow.webContents.send('browser:show-admin-prompt');
  }
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

// Minimal safe config for exam page preloads — only exposes what examPreload.js needs.
// Deliberately does NOT expose examUrl, allowedDomains, passwords, tokens, or server config.
ipcMain.handle('exam:getSafeConfig', () => {
  const cfg = config.get();
  return {
    features: {
      blockCopyPaste: cfg.features.blockCopyPaste,
      blockRightClick: cfg.features.blockRightClick,
      blockAiApiBackends: cfg.features.blockAiApiBackends,
    }
  };
});

// Save config
ipcMain.handle('admin:saveConfig', (_, newConfig) => {
  // Sanitize: only allow safe keys
  const allowed = ['examUrl', 'allowedDomains', 'blockedAiDomains', 'features', 'firstRun', 'remoteServerUrl', 'clientAuthToken'];
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

// Verify admin password from browser window
ipcMain.handle('browser:verifyAdminPassword', (_, password) => {
  return config.verifyAdminPassword(password);
});

// Open admin panel after browser window verification succeeds
ipcMain.handle('browser:openAdminPanel', () => {
  openAdminPanel();
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

// Fetch autocomplete search suggestions securely from Google suggest queries API
ipcMain.handle('browser:getSuggestions', async (_, query) => {
  const https = require('https');
  return new Promise((resolve) => {
    if (!query || query.trim() === '') {
      resolve([]);
      return;
    }
    const url = `https://suggestqueries.google.com/complete/search?client=chrome&q=${encodeURIComponent(query)}`;
    https.get(url, (res) => {
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        try {
          const parsed = JSON.parse(data);
          // parsed[1] contains the suggestions array of strings
          if (Array.isArray(parsed) && Array.isArray(parsed[1])) {
            resolve(parsed[1].slice(0, 5)); // Return top 5 autocomplete suggestions
          } else {
            resolve([]);
          }
        } catch (e) {
          resolve([]);
        }
      });
    }).on('error', () => {
      resolve([]);
    });
  });
});

// Retrieve all browsing history entries
ipcMain.handle('browser:getHistory', () => {
  return history.getHistory();
});

// Add a new browsing history entry
ipcMain.handle('browser:addHistory', (_, { title, url }) => {
  history.addHistory(title, url);
  return true;
});

// Delete a single history entry
ipcMain.handle('browser:deleteHistoryItem', (_, id) => {
  history.deleteHistoryItem(id);
  return true;
});

// Clear all history list
ipcMain.handle('browser:clearHistory', () => {
  history.clearHistory();
  return true;
});

// Save partial config from the browser UI (e.g. uiTheme)
ipcMain.handle('browser:saveConfig', (_, partial) => {
  // Whitelist only UI-safe fields — never allow overwriting security config from renderer
  const allowed = ['uiTheme', 'openTabs'];
  const safe = {};
  for (const key of allowed) {
    if (partial && key in partial) safe[key] = partial[key];
  }
  if (Object.keys(safe).length > 0) {
    config.save(safe);
  }
  return true;
});

// Retrieve download manager state list
ipcMain.handle('downloads:getList', () => {
  return downloads.getDownloads();
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
});ipcMain.handle('browser:setThemeSource', (_, themeSource) => {
  try {
    const { nativeTheme } = require('electron');
    nativeTheme.themeSource = themeSource;
    return true;
  } catch (e) {
    console.error('[Main] Set theme source failed:', e);
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

// Quit with confirmation (no password check needed)
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

function setupDownloadHandler() {
  // session is already imported at the top of the file
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
    downloads.addOrUpdateDownload(dlObj);
    activeDownloads.set(downloadId, item);

    // Broadcast updates to the renderer process
    const broadcastList = () => {
      if (examWindow && !examWindow.isDestroyed()) {
        examWindow.webContents.send('browser:downloads-updated', downloads.getDownloads());
      }
    };

    // Log download start
    auditLog.log('DOWNLOAD_STARTED', { filename: name, sizeBytes: size });
    if (examWindow && !examWindow.isDestroyed()) {
      examWindow.webContents.send('browser:show-toast', { message: `Download started: ${name}`, type: 'download' });
    }
    broadcastList();

    // Set save path directly to bypass the save dialog
    // This allows downloads to complete automatically in kiosk/always-on-top mode
    // and prevents accessing the OS file system explorer during exams.
    const savePath = path.join(app.getPath('downloads'), name);
    item.setSavePath(savePath);

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
      downloads.addOrUpdateDownload(dlObj);
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
      downloads.addOrUpdateDownload(dlObj);
      broadcastList();
    });
  });
}

// (Webview registry removed - zoom and navigation are handled locally in renderer/preload)

// Attach URL filter to any webviews that get created, and push config into them
app.on('web-contents-created', (event, contents) => {
  if (contents.getType() === 'webview') {
    urlFilter.attach(contents);

    // Intercept keys before they get eaten by the webview guest
    contents.on('before-input-event', (inputEvent, input) => {
      if (input.type !== 'keyDown') return;

      const isControl = input.control;
      const isShift = input.shift;
      const isAlt = input.alt;
      const code = input.code;
      const key = input.key.toLowerCase();

      // Block DevTools shortcuts (F12, Ctrl+Shift+I/J/C, Ctrl+U) inside guest webviews
      if (key === 'f12' || (isControl && isShift && (key === 'i' || key === 'j' || key === 'c')) || (isControl && key === 'u')) {
        inputEvent.preventDefault();
        auditLog.log('SHORTCUT_BLOCKED', { shortcut: 'DevTools (Webview)' });
        if (examWindow && !examWindow.isDestroyed()) {
          examWindow.webContents.send('browser:show-toast', { message: 'Developer tools are disabled.', type: 'error' });
        }
        return;
      }

      // Block Print (Ctrl+P) and Save (Ctrl+S) inside guest webviews
      if (isControl && (key === 'p' || key === 's')) {
        inputEvent.preventDefault();
        auditLog.log('SHORTCUT_BLOCKED', { shortcut: `Ctrl+${key.toUpperCase()} (Webview)` });
        if (examWindow && !examWindow.isDestroyed()) {
          examWindow.webContents.send('browser:show-toast', { message: 'Printing and page saving are disabled.', type: 'error' });
        }
        return;
      }

      // 1. Reload shortcuts (F5, Ctrl+R, Ctrl+Shift+R, Ctrl+F5)
      const isF5Reload = (code === 'F5' && !isControl && !isAlt && !isShift);
      const isCtrlRReload = (isControl && !isAlt && code === 'KeyR');
      const isCtrlF5Reload = (isControl && code === 'F5');

      if (isF5Reload || isCtrlRReload || isCtrlF5Reload) {
        inputEvent.preventDefault();
        if (examWindow && !examWindow.isDestroyed()) {
          if (isExamActiveGlobal) {
            examWindow.webContents.send('browser:show-toast', { message: 'Reloading is blocked during an active exam.', type: 'error' });
          } else {
            const ignoreCache = isShift || isCtrlF5Reload;
            examWindow.webContents.send('host:reload-shortcut', { ignoreCache });
          }
        }
        return;
      }

      // 2. Ctrl + Tab (Next tab) / Ctrl + Shift + Tab (Prev tab)
      if (isControl && !isAlt && code === 'Tab') {
        inputEvent.preventDefault();
        if (examWindow && !examWindow.isDestroyed()) {
          if (isExamActiveGlobal) {
            examWindow.webContents.send('browser:show-toast', { message: 'You cannot switch tabs while taking an active exam.', type: 'error' });
          } else {
            if (isShift) {
              examWindow.webContents.send('host:tab-prev-shortcut');
            } else {
              examWindow.webContents.send('host:tab-next-shortcut');
            }
          }
        }
        return;
      }

      if (isControl && !isAlt) {
        // Tab switching Ctrl+1 to Ctrl+9
        const match = code.match(/^Digit([1-9])$/);
        if (match && !isShift) {
          inputEvent.preventDefault();
          if (examWindow && !examWindow.isDestroyed()) {
            if (isExamActiveGlobal) {
              examWindow.webContents.send('browser:show-toast', { message: 'You cannot switch tabs while taking an active exam.', type: 'error' });
            } else {
              const digit = parseInt(match[1], 10);
              examWindow.webContents.send('host:tab-switch-shortcut', { digit });
            }
          }
          return;
        }

        // Ctrl + Shift + T
        if (isShift && code === 'KeyT') {
          inputEvent.preventDefault();
          if (examWindow && !examWindow.isDestroyed()) {
            if (isExamActiveGlobal) {
              examWindow.webContents.send('browser:show-toast', { message: 'You cannot open new tabs while taking an active exam.', type: 'error' });
            } else {
              examWindow.webContents.send('host:tab-reopen-shortcut');
            }
          }
          return;
        }

        // Ctrl + T (New Tab)
        if (!isShift && code === 'KeyT') {
          inputEvent.preventDefault();
          if (examWindow && !examWindow.isDestroyed()) {
            if (isExamActiveGlobal) {
              examWindow.webContents.send('browser:show-toast', { message: 'You cannot open new tabs while taking an active exam.', type: 'error' });
            } else {
              examWindow.webContents.send('host:tab-new-shortcut');
            }
          }
          return;
        }

        // Ctrl + Shift + W (Close all tabs)
        if (isShift && code === 'KeyW') {
          inputEvent.preventDefault();
          if (examWindow && !examWindow.isDestroyed()) {
            if (isExamActiveGlobal) {
              examWindow.webContents.send('browser:show-toast', { message: 'You cannot close tabs while taking an active exam.', type: 'error' });
            } else {
              examWindow.webContents.send('host:tab-close-all-shortcut');
            }
          }
          return;
        }

        // Ctrl + W
        if (!isShift && code === 'KeyW') {
          inputEvent.preventDefault();
          if (examWindow && !examWindow.isDestroyed()) {
            if (isExamActiveGlobal) {
              examWindow.webContents.send('browser:show-toast', { message: 'You cannot close tabs while taking an active exam.', type: 'error' });
            } else {
              examWindow.webContents.send('host:tab-close-shortcut');
            }
          }
          return;
        }

        // Ctrl + E (Focus Search)
        if (!isShift && code === 'KeyE') {
          inputEvent.preventDefault();
          if (examWindow && !examWindow.isDestroyed()) {
            examWindow.webContents.send('host:focus-search-shortcut');
          }
          return;
        }

        // Ctrl + H (History)
        if (!isShift && code === 'KeyH') {
          inputEvent.preventDefault();
          if (examWindow && !examWindow.isDestroyed()) {
            examWindow.webContents.send('host:history-shortcut');
          }
          return;
        }

        // Ctrl + J (Downloads)
        if (!isShift && code === 'KeyJ') {
          inputEvent.preventDefault();
          if (examWindow && !examWindow.isDestroyed()) {
            examWindow.webContents.send('host:downloads-shortcut');
          }
          return;
        }

        // Ctrl + M (Magnifier)
        if (!isShift && code === 'KeyM') {
          inputEvent.preventDefault();
          if (examWindow && !examWindow.isDestroyed()) {
            examWindow.webContents.send('host:magnifier-shortcut');
          }
          return;
        }
      }
    });

    // Push config directly from the main process on every page load.
    // Guard with isDestroyed() — rapid-redirect sites (e.g. LinkedIn) can dispose
    // the render frame between dom-ready firing and the .send() call, which throws
    // "Render frame was disposed before WebFrameMain could be accessed".
    contents.on('dom-ready', () => {
      if (contents.isDestroyed()) return;
      try {
        const cfg = config.get();
        // Strip sensitive fields before sending
        const safeCfg = { ...cfg };
        delete safeCfg.exitPasswordHash;
        delete safeCfg.exitPasswordSalt;
        delete safeCfg.adminPasswordHash;
        delete safeCfg.adminPasswordSalt;
        contents.send('seb:config', safeCfg);
      } catch (err) {
        // Frame was disposed between the guard and the send — silently ignore
        if (!err.message || !err.message.includes('disposed')) {
          console.error('[Main] Failed to push seb:config on dom-ready:', err);
        }
      }
    });


    // Only forward warnings and errors from webviews to the terminal.
    // Level 0 = log/info (extremely noisy — every site's analytics spam),
    // Level 1 = warning, Level 2 = error, Level 3 = debug.
    contents.on('console-message', (event, level, message, line, sourceId) => {
      if (level < 1) return; // Silence log/info entirely

      // Drop CSS-styled console messages (%c/%d markers) — these are browser
      // developer tricks that look like garbage in a raw terminal.
      if (message.startsWith('%c') || message.startsWith('%d')) return;

      // Drop well-known third-party noise that isn't actionable:
      if (
        message.includes('Electron Security Warning') ||   // Electron's own CSP nag (shown until packaged)
        message.includes('ch-ua-form-factors') ||          // Unrecognised Permissions-Policy feature
        message.includes('speculation rules') ||           // Browser speculation API (Chrome-only)
        message.includes('font-size:0') ||                 // CSS-formatted hidden console.log tricks
        message.includes('challenges.cloudflare.com') ||  // Cloudflare Turnstile challenge noise
        message.includes('GoTrueClient') ||                // Supabase auth duplicate instance warning
        message.includes('willReadFrequently')             // Canvas2D performance hint
      ) return;

      const tag = level === 1 ? 'WARN' : 'ERROR';
      console.log(`[Webview ${tag}] ${message} (at ${sourceId}:${line})`);
    });

  }
});

// ─── Remote Management Server Sync & Telemetry ──────────────────────────────

async function syncRemoteConfig() {
  const cfg = config.get();
  if (!cfg.remoteServerUrl) return { success: false, error: 'No remote server URL configured' };

  try {
    const url = `${cfg.remoteServerUrl.replace(/\/$/, '')}/config`;
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.clientAuthToken) {
      headers['Authorization'] = `Bearer ${cfg.clientAuthToken}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (!response.ok) {
      throw new Error(`Server returned status ${response.status}`);
    }

    const remoteData = await response.json();
    if (remoteData && typeof remoteData === 'object') {
      config.save(remoteData);
      auditLog.log('REMOTE_CONFIG_SYNCED');
      return { success: true };
    } else {
      throw new Error('Invalid config response format');
    }
  } catch (err) {
    auditLog.log('REMOTE_CONFIG_SYNC_FAILED', { error: err.message });
    return { success: false, error: err.message };
  }
}

async function sendHeartbeat() {
  const cfg = config.get();
  if (!cfg.remoteServerUrl || !cfg.features.clientHeartbeat) return;

  try {
    const url = `${cfg.remoteServerUrl.replace(/\/$/, '')}/heartbeat`;
    const headers = { 'Content-Type': 'application/json' };
    if (cfg.clientAuthToken) {
      headers['Authorization'] = `Bearer ${cfg.clientAuthToken}`;
    }

    let activeUrl = cfg.examUrl;
    let tabsCount = (cfg.openTabs || []).length;

    const payload = {
      clientToken: cfg.clientAuthToken,
      hostname: os.hostname(),
      platform: process.platform,
      examMode,
      activeUrl,
      tabsCount,
      connectedDisplays: screen.getAllDisplays().length,
      timestamp: new Date().toISOString(),
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    if (!response.ok) {
      console.warn(`[Telemetry] Heartbeat failed with status: ${response.status}`);
    }
  } catch (err) {
    console.error('[Telemetry] Heartbeat error:', err.message);
  }
}

function startHeartbeat() {
  stopHeartbeat();
  const cfg = config.get();
  if (cfg.remoteServerUrl && cfg.features.clientHeartbeat) {
    sendHeartbeat();
    heartbeatInterval = setInterval(sendHeartbeat, 30000);
  }
}

function stopHeartbeat() {
  if (heartbeatInterval) {
    clearInterval(heartbeatInterval);
    heartbeatInterval = null;
  }
}

// ─── Remote Management IPC Handlers ──────────────────────────────────────────

ipcMain.handle('admin:testRemoteConnection', async (_, { url, token }) => {
  try {
    const endpoint = `${url.replace(/\/$/, '')}/config`;
    const headers = { 'Content-Type': 'application/json' };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 4000);
    const response = await fetch(endpoint, { headers, signal: controller.signal });
    clearTimeout(timeoutId);

    if (response.ok) {
      return { success: true };
    } else {
      return { success: false, error: `Server returned status ${response.status}` };
    }
  } catch (err) {
    return { success: false, error: err.message };
  }
});

ipcMain.handle('admin:syncConfigNow', async () => {
  return await syncRemoteConfig();
});

function checkVirtualMachine(callback) {
  if (process.platform !== 'win32') {
    return callback(false); // Standard bypass for non-Windows dev systems
  }

  // WMI check is extremely lightweight and standard on Windows systems
  exec('wmic path win32_computersystem get manufacturer,model', (err, stdout) => {
    if (err) return callback(false);
    const output = stdout.toLowerCase();
    const vmKeywords = ['virtualbox', 'vmware', 'hyper-v', 'qemu', 'xen', 'parallels', 'virtual machine'];
    const isVm = vmKeywords.some(kw => output.includes(kw));

    if (isVm) {
      callback(true);
    } else {
      // Secondary check: BIOS manufacturer
      exec('wmic path win32_bios get manufacturer', (err2, stdout2) => {
        if (err2) return callback(false);
        const biosOutput = stdout2.toLowerCase();
        const isVmBios = vmKeywords.some(kw => biosOutput.includes(kw));
        callback(isVmBios);
      });
    }
  });
}

