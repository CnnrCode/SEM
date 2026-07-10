/**
 * downloads.js — Secure downloads history manager for SecureExam Browser.
 * Persists downloads list to the seb-downloads.json file in userData.
 */

const fs = require('fs');
const path = require('path');
const { app } = require('electron');

const DOWNLOADS_FILENAME = 'seb-downloads.json';
let downloadsPath = null;
let downloadsList = [];

function getDownloadsPath() {
  if (!downloadsPath) {
    downloadsPath = path.join(app.getPath('userData'), DOWNLOADS_FILENAME);
  }
  return downloadsPath;
}

function loadDownloads() {
  const p = getDownloadsPath();
  if (fs.existsSync(p)) {
    try {
      downloadsList = JSON.parse(fs.readFileSync(p, 'utf8'));
    } catch {
      downloadsList = [];
    }
  } else {
    downloadsList = [];
  }
  // Sanitize any active "downloading" states from a previous run to "failed" on start
  let modified = false;
  downloadsList = downloadsList.map(dl => {
    if (dl.status === 'downloading') {
      dl.status = 'failed';
      modified = true;
    }
    return dl;
  });
  if (modified) {
    try {
      fs.writeFileSync(p, JSON.stringify(downloadsList, null, 2), 'utf8');
    } catch {}
  }
  return downloadsList;
}

function saveDownloads() {
  const p = getDownloadsPath();
  try {
    fs.writeFileSync(p, JSON.stringify(downloadsList, null, 2), 'utf8');
  } catch (err) {
    console.error('[Downloads] Failed to save downloads:', err);
  }
}

function addOrUpdateDownload(dlObj) {
  loadDownloads();
  const idx = downloadsList.findIndex(d => d.id === dlObj.id);
  if (idx !== -1) {
    downloadsList[idx] = { ...downloadsList[idx], ...dlObj };
  } else {
    downloadsList.unshift(dlObj);
  }
  
  // Cap at 1000 entries
  if (downloadsList.length > 1000) {
    downloadsList = downloadsList.slice(0, 1000);
  }
  
  saveDownloads();
}

function getDownloads() {
  return loadDownloads();
}

function clearDownloads() {
  downloadsList = [];
  saveDownloads();
}

module.exports = {
  addOrUpdateDownload,
  getDownloads,
  clearDownloads
};
