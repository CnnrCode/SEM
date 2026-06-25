/**
 * auditLog.js — Audit trail logging for SecureExam Browser
 * Writes timestamped JSON events to userData/logs/YYYY-MM-DD.json
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

let logDir = null;
let currentLogFile = null;

function init() {
  logDir = path.join(app.getPath('userData'), 'logs');
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
  updateLogFile();
  log('SESSION_START', { version: app.getVersion(), platform: process.platform });
}

function updateLogFile() {
  const today = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
  currentLogFile = path.join(logDir, `${today}.json`);
}

/**
 * Log an event
 * @param {string} event - Event type (e.g. SHORTCUT_BLOCKED, URL_BLOCKED)
 * @param {object} data  - Additional metadata
 */
function log(event, data = {}) {
  if (!logDir) return;

  updateLogFile();

  const entry = {
    timestamp: new Date().toISOString(),
    event,
    ...data,
  };

  try {
    let logs = [];
    if (fs.existsSync(currentLogFile)) {
      const raw = fs.readFileSync(currentLogFile, 'utf8');
      logs = JSON.parse(raw);
    }
    logs.push(entry);
    fs.writeFileSync(currentLogFile, JSON.stringify(logs, null, 2), 'utf8');
  } catch (err) {
    console.error('[AuditLog] Failed to write log entry:', err);
  }
}

/**
 * Get all log files available
 * @returns {string[]} Array of log file dates (YYYY-MM-DD)
 */
function getLogDates() {
  if (!logDir || !fs.existsSync(logDir)) return [];
  return fs
    .readdirSync(logDir)
    .filter((f) => f.endsWith('.json'))
    .map((f) => f.replace('.json', ''))
    .sort()
    .reverse();
}

/**
 * Get logs for a specific date
 * @param {string} date - YYYY-MM-DD
 * @returns {object[]} Array of log entries
 */
function getLogsForDate(date) {
  if (!logDir) return [];
  const file = path.join(logDir, `${date}.json`);
  if (!fs.existsSync(file)) return [];
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return [];
  }
}

/**
 * Delete all logs
 */
function clearAllLogs() {
  if (!logDir || !fs.existsSync(logDir)) return;
  fs.readdirSync(logDir).forEach((f) => {
    if (f.endsWith('.json')) {
      fs.unlinkSync(path.join(logDir, f));
    }
  });
}

module.exports = { init, log, getLogDates, getLogsForDate, clearAllLogs };
