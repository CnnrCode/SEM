/**
 * screenGuard.js — Screen capture prevention & clipboard control
 * Uses Electron's setContentProtection() which wraps:
 *   Windows: SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)
 *   macOS:   CGWindowListSetWindowProperty
 */

const { clipboard } = require('electron');
const { exec } = require('child_process');
const auditLog = require('./auditLog');

let _mainWindow = null;

/**
 * Initialize with the main BrowserWindow reference.
 * @param {BrowserWindow} win
 */
function init(win) {
  _mainWindow = win;
}

/**
 * Enable content protection (black in screenshots/recordings).
 */
function enableScreenProtection() {
  if (!_mainWindow) return;
  _mainWindow.setContentProtection(true);
  console.log('[ScreenGuard] Content protection enabled.');

  if (process.platform === 'win32') {
    _blockSnippingToolWindows();
  }
}

/**
 * Disable content protection (called in admin mode or on exit).
 */
function disableScreenProtection() {
  if (!_mainWindow) return;
  _mainWindow.setContentProtection(false);
}

/**
 * Clear the system clipboard.
 */
function clearClipboard() {
  clipboard.clear();
  auditLog.log('CLIPBOARD_CLEARED');
  console.log('[ScreenGuard] Clipboard cleared.');
}

/**
 * Windows: kill the Snipping Tool and SnippingTool processes if they start.
 * Runs periodically during exam session.
 */
let _snippingWatchdog = null;

function startSnippingWatchdog() {
  if (process.platform !== 'win32') return;
  _snippingWatchdog = setInterval(() => {
    _blockSnippingToolWindows();
  }, 3000);
}

function stopSnippingWatchdog() {
  if (_snippingWatchdog) {
    clearInterval(_snippingWatchdog);
    _snippingWatchdog = null;
  }
}

function _blockSnippingToolWindows() {
  const processes = [
    'SnippingTool.exe',
    'ScreenClippingHost.exe',
    'ScreenSketch.exe',
    'ShareX.exe',
    'Greenshot.exe',
    'Lightshot.exe',
  ];
  processes.forEach((p) => {
    exec(`taskkill /f /im "${p}" 2>nul`, () => {});
  });
}

module.exports = {
  init,
  enableScreenProtection,
  disableScreenProtection,
  clearClipboard,
  startSnippingWatchdog,
  stopSnippingWatchdog,
};
