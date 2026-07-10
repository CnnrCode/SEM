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
  // New window (keep blocked, but not new tab)
  'Ctrl+N',
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
  'Super+P',           // Windows Projection (force closes the app)
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
        if (shortcut === 'Super+P') {
          auditLog.log('VIOLATION_FORCE_CLOSE', { shortcut, reason: 'Display projection attempt (Win+P)' });
          app.exit(0);
        } else {
          auditLog.log('SHORTCUT_BLOCKED', { shortcut });
        }
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

// Windows: Skip registry modifications and taskbar hiding to behave like a standard browser
function _windowsLockdown() {
  console.log('[Lockdown] Windows deep lockdown skipped (standard browser behavior).');
}

// Restore Windows settings (no-op since lockdown is simplified)
function _windowsUnlockdown() {
  console.log('[Lockdown] Windows deep lockdown cleared.');
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

    // DevTools shortcuts (F12, Ctrl+Shift+I/J/C, Ctrl+U)
    if (key === 'f12' || (isControl && isShift && (key === 'i' || key === 'j' || key === 'c')) || (isControl && key === 'u')) {
      event.preventDefault();
      auditLog.log('SHORTCUT_BLOCKED', { shortcut: 'DevTools' });
      return;
    }

    // Keyboard Shortcuts (General Lockdown)
    if (!cfg || cfg.features.blockKeyboardShortcuts !== false) {
      // Windows 11 Copilot / Xbox overlays via Super keys
      if (isMeta && (key === 'c' || key === 'g' || (isShift && key === 'f'))) {
        event.preventDefault();
        auditLog.log('SHORTCUT_BLOCKED', { shortcut: 'Super+' + key.toUpperCase() });
        return;
      }
      // Windows + P (Display projection) → force close app
      if (isMeta && key === 'p') {
        event.preventDefault();
        auditLog.log('VIOLATION_FORCE_CLOSE', { shortcut: 'Super+P', reason: 'Display projection attempt (Win+P)' });
        app.exit(0);
        return;
      }
      // Alt+Tab
      if (isAlt && key === 'tab') {
        event.preventDefault();
        auditLog.log('SHORTCUT_BLOCKED', { shortcut: 'Alt+Tab' });
        return;
      }
      // F5 and Ctrl+R are bypassed here as they are handled globally for browser tab reloads.
      // Ctrl+N (New Window)
      if (isControl && key === 'n') {
        event.preventDefault();
        auditLog.log('SHORTCUT_BLOCKED', { shortcut: 'Ctrl+N' });
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
