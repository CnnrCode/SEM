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
});

// ─── Tab Management ─────────────────────────────────────────────────────────

function createTab(url, canClose = true, customTitle = 'Loading...') {
  const id = tabIdCounter++;

  // Create UI Tab Element
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.id = `tab-control-${id}`;
  tabEl.innerHTML = `
    <span class="tab-title" id="tab-title-${id}">${customTitle}</span>
    ${canClose ? `<span class="tab-close" id="tab-close-${id}">✕</span>` : ''}
  `;

  // Create Webview Element
  const webview = document.createElement('webview');
  webview.id = `webview-${id}`;
  webview.setAttribute('src', url);
  // Ensure preload is injected
  if (examPreloadPath) {
    // Convert Windows backslashes to forward slashes for URL format in preload attribute
    const preloadUrl = 'file:///' + examPreloadPath.replace(/\\/g, '/');
    webview.setAttribute('preload', preloadUrl);
  }
  
  // Set safety attributes
  webview.setAttribute('nodeintegration', 'false');
  webview.setAttribute('contextisolation', 'true');
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
    canClose
  };

  tabs.push(tabObj);

  // Tab Events
  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-close')) return;
    switchTab(id);
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
    `You cannot use other AI tools. Prodigy Browser has a built-in AI tutor that provides guidance without giving direct answers.`
  );
}

function showToast(message) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast';
  
  toast.innerHTML = `
    <div class="toast-header">
      <span class="toast-title">
        <span>🛡️</span> AI Blocking Shield
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
