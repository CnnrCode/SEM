/**
 * browser.js — Browser chrome controller for SecureExam Browser.
 * Handles tab management, webview events, navigation, and security overlays.
 */

'use strict';

let config = null;
let examPreloadPath = '';
let tabs = [];
let tabIdCounter = 0;
let activeTabId = null;
let contextMenuTabId = null;

// DOM Elements
const tabsContainer = document.getElementById('tabs-container');
const newTabBtn = document.getElementById('new-tab-btn');
const navBackBtn = document.getElementById('nav-back-btn');
const navForwardBtn = document.getElementById('nav-forward-btn');
const navRefreshBtn = document.getElementById('nav-refresh-btn');
const navHomeBtn = document.getElementById('nav-home-btn');
const addressInput = document.getElementById('address-input');
const loadingSpinner = document.getElementById('loading-spinner');
const chromeExitBtn = document.getElementById('chrome-exit-btn');
const exitModal = document.getElementById('exit-modal');
const exitSubmitBtn = document.getElementById('exit-submit-btn');
const exitCancelBtn = document.getElementById('exit-cancel-btn');
const webviewsContainer = document.getElementById('webview-views');
const tabContextMenu = document.getElementById('tab-context-menu');
const addressZoomBtn = document.getElementById('address-zoom-btn');
const addressZoomText = document.getElementById('address-zoom-text');
const zoomPopover = document.getElementById('zoom-popover');
const popoverZoomOut = document.getElementById('popover-zoom-out');
const popoverZoomIn = document.getElementById('popover-zoom-in');
const popoverZoomVal = document.getElementById('popover-zoom-val');
const popoverZoomReset = document.getElementById('popover-zoom-reset');

