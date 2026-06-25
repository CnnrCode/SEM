/**
 * kiosk.js — SecureExam PWA kiosk logic
 * Handles: fullscreen request, security restrictions, iframe loading, exit password
 */

'use strict';

// ─── State ────────────────────────────────────────────────────────────────────

let exitPassword = '';
let examUrl = '';
let isFullscreen = false;

// ─── DOM refs ─────────────────────────────────────────────────────────────────

const setupScreen = document.getElementById('setup-screen');
const examScreen  = document.getElementById('exam-screen');
const examFrame   = document.getElementById('exam-frame');
const startBtn    = document.getElementById('start-btn');
const exitBtn     = document.getElementById('exit-btn');
const exitDialog  = document.getElementById('exit-dialog');
const exitInput   = document.getElementById('exit-dialog-input');
const exitError   = document.getElementById('exit-error');
const exitCancel  = document.getElementById('exit-cancel-btn');
const exitConfirm = document.getElementById('exit-confirm-btn');
const fsPrompt    = document.getElementById('fs-prompt');
const fsBtn       = document.getElementById('fs-btn');
const examUrlDisp = document.getElementById('exam-url-display');

// ─── Setup ────────────────────────────────────────────────────────────────────

startBtn.addEventListener('click', () => {
  const urlInput = document.getElementById('exam-url').value.trim();
  const pwInput  = document.getElementById('exit-pass').value;

  if (!urlInput || !isValidUrl(urlInput)) {
    alert('Please enter a valid exam URL.');
    return;
  }

  examUrl = urlInput;
  exitPassword = pwInput;

  // Enter fullscreen
  requestFullscreen().then(() => {
    launchExam();
  }).catch(() => {
    // If fullscreen fails, show prompt but still launch
    launchExam();
    showFsPrompt();
  });
});

fsBtn.addEventListener('click', () => {
  requestFullscreen().then(() => {
    fsPrompt.classList.add('hidden');
  });
});

function launchExam() {
  setupScreen.classList.add('hidden');
  examScreen.classList.remove('hidden');
  examUrlDisp.textContent = new URL(examUrl).hostname;
  examFrame.src = examUrl;
  applyRestrictions();
}

// ─── Fullscreen ───────────────────────────────────────────────────────────────

function requestFullscreen() {
  const el = document.documentElement;
  return (el.requestFullscreen || el.webkitRequestFullscreen || el.mozRequestFullScreen || el.msRequestFullscreen)
    ? (el.requestFullscreen || el.webkitRequestFullscreen).call(el)
    : Promise.reject('Fullscreen not supported');
}

document.addEventListener('fullscreenchange', handleFsChange);
document.addEventListener('webkitfullscreenchange', handleFsChange);

function handleFsChange() {
  isFullscreen = !!document.fullscreenElement;
  if (!isFullscreen && examScreen.classList.contains('hidden') === false) {
    // Student exited fullscreen — show prompt
    showFsPrompt();
  } else {
    fsPrompt.classList.add('hidden');
  }
}

function showFsPrompt() {
  if (!examScreen.classList.contains('hidden')) {
    fsPrompt.classList.remove('hidden');
  }
}

// ─── Security restrictions ────────────────────────────────────────────────────

function applyRestrictions() {
  // Block context menu
  document.addEventListener('contextmenu', (e) => e.preventDefault(), true);

  // Block copy/cut/paste
  ['copy', 'cut', 'paste'].forEach((ev) => {
    document.addEventListener(ev, (e) => e.preventDefault(), true);
  });

  // Block drag
  document.addEventListener('dragstart', (e) => e.preventDefault(), true);

  // Disable text selection globally (but not inside iframe which is separate origin)
  document.body.style.userSelect = 'none';
  document.body.style.webkitUserSelect = 'none';

  // Block keyboard shortcuts
  document.addEventListener('keydown', (e) => {
    const blocked = (
      (e.metaKey || e.key === 'Meta') ||    // Cmd / Win
      (e.altKey && e.key === 'Tab') ||       // Alt+Tab
      (e.altKey && e.key === 'F4') ||        // Alt+F4
      e.key === 'PrintScreen' ||
      e.key === 'F12' ||
      (e.ctrlKey && e.shiftKey && (e.key === 'I' || e.key === 'J' || e.key === 'C')) || // DevTools
      (e.ctrlKey && e.key === 'u')           // View source
    );

    if (blocked) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }, true);

  // Warn before page unload
  window.addEventListener('beforeunload', (e) => {
    e.preventDefault();
    e.returnValue = 'The exam is still in progress. Are you sure you want to leave?';
    return e.returnValue;
  });

  // Visibility change warning
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      console.warn('[SecureExam] Tab became hidden — possible tab switch');
    }
  });
}

// ─── Exit dialog ──────────────────────────────────────────────────────────────

exitBtn.addEventListener('click', () => {
  if (!exitPassword) {
    // No password set — ask for confirmation
    if (confirm('Are you sure you want to exit the exam session?')) {
      doExit();
    }
    return;
  }
  exitDialog.classList.remove('hidden');
  exitInput.value = '';
  exitError.classList.add('hidden');
  setTimeout(() => exitInput.focus(), 100);
});

exitCancel.addEventListener('click', () => {
  exitDialog.classList.add('hidden');
});

exitConfirm.addEventListener('click', () => {
  if (exitInput.value === exitPassword) {
    doExit();
  } else {
    exitError.classList.remove('hidden');
    exitInput.value = '';
    exitInput.focus();
  }
});

exitInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') exitConfirm.click();
  if (e.key === 'Escape') exitCancel.click();
});

function doExit() {
  // Exit fullscreen
  if (document.exitFullscreen) document.exitFullscreen();
  // Show setup screen
  examFrame.src = 'about:blank';
  examScreen.classList.add('hidden');
  exitDialog.classList.add('hidden');
  setupScreen.classList.remove('hidden');
  exitPassword = '';
  examUrl = '';
}

// ─── Utility ──────────────────────────────────────────────────────────────────

function isValidUrl(str) {
  try { new URL(str); return true; } catch { return false; }
}
