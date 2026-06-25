/**
 * admin.js — Admin panel logic for SecureExam Browser
 * Runs in the Electron renderer process. Communicates with main via window.sebAdmin.
 */

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

let currentConfig = null;
let domainList = [];
let customAiDomains = [];  // Admin-added AI domains to block

const FEATURE_META = {
  blockKeyboardShortcuts: {
    name: 'Block Keyboard Shortcuts',
    desc: 'Prevents Alt+Tab, Win key, PrintScreen, Ctrl+Alt+Del, and other system shortcuts',
  },
  blockScreenCapture: {
    name: 'Block Screen Capture',
    desc: 'Makes the exam window appear black in screenshots and recordings',
  },
  clearClipboardOnExit: {
    name: 'Clear Clipboard on Exit',
    desc: 'Wipes the clipboard contents when the exam session starts and ends',
  },
  blockCopyPaste: {
    name: 'Block Copy / Paste',
    desc: 'Prevents Ctrl+C, Ctrl+X, Ctrl+V on the exam page',
  },
  fullscreenLockdown: {
    name: 'Fullscreen Lockdown',
    desc: 'Forces the exam into fullscreen kiosk mode — cannot be minimized or closed',
  },
  blockDevTools: {
    name: 'Block Developer Tools',
    desc: 'Blocks F12, Ctrl+Shift+I, and all DevTools access during the exam',
  },
  blockRightClick: {
    name: 'Block Right-Click Menu',
    desc: 'Disables the context menu on the exam page',
  },
};

// ─── Init ─────────────────────────────────────────────────────────────────────

document.addEventListener('DOMContentLoaded', async () => {
  // Load app version
  try {
    const v = await window.sebAdmin.getVersion();
    document.getElementById('app-version').textContent = `v${v}`;
  } catch {}

  // Check if admin password is set
  const cfg = await window.sebAdmin.getConfig();
  const hasPassword = !!(cfg.adminPasswordHash !== undefined
    ? false // hashes are stripped — check differently
    : false);

  // Since hashes are stripped, we show first-run note if firstRun is true
  if (cfg.firstRun) {
    document.getElementById('first-run-note').style.display = 'block';
    document.getElementById('admin-password-input').placeholder = 'No password set — press Enter to continue';
  }

  // Auth form
  document.getElementById('auth-submit-btn').addEventListener('click', handleAuth);
  document.getElementById('admin-password-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') handleAuth();
  });
});

async function handleAuth() {
  const password = document.getElementById('admin-password-input').value;
  const ok = await window.sebAdmin.verifyAdminPassword(password);
  if (ok) {
    document.getElementById('auth-gate').classList.add('hidden');
    document.getElementById('admin-app').classList.remove('hidden');
    initAdminApp();
  } else {
    const errEl = document.getElementById('auth-error');
    errEl.textContent = 'Incorrect admin password. Please try again.';
    errEl.classList.remove('hidden');
    document.getElementById('admin-password-input').select();
  }
}

// ─── Main Init ────────────────────────────────────────────────────────────────

async function initAdminApp() {
  currentConfig = await window.sebAdmin.getConfig();
  domainList = [...(currentConfig.allowedDomains || [])];
  customAiDomains = [...(await window.sebAdmin.getBlockedAiDomains())];

  setupNav();
  setupDashboard();
  setupExamSection();
  setupSecuritySection();
  setupWhitelistSection();
  setupAiBlockSection();
  setupPasswordsSection();
  setupLogsSection();
}

// ─── Navigation ───────────────────────────────────────────────────────────────

function setupNav() {
  const navItems = document.querySelectorAll('.nav-item[data-section]');
  navItems.forEach((item) => {
    item.addEventListener('click', () => {
      navItems.forEach((n) => n.classList.remove('active'));
      item.classList.add('active');

      document.querySelectorAll('.section').forEach((s) => s.classList.remove('active'));
      document.getElementById(`section-${item.dataset.section}`).classList.add('active');
    });
  });

  document.getElementById('launch-exam-btn').addEventListener('click', async () => {
    const cfg = await window.sebAdmin.getConfig();
    if (!cfg.examUrl) {
      showToast('Please set an exam URL before launching.', 'error');
      return;
    }
    showToast('Launching exam session...', 'success');
    setTimeout(async () => {
      await window.sebAdmin.launchExam();
    }, 600);
  });
}