document.addEventListener('DOMContentLoaded', async () => {
  // Load config & preload paths
  config = await window.sebBrowser.getConfig();
  examPreloadPath = await window.sebBrowser.getExamPreloadPath();

  // Adjust tabs-bar padding for native title bar overlays (frameless window controls)
  const platform = navigator.platform.toLowerCase();
  const isWin = platform.includes('win');
  const isMac = platform.includes('mac');
  const tabsBar = document.getElementById('tabs-bar');
  if (tabsBar) {
    if (isWin) {
      tabsBar.style.paddingRight = '140px';
    } else if (isMac) {
      tabsBar.style.paddingLeft = '80px';
    }
  }

  // Create initial tab (Exam Tab - cannot be closed)
  const initialUrl = config.examUrl || 'about:blank';
  createTab(initialUrl, false, 'Exam');

  // Event Listeners
  newTabBtn.addEventListener('click', () => createTab('https://www.google.com', true));
  navBackBtn.addEventListener('click', navigateBack);
  navForwardBtn.addEventListener('click', navigateForward);
  navRefreshBtn.addEventListener('click', navigateRefresh);
  navHomeBtn.addEventListener('click', navigateHome);

  // Zoom Button & Popover Listeners
  if (addressZoomBtn) {
    addressZoomBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleZoomPopover();
    });
  }

  if (popoverZoomOut) popoverZoomOut.addEventListener('click', (e) => { e.stopPropagation(); zoomActiveTab(-0.1); });
  if (popoverZoomIn) popoverZoomIn.addEventListener('click', (e) => { e.stopPropagation(); zoomActiveTab(0.1); });
  if (popoverZoomReset) popoverZoomReset.addEventListener('click', (e) => { e.stopPropagation(); resetZoomActiveTab(); });

  // Dismiss Zoom Popover on outside click
  document.addEventListener('click', (e) => {
    if (zoomPopover && !zoomPopover.classList.contains('hidden')) {
      if (!zoomPopover.contains(e.target) && e.target !== addressZoomBtn && !addressZoomBtn.contains(e.target)) {
        zoomPopover.classList.add('hidden');
      }
    }
  });

  // Context Menu Item Listeners
  const menuReload = document.getElementById('menu-reload');
  if (menuReload) {
    menuReload.addEventListener('click', () => {
      if (contextMenuTabId !== null) {
        const tab = tabs.find(t => t.id === contextMenuTabId);
        if (tab) tab.webviewElement.reload();
      }
    });
  }

  const menuClose = document.getElementById('menu-close');
  if (menuClose) {
    menuClose.addEventListener('click', () => {
      if (contextMenuTabId !== null) {
        closeTab(contextMenuTabId);
      }
    });
  }

  const menuCloseOthers = document.getElementById('menu-close-others');
  if (menuCloseOthers) {
    menuCloseOthers.addEventListener('click', () => {
      if (contextMenuTabId !== null) {
        const tabsToClose = tabs.filter(t => t.id !== contextMenuTabId && t.canClose).map(t => t.id);
        tabsToClose.forEach(id => closeTab(id));
      }
    });
  }

  // IPC Event listeners
  window.sebBrowser.onShowToast((data) => {
    if (data && data.message) {
      showToast(data.message, data.type);
    } else {
      showToast(data, 'info');
    }
  });

  window.sebBrowser.onZoom((key) => {
    if (key === '=' || key === '+') {
      zoomActiveTab(0.1);
    } else if (key === '-') {
      zoomActiveTab(-0.1);
    } else if (key === '0') {
      resetZoomActiveTab();
    }
  });

  addressInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      const rawInput = addressInput.value.trim();
      if (!rawInput) return;

      // Check if input is blocked
      const isBlocked = await window.sebBrowser.checkBlocked(rawInput);
      if (isBlocked) {
        // Log block event
        window.sebBrowser.logEvent('AI_URL_BLOCKED', { url: rawInput });

        // Show block toast
        showBlockedToast(rawInput);

        // Restore previous URL
        const activeTab = tabs.find(t => t.id === activeTabId);
        if (activeTab) {
          addressInput.value = activeTab.url || '';
        }
        addressInput.blur();
        return;
      }

      let url = rawInput;
      if (!/^https?:\/\//i.test(url)) {
        // If it looks like a domain, prepend https://. Else search on Google.
        if (url.includes('.') && !url.includes(' ')) {
          url = 'https://' + url;
        } else {
          url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
        }
      }
      navigateActiveTabTo(url);
      addressInput.blur();
    }
  });

  // Modal actions
  chromeExitBtn.addEventListener('click', showExitPrompt);
  exitCancelBtn.addEventListener('click', hideExitPrompt);
  exitSubmitBtn.addEventListener('click', attemptExit);


  // Global Keyboard shortcuts in the window
  window.addEventListener('keydown', (e) => {
    // Ctrl + T -> New Tab
    if (e.ctrlKey && e.key.toLowerCase() === 't') {
      e.preventDefault();
      createTab('https://www.google.com', true);
    }
    // Ctrl + W -> Close Tab
    if (e.ctrlKey && e.key.toLowerCase() === 'w') {
      e.preventDefault();
      if (activeTabId !== null) {
        closeTab(activeTabId);
      }
    }
    // Ctrl + R or F5 -> Refresh Active Tab
    if ((e.ctrlKey && e.key.toLowerCase() === 'r') || e.key === 'F5') {
      e.preventDefault();
      navigateRefresh();
    }

    // Ctrl + M -> Toggle Magnifier
    if (e.ctrlKey && e.key.toLowerCase() === 'm') {
      e.preventDefault();
      toggleMagnifier();
    }

    // Zoom shortcuts
    const isControl = e.ctrlKey || e.metaKey;
    const key = e.key.toLowerCase();
    const isPlus = key === '+' || key === '=' || key === 'add';
    const isMinus = key === '-' || key === 'subtract';
    const isReset = key === '0';

    if (isControl && (isPlus || isMinus || isReset)) {
      e.preventDefault();
      if (isMagnifierActive) {
        // Zoom magnifier lens instead of the page zoom
        if (isPlus) magnifierScale = Math.min(4.0, magnifierScale + 0.2);
        else if (isMinus) magnifierScale = Math.max(1.5, magnifierScale - 0.2);
        else if (isReset) magnifierScale = 2.0;
        
        const badge = document.getElementById('magnifier-lens-badge');
        if (badge) badge.textContent = `${magnifierScale.toFixed(1)}x`;
      } else {
        if (isPlus) zoomActiveTab(0.1);
        else if (isMinus) zoomActiveTab(-0.1);
        else if (isReset) resetZoomActiveTab();
      }
    }
  });

  // Handle Close Attempt from OS (Main Process IPC)
  window.sebBrowser.onShowExitDialog(() => {
    showExitPrompt();
  });

  // Handle Tab Opening from setWindowOpenHandler
  window.sebBrowser.onOpenTab((url) => {
    createTab(url, true);
  });

  // Handle Blocked Toast notification
  window.sebBrowser.onShowBlockedToast(({ url }) => {
    showBlockedToast(url);
  });

  // Fullscreen & Exit Session button visibility handling (only show in fullscreen mode)
  const exitBtn = document.getElementById('chrome-exit-btn');
  const updateExitButtonVisibility = (isFS) => {
    if (exitBtn) {
      if (isFS) {
        exitBtn.classList.remove('hidden');
      } else {
        exitBtn.classList.add('hidden');
      }
    }
  };

  // Init visibility state
  const initialFS = await window.sebBrowser.isFullScreen();
  updateExitButtonVisibility(initialFS);

  // Listen for dynamic changes
  window.sebBrowser.onFullscreenChanged((isFS) => {
    updateExitButtonVisibility(isFS);
  });

  // ─── Hamburger Dropdown Menu Event Handlers ────────────────────────────────
  const menuBtn = document.getElementById('chrome-menu-btn');
  const menuDropdown = document.getElementById('menu-dropdown');

  if (menuBtn && menuDropdown) {
    // Toggle Menu
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menuDropdown.classList.toggle('hidden');
    });

    // Close Menu on clicking outside
    document.addEventListener('click', (e) => {
      if (!menuDropdown.contains(e.target) && e.target !== menuBtn) {
        menuDropdown.classList.add('hidden');
      }
    });

    // Menu Actions Setup
    
    // New Tab
    const mNewTab = document.getElementById('menu-item-new-tab');
    if (mNewTab) {
      mNewTab.addEventListener('click', () => {
        menuDropdown.classList.add('hidden');
        createTab(config?.examUrl || 'https://www.google.com/', true);
      });
    }

    // Reload Tab
    const mReload = document.getElementById('menu-item-reload');
    if (mReload) {
      mReload.addEventListener('click', () => {
        menuDropdown.classList.add('hidden');
        navigateRefresh();
      });
    }

    // Downloads
    const mDownloads = document.getElementById('menu-item-downloads');
    if (mDownloads) {
      mDownloads.addEventListener('click', () => {
        menuDropdown.classList.add('hidden');
        showToast('SecureExam Browser protects downloads. All downloaded exam files are saved directly in your Windows downloads folder.', 'info');
      });
    }

    // Zoom Out
    const mZoomOut = document.getElementById('menu-zoom-out');
    if (mZoomOut) {
      mZoomOut.addEventListener('click', (e) => {
        e.stopPropagation();
        zoomActiveTab(-0.1);
      });
    }

    // Zoom In
    const mZoomIn = document.getElementById('menu-zoom-in');
    if (mZoomIn) {
      mZoomIn.addEventListener('click', (e) => {
        e.stopPropagation();
        zoomActiveTab(0.1);
      });
    }

    // Toggle Fullscreen
    const mFullscreen = document.getElementById('menu-zoom-fullscreen');
    if (mFullscreen) {
      mFullscreen.addEventListener('click', async (e) => {
        e.stopPropagation();
        menuDropdown.classList.add('hidden');
        await window.sebBrowser.toggleFullScreen();
      });
    }

    // Exit Session
    const mExit = document.getElementById('menu-item-exit');
    if (mExit) {
      mExit.addEventListener('click', () => {
        menuDropdown.classList.add('hidden');
        showExitPrompt();
      });
    }

    // Magnifier Menu Action
    const mMagnifier = document.getElementById('menu-item-magnifier');
    if (mMagnifier) {
      mMagnifier.addEventListener('click', () => {
        menuDropdown.classList.add('hidden');
        toggleMagnifier();
      });
    }

    // Hide lens if mouse moves over the chrome toolbar area
    const header = document.getElementById('browser-header');
    if (header) {
      header.addEventListener('mousemove', () => {
        if (isMagnifierActive) {
          const lens = document.getElementById('magnifier-lens');
          if (lens) lens.style.display = 'none';
        }
      });
    }

    // Global Esc key handling for magnifier cancel
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isMagnifierActive) {
        toggleMagnifier();
      }
    });
  }
});

