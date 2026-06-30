/**
 * examPreload.js — Injected into exam pages via Electron contextBridge
 * Blocks: copy, cut, paste, contextmenu, drag, text selection, devtools shortcuts
 *
 * Config is delivered via two mechanisms (whichever fires first wins):
 *   1. browser.js pushes 'seb:config' on webview dom-ready  (primary, reliable)
 *   2. ipcRenderer.invoke fallback in case the push is missed
 */

const { ipcRenderer } = require('electron');

let cfg = null;
let configApplied = false;

function applyConfig(receivedConfig) {
  if (configApplied) return; // only apply once
  configApplied = true;
  cfg = receivedConfig;

  // Apply text-selection restriction when blockCopyPaste is active
  if (!cfg || !cfg.features || cfg.features.blockCopyPaste !== false) {
    const textSelectStyle = document.createElement('style');
    textSelectStyle.textContent = `
      * {
        -webkit-user-select: none !important;
        user-select: none !important;
      }
      input, textarea, [contenteditable] {
        -webkit-user-select: text !important;
        user-select: text !important;
      }
    `;
    document.head.appendChild(textSelectStyle);
  }
}

// Primary: browser.js pushes config here on webview dom-ready
ipcRenderer.on('seb:config', (_, receivedConfig) => {
  applyConfig(receivedConfig);
});

// Fallback: pull from main process in case the push was missed
ipcRenderer.invoke('admin:getConfig').then(c => {
  applyConfig(c);
}).catch(err => {
  console.error('[examPreload] Failed to load config via IPC fallback:', err);
});

// ─── Block copy/cut/paste ─────────────────────────────────────────────────────

document.addEventListener('copy', (e) => {
  if (cfg && cfg.features && cfg.features.blockCopyPaste === false) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  ipcRenderer.send('exam-event', { type: 'COPY_ATTEMPTED' });
}, true);

document.addEventListener('cut', (e) => {
  if (cfg && cfg.features && cfg.features.blockCopyPaste === false) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  ipcRenderer.send('exam-event', { type: 'CUT_ATTEMPTED' });
}, true);

document.addEventListener('paste', (e) => {
  if (cfg && cfg.features && cfg.features.blockCopyPaste === false) return;
  e.preventDefault();
  e.stopImmediatePropagation();
  ipcRenderer.send('exam-event', { type: 'PASTE_ATTEMPTED' });
}, true);

// ─── Block right-click context menu ──────────────────────────────────────────