// ─── Dashboard ────────────────────────────────────────────────────────────────

async function setupDashboard() {
  const cfg = currentConfig;

  // Stats
  const examUrlEl = document.getElementById('dash-exam-url');
  examUrlEl.textContent = cfg.examUrl
    ? new URL(cfg.examUrl).hostname
    : 'Not set';
  if (!cfg.examUrl) examUrlEl.style.color = 'var(--danger)';

  document.getElementById('dash-domains').textContent = (cfg.allowedDomains || []).length;

  // Log count
  const dates = await window.sebAdmin.getLogDates();
  document.getElementById('dash-log-count').textContent = dates.length;

  // Features
  const featureGrid = document.getElementById('dash-features');
  featureGrid.innerHTML = '';
  const features = cfg.features || {};
  for (const [key, meta] of Object.entries(FEATURE_META)) {
    const on = features[key] !== false;
    const badge = document.createElement('div');
    badge.className = `feature-badge ${on ? 'on' : 'off'}`;
    badge.innerHTML = `<span class="dot"></span>${meta.name}`;
    featureGrid.appendChild(badge);
  }
}

// ─── Exam Config ──────────────────────────────────────────────────────────────

function setupExamSection() {
  const input = document.getElementById('exam-url-input');
  const preview = document.getElementById('url-preview');
  const saveBtn = document.getElementById('save-exam-url-btn');

  input.value = currentConfig.examUrl || '';
  updatePreview(input.value);

  input.addEventListener('input', () => updatePreview(input.value));

  saveBtn.addEventListener('click', async () => {
    const url = input.value.trim();
    if (url && !isValidUrl(url)) {
      showToast('Please enter a valid URL (include https://)', 'error');
      return;
    }
    await window.sebAdmin.saveConfig({ examUrl: url });
    currentConfig.examUrl = url;
    updatePreview(url);
    setupDashboard();
    showToast('Exam URL saved!', 'success');
  });
}

function updatePreview(url) {
  const preview = document.getElementById('url-preview');
  if (url && isValidUrl(url)) {
    preview.innerHTML = `<span style="color:var(--accent)">${url}</span>`;
  } else {
    preview.innerHTML = `<span class="url-preview-placeholder">Enter an exam URL above to preview it here</span>`;
  }
}

function isValidUrl(str) {
  try { new URL(str); return true; } catch { return false; }
}

// ─── Security Settings ────────────────────────────────────────────────────────

function setupSecuritySection() {
  const container = document.getElementById('feature-toggles');
  container.innerHTML = '';

  const features = currentConfig.features || {};

  for (const [key, meta] of Object.entries(FEATURE_META)) {
    const on = features[key] !== false;

    const row = document.createElement('div');
    row.className = 'toggle-row';
    row.innerHTML = `
      <div class="toggle-info">
        <span class="toggle-name">${meta.name}</span>
        <span class="toggle-desc">${meta.desc}</span>
      </div>
      <label class="toggle-switch" title="${meta.name}">
        <input type="checkbox" id="toggle-${key}" ${on ? 'checked' : ''} />
        <span class="toggle-thumb"></span>
      </label>
    `;
    container.appendChild(row);
  }

  document.getElementById('save-security-btn').addEventListener('click', async () => {
    const updatedFeatures = {};
    for (const key of Object.keys(FEATURE_META)) {
      updatedFeatures[key] = document.getElementById(`toggle-${key}`).checked;
    }
    await window.sebAdmin.saveConfig({ features: updatedFeatures });
    currentConfig.features = updatedFeatures;
    setupDashboard();
    showToast('Security settings saved!', 'success');
  });
}

// ─── URL Whitelist ────────────────────────────────────────────────────────────

function setupWhitelistSection() {
  renderDomainList();

  document.getElementById('add-domain-btn').addEventListener('click', () => {
    const input = document.getElementById('domain-input');
    const val = input.value.trim().toLowerCase();
    if (!val) return;
    if (domainList.includes(val)) {
      showToast('Domain already in list.', 'error');
      return;
    }
    domainList.push(val);
    input.value = '';
    renderDomainList();
  });

  document.getElementById('domain-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('add-domain-btn').click();
  });

  document.getElementById('save-whitelist-btn').addEventListener('click', async () => {
    await window.sebAdmin.saveConfig({ allowedDomains: domainList });
    currentConfig.allowedDomains = [...domainList];
    setupDashboard();
    showToast('Whitelist saved!', 'success');
  });
}