// ─── Tab Management ─────────────────────────────────────────────────────────

function createTab(url, canClose = true, customTitle = 'Loading...') {
  const id = tabIdCounter++;

  // Create UI Tab Element
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.id = `tab-control-${id}`;
  tabEl.innerHTML = `
    <svg class="tab-chrome-icon" viewBox="0 0 24 24" width="16" height="16"><path fill="#4285F4" d="M12 0C8.16 0 4.87 2.15 3.16 5.33l4.89 8.46c.14-.52.54-.95 1.07-1.16l2.88-5c1.1-1.9 3.53-2.55 5.43-1.45.69.4 1.23.99 1.57 1.7L22 4.41C19.72 1.7 16.08 0 12 0z"/><path fill="#EA4335" d="M23.63 7.82c-.88-2.62-2.57-4.88-4.82-6.41l-3.87 6.7c1.37.79 1.84 2.54 1.05 3.91-.29.5-.73.87-1.25 1.05l-4.14 7.17C11 20.31 11.5 20.3 12 20.3c4.58 0 8.3-3.72 8.3-8.3 0-1.52-.41-2.94-1.12-4.18z"/><path fill="#FBBC05" d="M9.16 11.63L3.16 1.25A12.016 12.016 0 0 0 .37 16.18l3.87 6.7c-.52-.18-.95-.59-1.16-1.12-.79-1.37-.32-3.12 1.05-3.91l4.14-7.17c.29-.5.73-.87 1.25-1.05z"/><path fill="#FFF" d="M12 7.7c-2.37 0-4.3 1.93-4.3 4.3s1.93 4.3 4.3 4.3 4.3-1.93 4.3-4.3S14.37 7.7 12 7.7z"/><path fill="#4285F4" d="M12 8.7c-1.82 0-3.3 1.48-3.3 3.3s1.48 3.3 3.3 3.3 3.3-1.48 3.3-3.3-1.48-3.3-3.3-3.3z"/></svg>
    <span class="tab-title" id="tab-title-${id}">${customTitle}</span>
    ${canClose ? `<span class="tab-close" id="tab-close-${id}">✕</span>` : ''}
  `;

  // Create Webview Element
  const webview = document.createElement('webview');
  webview.id = `webview-${id}`;
  webview.setAttribute('src', url);
  // Ensure preload is injected
  if (examPreloadPath) {
    webview.setAttribute('preload', examPreloadPath);
  }
  
  // Set safety attributes
  webview.setAttribute('nodeintegration', 'false');
  webview.setAttribute('contextisolation', 'true');
  webview.setAttribute('plugins', 'true');
  webview.className = 'hidden';

  // Add elements to DOM
  tabsContainer.appendChild(tabEl);
  webviewsContainer.appendChild(webview);

  const tabObj = {
    id,
    url,
    title: customTitle,
    webviewElement: webview,
    tabElement: tabEl,
    canClose,
    zoomFactor: 1.0
  };

  tabs.push(tabObj);

  // Tab Events
  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-close')) return;
    switchTab(id);
  });

  // Double click to close tab removed by request

  tabEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showTabContextMenu(id, e.clientX, e.clientY);
  });

  if (canClose) {
    tabEl.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      closeTab(id);
    });
  }

  // Webview Event Listeners
  setupWebviewEvents(tabObj);

  // Switch to new tab
  switchTab(id);
  return tabObj;
}

