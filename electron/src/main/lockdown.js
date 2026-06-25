/**
 * lockdown.js — Keyboard shortcut and system lockdown for SecureExam Browser
 * Blocks dangerous key combos via Electron's globalShortcut + platform-specific hooks.
 */

const { globalShortcut, app } = require('electron');
const { exec } = require('child_process');
const auditLog = require('./auditLog');

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
  // Zoom
  'Ctrl+Plus',
  'Ctrl+Minus',
  'Ctrl+0',
  // Misc
  'Ctrl+P',             // Print
  'Ctrl+S',             // Save
  'F1',                 // Help
  'F3',                 // Find
  'F6',                 // Address bar focus
  'F10',               // Menu bar
  'F11',               // Fullscreen toggle (we manage this ourselves)
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

module.exports = { registerAll, unregisterAll };
