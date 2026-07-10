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

const { shell, session, webContents } = require('electron');
const auditLog = require('./auditLog');
const config = require('./config');

// ─── Built-in Game domain/keyword block list ─────────────────────────────────
const BLOCKED_GAME_KEYWORDS = [
  'y8',
  'poki',
  'crazygames',
  'pudge-wars',
  'poker-project',
  'pusoy',
  'blackjack',
  'casino',
  'tetris',
  'itch.io',
  'miniclip',
  'kongregate',
  'silvergames',
  'armorgames',
  'addictinggames',
  'game',
  'poker',
  'arcade',
  'wars'
];

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
  // Newly added domains/wrappers
  'gpex.ai',
  'phind.com',
  'kagi.com',
  'exa.ai',
  'jasper.ai',
  'writesonic.com',
  'quillbot.com',
  'wordtune.com',
  'grammarly.com',
  'copy.ai',
  'rytr.me',
  'replit.com',
  'codeium.com',
  'cursor.sh',
  'cursor.com',
  'tabnine.com',
  'midjourney.com',
  'sora.com',
  'luma.ai',
  'pika.art',
  'suno.com',
  'udio.com',
  'elevenlabs.io',
  'vivid.ai',
  'blackbox.ai',
  'v0.dev',
  'chatlarena.org',
  'lmarena.ai',
  // Math & homework AI (commonly used to cheat on exams)
  'mathgptpro.com',         // seen in live logs
  'mathway.com',
  'photomath.com',
  'cymath.com',
  'wolframalpha.com',       // computational AI answers
  'socratic.org',           // Google homework helper
  'brainly.com',            // crowd-sourced homework cheating
  'chegg.com',              // homework answers
  'coursehero.com',         // homework answers
  'studocu.com',            // document sharing / answers
  'numerade.com',
  'bartleby.com',
  'slader.com',
  'homeworkify.net',
  'gauthmath.com',
  // Translation AI (used to cheat via foreign-language lookup)
  'deepl.com',
];

// Backend APIs used by wrapper/custom AI applications
const BUILTIN_AI_API_BACKENDS = [
  'api.openai.com',
  'api.anthropic.com',
  'generativelanguage.googleapis.com',
  'api.mistral.ai',
  'api.x.ai',
  'api.deepseek.com',
  'api.cohere.com',
  'api.together.ai',
  'api.deepinfra.com',
  'api.groq.com',
  'openrouter.ai',
  'api-inference.huggingface.co',
  'api.replicate.com',
  'api.fireworks.ai',
  'api.cerebras.ai',
  'api.sambanova.ai',
  'gateway.ai.cloudflare.com',
];

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check whether a URL belongs to a blocked Game domain or keyword.
 * Returns true if the URL should be BLOCKED.
 * @param {string} url
 * @returns {boolean}
 */
function isGameBlocked(url) {
  if (!url || url === 'about:blank' || url.startsWith('file://')) {
    return false;
  }

  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  const normalizedHostname = hostname.replace(/^www\./, '');

  // Whitelist/allowed domain checks first (always allowed)
  if (isAllowedDomain(url)) {
    return false;
  }

  // Check Game keywords
  for (const keyword of BLOCKED_GAME_KEYWORDS) {
    if (normalizedHostname.includes(keyword)) {
      return true;
    }
  }

  // Check Game TLDs
  if (normalizedHostname.endsWith('.games') || normalizedHostname.endsWith('.play')) {
    return true;
  }

  return false;
}

/**
 * Attach URL filtering to a webContents instance.
 * @param {Electron.WebContents} webContents
 */