function switchTab(id) {
  if (isMagnifierActive) {
    toggleMagnifier();
  }
  const previousTab = tabs.find(t => t.id === activeTabId);
  const currentTab = tabs.find(t => t.id === id);

  if (!currentTab) return;

  if (previousTab) {
    previousTab.tabElement.classList.remove('active');
    previousTab.webviewElement.classList.add('hidden');
  }

  currentTab.tabElement.classList.add('active');
  currentTab.webviewElement.classList.remove('hidden');
  activeTabId = id;

  updateNavigationUI(currentTab);
  updateZoomUI(currentTab);
  
  // Try to focus the current webview
  try {
    currentTab.webviewElement.focus();
  } catch (err) {}
}

function closeTab(id) {
  const tabIndex = tabs.findIndex(t => t.id === id);
  if (tabIndex === -1) return;

  const tab = tabs[tabIndex];
  if (!tab.canClose) {
    // Can't close primary exam tab!
    return;
  }

  // Remove elements from DOM
  tab.tabElement.remove();
  tab.webviewElement.remove();

  tabs.splice(tabIndex, 1);

  // If closed the active tab, switch to another
  if (activeTabId === id) {
    const nextActiveIndex = Math.min(tabIndex, tabs.length - 1);
    if (nextActiveIndex >= 0) {
      switchTab(tabs[nextActiveIndex].id);
    } else {
      activeTabId = null;
    }
  }
}

