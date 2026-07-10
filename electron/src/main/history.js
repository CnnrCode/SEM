/**
 * history.js — Secure browsing history manager for SecureExam Browser.
 * Persists history list to the seb-history.json file in userData.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const HISTORY_FILENAME = 'seb-history.json';
let historyPath = null;
let historyList = [];

function getHistoryPath() {
  if (!historyPath) {
    historyPath = path.join(app.getPath('userData'), HISTORY_FILENAME);
  }
  return historyPath;
}

function loadHistory() {
  const p = getHistoryPath();
  if (fs.existsSync(p)) {
    try {
      historyList = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      historyList = [];
    }
  } else {
    historyList = [];
  }
  return historyList;
}

function saveHistory() {
  const p = getHistoryPath();
  try {
    fs.writeFileSync(p, JSON.stringify(historyList, null, 2), 'utf8');
  } catch (err) {
    console.error('[History] Failed to save history:', err);
  }
}

function addHistory(title, url) {
  if (!url || url === 'about:blank' || url.startsWith('seb://') || url.startsWith('chrome://')) {
    return;
  }
  loadHistory();
  
  const now = new Date();
  const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const dateStr = now.toLocaleDateString([], { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });
  
  // Avoid duplicate adjacent entries within 15 seconds
  if (historyList.length > 0) {
    const last = historyList[0];
    if (last.url === url && (now - new Date(last.timestamp)) < 15000) {
      last.title = title || last.title;
      last.timestamp = now.toISOString();
      last.time = timeStr;
      last.date = dateStr;
      saveHistory();
      return;
    }
  }

  const entry = {
    id: Date.now().toString() + '_' + Math.random().toString(36).substr(2, 5),
    title: title || url,
    url,
    timestamp: now.toISOString(),
    time: timeStr,
    date: dateStr
  };

  historyList.unshift(entry);
  
  // Cap at 2000 entries
  if (historyList.length > 2000) {
    historyList = historyList.slice(0, 2000);
  }
  
  saveHistory();
}

function getHistory() {
  return loadHistory();
}

function deleteHistoryItem(id) {
  loadHistory();
  historyList = historyList.filter(item => item.id !== id);
  saveHistory();
}

function clearHistory() {
  historyList = [];
  saveHistory();
}

module.exports = {
  addHistory,
  getHistory,
  deleteHistoryItem,
  clearHistory
};