function attach(webContents) {
  // Block navigation to AI domains (including subframes and programmatic loadURL)
  webContents.on('will-frame-navigate', (event, details) => {
    const url = details.url;
    const resType = details.isMainFrame ? 'mainFrame' : 'subFrame';

    // Block non-standard protocols to prevent triggering external software launches
    try {
      const parsed = new URL(url);
      const protocol = parsed.protocol.toLowerCase();
      const allowedProtocols = ['http:', 'https:', 'file:', 'data:', 'seb:'];
      if (!allowedProtocols.includes(protocol)) {
        event.preventDefault();
        console.warn(`[URLFilter] Blocked external application protocol launch: ${url}`);
        return;
      }
    } catch (e) {}

    const isGame = isGameBlocked(url);
    const isAi = isAiBlocked(url, resType);

    if (isAi || isGame) {
      event.preventDefault();
      auditLog.log(isGame ? 'GAME_URL_BLOCKED' : 'AI_URL_BLOCKED', { url });
      const owner = webContents.getOwnerBrowserWindow();
      if (owner && !owner.isDestroyed()) {
        owner.webContents.send('browser:show-blocked-toast', { url, type: isGame ? 'game' : 'ai' });
      }
      console.warn('[URLFilter] Blocked frame navigation to:', url);
    }
  });

  // Block new-window/popup creation — force links to open in a new tab
  webContents.setWindowOpenHandler(({ url }) => {
    const isGame = isGameBlocked(url);
    const isAi = isAiBlocked(url, 'mainFrame');

    if (isAi || isGame) {
      auditLog.log(isGame ? 'GAME_POPUP_BLOCKED' : 'AI_POPUP_BLOCKED', { url });
      const owner = webContents.getOwnerBrowserWindow();
      if (owner && !owner.isDestroyed()) {
        owner.webContents.send('browser:show-blocked-toast', { url, type: isGame ? 'game' : 'ai' });
      }
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
    // Block non-standard protocols on redirect to prevent triggering external software launches
    try {
      const parsed = new URL(url);
      const protocol = parsed.protocol.toLowerCase();
      const allowedProtocols = ['http:', 'https:', 'file:', 'data:', 'seb:'];
      if (!allowedProtocols.includes(protocol)) {
        event.preventDefault();
        console.warn(`[URLFilter] Blocked external redirect protocol launch: ${url}`);
        return;
      }
    } catch (e) {}

    const isGame = isGameBlocked(url);
    const isAi = isAiBlocked(url, 'mainFrame');

    if (isAi || isGame) {
      event.preventDefault();
      auditLog.log(isGame ? 'GAME_REDIRECT_BLOCKED' : 'AI_REDIRECT_BLOCKED', { url });
      const owner = webContents.getOwnerBrowserWindow();
      if (owner && !owner.isDestroyed()) {
        owner.webContents.send('browser:show-blocked-toast', { url, type: isGame ? 'game' : 'ai' });
      }
      console.warn('[URLFilter] Blocked redirect to:', url);
    }
  });

  // DevTools are always blocked during exam sessions
  webContents.on('devtools-opened', () => {
    webContents.closeDevTools();
    auditLog.log('DEVTOOLS_BLOCKED');
    console.warn('[URLFilter] DevTools opened — closed immediately.');
  });
}

/**
 * Check if the URL is explicitly allowed (exam host or admin allowed domains).
 * Whitelisted domains are NEVER blocked by any AI filter layer.
 * @param {string} url
 * @returns {boolean}
 */
function isAllowedDomain(url) {
  if (!url) return false;
  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }
  const normalizedHostname = hostname.replace(/^www\./, '');

  const cfg = config.get();
  // 1. Always allow examUrl domain
  if (cfg.examUrl) {
    try {
      const examHost = new URL(cfg.examUrl).hostname.toLowerCase().replace(/^www\./, '');
      if (normalizedHostname === examHost || normalizedHostname.endsWith(`.${examHost}`)) {
        return true;
      }
    } catch {}
  }

  // 2. Allow domains listed in allowedDomains
  const allowed = cfg.allowedDomains || [];
  for (const domain of allowed) {
    const d = domain.trim().toLowerCase().replace(/^https?:\/\//, '').split('/')[0].replace(/^www\./, '');
    if (!d) continue;
    if (normalizedHostname === d || normalizedHostname.endsWith(`.${d}`)) {
      return true;
    }
  }

  return false;
}

/**
 * Check whether a URL belongs to a blocked AI domain.
 * Returns true if the URL should be BLOCKED.
 */
function isAiBlocked(url, resourceType = 'mainFrame') {
  // Block data: and javascript: URIs to prevent self-contained bypasses
  if (url && (url.startsWith('data:') || url.startsWith('javascript:'))) {
    return true;
  }

  // Block specific known AI paths on allowed domains (like Facebook/Instagram Meta AI)
  if (url) {
    const urlLower = url.toLowerCase();
    if (urlLower.includes('/metaai') || urlLower.includes('/meta-ai') || urlLower.includes('metaai=') || urlLower.includes('meta_ai')) {
      return true;
    }
  }

  // Always allow internal / blank pages
  if (!url || url === 'about:blank' || url.startsWith('file://')) {
    return false;
  }

  let hostname;
  try {
    hostname = new URL(url).hostname.toLowerCase();
  } catch {
    return false; // unparseable → allow (fail open)
  }

  // Normalize hostname: strip leading 'www.' for checking
  const normalizedHostname = hostname.replace(/^www\./, '');

  // Whitelist/allowed domain checks first (always allowed)
  if (isAllowedDomain(url)) {
    return false;
  }

  const cfg = config.get();

  // Layer 1: Check AI API backend domains (block for all resource types)
  if (!cfg || cfg.features.blockAiApiBackends !== false) {
    for (const backend of BUILTIN_AI_API_BACKENDS) {
      const b = backend.trim().toLowerCase().replace(/^www\./, '');
      if (normalizedHostname === b || normalizedHostname.endsWith(`.${b}`)) {
        return true;
      }
    }

    // AWS Bedrock pattern match
    if (normalizedHostname.startsWith('bedrock-runtime.') && normalizedHostname.endsWith('.amazonaws.com')) {
      return true;
    }

    // Localhost AI Server blocking (Ollama, LM Studio, etc.)
    const blockedPorts = ['11434', '1234', '8080', '5000', '8000', '9000'];
    let port;
    try {
      port = new URL(url).port;
    } catch {}
    if (normalizedHostname === 'localhost' || normalizedHostname === '127.0.0.1' || normalizedHostname.startsWith('192.168.') || normalizedHostname.startsWith('10.')) {
      if (port && blockedPorts.includes(port)) {
        return true;
      }
    }
  }

  // Layer 3: Block all .ai TLD domains (ONLY block for mainFrame and subFrame requests)
  if (normalizedHostname.endsWith('.ai')) {
    if (resourceType === 'mainFrame' || resourceType === 'subFrame') {
      return true;
    }
  }

  // Layer 3: Check built-in list
  for (const domain of BUILTIN_AI_DOMAINS) {
    const d = domain.trim().toLowerCase().replace(/^www\./, '');
    if (normalizedHostname === d || normalizedHostname.endsWith(`.${d}`)) {
      // Bing.com: ONLY block mainFrame and subFrame to avoid breaking analytics pixels on allowed sites
      if (d === 'bing.com') {
        if (resourceType === 'mainFrame' || resourceType === 'subFrame') {
          return true;
        }
      } else {
        return true;
      }
    }
  }

  // Check admin-configured extra blocked domains (block for all resource types)
  const extra = cfg.blockedAiDomains || [];
  for (const domain of extra) {
    const d = domain.trim().toLowerCase()
      .replace(/^https?:\/\//, '')
      .split('/')[0]
      .replace(/^www\./, '');
    if (!d) continue;
    if (normalizedHostname === d || normalizedHostname.endsWith(`.${d}`)) {
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

/**
 * Set up global session-level WebRequest interceptor to block all AI traffic
 */
function init() {
  // 1. Block requests to AI domains or data/javascript URIs
  session.defaultSession.webRequest.onBeforeRequest(
    { urls: ['*://*/*'] },
    (details, callback) => {
      const url = details.url;

      // Force Google Classic Web Search (udm=14) to block SGE/AI features
      if (details.resourceType === 'mainFrame' || details.resourceType === 'subFrame') {
        let isGoogleSearch = false;
        try {
          const host = new URL(url).hostname;
          if (host.startsWith('google.') || host.includes('.google.')) {
            if (new URL(url).pathname === '/search') {
              isGoogleSearch = true;
            }
          }
        } catch {}

        if (isGoogleSearch) {
          try {
            const parsedUrl = new URL(url);
            const tbm = parsedUrl.searchParams.get('tbm');
            const udm = parsedUrl.searchParams.get('udm');
            
            // Allow media search tabs (Images=2, Videos=3, News=7, Shopping=12, Forums=13)
            const allowedUdms = ['2', '3', '6', '7', '12', '13'];
            const hasMediaTab = tbm || (udm && allowedUdms.includes(udm));

            if (parsedUrl.searchParams.has('q') && !hasMediaTab && udm !== '14') {
              parsedUrl.searchParams.set('udm', '14');
              console.log('[URLFilter] Redirecting Google search to Classic Web search:', parsedUrl.toString());
              callback({ redirectURL: parsedUrl.toString() });
              return;
            }
          } catch (err) {
            console.error('[URLFilter] Failed to append udm=14:', err);
          }
        }
      }

      const isGame = isGameBlocked(url);
      const isAi = isAiBlocked(url, details.resourceType);

      if (isAi || isGame) {
        auditLog.log(isGame ? 'GAME_URL_BLOCKED' : 'AI_URL_BLOCKED', { url });

        if (details.webContentsId) {
          try {
            const wc = webContents.fromId(details.webContentsId);
            if (wc && !wc.isDestroyed()) {
              const owner = wc.getOwnerBrowserWindow();
              if (owner && !owner.isDestroyed()) {
                owner.webContents.send('browser:show-blocked-toast', { url, type: isGame ? 'game' : 'ai' });
              }
            }
          } catch (err) {
            console.error('[URLFilter] Failed to send blocked toast event:', err);
          }
        }

        console.warn('[URLFilter] WebRequest blocked request:', url);
        callback({ cancel: true });
      } else {
        callback({ cancel: false });
      }
    }
  );

  // 2. Block streaming/SSE responses from non-allowed hosts (detects AI streaming)
  session.defaultSession.webRequest.onHeadersReceived(
    { urls: ['*://*/*'] },
    (details, callback) => {
      const cfg = config.get();
      if (!cfg || cfg.features.blockAiStreaming !== false) {
        const responseHeaders = details.responseHeaders || {};
        let contentType = '';
        for (const key of Object.keys(responseHeaders)) {
          if (key.toLowerCase() === 'content-type') {
            const values = responseHeaders[key];
            if (Array.isArray(values)) {
              contentType = values.join(';');
            } else if (typeof values === 'string') {
              contentType = values;
            }
            break;
          }
        }

        if (contentType.toLowerCase().includes('text/event-stream')) {
          const url = details.url;
          if (!isAllowedDomain(url)) {
            auditLog.log('AI_STREAM_BLOCKED', { url });
            console.warn('[URLFilter] Blocked AI streaming response from:', url);
            callback({ cancel: true });
            return;
          }
        }
      }
      callback({ responseHeaders: details.responseHeaders });
    }
  );
}

module.exports = { init, attach, isAiBlocked, getBuiltinAiDomains, isInputBlocked, isGameBlocked };

/**
 * Check if the user input in the address bar should be blocked because it contains AI.
 * @param {string} text
 * @returns {boolean}
 */
function isInputBlocked(text) {
  if (!text) return false;
  const lower = text.trim().toLowerCase();

  // 1. Check if the input contains general Game keywords
  const GAME_KEYWORDS = [
    'y8',
    'poki',
    'crazygames',
    'pudge-wars',
    'poker-project',
    'pusoy',
    'blackjack',
    'casino',
    'tetris',
    'game',
    'poker',
    'arcade',
    'wars'
  ];

  for (const keyword of GAME_KEYWORDS) {
    if (lower.includes(keyword)) {
      return true;
    }
  }

  // 2. Check if the input contains general AI keywords
  const AI_KEYWORDS = [
    'chatgpt',
    'gemini',
    'claude',
    'copilot',
    'perplexity',
    'deepseek',
    'grok',
    'openai',
    'anthropic',
    'artificial intelligence',
    'llm',
    'bard',
    'gpex',
    'blackbox',
    'v0',
    'lmarena',
    'openrouter',
    'ollama',
    'replicate',
    'phind',
    'kagi',
    'quillbot',
    'wordtune',
    'jasper',
    'writesonic',
    'suno',
    'udio',
    'elevenlabs'
  ];

  for (const keyword of AI_KEYWORDS) {
    if (lower.includes(keyword)) {
      return true;
    }
  }

  // 3. Check against built-in and extra blocked domains
  const tlds = ['com', 'org', 'net', 'edu', 'gov', 'co', 'io', 'ai', 'uk', 'us', 'ca', 'au', 'nz', 'de', 'fr', 'jp', 'cn', 'ru', 'in', 'br', 'za'];
  const EXCLUDED_LABELS = ['google', 'microsoft', 'bing', 'github', 'huggingface', 'x', 'you', 'chat'];

  const allDomains = [...BUILTIN_AI_DOMAINS];
  const cfg = config.get();
  if (cfg && cfg.blockedAiDomains) {
    allDomains.push(...cfg.blockedAiDomains);
  }

  for (const domain of allDomains) {
    const d = domain.trim().toLowerCase()
      .replace(/^https?:\/\//, '')
      .split('/')[0];
    if (!d) continue;

    // Check if the input contains the exact domain/subdomain
    if (lower.includes(d)) {
      return true;
    }

    // Check label parts of the domain (excluding common TLDs and generic labels)
    const parts = d.split('.');
    const labelParts = parts.filter(p => p.length > 2 && !tlds.includes(p) && !EXCLUDED_LABELS.includes(p) && p !== 'www');
    for (const label of labelParts) {
      if (lower.includes(label)) {
        return true;
      }
    }
  }

  return false;
}