function renderDomainList() {
  const list = document.getElementById('domain-list');
  list.innerHTML = '';

  if (domainList.length === 0) {
    list.innerHTML = '<p class="empty-msg">No additional domains added yet.</p>';
    return;
  }

  domainList.forEach((domain, i) => {
    const tag = document.createElement('div');
    tag.className = 'domain-tag';
    tag.innerHTML = `
      <span>${domain}</span>
      <button class="btn-icon-sm" data-i="${i}">Remove</button>
    `;
    tag.querySelector('button').addEventListener('click', () => {
      domainList.splice(i, 1);
      renderDomainList();
    });
    list.appendChild(tag);
  });
}

// ─── AI Block List ────────────────────────────────────────────────────────────

async function setupAiBlockSection() {
  // Render built-in domains (read-only)
  const builtinList = document.getElementById('builtin-ai-list');
  try {
    const builtins = await window.sebAdmin.getBuiltinAiDomains();
    if (builtins.length === 0) {
      builtinList.innerHTML = '<p class="empty-msg">None.</p>';
    } else {
      builtinList.innerHTML = '';
      builtins.forEach((domain) => {
        const tag = document.createElement('div');
        tag.className = 'domain-tag domain-tag-blocked';
        tag.innerHTML = `
          <span>🚫 ${domain}</span>
          <span class="tag-badge">Built-in</span>
        `;
        builtinList.appendChild(tag);
      });
    }
  } catch {
    builtinList.innerHTML = '<p class="empty-msg">Could not load built-in list.</p>';
  }

  // Render custom domains
  renderCustomAiList();

  // Add domain button
  document.getElementById('add-ai-domain-btn').addEventListener('click', () => {
    const input = document.getElementById('ai-domain-input');
    const val = input.value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/$/, '');
    if (!val) return;
    if (customAiDomains.includes(val)) {
      showToast('Domain already in block list.', 'error');
      return;
    }
    customAiDomains.push(val);
    input.value = '';
    renderCustomAiList();
    showToast(`${val} added to block list.`, 'success');
  });

  document.getElementById('ai-domain-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('add-ai-domain-btn').click();
  });

  // Save button
  document.getElementById('save-ai-blocklist-btn').addEventListener('click', async () => {
    await window.sebAdmin.saveBlockedAiDomains(customAiDomains);
    showToast('AI block list saved!', 'success');
  });
}

function renderCustomAiList() {
  const list = document.getElementById('custom-ai-list');
  list.innerHTML = '';

  if (customAiDomains.length === 0) {
    list.innerHTML = '<p class="empty-msg">No custom domains blocked yet.</p>';
    return;
  }

  customAiDomains.forEach((domain, i) => {
    const tag = document.createElement('div');
    tag.className = 'domain-tag domain-tag-blocked';
    tag.innerHTML = `
      <span>🚫 ${domain}</span>
      <button class="btn-icon-sm btn-icon-remove" data-i="${i}">Remove</button>
    `;
    tag.querySelector('button').addEventListener('click', () => {
      customAiDomains.splice(i, 1);
      renderCustomAiList();
    });
    list.appendChild(tag);
  });
}

// ─── Passwords ────────────────────────────────────────────────────────────────