function setupWebviewEvents(tab) {
  const { id, webviewElement } = tab;

  // Track Loading State
  webviewElement.addEventListener('did-start-loading', () => {
    tab.isLoading = true;
    if (activeTabId === id) {
      loadingSpinner.classList.remove('hidden');
    }
  });

  webviewElement.addEventListener('did-stop-loading', () => {
    tab.isLoading = false;
    if (activeTabId === id) {
      loadingSpinner.classList.add('hidden');
      updateNavigationUI(tab);
    }
  });

  // Track URL & Title
  const updateTabUrl = (newUrl) => {
    tab.url = newUrl;
    if (activeTabId === id) {
      addressInput.value = newUrl;
      updateNavigationUI(tab);
    }
  };

  webviewElement.addEventListener('did-navigate', (e) => {
    updateTabUrl(e.url);
  });

  webviewElement.addEventListener('did-navigate-in-page', (e) => {
    updateTabUrl(e.url);
  });

  webviewElement.addEventListener('page-title-updated', (e) => {
    tab.title = e.title;
    const titleEl = document.getElementById(`tab-title-${id}`);
    if (titleEl) {
      titleEl.textContent = e.title || 'Untitled';
      titleEl.title = e.title || 'Untitled';
    }
  });

  // Handle popups inside webview (target="_blank")
  webviewElement.addEventListener('new-window', (e) => {
    e.preventDefault();
    createTab(e.url, true);
  });

  // Handle window.close() inside webview
  webviewElement.addEventListener('close', () => {
    closeTab(id);
  });

  // Re-apply zoom on dom-ready (since Chromium resets zoom on navigation)
  webviewElement.addEventListener('dom-ready', () => {
    try {
      webviewElement.send('guest:set-zoom', tab.zoomFactor);
    } catch (err) {
      console.error('[Browser] Failed to send guest:set-zoom on dom-ready:', err);
    }
  });

  // Listen for local zoom and magnifier changes from the guest page
  webviewElement.addEventListener('ipc-message', (e) => {
    if (e.channel === 'webview-zoom-changed') {
      const { zoomFactor } = e.args[0];
      tab.zoomFactor = zoomFactor;
      updateZoomUI(tab);
    } else if (e.channel === 'guest-magnifier-move') {
      const { x, y, scrollX, scrollY } = e.args[0];
      lastMouseX = x;
      lastMouseY = y;
      currentScrollX = scrollX;
      currentScrollY = scrollY;
      
      const lens = document.getElementById('magnifier-lens');
      const badge = document.getElementById('magnifier-lens-badge');
      if (lens && isMagnifierActive) {
        const rect = webviewElement.getBoundingClientRect();
        const hostX = rect.left + x;
        const hostY = rect.top + y;
        
        // Position lens centered on mouse cursor
        const lensWidth = 260;
        const lensHeight = 160;
        
        lens.style.display = 'block';
        lens.style.left = `${hostX - lensWidth / 2}px`;
        lens.style.top = `${hostY - lensHeight / 2}px`;
        
        // Calculate scroll delta from snapshot time
        const deltaX = scrollX - scrollXAtCapture;
        const deltaY = scrollY - scrollYAtCapture;
        
        // Offset the crop coordinate by the scroll delta
        const cropX = x + deltaX;
        const cropY = y + deltaY;
        
        // Calculate background crop zoom positioning
        const bgX = -cropX * magnifierScale + lensWidth / 2;
        const bgY = -cropY * magnifierScale + lensHeight / 2;
        
        lens.style.backgroundPosition = `${bgX}px ${bgY}px`;
        lens.style.backgroundSize = `${rect.width * magnifierScale}px ${rect.height * magnifierScale}px`;
        
        if (badge) badge.textContent = `${magnifierScale.toFixed(1)}x`;
      }
    } else if (e.channel === 'guest-magnifier-scroll-ended') {
      refreshMagnifierSnapshot();
    } else if (e.channel === 'guest-magnifier-zoom') {
      const action = e.args[0];
      if (action === 'in') {
        magnifierScale = Math.min(4.0, magnifierScale + 0.2);
      } else if (action === 'out') {
        magnifierScale = Math.max(1.5, magnifierScale - 0.2);
      }
      
      const badge = document.getElementById('magnifier-lens-badge');
      if (badge) badge.textContent = `${magnifierScale.toFixed(1)}x`;
      
      refreshMagnifierSnapshot();
    }
  });
}

