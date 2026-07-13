/**
 * config.js — Configuration management for SecureExam Browser
 * Reads/writes the .seb JSON config file in userData.
 * Exit password is stored as a SHA-256 hash (salted).
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { app } = require('electron');

const CONFIG_FILENAME = 'seb-config.json';

const DEFAULT_CONFIG = {
  examUrl: 'https://www.prodigyreview.ai/',
  allowedDomains: [],       // e.g. ["example.com", "myschool.edu"]
  blockedAiDomains: [],     // Admin-added extra AI domains to block
  exitPasswordHash: '',     // SHA-256 of salt+password
  exitPasswordSalt: '',
  adminPasswordHash: '',    // SHA-256 of salt+admin-password
  adminPasswordSalt: '',
  uiTheme: 'dark',          // Persisted UI theme selection
  openTabs: [],             // Preserved browser tabs list
  remoteServerUrl: '',      // Central server management API endpoint
  clientAuthToken: '',      // Authentication credentials token for this client
  features: {
    blockKeyboardShortcuts: true,
    blockScreenCapture: true,
    clearClipboardOnExit: true,
    blockCopyPaste: true,
    fullscreenLockdown: true,
    blockRightClick: true,
    blockAiApiBackends: true,
    blockAiStreaming: true,
    multiMonitorAction: 'block',
    syncConfigOnStartup: false,
    remoteTelemetry: false,
    clientHeartbeat: false,
  },
  firstRun: true,
};

let configPath = null;
let _config = null;

function getConfigPath() {
  if (!configPath) {
    configPath = path.join(app.getPath('userData'), CONFIG_FILENAME);
  }
  return configPath;
}

function load() {
  const p = getConfigPath();
  if (fs.existsSync(p)) {
    try {
      _config = { ...DEFAULT_CONFIG, ...JSON.parse(fs.readFileSync(p, 'utf8')) };
      // Merge nested features
      _config.features = { ...DEFAULT_CONFIG.features, ..._config.features };
    } catch {
      _config = { ...DEFAULT_CONFIG };
    }
  } else {
    _config = { ...DEFAULT_CONFIG };
  }
  _config.examUrl = 'https://www.prodigyreview.ai/';
  return _config;
}

function save(partial = {}) {
  if (!_config) load();
  _config = { ..._config, ...partial };
  // Merge features if provided
  if (partial.features) {
    _config.features = { ..._config.features, ...partial.features };
  }
  _config.examUrl = 'https://www.prodigyreview.ai/';
  fs.writeFileSync(getConfigPath(), JSON.stringify(_config, null, 2), 'utf8');
  return _config;
}

function get() {
  if (!_config) load();
  return _config;
}

function isFirstRun() {
  const c = get();
  return c.firstRun || !c.adminPasswordHash;
}

// ─── Password helpers ─────────────────────────────────────────────────────────

function _hash(salt, password) {
  return crypto.createHash('sha256').update(salt + password).digest('hex');
}

function _genSalt() {
  return crypto.randomBytes(16).toString('hex');
}

function setExitPassword(password) {
  const salt = _genSalt();
  save({ exitPasswordHash: _hash(salt, password), exitPasswordSalt: salt });
}

function verifyExitPassword(password) {
  const c = get();
  if (!c.exitPasswordHash) return true; // no password set → allow
  return _hash(c.exitPasswordSalt, password) === c.exitPasswordHash;
}

function setAdminPassword(password) {
  const salt = _genSalt();
  save({ adminPasswordHash: _hash(salt, password), adminPasswordSalt: salt, firstRun: false });
}

function verifyAdminPassword(password) {
  const c = get();
  if (!c.adminPasswordHash) return true; // no admin password → allow (first run)
  return _hash(c.adminPasswordSalt, password) === c.adminPasswordHash;
}

function hasAdminPassword() {
  const c = get();
  return !!(c.adminPasswordHash);
}

module.exports = {
  load,
  save,
  get,
  isFirstRun,
  setExitPassword,
  verifyExitPassword,
  setAdminPassword,
  verifyAdminPassword,
  hasAdminPassword,
};