function setupPasswordsSection() {
  // Exit password
  document.getElementById('save-exit-pw-btn').addEventListener('click', async () => {
    const pw1 = document.getElementById('exit-pw-input').value;
    const pw2 = document.getElementById('exit-pw-confirm').value;
    const msg = document.getElementById('exit-pw-msg');

    if (pw1 !== pw2) {
      showMsg(msg, 'Passwords do not match.', 'error');
      return;
    }
    await window.sebAdmin.setExitPassword(pw1);
    document.getElementById('exit-pw-input').value = '';
    document.getElementById('exit-pw-confirm').value = '';
    showMsg(msg, pw1 ? 'Exit password set successfully.' : 'Exit password cleared (no password required to exit).', 'success');
    showToast('Exit password updated!', 'success');
    setupDashboard();
  });

  // Admin password
  document.getElementById('save-admin-pw-btn').addEventListener('click', async () => {
    const pw1 = document.getElementById('admin-pw-input').value;
    const pw2 = document.getElementById('admin-pw-confirm').value;
    const msg = document.getElementById('admin-pw-msg');

    if (!pw1) {
      showMsg(msg, 'Admin password cannot be empty.', 'error');
      return;
    }
    if (pw1 !== pw2) {
      showMsg(msg, 'Passwords do not match.', 'error');
      return;
    }
    await window.sebAdmin.setAdminPassword(pw1);
    document.getElementById('admin-pw-input').value = '';
    document.getElementById('admin-pw-confirm').value = '';
    showMsg(msg, 'Admin password updated successfully.', 'success');
    showToast('Admin password updated!', 'success');
  });
}

function showMsg(el, text, type) {
  el.textContent = text;
  el.className = `form-msg ${type}`;
  el.classList.remove('hidden');
  setTimeout(() => el.classList.add('hidden'), 4000);
}

// ─── Audit Logs ───────────────────────────────────────────────────────────────

async function setupLogsSection() {
  const select = document.getElementById('log-date-select');
  const viewer = document.getElementById('log-viewer');

  const dates = await window.sebAdmin.getLogDates();
  select.innerHTML = '<option value="">Select a date...</option>';
  dates.forEach((d) => {
    const opt = document.createElement('option');
    opt.value = d;
    opt.textContent = d;
    select.appendChild(opt);
  });

  select.addEventListener('change', async () => {
    if (!select.value) {
      viewer.innerHTML = '<p class="empty-msg">Select a date to view logs.</p>';
      return;
    }
    const logs = await window.sebAdmin.getLogsForDate(select.value);
    renderLogs(logs);
  });

  document.getElementById('clear-logs-btn').addEventListener('click', async () => {
    if (!confirm('Are you sure you want to delete ALL audit logs? This cannot be undone.')) return;
    await window.sebAdmin.clearAllLogs();
    select.innerHTML = '<option value="">Select a date...</option>';
    viewer.innerHTML = '<p class="empty-msg">Select a date to view logs.</p>';
    document.getElementById('dash-log-count').textContent = '0';
    showToast('All logs cleared.', 'success');
  });
}

function renderLogs(logs) {
  const viewer = document.getElementById('log-viewer');
  if (!logs || logs.length === 0) {
    viewer.innerHTML = '<p class="empty-msg">No log entries for this date.</p>';
    return;
  }

  const html = logs.map((entry) => {
    const time = new Date(entry.timestamp).toLocaleTimeString();
    const data = { ...entry };
    delete data.timestamp;
    delete data.event;
    const dataStr = Object.keys(data).length
      ? Object.entries(data).map(([k, v]) => `${k}: ${v}`).join(' · ')
      : '—';

    const eventClass = _eventClass(entry.event);
    return `
      <div class="log-entry">
        <span class="log-time">${time}</span>
        <span class="log-event ${eventClass}">${entry.event}</span>
        <span class="log-data">${dataStr}</span>
      </div>
    `;
  }).join('');

  viewer.innerHTML = html;
}

function _eventClass(event) {
  if (!event) return 'info';
  if (event.includes('START') || event.includes('LAUNCHED')) return 'start';
  if (event.includes('END') || event.includes('EXIT') || event.includes('CLEAR')) return 'end';
  if (event.includes('BLOCK') || event.includes('DENIED') || event.includes('ATTEMPTED')) return 'blocked';
  if (event.includes('WARN') || event.includes('LOST')) return 'warning';
  return 'info';
}

// ─── Toast ────────────────────────────────────────────────────────────────────

let _toastTimer = null;

function showToast(message, type = 'info') {
  const toast = document.getElementById('toast');
  toast.textContent = message;
  toast.className = `toast ${type}`;
  toast.classList.remove('hidden');

  if (_toastTimer) clearTimeout(_toastTimer);
  _toastTimer = setTimeout(() => {
    toast.classList.add('hidden');
  }, 3000);
}
