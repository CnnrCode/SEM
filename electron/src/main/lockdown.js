/**
 * lockdown.js — Keyboard shortcut and system lockdown for SecureExam Browser
 * Blocks dangerous key combos via Electron's globalShortcut + platform-specific hooks.
 */

const { globalShortcut, app } = require('electron');
const { exec } = require('child_process');
const auditLog = require('./auditLog');
const config = require('./config');

// ─── List of shortcuts to block ──────────────────────────────────────────────

const BLOCKED_SHORTCUTS = [
  // Task switcher / system
  'Alt+Tab',
  'Alt+Shift+Tab',
  'Alt+F4',
  'Super+Tab',          // Win key + Tab (Task View)
  'Super+D',            // Show desktop
  'Super+E',            // Explorer
  'Super+L',            // Lock screen
  'Super+R',            // Run dialog
  'Super+S',            // Search
  'Super+I',            // Settings
  'Super+X',            // Quick link menu
  'Super+M',            // Minimize all
  'Super',              // Start menu
  'Ctrl+Escape',        // Start menu
  'Ctrl+Alt+Delete',    // Task manager / lock
  'Ctrl+Shift+Escape',  // Task manager direct
  // Screenshot
  'PrintScreen',
  'Alt+PrintScreen',
  'Ctrl+PrintScreen',
  'Super+PrintScreen',
  'Super+Shift+S',      // Snipping tool
  // DevTools / inspector
  'F12',
  'Ctrl+Shift+I',
  'Ctrl+Shift+J',
  'Ctrl+Shift+C',
  'Ctrl+U',             // View source
  // Navigation (extra safety)
  'F5',
  'Ctrl+R',
  'Ctrl+Shift+R',
  'Ctrl+F5',
  // New window (keep blocked, but not new tab)
  'Ctrl+N',
  'Ctrl+W',
  // Address bar
  'Ctrl+L',
  'Alt+D',
  // Find (allowed in some configs, blocked here by default)
  'Ctrl+F',
  // Misc
  'Ctrl+P',             // Print
  'Ctrl+S',             // Save
  'F1',                 // Help
  'F3',                 // Find
  'F6',                 // Address bar focus
  'F10',               // Menu bar
  'F11',               // Fullscreen toggle (we manage this ourselves)
  // Windows 11 AI / overlay features
  'Super+C',           // Windows Copilot
  'Super+G',           // Xbox Game Bar
  'Super+Shift+F',     // Copilot sidebar on some builds
];

let registered = [];

/**
 * Register all blocked shortcuts. Call after app is ready.
 */
function registerAll() {
  let blocked = 0;
  let failed = 0;

  for (const shortcut of BLOCKED_SHORTCUTS) {
    try {
      const ok = globalShortcut.register(shortcut, () => {
        auditLog.log('SHORTCUT_BLOCKED', { shortcut });
      });
      if (ok) {
        registered.push(shortcut);
        blocked++;
      } else {
        failed++;
      }
    } catch (e) {
      // Some shortcuts may not be registerable on all platforms — skip silently
      failed++;
    }
  }

  console.log(`[Lockdown] Registered ${blocked} shortcuts, ${failed} failed/skipped.`);
  _applyPlatformLockdown();
}

/**
 * Unregister all shortcuts (called on exit/admin mode).
 */
function unregisterAll() {
  globalShortcut.unregisterAll();
  registered = [];
  _removePlatformLockdown();
}

// ─── Platform-specific deep lockdown ─────────────────────────────────────────

function _applyPlatformLockdown() {
  if (process.platform === 'win32') {
    _windowsLockdown();
  } else if (process.platform === 'darwin') {
    _macosLockdown();
  }
  // Linux: globalShortcut + kiosk mode is sufficient for most cases
}

function _removePlatformLockdown() {
  if (process.platform === 'win32') {
    _windowsUnlockdown();
  }
}

