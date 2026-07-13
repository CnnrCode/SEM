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


// ─── Customizer & Canvas Animation Controller ─────────────────────────────────

(function () {
  // 1. Settings Popup Toggle & Theme Switcher
  const settingsBtn = document.getElementById('nt-settings-btn');
  const settingsPopup = document.getElementById('nt-settings-popup');
  
  if (settingsBtn && settingsPopup) {
    settingsBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      settingsPopup.classList.toggle('hidden');
    });

    // Prevent clicks inside popup from propagating and closing it
    settingsPopup.addEventListener('click', (e) => {
      e.stopPropagation();
    });

    // Close settings popup when clicking anywhere outside
    document.addEventListener('click', () => {
      settingsPopup.classList.add('hidden');
    });
  }

  // Active theme synchronization inside popup
  const themeDotBtns = document.querySelectorAll('.theme-dot-btn');
  function syncThemeSelector() {
    const activeTheme = localStorage.getItem('seb-theme') || 'dark';
    themeDotBtns.forEach(btn => {
      if (btn.getAttribute('data-theme') === activeTheme) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
  syncThemeSelector();

  themeDotBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const selectedTheme = btn.getAttribute('data-theme');
      
      // Update dots UI
      themeDotBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      
      // Update localStorage
      localStorage.setItem('seb-theme', selectedTheme);
      localStorage.setItem('prodigy-theme', selectedTheme);
      
      // Sync styles locally on New Tab page
      applyTheme();
      
      // Send message to parent frame to update browser chrome window and config
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'seb:newtab-set-theme', theme: selectedTheme }, '*');
      } else if (window.sebBrowser && window.sebBrowser.saveConfig) {
        // Fallback context bridge call
        window.sebBrowser.saveConfig({ uiTheme: selectedTheme }).catch(() => {});
      }
    });
  });

  // Observe configuration or storage change to update popup dots
  window.addEventListener('storage', (e) => {
    if (e.key === 'seb-theme') syncThemeSelector();
  });

  // 2. Visualization Mode Controller
  const visBtns = document.querySelectorAll('.vis-btn');
  let visMode = localStorage.getItem('seb-vis-mode') || 'brain';

  function syncVisSelector() {
    visBtns.forEach(btn => {
      if (btn.getAttribute('data-mode') === visMode) {
        btn.classList.add('active');
      } else {
        btn.classList.remove('active');
      }
    });
  }
  syncVisSelector();

  visBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      const mode = btn.getAttribute('data-mode');
      visMode = mode;
      localStorage.setItem('seb-vis-mode', mode);
      syncVisSelector();
      initVis();
    });
  });

  // 2.5. Proctoring Camera Controller
  const camBtnOn = document.getElementById('cam-btn-on');
  const camBtnOff = document.getElementById('cam-btn-off');

  function syncCamSelector() {
    const isCamEnabled = localStorage.getItem('seb-proctor-cam') === 'true';
    if (isCamEnabled) {
      if (camBtnOn) camBtnOn.classList.add('active');
      if (camBtnOff) camBtnOff.classList.remove('active');
    } else {
      if (camBtnOn) camBtnOn.classList.remove('active');
      if (camBtnOff) camBtnOff.classList.add('active');
    }
  }
  syncCamSelector();

  function setProctorCamState(enabled) {
    localStorage.setItem('seb-proctor-cam', enabled ? 'true' : 'false');
    syncCamSelector();
    
    // Post message to browser chrome parent window
    if (window.parent && window.parent !== window) {
      window.parent.postMessage({ type: 'seb:newtab-set-proctor-cam', enabled }, '*');
    }
  }

  if (camBtnOn) {
    camBtnOn.addEventListener('click', () => setProctorCamState(true));
  }
  if (camBtnOff) {
    camBtnOff.addEventListener('click', () => setProctorCamState(false));
  }

  // Initialize proctor cam status on startup (notifies parent frame)
  const initialCamEnabled = localStorage.getItem('seb-proctor-cam') === 'true';
  if (initialCamEnabled) {
    setTimeout(() => {
      if (window.parent && window.parent !== window) {
        window.parent.postMessage({ type: 'seb:newtab-set-proctor-cam', enabled: true }, '*');
      }
    }, 200);
  }

  // 3. Canvas Animation Logic
  const canvas = document.getElementById('nt-canvas');
  if (!canvas) return;
  const ctx = canvas.getContext('2d');

  let width = 0;
  let height = 0;
  let centerX = 0;
  let centerY = 0;

  // Track mouse coordinates
  const mouse = { x: -9999, y: -9999, active: false };

  // Set sizing
  function resize() {
    width = canvas.width = window.innerWidth;
    height = canvas.height = window.innerHeight;
    centerX = width / 2;
    centerY = height / 2 - 20; // Shift slightly upward to sit behind main logo
  }
  resize();
  window.addEventListener('resize', resize);

  document.addEventListener('mousemove', (e) => {
    mouse.x = e.clientX;
    mouse.y = e.clientY;
    mouse.active = true;
  });

  document.addEventListener('mouseleave', () => {
    mouse.active = false;
    mouse.x = -9999;
    mouse.y = -9999;
  });

  // Dynamic Theme Colors
  let themeColor = 'rgba(79, 142, 247, 0.4)';
  let accentColorHex = '#4f8ef7';
  
  function updateThemeColors() {
    const style = getComputedStyle(document.body);
    const accent = style.getPropertyValue('--nt-accent').trim();
    if (accent) {
      accentColorHex = accent;
      if (accent.startsWith('#')) {
        const r = parseInt(accent.slice(1, 3), 16);
        const g = parseInt(accent.slice(3, 5), 16);
        const b = parseInt(accent.slice(5, 7), 16);
        themeColor = `rgba(${r}, ${g}, ${b}, 0.35)`;
      } else {
        themeColor = accent;
      }
    }
  }
  updateThemeColors();
  
  window.addEventListener('storage', (e) => {
    if (e.key === 'seb-theme') {
      setTimeout(updateThemeColors, 50);
    }
  });

  const observer = new MutationObserver(updateThemeColors);
  observer.observe(document.body, { attributes: true, attributeFilter: ['class'] });

  // Data arrays
  const particles = [];
  const connections = [];
  const pulses = [];
  const satellites = [];

  // Lobe definition centers for Brain:
  const BRAIN_CLUSTERS = [
    { name: 'Frontal Lobe', cx: -75, cy: -50, rx: 75, ry: 60, count: 28 },
    { name: 'Parietal Lobe', cx: 25, cy: -75, rx: 75, ry: 60, count: 26 },
    { name: 'Occipital Lobe', cx: 95, cy: -35, rx: 60, ry: 50, count: 22 },
    { name: 'Temporal Lobe', cx: -15, cy: 15, rx: 65, ry: 50, count: 24 },
    { name: 'Cerebellum', cx: 70, cy: 50, rx: 45, ry: 35, count: 18 },
    { name: 'Brain Stem', cx: 15, cy: 100, rx: 18, ry: 55, count: 12 }
  ];

  const BRAIN_ADJACENCY = {
    0: [0, 1, 3],
    1: [1, 0, 2, 3],
    2: [2, 1, 4],
    3: [3, 0, 1, 4, 5],
    4: [4, 2, 3, 5],
    5: [5, 3, 4]
  };

  const brainMaxDist = 75;

  function initBrainParticles() {
    BRAIN_CLUSTERS.forEach((cluster, index) => {
      for (let i = 0; i < cluster.count; i++) {
        let offX, offY;
        if (index === 5) {
          offX = (Math.random() - 0.5) * cluster.rx * 2;
          offY = (Math.random() - 0.5) * cluster.ry * 2;
        } else {
          const theta = Math.random() * Math.PI * 2;
          const rad = Math.sqrt(Math.random());
          offX = Math.cos(theta) * rad * cluster.rx;
          offY = Math.sin(theta) * rad * cluster.ry;
        }

        particles.push({
          id: particles.length,
          clusterId: index,
          baseX: cluster.cx + offX,
          baseY: cluster.cy + offY,
          dx: 0,
          dy: 0,
          vx: (Math.random() - 0.5) * 0.2,
          vy: (Math.random() - 0.5) * 0.2,
          size: Math.random() * 2 + 1.5,
          brightness: Math.random() * 0.5 + 0.5,
          pulseOffset: Math.random() * Math.PI * 2
        });
      }
    });

    for (let i = 0; i < particles.length; i++) {
      for (let j = i + 1; j < particles.length; j++) {
        const p1 = particles[i];
        const p2 = particles[j];
        const allowedTargets = BRAIN_ADJACENCY[p1.clusterId];
        if (allowedTargets.includes(p2.clusterId)) {
          const dx = p1.baseX - p2.baseX;
          const dy = p1.baseY - p2.baseY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < brainMaxDist) {
            connections.push({ from: p1.id, to: p2.id });
          }
        }
      }
    }
  }

  // Earth Landmass check:
  function checkLand(lat, lon) {
    if (lon > -2.8 && lon < -0.6) {
      if (lat > -1.0 && lat < 1.3) return true;
    }
    if (lon > -0.35 && lon < 0.9 && lat > -0.6 && lat < 0.6) return true;
    if (lon > -0.2 && lon < 3.14 && lat > 0.15 && lat < 1.3) return true;
    if (lon > 1.9 && lon < 2.7 && lat > -0.7 && lat < -0.17) return true;
    if (lat < -1.2) return true;
    return false;
  }

  const earthRadius = 140;

  function initEarthParticles() {
    const totalPoints = 380;
    for (let i = 0; i < totalPoints; i++) {
      const offset = 2 / totalPoints;
      const increment = Math.PI * (3 - Math.sqrt(5)); // Golden angle
      
      const y = ((i * offset) - 1) + (offset / 2);
      const r = Math.sqrt(1 - y * y);
      const phi = i * increment;
      
      const x = Math.cos(phi) * r;
      const z = Math.sin(phi) * r;

      const theta = Math.atan2(z, x);
      const lat = Math.asin(y);
      
      const isLandNode = checkLand(lat, theta);

      // Keep land nodes, make ocean nodes very sparse
      if (!isLandNode && Math.random() > 0.12) {
        continue;
      }

      particles.push({
        id: particles.length,
        x3d: x * earthRadius,
        y3d: y * earthRadius,
        z3d: z * earthRadius,
        isLand: isLandNode,
        size: isLandNode ? (Math.random() * 1.5 + 1.6) : 0.8,
        opacity: isLandNode ? (Math.random() * 0.45 + 0.45) : 0.15,
        brightness: isLandNode ? 1.0 : 0.45
      });
    }

    // Build connections between neighboring land nodes
    for (let i = 0; i < connections.length; i++) {} // reset
    
    // Connect neighboring land nodes
    for (let i = 0; i < particles.length; i++) {
      const p1 = particles[i];
      if (!p1.isLand) continue;
      
      for (let j = i + 1; j < particles.length; j++) {
        const p2 = particles[j];
        if (!p2.isLand) continue;

        const dx = p1.x3d - p2.x3d;
        const dy = p1.y3d - p2.y3d;
        const dz = p1.z3d - p2.z3d;
        const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);

        if (dist < 32) {
          connections.push({ from: p1.id, to: p2.id });
        }
      }
    }

    // Satellites
    satellites.push({
      angle: 0,
      speed: 0.01,
      orbitRadius: 185,
      tiltX: 0.5,
      size: 3,
      color: '#ffffff'
    });
    satellites.push({
      angle: Math.PI,
      speed: -0.007,
      orbitRadius: 200,
      tiltX: -0.4,
      size: 2.5,
      color: 'accent'
    });
  }

  function initVis() {
    particles.length = 0;
    connections.length = 0;
    pulses.length = 0;
    satellites.length = 0;

    if (visMode === 'brain') {
      initBrainParticles();
    } else if (visMode === 'earth') {
      initEarthParticles();
    }
  }
  initVis();

  // Pulse logic (used primarily in Brain mode)
  function spawnPulse() {
    if (pulses.length > 25) return;
    if (connections.length === 0) return;
    const conn = connections[Math.floor(Math.random() * connections.length)];
    
    const fromNode = Math.random() > 0.5 ? conn.from : conn.to;
    const toNode = fromNode === conn.from ? conn.to : conn.from;

    pulses.push({
      from: fromNode,
      to: toNode,
      progress: 0,
      speed: Math.random() * 0.015 + 0.01,
      size: Math.random() * 2.2 + 1.2
    });
  }

  let frame = 0;
  let angleY = 0;

  function animate() {
    ctx.clearRect(0, 0, width, height);
    frame++;

    if (visMode === 'none') {
      requestAnimationFrame(animate);
      return;
    }

    if (visMode === 'brain') {
      // ─── Brain Render Mode ───
      if (frame % 8 === 0) {
        spawnPulse();
      }

      const breatheFactor = Math.sin(frame * 0.005) * 0.04 + 1.0;

      // Update positions
      particles.forEach(p => {
        p.dx += p.vx;
        p.dy += p.vy;

        const maxDrift = 14;
        const distFromAnchor = Math.sqrt(p.dx * p.dx + p.dy * p.dy);
        if (distFromAnchor > maxDrift) {
          p.vx -= (p.dx / distFromAnchor) * 0.008;
          p.vy -= (p.dy / distFromAnchor) * 0.008;
        }

        p.x = centerX + (p.baseX + p.dx) * breatheFactor;
        p.y = centerY + (p.baseY + p.dy) * breatheFactor;

        // Mouse attraction
        if (mouse.active) {
          const mx = mouse.x - p.x;
          const my = mouse.y - p.y;
          const mDist = Math.sqrt(mx * mx + my * my);
          const maxMouseRadius = 140;

          if (mDist < maxMouseRadius) {
            const pull = (maxMouseRadius - mDist) * 0.04;
            p.x += (mx / mDist) * pull;
            p.y += (my / mDist) * pull;
            p.currentBrightness = Math.min(1.2, p.brightness + (maxMouseRadius - mDist) / maxMouseRadius * 0.55);
          } else {
            p.currentBrightness = p.brightness;
          }
        } else {
          p.currentBrightness = p.brightness;
        }
      });

      // Draw lines
      ctx.lineWidth = 0.8;
      connections.forEach(conn => {
        const p1 = particles[conn.from];
        const p2 = particles[conn.to];

        const dx = p1.x - p2.x;
        const dy = p1.y - p2.y;
        const dist = Math.sqrt(dx * dx + dy * dy);

        if (dist < brainMaxDist * breatheFactor) {
          const opacity = (1 - dist / (brainMaxDist * breatheFactor)) * 0.22;
          ctx.strokeStyle = themeColor.replace(/[\d.]+\)$/, `${opacity})`);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      });

      // Update and draw pulses
      for (let i = pulses.length - 1; i >= 0; i--) {
        const pulse = pulses[i];
        const p1 = particles[pulse.from];
        const p2 = particles[pulse.to];

        pulse.progress += pulse.speed;
        if (pulse.progress >= 1) {
          if (Math.random() < 0.35) {
            const nextTargets = connections
              .filter(c => c.from === pulse.to || c.to === pulse.to)
              .map(c => c.from === pulse.to ? c.to : c.from)
              .filter(nodeId => nodeId !== pulse.from);

            if (nextTargets.length > 0) {
              const nextNode = nextTargets[Math.floor(Math.random() * nextTargets.length)];
              pulses.push({
                from: pulse.to,
                to: nextNode,
                progress: 0,
                speed: pulse.speed * (0.9 + Math.random() * 0.2),
                size: pulse.size
              });
            }
          }
          pulses.splice(i, 1);
          continue;
        }

        const px = p1.x + (p2.x - p1.x) * pulse.progress;
        const py = p1.y + (p2.y - p1.y) * pulse.progress;

        ctx.fillStyle = accentColorHex;
        ctx.shadowColor = accentColorHex;
        ctx.shadowBlur = 5;
        ctx.beginPath();
        ctx.arc(px, py, pulse.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      }

      // Draw nodes
      particles.forEach(p => {
        const dynamicBreathe = Math.sin(frame * 0.05 + p.pulseOffset) * 0.15 + 0.85;
        const nodeOpacity = p.currentBrightness * dynamicBreathe * 0.8;

        ctx.fillStyle = themeColor.replace(/[\d.]+\)$/, `${nodeOpacity})`);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();

        if (p.currentBrightness > 0.85) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 0.45, 0, Math.PI * 2);
          ctx.fill();
        }
      });

    } else if (visMode === 'earth') {
      // ─── Planet Earth Render Mode ───
      angleY += 0.0025;
      const tilt = 0.4;
      const cosY = Math.cos(angleY);
      const sinY = Math.sin(angleY);
      const cosTilt = Math.cos(tilt);
      const sinTilt = Math.sin(tilt);

      // Rotate and project nodes
      particles.forEach(p => {
        const x1 = p.x3d * cosY - p.z3d * sinY;
        const z1 = p.z3d * cosY + p.x3d * sinY;
        const y2 = p.y3d * cosTilt - z1 * sinTilt;
        const z2 = z1 * cosTilt + p.y3d * sinTilt;

        const depthScale = 270 / (270 + z2);
        p.x = centerX + x1 * depthScale;
        p.y = centerY + y2 * depthScale;
        p.zDepth = z2;

        p.currentBrightness = p.brightness;
        if (mouse.active) {
          const mx = mouse.x - p.x;
          const my = mouse.y - p.y;
          const mDist = Math.sqrt(mx * mx + my * my);
          if (mDist < 100) {
            p.currentBrightness = Math.min(1.4, p.brightness + (100 - mDist) / 100 * 0.45);
          }
        }
      });

      // Draw connections
      ctx.lineWidth = 0.65;
      connections.forEach(conn => {
        const p1 = particles[conn.from];
        const p2 = particles[conn.to];
        const avgZ = (p1.zDepth + p2.zDepth) / 2;
        const maxBehind = earthRadius * 0.7;

        if (avgZ < maxBehind) {
          let depthOpacityFactor = 1.0;
          if (avgZ > 0) {
            depthOpacityFactor = 1.0 - (avgZ / maxBehind);
          }
          const opacity = depthOpacityFactor * 0.18;
          ctx.strokeStyle = themeColor.replace(/[\d.]+\)$/, `${opacity})`);
          ctx.beginPath();
          ctx.moveTo(p1.x, p1.y);
          ctx.lineTo(p2.x, p2.y);
          ctx.stroke();
        }
      });

      // Draw nodes
      particles.forEach(p => {
        const maxBehind = earthRadius;
        let depthOpacityFactor = 1.0;
        if (p.zDepth > 0) {
          depthOpacityFactor = 1.0 - (p.zDepth / maxBehind) * 0.85;
        }
        const nodeOpacity = p.opacity * depthOpacityFactor * p.currentBrightness;

        ctx.fillStyle = themeColor.replace(/[\d.]+\)$/, `${nodeOpacity})`);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();

        if (p.isLand && p.zDepth < 0 && p.currentBrightness > 1.1) {
          ctx.fillStyle = '#ffffff';
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 0.45, 0, Math.PI * 2);
          ctx.fill();
        }
      });

      // Update and draw satellites
      satellites.forEach(sat => {
        sat.angle += sat.speed;
        const rawX = sat.orbitRadius * Math.cos(sat.angle);
        const rawY = sat.orbitRadius * Math.sin(sat.angle) * Math.sin(sat.tiltX);
        const rawZ = sat.orbitRadius * Math.sin(sat.angle) * Math.cos(sat.tiltX);

        const x1 = rawX * cosY - rawZ * sinY;
        const z1 = rawZ * cosY + rawX * sinY;
        const y2 = rawY * cosTilt - z1 * sinTilt;
        const z2 = z1 * cosTilt + rawY * sinTilt;

        const depthScale = 270 / (270 + z2);
        const sx = centerX + x1 * depthScale;
        const sy = centerY + y2 * depthScale;

        // Draw orbit wireframe
        ctx.lineWidth = 0.55;
        const pathPoints = 64;
        ctx.beginPath();
        for (let j = 0; j <= pathPoints; j++) {
          const theta = (j / pathPoints) * Math.PI * 2;
          const ox = sat.orbitRadius * Math.cos(theta);
          const oy = sat.orbitRadius * Math.sin(theta) * Math.sin(sat.tiltX);
          const oz = sat.orbitRadius * Math.sin(theta) * Math.cos(sat.tiltX);
          
          const rx = ox * cosY - oz * sinY;
          const rz = oz * cosY + ox * sinY;
          const ry = oy * cosTilt - rz * sinTilt;
          const rdepth = rz * cosTilt + oy * sinTilt;
          
          const ds = 270 / (270 + rdepth);
          const px = centerX + rx * ds;
          const py = centerY + ry * ds;
          
          const orbitOpacity = rdepth > 0 ? 0.03 : 0.08;
          ctx.strokeStyle = themeColor.replace(/[\d.]+\)$/, `${orbitOpacity})`);
          if (j === 0) ctx.moveTo(px, py);
          else ctx.lineTo(px, py);
        }
        ctx.stroke();

        // Draw satellite dot
        const satOpacity = z2 > 0 ? 0.25 : 0.95;
        ctx.fillStyle = sat.color === 'accent' ? accentColorHex : '#ffffff';
        ctx.shadowColor = ctx.fillStyle;
        ctx.shadowBlur = z2 > 0 ? 0 : 5;
        ctx.beginPath();
        ctx.arc(sx, sy, sat.size, 0, Math.PI * 2);
        ctx.fill();
        ctx.shadowBlur = 0;
      });
    }

    requestAnimationFrame(animate);
  }
  animate();
})();