// ─── Navigation ─────────────────────────────────────────────────────────────

function updateNavigationUI(tab) {
  if (activeTabId !== tab.id) return;

  addressInput.value = tab.url || '';
  
  // Set back/forward buttons status
  try {
    navBackBtn.disabled = !tab.webviewElement.canGoBack();
    navForwardBtn.disabled = !tab.webviewElement.canGoForward();
  } catch (err) {
    navBackBtn.disabled = true;
    navForwardBtn.disabled = true;
  }
}

function navigateBack() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && tab.webviewElement.canGoBack()) {
    tab.webviewElement.goBack();
  }
}

function navigateForward() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && tab.webviewElement.canGoForward()) {
    tab.webviewElement.goForward();
  }
}

function navigateRefresh() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) {
    tab.webviewElement.reload();
  }
}

function navigateHome() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && config && config.examUrl) {
    tab.webviewElement.loadURL(config.examUrl);
  }
}

function navigateActiveTabTo(url) {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab) {
    tab.webviewElement.loadURL(url);
  }
}

// ─── Exit Dialog ────────────────────────────────────────────────────────────

async function showExitPrompt() {
  exitModal.classList.remove('hidden');
}

function hideExitPrompt() {
  exitModal.classList.add('hidden');
}

async function attemptExit() {
  try {
    await window.sebBrowser.quit('');
  } catch (err) {
    console.error('Exit call failed', err);
  }
}

// ─── Toast Notifications ─────────────────────────────────────────────────────

function showBlockedToast(url) {
  showToast(
    `You cannot use other AI tools. Prodigy Browser has a built-in AI tutor that provides guidance without giving direct answers.`,
    'blocked'
  );
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let icon = 'ℹ️';
  let title = 'Notification';
  
  if (type === 'blocked') {
    icon = '🛡️';
    title = 'AI Blocking Shield';
  } else if (type === 'download') {
    icon = '📥';
    title = 'File Download';
  } else if (type === 'success') {
    icon = '✅';
    title = 'Success';
  } else if (type === 'error') {
    icon = '❌';
    title = 'Error';
  }
  
  toast.innerHTML = `
    <div class="toast-header">
      <span class="toast-title">
        <span>${icon}</span> ${title}
      </span>
      <button class="toast-close">✕</button>
    </div>
    <div class="toast-body">${message}</div>
  `;

  container.appendChild(toast);

  // Trigger slide-in
  setTimeout(() => {
    toast.classList.add('show');
  }, 10);

  const dismiss = () => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
    }, 350);
  };

  toast.querySelector('.toast-close').addEventListener('click', dismiss);

  // Auto-dismiss after 6 seconds
  setTimeout(dismiss, 6000);
}

// ─── Zoom Helpers ────────────────────────────────────────────────────────────

function zoomActiveTab(delta) {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  
  let newZoom = tab.zoomFactor + delta;
  // Bound zoom between 50% and 300%
  newZoom = Math.max(0.5, Math.min(3.0, newZoom));
  
  tab.zoomFactor = parseFloat(newZoom.toFixed(1));
  try {
    tab.webviewElement.send('guest:set-zoom', tab.zoomFactor);
  } catch (err) {
    console.error('[Browser] Failed to send guest:set-zoom:', err);
  }
  
  updateZoomUI(tab);
  
  // Log zoom event
  window.sebBrowser.logEvent('BROWSER_ZOOM_CHANGED', { level: `${Math.round(tab.zoomFactor * 100)}%` });
}

function resetZoomActiveTab() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  
  tab.zoomFactor = 1.0;
  try {
    tab.webviewElement.send('guest:set-zoom', 1.0);
  } catch (err) {
    console.error('[Browser] Failed to send guest:set-zoom (reset):', err);
  }
  
  updateZoomUI(tab);
  window.sebBrowser.logEvent('BROWSER_ZOOM_RESET');
}

function updateZoomUI(tab) {
  if (activeTabId !== tab.id) return;
  
  const percentage = Math.round(tab.zoomFactor * 100);
  if (addressZoomText) addressZoomText.textContent = `${percentage}%`;
  if (popoverZoomVal) popoverZoomVal.textContent = `${percentage}%`;
  
  const menuZoomPercentage = document.getElementById('menu-zoom-percentage');
  if (menuZoomPercentage) menuZoomPercentage.textContent = `${percentage}%`;
  
  if (addressZoomBtn) {
    if (percentage === 100) {
      addressZoomBtn.classList.add('hidden');
      if (zoomPopover) zoomPopover.classList.add('hidden');
    } else {
      addressZoomBtn.classList.remove('hidden');
    }
  }
}

