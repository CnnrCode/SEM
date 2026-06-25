/**
 * examPreload.js — Injected into exam pages via Electron contextBridge
 * Blocks: copy, cut, paste, contextmenu, drag, text selection, devtools shortcuts
 */

const { ipcRenderer } = require('electron');

let cfg = null;

// Async load config to respect feature flags
ipcRenderer.invoke('admin:getConfig').then(c => {
  cfg = c;
  
  // Apply text selection restriction if blockCopyPaste is active
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
}).catch(err => {
  console.error('Failed to load config in preload', err);
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

window.addEventListener('DOMContentLoaded', () => {
  _injectFloatingCloseButton();
});

function _injectFloatingCloseButton() {
  // Prevent duplicate floating buttons
  if (document.getElementById('__seb_floating_close_btn')) return;

  const btn = document.createElement('div');
  btn.id = '__seb_floating_close_btn';
  btn.innerHTML = '✕';
  btn.title = 'Exit Exam';
  
  btn.addEventListener('click', async () => {
    try {
      const hasPassword = await ipcRenderer.invoke('exam:hasExitPassword');
      if (hasPassword) {
        _showExitDialog();
      } else {
        await ipcRenderer.invoke('admin:quit', '');
      }
    } catch (err) {
      console.error('Failed to query exit password status, falling back to dialog:', err);
      _showExitDialog();
    }
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
        Enter the exit password to unlock the device and close the browser.
      </p>
      
      <input type="password" id="__seb_exit_password_input" placeholder="Password" style="
        width: 100%; background: rgba(15, 23, 42, 0.6);
        border: 1px solid rgba(255, 255, 255, 0.1);
        border-radius: 8px; padding: 12px 16px; color: #ffffff;
        font-size: 15px; margin-bottom: 12px; box-sizing: border-box;
        outline: none; transition: border-color 0.2s;
      " />
      
      <div id="__seb_exit_error_msg" style="
        color: #ef4444; font-size: 13px; text-align: left;
        margin: -4px 0 16px 4px; display: none;
      ">
        Incorrect exit password. Access denied.
      </div>
      
      <div style="display: flex; gap: 12px; margin-top: 16px; width: 100%;">
        <button id="__seb_exit_cancel_btn" class="__seb_exit_btn">Cancel</button>
        <button id="__seb_exit_submit_btn" class="__seb_exit_btn">Exit Session</button>
      </div>
    </div>
  `;
  
  document.body.appendChild(dialog);
  
  const cancelBtn = dialog.querySelector('#__seb_exit_cancel_btn');
  const submitBtn = dialog.querySelector('#__seb_exit_submit_btn');
  const pwdInput = dialog.querySelector('#__seb_exit_password_input');
  const errorMsg = dialog.querySelector('#__seb_exit_error_msg');
  
  pwdInput.focus();
  
  cancelBtn.addEventListener('click', () => {
    dialog.remove();
  });
  
  const attemptExit = async () => {
    const password = pwdInput.value;
    errorMsg.style.display = 'none';
    
    try {
      const response = await ipcRenderer.invoke('admin:quit', password);
      if (response && response.success) {
        // App will exit
      } else {
        errorMsg.style.display = 'block';
        pwdInput.value = '';
        pwdInput.focus();
      }
    } catch (err) {
      console.error('Exit failed:', err);
      errorMsg.textContent = 'Connection error.';
      errorMsg.style.display = 'block';
    }
  };
  
  submitBtn.addEventListener('click', attemptExit);
  
  pwdInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      attemptExit();
    }
    if (e.key === 'Escape') {
      dialog.remove();
    }
  });
}


// ─── Listen for url-blocked message and show overlay ─────────────────────────

ipcRenderer.on('url-blocked', (_, { url }) => {
  _showBlockedOverlay(url);
});

function _showBlockedOverlay(url) {
  // Remove existing overlay
  const existing = document.getElementById('__seb_blocked_overlay');
  if (existing) existing.remove();

  const overlay = document.createElement('div');
  overlay.id = '__seb_blocked_overlay';
  overlay.innerHTML = `
    <div style="
      position: fixed; top: 0; left: 0; width: 100%; height: 100%;
      background: rgba(10,14,26,0.95);
      display: flex; align-items: center; justify-content: center;
      z-index: 2147483647; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    ">
      <div style="
        background: #1a1f35; border: 1px solid #ef4444;
        border-radius: 16px; padding: 40px 48px; text-align: center;
        max-width: 480px;
      ">
        <div style="font-size: 48px; margin-bottom: 16px;">🚫</div>
        <h2 style="color: #ef4444; font-size: 22px; margin: 0 0 12px;">Access Blocked</h2>
        <p style="color: #94a3b8; font-size: 14px; margin: 0 0 8px;">
          This URL is not allowed during the exam session.
        </p>
        <code style="
          display: block; background: #0f1322; color: #f87171;
          padding: 8px 12px; border-radius: 8px; font-size: 12px;
          word-break: break-all; margin: 12px 0 24px;
        ">${url}</code>
        <button onclick="document.getElementById('__seb_blocked_overlay').remove()" style="
          background: #4f8ef7; color: white; border: none;
          padding: 10px 28px; border-radius: 8px; cursor: pointer;
          font-size: 14px; font-weight: 600;
        ">Back to Exam</button>
      </div>
    </div>
  `;
  document.body.appendChild(overlay);

  // Auto-dismiss after 5 seconds
  setTimeout(() => {
    if (overlay.parentNode) overlay.remove();
  }, 5000);
}
