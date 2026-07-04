/**
 * examPreload.js — Injected into exam pages via Electron contextBridge
 * Blocks: copy, cut, paste, contextmenu, drag, text selection, devtools shortcuts
 *
 * Config is delivered via two mechanisms (whichever fires first wins):
 *   1. browser.js pushes 'seb:config' on webview dom-ready  (primary, reliable)
 *   2. ipcRenderer.invoke fallback in case the push is missed
 */

const { ipcRenderer, webFrame } = require('electron');

let cfg = null;
let configApplied = false;
let cfgZoomFactor = 1.0;

// Listen for zoom commands from the host window
ipcRenderer.on('guest:set-zoom', (event, factor) => {
  cfgZoomFactor = factor;
  try {
    webFrame.setZoomFactor(factor);
  } catch (err) {
    console.error('[Preload] Failed to set zoom factor:', err);
  }
});

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

// (Overlay exit dialog and floating close styles removed)

_setupZoomShortcuts();

// Initialize on DOM load
window.addEventListener('DOMContentLoaded', () => {
  _setupGoogleAiShield();
});

function _setupZoomShortcuts() {
  document.addEventListener('keydown', (e) => {
    const isControl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    
    const isPlus = key === '+' || key === '=' || key === 'add';
    const isMinus = key === '-' || key === 'subtract';
    const isReset = key === '0';
    
    let zoomAction = null;
    if (isPlus) zoomAction = 'in';
    else if (isMinus) zoomAction = 'out';
    else if (isReset) zoomAction = 'reset';
    
    if (isControl && zoomAction !== null) {
      e.preventDefault();
      handleLocalZoom(zoomAction);
    }
  }, true);

  document.addEventListener('wheel', (e) => {
    if (e.ctrlKey || e.metaKey) {
      e.preventDefault();
      if (e.deltaY < 0) {
        handleLocalZoom('in');
      } else if (e.deltaY > 0) {
        handleLocalZoom('out');
      }
    }
  }, { capture: true, passive: false });
}

function handleLocalZoom(action) {
  if (magnifierActive) {
    ipcRenderer.sendToHost('guest-magnifier-zoom', action);
    return;
  }

  let newZoom = cfgZoomFactor;
  if (action === 'in') {
    newZoom += 0.1;
  } else if (action === 'out') {
    newZoom -= 0.1;
  } else if (action === 'reset') {
    newZoom = 1.0;
  }
  
  newZoom = Math.max(0.5, Math.min(3.0, newZoom));
  cfgZoomFactor = parseFloat(newZoom.toFixed(1));
  
  try {
    webFrame.setZoomFactor(cfgZoomFactor);
    // Tell the host window that zoom changed
    ipcRenderer.sendToHost('webview-zoom-changed', { zoomFactor: cfgZoomFactor });
    // Log event to main process
    ipcRenderer.send('exam-event', { type: 'BROWSER_ZOOM_CHANGED', level: `${Math.round(cfgZoomFactor * 100)}%` });
  } catch (err) {
    console.error('[Preload] Failed to apply local zoom:', err);
  }
}

// (Overlay exit dialog and floating close functions removed)

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

// ─── Magnifier Loupe Events ──────────────────────────────────────────────
let magnifierActive = false;
let localLastX = 200;
let localLastY = 200;
let frameRequested = false;
let scrollTimeout = null;

function triggerCoordinatesReport() {
  if (!frameRequested) {
    frameRequested = true;
    requestAnimationFrame(() => {
      frameRequested = false;
      if (magnifierActive) {
        ipcRenderer.sendToHost('guest-magnifier-move', {
          x: localLastX,
          y: localLastY,
          scrollX: window.scrollX,
          scrollY: window.scrollY
        });
      }
    });
  }
}

ipcRenderer.on('guest:set-magnifier-active', (event, active) => {
  magnifierActive = active;
  if (active) {
    // Reply immediately with the last known position and scroll offsets to prevent blinking
    ipcRenderer.sendToHost('guest-magnifier-move', {
      x: localLastX,
      y: localLastY,
      scrollX: window.scrollX,
      scrollY: window.scrollY
    });
  }
});

document.addEventListener('mousemove', (e) => {
  localLastX = e.clientX;
  localLastY = e.clientY;
  
  if (magnifierActive) {
    triggerCoordinatesReport();
  }
});

document.addEventListener('scroll', () => {
  if (magnifierActive) {
    triggerCoordinatesReport();
    
    // Debounce the snapshot recapture until scrolling stops
    clearTimeout(scrollTimeout);
    scrollTimeout = setTimeout(() => {
      if (magnifierActive) {
        ipcRenderer.sendToHost('guest-magnifier-scroll-ended');
      }
    }, 200);
  }
}, true);

// Dismiss host menus/popovers when clicking inside the guest page webview
document.addEventListener('mousedown', () => {
  ipcRenderer.sendToHost('guest-click');
});