document.addEventListener('contextmenu', (e) => {
  if (cfg && cfg.features && cfg.features.blockRightClick === false) return;
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);

// ─── Block drag & drop ────────────────────────────────────────────────────────

document.addEventListener('dragstart', (e) => {
  if (cfg && cfg.features && cfg.features.blockCopyPaste === false) return;
  e.preventDefault();
}, true);

document.addEventListener('drop', (e) => {
  if (cfg && cfg.features && cfg.features.blockCopyPaste === false) return;
  e.preventDefault();
}, true);

// ─── Custom overlay styles (CSS-based) ──────────────────

const style = document.createElement('style');
style.textContent = `
  /* Floating X close button */
  #__seb_floating_close_btn {
    position: fixed;
    top: 20px;
    right: 20px;
    width: 44px;
    height: 44px;
    background: rgba(15, 23, 42, 0.7) !important;
    backdrop-filter: blur(8px) !important;
    -webkit-backdrop-filter: blur(8px) !important;
    border: 1px solid rgba(255, 255, 255, 0.15) !important;
    border-radius: 50% !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    color: #ffffff !important;
    font-size: 20px !important;
    font-weight: 300 !important;
    cursor: pointer !important;
    z-index: 2147483645 !important;
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.3) !important;
    transition: all 0.3s ease !important;
    user-select: none !important;
    -webkit-user-select: none !important;
  }
  
  #__seb_floating_close_btn:hover {
    background: rgba(239, 68, 68, 0.9) !important;
    border-color: rgba(239, 68, 68, 0.4) !important;
    transform: scale(1.1) !important;
    box-shadow: 0 0 15px rgba(239, 68, 68, 0.4) !important;
  }
  
  /* Password Exit dialog styles */
  #__seb_exit_dialog {
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(10, 14, 26, 0.85) !important;
    backdrop-filter: blur(12px) !important;
    -webkit-backdrop-filter: blur(12px) !important;
    display: flex !important;
    align-items: center !important;
    justify-content: center !important;
    z-index: 2147483647 !important;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif !important;
  }
  
  #__seb_exit_password_input:focus {
    border-color: #6366f1 !important;
    box-shadow: 0 0 0 2px rgba(99, 102, 241, 0.2) !important;
  }
  
  .__seb_exit_btn {
    flex: 1;
    border: none;
    padding: 12px;
    border-radius: 8px;
    cursor: pointer;
    font-size: 14px;
    font-weight: 500;
    transition: all 0.2s ease;
  }
  
  #__seb_exit_cancel_btn {
    background: rgba(255, 255, 255, 0.05) !important;
    color: #d1d5db !important;
    border: 1px solid rgba(255, 255, 255, 0.1) !important;
  }
  
  #__seb_exit_cancel_btn:hover {
    background: rgba(255, 255, 255, 0.1) !important;
  }
  
  #__seb_exit_submit_btn {
    background: #6366f1 !important;
    color: white !important;
    box-shadow: 0 4px 6px -1px rgba(99, 102, 241, 0.3) !important;
    font-weight: 600 !important;
  }
  
  #__seb_exit_submit_btn:hover {
    background: #4f46e5 !important;
  }
`;
document.head.appendChild(style);

// ─── Floating close button injection ──────────────────────────────────────────
// Initialize on DOM load
window.addEventListener('DOMContentLoaded', () => {
  _injectFloatingCloseButton();
  _setupGoogleAiShield();
});

function _injectFloatingCloseButton() {
  // Prevent duplicate floating buttons
  if (document.getElementById('__seb_floating_close_btn')) return;

  const btn = document.createElement('div');
  btn.id = '__seb_floating_close_btn';
  btn.innerHTML = '✕';
  btn.title = 'Exit Exam';
  
  btn.addEventListener('click', () => {
    _showExitDialog();
  });
  
  document.body.appendChild(btn);
}

function _showExitDialog() {
  // Prevent duplicate dialogs
  if (document.getElementById('__seb_exit_dialog')) return;
  
  const dialog = document.createElement('div');
  dialog.id = '__seb_exit_dialog';
  dialog.innerHTML = `
    <div style="
      background: rgba(30, 41, 59, 0.7);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      padding: 32px 40px;
      width: 380px;
      box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);
      text-align: center;
      box-sizing: border-box;
    ">
      <h3 style="color: #f3f4f6; margin: 0 0 12px; font-size: 20px; font-weight: 600;">Exit Exam Session</h3>
      <p style="color: #9ca3af; margin: 0 0 24px; font-size: 14px; line-height: 1.5; text-align: center;">
        Are you sure you want to exit the exam session? Unsaved changes may be lost.
      </p>
      
      <div style="display: flex; gap: 12px; margin-top: 16px; width: 100%;">
        <button id="__seb_exit_cancel_btn" class="__seb_exit_btn">Cancel</button>
        <button id="__seb_exit_submit_btn" class="__seb_exit_btn">Exit Session</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(dialog);
  
  const cancelBtn = dialog.querySelector('#__seb_exit_cancel_btn');
  const submitBtn = dialog.querySelector('#__seb_exit_submit_btn');
  
  cancelBtn.addEventListener('click', () => {
    dialog.remove();
  });
  
  const attemptExit = async () => {
    try {
      await ipcRenderer.invoke('admin:quit');
    } catch (err) {
      console.error('Exit failed:', err);
    }
  };
  
  submitBtn.addEventListener('click', attemptExit);
  
  window.addEventListener('keydown', function escHandler(e) {
    if (e.key === 'Escape') {
      dialog.remove();
      window.removeEventListener('keydown', escHandler);
    }
  });
}

// Blocked overlay removed in favor of chrome-level custom Toast notifications.

function _setupGoogleAiShield() {
  const host = window.location.hostname;
  if (!host.includes('google.')) return;

  const injectShield = () => {
    // 1. Inject CSS to hide all known AI Overview containers & SGE widgets
    const styleId = '__seb_google_ai_shield_css';
    if (!document.getElementById(styleId)) {
      const style = document.createElement('style');
      style.id = styleId;
      style.innerHTML = `
        /* Hide SGE/AI Overview/Gemini widgets */
        div[data-sge-type],
        div[data-sge],
        div.sge-root,
        div.SGE,
        #sge-root,
        #sge-results,
        div[data-md*="sge"],
        div[class*="sge_"],
        div[class*="SGE_"],
        div[data-share-url*="gemini"],
        div[class*="Sge"],
        /* Hide generative search prompt areas */
        div[class*="gemini-"],
        /* Navigation tabs: hide AI Mode tab */
        a[href*="udm=14"] {
          display: none !important;
        }
      `;
      document.head.appendChild(style);
    }

    // 2. Hide "AI Mode" navigation elements by text content matching
    const items = document.querySelectorAll('a, div, span, button');
    for (const el of items) {
      if (el.textContent && el.textContent.trim().toLowerCase() === 'ai mode') {
        const parent = el.closest('div[role="listitem"]') || el.closest('a') || el;
        if (parent && parent.style.display !== 'none') {
          parent.style.setProperty('display', 'none', 'important');
        }
      }
    }

    // 3. Hide bottom SGE chat input box if present
    const textareas = document.querySelectorAll('textarea, input');
    for (const el of textareas) {
      const placeholder = el.placeholder || '';
      if (placeholder.includes('Ask anything') || placeholder.includes('Converse')) {
        const parent = el.closest('div');
        if (parent && parent.style.display !== 'none') {
          parent.style.setProperty('display', 'none', 'important');
        }
      }
    }
  };

  // Run immediately on script load, on DOMContentLoaded, and observe DOM changes
  injectShield();
  window.addEventListener('DOMContentLoaded', injectShield);

  // Setup MutationObserver to continuously strip AI elements (for Google Search SPAs)
  const observer = new MutationObserver(() => {
    injectShield();
  });
  
  observer.observe(document.documentElement, {
    childList: true,
    subtree: true
  });
}
