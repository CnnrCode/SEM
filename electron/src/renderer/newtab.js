/**
 * newtab.js — Logic for the Prodigy New Tab page.
 * Handles: live clock, motivational quotes, Google search,
 * theme sync from parent browser window, and iframe lockdown.
 */

'use strict';

// ─── Quotes ──────────────────────────────────────────────────────────────────

const QUOTES = [
  "The secret of getting ahead is getting started. — Mark Twain",
  "An investment in knowledge pays the best interest. — Benjamin Franklin",
  "Education is the most powerful weapon you can use to change the world. — Nelson Mandela",
  "The more that you read, the more things you will know. — Dr. Seuss",
  "Success is the sum of small efforts, repeated day in and day out. — Robert Collier",
  "Believe you can and you're halfway there. — Theodore Roosevelt",
  "Do not wait to strike till the iron is hot; make it hot by striking. — W.B. Yeats",
  "It always seems impossible until it's done. — Nelson Mandela",
  "The expert in anything was once a beginner. — Helen Hayes",
  "Push yourself, because no one else is going to do it for you.",
  "Great things never come from comfort zones.",
  "Don't stop when you're tired. Stop when you're done.",
  "Dream it. Wish it. Do it.",
  "Study hard now. Shine later.",
  "Your only limit is your mind.",
  "Every expert was once a student.",
  "Study, Don't be Skibidi"
];

// ─── Clock ────────────────────────────────────────────────────────────────────

const clockEl = document.getElementById('nt-clock');
const dateEl = document.getElementById('nt-date');

function updateClock() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  const s = String(now.getSeconds()).padStart(2, '0');
  clockEl.textContent = `${h}:${m}:${s}`;

  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
  const months = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
  dateEl.textContent = `${days[now.getDay()]}, ${months[now.getMonth()]} ${now.getDate()}`;
}

updateClock();
setInterval(updateClock, 1000);

// ─── Random Quote ─────────────────────────────────────────────────────────────

const quoteEl = document.getElementById('nt-quote');
quoteEl.textContent = `"${QUOTES[Math.floor(Math.random() * QUOTES.length)]}"`;

// ─── Search ───────────────────────────────────────────────────────────────────

const searchInput = document.getElementById('nt-search-input');
const searchBtn = document.getElementById('nt-search-btn');

function doSearch() {
  const raw = searchInput.value.trim();
  if (!raw) return;

  let url;
  // If it looks like a URL, navigate directly; otherwise Google it
  if (/^https?:\/\//i.test(raw)) {
    url = raw;
  } else if (raw.includes('.') && !raw.includes(' ')) {
    url = 'https://' + raw;
  } else {
    url = 'https://www.google.com/search?q=' + encodeURIComponent(raw);
  }

  // Communicate to the parent browser frame to navigate the active tab
  if (window.parent && window.parent !== window) {
    // Running inside browser.html iframe — shouldn't happen but handle gracefully
    window.parent.postMessage({ type: 'seb:newtab-navigate', url }, '*');
  } else {
    // Running directly in a webview — use the exposed IPC bridge if available
    if (window.sebBrowser && window.sebBrowser.navigateTo) {
      window.sebBrowser.navigateTo(url);
    } else {
      // Fallback: open in same window (the webview will intercept)
      window.location.href = url;
    }
  }
}

searchInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') doSearch();
});

searchBtn.addEventListener('click', doSearch);

// ─── Theme Sync ───────────────────────────────────────────────────────────────

// Read the theme class from localStorage (set by the parent browser chrome)
function applyTheme() {
  const theme = localStorage.getItem('seb-theme') || 'dark';
  // Remove any existing theme classes
  document.body.className = document.body.className
    .replace(/\btheme-\S+/g, '')
    .trim();
  if (theme && theme !== 'dark') {
    document.body.classList.add(`theme-${theme}`);
  }
}

applyTheme();

// Watch for theme changes from parent (via storage events)
window.addEventListener('storage', (e) => {
  if (e.key === 'seb-theme') applyTheme();
});




// ─── Lockdown / Security Restrictions inside iframe ───────────────────────────

// Disable context menu (right click)
document.addEventListener('contextmenu', (e) => {
  e.preventDefault();
  e.stopImmediatePropagation();
}, true);

// Block keyboard shortcuts
document.addEventListener('keydown', (e) => {
  const isControl = e.ctrlKey || e.metaKey;
  const isShift = e.shiftKey;
  const isAlt = e.altKey;
  const key = e.key.toLowerCase();

  // 1. DevTools: F12, Ctrl+Shift+I/J/C, Ctrl+U (View Source)
  if (
    key === 'f12' ||
    (isControl && isShift && (key === 'i' || key === 'j' || key === 'c')) ||
    (isControl && key === 'u')
  ) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }

  // 2. Printing and Saving: Ctrl+P, Ctrl+S
  if (isControl && (key === 'p' || key === 's')) {
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }

  // 3. New Window / Tab creation: Ctrl+N
  if (isControl && key === 'n') {
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }

  // 4. Alt+F4
  if (isAlt && key === 'f4') {
    e.preventDefault();
    e.stopImmediatePropagation();
    return;
  }
}, true);
