/**
 * urlFilter.js — AI blacklist URL enforcement for SecureExam Browser
 *
 * Behaviour (new model):
 *   • All URLs are ALLOWED by default — students can open Facebook, YouTube, etc.
 *   • AI tool domains are BLOCKED — ChatGPT, Gemini, Claude, Copilot, etc.
 *   • Admin can extend the block list via the Admin Panel.
 *   • DevTools are always blocked.
 *   • New windows / popups are always denied (open in same tab instead).
 */

const { shell } = require('electron');
const auditLog = require('./auditLog');
const config = require('./config');

// ─── Built-in AI domain block list ───────────────────────────────────────────
// Subdomains are matched automatically (e.g. blocking "openai.com" also blocks
// "api.openai.com", "platform.openai.com", etc.)

const BUILTIN_AI_DOMAINS = [
  // OpenAI / ChatGPT
  'openai.com',
  'chatgpt.com',
  // Google AI
  'gemini.google.com',
  'bard.google.com',
  'aistudio.google.com',
  'makersuite.google.com',
  // Microsoft Copilot
  'copilot.microsoft.com',
  'copilot.cloud.microsoft',
  // Bing AI (chat only — hostname level; we can't filter by path in will-navigate)
  'bing.com',
  // Anthropic Claude
  'claude.ai',
  'anthropic.com',
  // Perplexity
  'perplexity.ai',
  // Meta AI
  'meta.ai',
  // You.com
  'you.com',
  // Poe
  'poe.com',
  // Mistral
  'mistral.ai',
  'chat.mistral.ai',
  // Hugging Face Chat
  'huggingface.co',
  // DeepSeek
  'deepseek.com',
  // Grok / xAI
  'grok.com',
  'x.ai',
  // Cohere
  'cohere.com',
  'coral.cohere.com',
  // Pi AI
  'pi.ai',
  // Inflection
  'inflection.ai',
  // Character.ai
  'character.ai',
  'beta.character.ai',
  // Runway, Sora-type generative AI
  'runwayml.com',
  // GitHub Copilot (web)
  'githubnext.com',
  'copilot.github.com',
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Attach URL filtering to a webContents instance.
 * @param {Electron.WebContents} webContents
 */
function attach(webContents) {
  // Block navigation to AI domains
  webContents.on('will-navigate', (event, url) => {
    if (isAiBlocked(url)) {
      event.preventDefault();
      auditLog.log('AI_URL_BLOCKED', { url });
      webContents.send('url-blocked', { url, reason: 'ai' });
      console.warn('[URLFilter] Blocked AI navigation to:', url);
    }
  });

  // Block new-window/popup creation — force links to open in a new tab
  webContents.setWindowOpenHandler(({ url }) => {
    if (isAiBlocked(url)) {
      auditLog.log('AI_POPUP_BLOCKED', { url });
      return { action: 'deny' };
    }
    
    // For non-AI URLs: tell the browser chrome window to open a new tab
    if (webContents.getType() === 'webview') {
      const owner = webContents.getOwnerBrowserWindow();
      if (owner && !owner.isDestroyed()) {
        owner.webContents.send('browser:open-tab', url);
      }
    }
    return { action: 'deny' };
  });

  // Block redirects to AI domains
  webContents.on('will-redirect', (event, url) => {
    if (isAiBlocked(url)) {
      event.preventDefault();
      auditLog.log('AI_REDIRECT_BLOCKED', { url });
      console.warn('[URLFilter] Blocked AI redirect to:', url);
    }
  });

  // Block DevTools — always
  webContents.on('devtools-opened', () => {
    webContents.closeDevTools();
    auditLog.log('DEVTOOLS_BLOCKED');
    console.warn('[URLFilter] DevTools opened — closed immediately.');
  });
}

/**
 * Check whether a URL belongs to a blocked AI domain.
 * Returns true if the URL should be BLOCKED.
 */
function isAiBlocked(url) {
  // Always allow internal / blank pages
  if (!url || url === 'about:blank' || url.startsWith('data:') || url.startsWith('file://')) {
    return false;
  }

  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false; // unparseable → allow (fail open)
  }

  // Check built-in list
  for (const domain of BUILTIN_AI_DOMAINS) {
    const d = domain.trim().toLowerCase();
    if (hostname === d || hostname.endsWith(`.${d}`)) {
      return true;
    }
  }

  // Check admin-configured extra blocked domains
  const cfg = config.get();
  const extra = cfg.blockedAiDomains || [];
  for (const domain of extra) {
    const d = domain.trim().toLowerCase();
    if (!d) continue;
    if (hostname === d || hostname.endsWith(`.${d}`)) {
      return true;
    }
  }

  return false;
}

/**
 * Returns the full merged block list (built-in + admin extras).
 * Used by the admin panel to display the current state.
 */
function getBuiltinAiDomains() {
  return [...BUILTIN_AI_DOMAINS];
}

module.exports = { attach, isAiBlocked, getBuiltinAiDomains };