// Windows: Disable Task Manager via registry + block Win key via registry tweak
function _windowsLockdown() {
  const commands = [
    // Disable Task Manager
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System" /v DisableTaskMgr /t REG_DWORD /d 1 /f`,
    // Disable context menu on taskbar
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer" /v NoTrayContextMenu /t REG_DWORD /d 1 /f`,
    // Hide taskbar
    `reg add "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Explorer\\StuckRects3" /v Settings /t REG_BINARY /d 28000000FE000000 /f`,
  ];

  commands.forEach((cmd) => {
    exec(cmd, (err) => {
      if (err) console.error('[Lockdown] Registry cmd failed:', err.message);
    });
  });

  // Restart Explorer to apply taskbar hide
  exec('taskkill /f /im explorer.exe', () => {
    setTimeout(() => exec('start explorer.exe'), 1500);
  });
}

// Restore Windows settings
function _windowsUnlockdown() {
  const commands = [
    `reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\System" /v DisableTaskMgr /f`,
    `reg delete "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Policies\\Explorer" /v NoTrayContextMenu /f`,
  ];
  commands.forEach((cmd) => exec(cmd, () => {}));
  // Restore taskbar
  exec('start explorer.exe', () => {});
}

// macOS: nothing extra needed — globalShortcut + kiosk handles most cases
function _macosLockdown() {
  // Could use Accessibility API to suppress Cmd+Space, Mission Control etc.
  // For now globalShortcut covers the important ones.
}

module.exports = { registerAll, unregisterAll, setupInputBarrier };

/**
 * Register before-input-event interceptor on a BrowserWindow instance.
 * @param {Electron.BrowserWindow} window
 */
function setupInputBarrier(window) {
  window.webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;

    const cfg = config.get();
    const isAlt = input.alt;
    const isControl = input.control;
    const isShift = input.shift;
    const isMeta = input.meta;
    const key = input.key.toLowerCase();

    // DevTools shortcuts (F12, Ctrl+Shift+I/J/C, Ctrl+U) are already blocked
    // at the globalShortcut level via BLOCKED_SHORTCUTS — no extra handling needed here.

    // Keyboard Shortcuts (General Lockdown)
    if (!cfg || cfg.features.blockKeyboardShortcuts !== false) {
      // Windows 11 Copilot / Xbox overlays via Super keys
      if (isMeta && (key === 'c' || key === 'g' || (isShift && key === 'f'))) {
        event.preventDefault();
        auditLog.log('SHORTCUT_BLOCKED', { shortcut: 'Super+' + key.toUpperCase() });
        return;
      }
      // Alt+Tab
      if (isAlt && key === 'tab') {
        event.preventDefault();
        auditLog.log('SHORTCUT_BLOCKED', { shortcut: 'Alt+Tab' });
        return;
      }
      // F5, Ctrl+R
      if (key === 'f5' || (isControl && key === 'r')) {
        event.preventDefault();
        auditLog.log('SHORTCUT_BLOCKED', { shortcut: key.toUpperCase() });
        return;
      }
      // Ctrl+N (New Window), Ctrl+W (Close Window)
      if (isControl && (key === 'n' || key === 'w')) {
        event.preventDefault();
        auditLog.log('SHORTCUT_BLOCKED', { shortcut: 'Ctrl+' + key.toUpperCase() });
        return;
      }
      // Ctrl+P (Print), Ctrl+S (Save)
      if (isControl && (key === 'p' || key === 's')) {
        event.preventDefault();
        auditLog.log('SHORTCUT_BLOCKED', { shortcut: 'Ctrl+' + key.toUpperCase() });
        return;
      }
      // Ctrl+F, F3 (Find)
      if ((isControl && key === 'f') || key === 'f3') {
        event.preventDefault();
        auditLog.log('SHORTCUT_BLOCKED', { shortcut: 'Find' });
        return;
      }
      // Alt+F4 (Close window)
      if (isAlt && key === 'f4') {
        event.preventDefault();
        auditLog.log('SHORTCUT_BLOCKED', { shortcut: 'Alt+F4' });
        return;
      }
      // Address bar shortcuts: Ctrl+L, Alt+D, F6
      if ((isControl && key === 'l') || (isAlt && key === 'd') || key === 'f6') {
        event.preventDefault();
        auditLog.log('SHORTCUT_BLOCKED', { shortcut: 'AddressFocus' });
        return;
      }
    }
  });
}
