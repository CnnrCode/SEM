/**
 * screenGuard.js — Screen capture prevention & clipboard control
 * Uses Electron's setContentProtection() which wraps:
 *   Windows: SetWindowDisplayAffinity(WDA_EXCLUDEFROMCAPTURE)
 *   macOS:   CGWindowListSetWindowProperty
 */

const { clipboard } = require('electron');
const { exec } = require('child_process');
const crypto = require('crypto');
const auditLog = require('./auditLog');
const config = require('./config');

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
let _aiProcessWatchdog = null;

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

function startAiProcessWatchdog() {
  if (process.platform !== 'win32') return;
  _aiProcessWatchdog = setInterval(() => {
    _blockAiProcesses();
  }, 4000);
}

function stopAiProcessWatchdog() {
  if (_aiProcessWatchdog) {
    clearInterval(_aiProcessWatchdog);
    _aiProcessWatchdog = null;
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

function _blockAiProcesses() {
  const processes = [
    'ollama.exe',
    'lmstudio.exe',
    'jan.exe',
    'mscopilot.exe',
    'chatgpt.exe',
    'cursor.exe',
  ];
  processes.forEach((p) => {
    exec(`taskkill /f /im "${p}" 2>nul`, (err, stdout) => {
      if (stdout && stdout.toLowerCase().includes('success')) {
        auditLog.log('AI_PROCESS_KILLED', { process: p });
        console.warn(`[ScreenGuard] AI process ${p} was detected and terminated.`);
      }
    });
  });
}

let _clipboardWatchdog = null;
let _lastClipboardText = '';

function startClipboardWatchdog() {
  try {
    _lastClipboardText = clipboard.readText();
  } catch (err) {
    _lastClipboardText = '';
  }
  _clipboardWatchdog = setInterval(() => {
    _checkClipboard();
  }, 2000);
  console.log('[ScreenGuard] Clipboard watchdog started.');
}

function stopClipboardWatchdog() {
  if (_clipboardWatchdog) {
    clearInterval(_clipboardWatchdog);
    _clipboardWatchdog = null;
  }
  console.log('[ScreenGuard] Clipboard watchdog stopped.');
}

function _checkClipboard() {
  let currentText;
  try {
    currentText = clipboard.readText();
  } catch (err) {
    return;
  }

  if (currentText && currentText !== _lastClipboardText) {
    _lastClipboardText = currentText;

    // 1. Generate fingerprint (hash of text)
    const hash = crypto.createHash('sha256').update(currentText).digest('hex').substring(0, 8);
    auditLog.log('CLIPBOARD_CHANGED', { fingerprint: hash, length: currentText.length });

    // 2. AI-text heuristic check:
    // - Length > 200 chars
    // - Low pronoun density (I, me, my, we, us)
    // - Structured patterns (bullet points, headers)
    if (currentText.length > 200) {
      const hasBulletPoints = /^[ \t]*[-*+•] /m.test(currentText) || /^[ \t]*\d+\. /m.test(currentText);
      const hasMarkdown = /^(#+ |\*\*|`)/m.test(currentText);
      
      const pronounMatch = currentText.match(/\b(i|me|my|we|us|our)\b/gi);
      const pronounCount = pronounMatch ? pronounMatch.length : 0;
      const pronounDensity = pronounCount / currentText.length;
      
      if ((hasBulletPoints || hasMarkdown) && pronounDensity < 0.005) {
        auditLog.log('SUSPICIOUS_CLIPBOARD', { fingerprint: hash, reason: 'ai_heuristics_matched' });
        console.warn('[ScreenGuard] Suspicious AI-like text detected in clipboard:', hash);
        
        const cfg = config.get();
        if (cfg.features.clearClipboardOnExit) {
          clearClipboard();
        }
      }
    }
  }
}

module.exports = {
  init,
  enableScreenProtection,
  disableScreenProtection,
  clearClipboard,
  startSnippingWatchdog,
  stopSnippingWatchdog,
  startAiProcessWatchdog,
  stopAiProcessWatchdog,
  startClipboardWatchdog,
  stopClipboardWatchdog,
};