function toggleZoomPopover() {
  if (!zoomPopover || !addressZoomBtn) return;
  
  const isHidden = zoomPopover.classList.contains('hidden');
  if (isHidden) {
    const rect = addressZoomBtn.getBoundingClientRect();
    zoomPopover.style.left = `${rect.right - 145}px`;
    zoomPopover.style.top = `${rect.bottom + 6}px`;
    zoomPopover.classList.remove('hidden');
  } else {
    zoomPopover.classList.add('hidden');
  }
}

// ─── Tab Context Menu Helpers ────────────────────────────────────────────────

function showTabContextMenu(tabId, x, y) {
  contextMenuTabId = tabId;
  const menu = document.getElementById('tab-context-menu');
  if (!menu) return;
  
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  
  // Disable "Close Tab" if it cannot be closed
  const tabObj = tabs.find(t => t.id === tabId);
  const closeItem = document.getElementById('menu-close');
  if (tabObj && !tabObj.canClose) {
    closeItem.classList.add('disabled');
  } else {
    closeItem.classList.remove('disabled');
  }
  
  menu.classList.remove('hidden');
  
  // Dismiss listener
  const dismissMenu = () => {
    menu.classList.add('hidden');
    document.removeEventListener('click', dismissMenu);
  };
  
  setTimeout(() => {
    document.addEventListener('click', dismissMenu);
  }, 10);
}

// ─── Live Magnifier Lens Tool ───────────────────────────────────────────────

let isMagnifierActive = false;
let magnifierScale = 2.0; // Default 2x zoom factor
let lastMouseX = 200;
let lastMouseY = 200;
let scrollXAtCapture = 0;
let scrollYAtCapture = 0;
let currentScrollX = 0;
let currentScrollY = 0;

async function toggleMagnifier() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  
  const lens = document.getElementById('magnifier-lens');
  if (!lens) return;
  
  if (isMagnifierActive) {
    // Deactivate
    isMagnifierActive = false;
    lens.classList.add('hidden');
    lens.style.display = 'none';
    lens.style.opacity = '0';
    tab.webviewElement.send('guest:set-magnifier-active', false);
  } else {
    // Activate
    isMagnifierActive = true;
    tab.webviewElement.send('guest:set-magnifier-active', true);
    
    // Position lens immediately at the last known coordinates
    const rect = tab.webviewElement.getBoundingClientRect();
    const hostX = rect.left + lastMouseX;
    const hostY = rect.top + lastMouseY;
    const lensWidth = 260;
    const lensHeight = 160;
    
    lens.style.left = `${hostX - lensWidth / 2}px`;
    lens.style.top = `${hostY - lensHeight / 2}px`;
    lens.style.opacity = '0';
    
    // Capture initial snapshot
    await refreshMagnifierSnapshot();
    
    // Force set the initial background image slice position taking scroll offsets into account
    const deltaX = currentScrollX - scrollXAtCapture;
    const deltaY = currentScrollY - scrollYAtCapture;
    const cropX = lastMouseX + deltaX;
    const cropY = lastMouseY + deltaY;
    
    const bgX = -cropX * magnifierScale + lensWidth / 2;
    const bgY = -cropY * magnifierScale + lensHeight / 2;
    lens.style.backgroundPosition = `${bgX}px ${bgY}px`;
    lens.style.backgroundSize = `${rect.width * magnifierScale}px ${rect.height * magnifierScale}px`;
    
    lens.classList.remove('hidden');
    lens.style.display = 'block';
    lens.style.opacity = '1';
  }
}

async function refreshMagnifierSnapshot() {
  const tab = tabs.find(t => t.id === activeTabId);
  const lens = document.getElementById('magnifier-lens');
  if (!tab || !lens || !isMagnifierActive) return;
  
  try {
    const img = await tab.webviewElement.capturePage();
    lens.style.backgroundImage = `url(${img.toDataURL()})`;
    
    // Save the baseline scroll offset coordinates at capture time
    scrollXAtCapture = currentScrollX;
    scrollYAtCapture = currentScrollY;
  } catch (err) {
    console.error('[Browser] Magnifier capture failed:', err);
  }
}
