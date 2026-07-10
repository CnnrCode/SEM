/**
 * browser.js — Browser chrome controller for SecureExam Browser.
 * Handles tab management, webview events, navigation, and security overlays.
 */

'use strict';

let config = null;
let examPreloadPath = '';
let tabs = [];
let tabIdCounter = 0;
let activeTabId = null;
let contextMenuTabId = null;
let examTabIdToReturnTo = null;
let tabHoverTimeout = null;
let tabHoverHideTimeout = null;
let isHoverCardActive = false;
// (lastMouseHoverEvent removed — unused variable)

// ─── Lightweight debounce utility ────────────────────────────────────────────
function debounce(fn, delay) {
  let timer = null;
  return function (...args) {
    clearTimeout(timer);
    timer = setTimeout(() => fn.apply(this, args), delay);
  };
}
let closedTabsStack = [];
let draggedTabId = null;
let isCurrentTabExamActive = false;

// DOM Elements
const tabsContainer = document.getElementById('tabs-container');
const newTabBtn = document.getElementById('new-tab-btn');
const navBackBtn = document.getElementById('nav-back-btn');
const navForwardBtn = document.getElementById('nav-forward-btn');
const navRefreshBtn = document.getElementById('nav-refresh-btn');
const navHomeBtn = document.getElementById('nav-home-btn');
const addressInput = document.getElementById('address-input');
const loadingSpinner = document.getElementById('loading-spinner');
const suggestionsContainer = document.getElementById('address-suggestions');
let activeSuggestionIndex = -1;
let suggestionsList = [];
const chromeExitBtn = document.getElementById('close-browser-btn');
const exitModal = document.getElementById('exit-modal');
const exitSubmitBtn = document.getElementById('exit-submit-btn');
const exitCancelBtn = document.getElementById('exit-cancel-btn');
const exitModalDesc = document.getElementById('exit-modal-desc');

const closeAllModal = document.getElementById('close-all-modal');
const closeAllDesc = document.getElementById('close-all-desc');
const closeAllCancelBtn = document.getElementById('close-all-cancel-btn');
const closeAllSubmitBtn = document.getElementById('close-all-submit-btn');

const adminUnlockModal = document.getElementById('admin-unlock-modal');
const adminUnlockPasswordInput = document.getElementById('admin-unlock-password-input');
const adminUnlockErrorMsg = document.getElementById('admin-unlock-error-msg');
const adminUnlockSubmitBtn = document.getElementById('admin-unlock-submit-btn');
const adminUnlockCancelBtn = document.getElementById('admin-unlock-cancel-btn');

let aiBlockedToastTimer = null;
let aiBlockedToastHideTimer = null;

const webviewsContainer = document.getElementById('webview-views');
const tabContextMenu = document.getElementById('tab-context-menu');
const addressZoomBtn = document.getElementById('address-zoom-btn');
const addressZoomText = document.getElementById('address-zoom-text');
const zoomPopover = document.getElementById('zoom-popover');
const popoverZoomOut = document.getElementById('popover-zoom-out');
const popoverZoomIn = document.getElementById('popover-zoom-in');
const popoverZoomVal = document.getElementById('popover-zoom-val');
const popoverZoomReset = document.getElementById('popover-zoom-reset');

const hoverCard = document.getElementById('tab-hover-card');
const hoverCardTitle = document.getElementById('hover-card-title');
const hoverCardDomain = document.getElementById('hover-card-domain');
const hoverCardMemory = document.getElementById('hover-card-memory');
const tabMemoryCache = new Map();

// Notes Elements
const toolbarNotepadBtn = document.getElementById('toolbar-notepad-btn');
const notepadSidebar = document.getElementById('notepad-sidebar');
const notepadCloseBtn = document.getElementById('notepad-close-btn');
const notepadClearBtn = document.getElementById('notepad-clear-btn');
const notepadEditor = document.getElementById('notepad-editor');
const insertDrawBtn = document.getElementById('insert-draw-btn');

let isNotepadActive = false;

// Socratic AI Elements
const toolbarAiBtn = document.getElementById('toolbar-ai-btn');
const aiSidebar = document.getElementById('ai-sidebar');
const aiCloseBtn = document.getElementById('ai-close-btn');
const aiChatMessages = document.getElementById('ai-chat-messages');
const aiChatInput = document.getElementById('ai-chat-input');
const aiChatSendBtn = document.getElementById('ai-chat-send-btn');
let isAiActive = false;

document.addEventListener('DOMContentLoaded', async () => {
  // Load config & preload paths in parallel to optimize startup time
  const [loadedConfig, loadedPreload] = await Promise.all([
    window.sebBrowser.getConfig(),
    window.sebBrowser.getExamPreloadPath()
  ]);
  config = loadedConfig;
  examPreloadPath = loadedPreload;

  // Initialize theme switcher engine
  initThemes();

  // Initialize dyslexia font engine
  initDyslexiaFont();


  // Initialize secure downloads tab controller
  initDownloadsTab();

  // Initialize browsing history tab controller
  initHistoryTab();

  // Adjust tabs-bar padding for native title bar overlays (frameless window controls)
  const platform = navigator.platform.toLowerCase();
  const isWin = platform.includes('win');
  const isMac = platform.includes('mac');
  const tabsBar = document.getElementById('tabs-bar');
  if (tabsBar) {
    if (isWin) {
      tabsBar.style.paddingRight = '140px';
    } else if (isMac) {
      tabsBar.style.paddingLeft = '80px';
    }
  }

  // Open initial exam URL or blank page as startup
  const initialUrl = config.examUrl || 'about:blank';
  const examTab = createTab('about:blank', false, 'Exam');
  setTimeout(() => {
    if (examTab && examTab.webviewElement) {
      let targetUrl = initialUrl;
      if (isPdfUrl(targetUrl)) {
        const folderPath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
        targetUrl = `file://${folderPath}/pdfviewer.html?file=${encodeURIComponent(targetUrl)}&title=${encodeURIComponent('Exam PDF')}`;
      }
      examTab.webviewElement.setAttribute('src', targetUrl);
    }
  }, 100);

  // If there are preserved tabs in the config, show the Session Restore prompt toast
  // ONLY if they contain actual tabs to restore (not just the single default startup page)
  const preservedTabs = (config && config.openTabs && config.openTabs.length > 0) ? config.openTabs : [];
  const hasTabsToRestore = preservedTabs.some(t => {
    const isDefaultStartPage = t.url === config.examUrl || t.url === 'about:blank' || t.url === 'seb://newtab';
    return t.canClose || !isDefaultStartPage;
  });

  if (hasTabsToRestore) {
    setTimeout(() => {
      promptSessionRestore(preservedTabs);
    }, 1200); // Trigger toast after 1.2s to look extremely smooth
  }

  // Initialize Unified Notepad Sidebar & Event Handlers (with Multi-note support)
  let notesList = [];
  let currentNoteId = null;

  function saveNotepad() {
    saveCurrentNoteState();
  }

  function saveCurrentNoteState() {
    if (!notepadEditor || !currentNoteId) return;
    
    // Save canvases data
    notepadEditor.querySelectorAll('.embedded-sketch').forEach(sketchBlock => {
      const canvas = sketchBlock.querySelector('.block-canvas');
      if (canvas) {
        sketchBlock.setAttribute('data-canvas-data', canvas.toDataURL());
      }
    });
    
    // Find note and update its content
    const noteIndex = notesList.findIndex(n => n.id === currentNoteId);
    if (noteIndex !== -1) {
      notesList[noteIndex].content = notepadEditor.innerHTML;
      localStorage.setItem('seb-notes-list', JSON.stringify(notesList));
    }
  }

  function createSketchElement() {
    const blockId = 'sketch-' + Date.now() + '-' + Math.random().toString(36).substr(2, 5);
    const wrapper = document.createElement('div');
    wrapper.className = 'embedded-sketch';
    wrapper.dataset.id = blockId;
    wrapper.setAttribute('contenteditable', 'false');

    wrapper.innerHTML = `
      <div class="block-header">
        <div class="block-header-title">
          <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" style="margin-right: 4px;"><path d="m12 22 1-1c1.4-1.4 2.4-3.2 3-5.2L18 9l-3-3-7 2c-2 .6-3.8 1.6-5.2 3l-1 1M18 9l3-3M21 6a2.12 2.12 0 0 0-3-3l-3 3M8.5 15.5 12 19"></path></svg>
          <span>Sketch Drawing</span>
        </div>
        <div class="block-actions">
          <button class="block-action-icon-btn block-btn-clear" title="Clear Canvas">
            <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
          </button>
          <button class="block-action-icon-btn block-btn-delete" title="Delete Drawing">✕</button>
        </div>
      </div>
      <div class="block-draw-tools">
        <div class="block-color-picker">
          <span class="color-dot active" style="background-color: #ffffff;" data-color="#ffffff" title="White"></span>
          <span class="color-dot" style="background-color: #ef4444;" data-color="#ef4444" title="Red"></span>
          <span class="color-dot" style="background-color: #3b82f6;" data-color="#3b82f6" title="Blue"></span>
          <span class="color-dot" style="background-color: #10b981;" data-color="#10b981" title="Green"></span>
          <button class="block-eraser-btn" title="Eraser Mode">
            <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M20 20H7L3 16C2 15 2 13 3 12L13 2L22 11L18 15L20 20Z"></path><path d="M17 14L11 8"></path></svg>
            <span>Eraser</span>
          </button>
        </div>
        <select class="block-brush-select" title="Brush Size">
          <option value="2">Fine</option>
          <option value="5" selected>Medium</option>
          <option value="10">Thick</option>
        </select>
      </div>
      <canvas class="block-canvas" width="286" height="220"></canvas>
    `;
    return wrapper;
  }

  function initSketchBlock(wrapper) {
    const canvas = wrapper.querySelector('.block-canvas');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    let isDrawing = false;
    let drawColor = '#ffffff';
    let drawWidth = 5;
    let isEraser = false;

    // Load saved image state if any
    const canvasData = wrapper.getAttribute('data-canvas-data');
    if (canvasData) {
      const img = new Image();
      img.onload = () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0);
      };
      img.src = canvasData;
    } else {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    }

    // Paint logic
    function startDrawing(e) {
      isDrawing = true;
      ctx.beginPath();
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      ctx.moveTo(x, y);
      ctx.strokeStyle = isEraser ? '#111424' : drawColor;
      ctx.lineWidth = drawWidth;
    }

    function draw(e) {
      if (!isDrawing) return;
      const rect = canvas.getBoundingClientRect();
      const x = e.clientX - rect.left;
      const y = e.clientY - rect.top;
      ctx.lineTo(x, y);
      ctx.stroke();
    }

    function stopDrawing() {
      if (!isDrawing) return;
      isDrawing = false;
      saveNotepad();
    }

    canvas.addEventListener('mousedown', startDrawing);
    canvas.addEventListener('mousemove', draw);
    canvas.addEventListener('mouseup', stopDrawing);
    canvas.addEventListener('mouseleave', stopDrawing);

    // Touch Support
    canvas.addEventListener('touchstart', (e) => {
      e.preventDefault();
      isDrawing = true;
      ctx.beginPath();
      const rect = canvas.getBoundingClientRect();
      const touch = e.touches[0];
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      ctx.moveTo(x, y);
      ctx.strokeStyle = isEraser ? '#111424' : drawColor;
      ctx.lineWidth = drawWidth;
    });

    canvas.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (!isDrawing) return;
      const rect = canvas.getBoundingClientRect();
      const touch = e.touches[0];
      const x = touch.clientX - rect.left;
      const y = touch.clientY - rect.top;
      ctx.lineTo(x, y);
      ctx.stroke();
    });

    canvas.addEventListener('touchend', stopDrawing);

    // Color Pickers
    const dots = wrapper.querySelectorAll('.color-dot');
    dots.forEach(dot => {
      dot.addEventListener('click', () => {
        dots.forEach(d => d.classList.remove('active'));
        dot.classList.add('active');
        drawColor = dot.getAttribute('data-color');
        isEraser = false;
        if (eraserBtn) eraserBtn.classList.remove('active');
      });
    });

    // Eraser Button
    const eraserBtn = wrapper.querySelector('.block-eraser-btn');
    if (eraserBtn) {
      eraserBtn.addEventListener('click', () => {
        isEraser = !isEraser;
        if (isEraser) {
          eraserBtn.classList.add('active');
          dots.forEach(d => d.classList.remove('active'));
        } else {
          eraserBtn.classList.remove('active');
          const defaultDot = dots[0]; // white
          if (defaultDot) {
            defaultDot.classList.add('active');
            drawColor = defaultDot.getAttribute('data-color');
          }
        }
      });
    }

    // Brush Size
    const brushSelect = wrapper.querySelector('.block-brush-select');
    if (brushSelect) {
      brushSelect.addEventListener('change', (e) => {
        drawWidth = parseInt(e.target.value, 10);
      });
    }

    // Clear Canvas
    const clearBtn = wrapper.querySelector('.block-btn-clear');
    if (clearBtn) {
      clearBtn.addEventListener('click', () => {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        saveNotepad();
      });
    }

    // Delete section
    const deleteBtn = wrapper.querySelector('.block-btn-delete');
    if (deleteBtn) {
      deleteBtn.addEventListener('click', () => {
        const wrapperParent = wrapper.parentNode;
        if (wrapperParent && wrapperParent.classList.contains('embedded-sketch-wrapper')) {
          wrapperParent.remove();
        } else {
          wrapper.remove();
        }
        saveNotepad();
      });
    }
  }

  function insertDrawingAtCursor() {
    if (!notepadEditor) return;

    const sketchBlock = createSketchElement();
    notepadEditor.focus();
    
    const selection = window.getSelection();
    if (selection.rangeCount > 0) {
      const range = selection.getRangeAt(0);
      
      if (notepadEditor.contains(range.commonAncestorContainer)) {
        range.deleteContents();
        
        const blockWrapper = document.createElement('div');
        blockWrapper.className = 'embedded-sketch-wrapper';
        blockWrapper.appendChild(sketchBlock);
        
        range.insertNode(blockWrapper);
        
        const nextParagraph = document.createElement('div');
        nextParagraph.innerHTML = '<br>';
        blockWrapper.after(nextParagraph);
        
        const newRange = document.createRange();
        newRange.setStart(nextParagraph, 0);
        newRange.collapse(true);
        selection.removeAllRanges();
        selection.addRange(newRange);
      } else {
        const blockWrapper = document.createElement('div');
        blockWrapper.className = 'embedded-sketch-wrapper';
        blockWrapper.appendChild(sketchBlock);
        notepadEditor.appendChild(blockWrapper);
        
        const nextParagraph = document.createElement('div');
        nextParagraph.innerHTML = '<br>';
        notepadEditor.appendChild(nextParagraph);
      }
    } else {
      const blockWrapper = document.createElement('div');
      blockWrapper.className = 'embedded-sketch-wrapper';
      blockWrapper.appendChild(sketchBlock);
      notepadEditor.appendChild(blockWrapper);
      
      const nextParagraph = document.createElement('div');
      nextParagraph.innerHTML = '<br>';
      notepadEditor.appendChild(nextParagraph);
    }
    
    initSketchBlock(sketchBlock);
    saveNotepad();
  }

  function updateNoteSelect() {
    const select = document.getElementById('note-select');
    if (!select) return;
    select.innerHTML = '';
    notesList.forEach(n => {
      const opt = document.createElement('option');
      opt.value = n.id;
      opt.textContent = n.title;
      if (n.id === currentNoteId) opt.selected = true;
      select.appendChild(opt);
    });
  }

  function switchNote(newId) {
    saveCurrentNoteState();
    currentNoteId = newId;
    localStorage.setItem('seb-current-note-id', currentNoteId);
    
    const note = notesList.find(n => n.id === currentNoteId);
    if (note) {
      notepadEditor.innerHTML = note.content || '<div><br></div>';
      notepadEditor.querySelectorAll('.embedded-sketch').forEach(sketchBlock => {
        initSketchBlock(sketchBlock);
      });
    }
    updateNoteSelect();
  }

  function createNewNote() {
    const id = 'note-' + Date.now();
    const title = 'Note ' + (notesList.length + 1);
    const newNote = { id, title, content: '<div><br></div>' };
    notesList.push(newNote);
    switchNote(id);
  }

  function deleteCurrentNote() {
    if (notesList.length <= 1) {
      notepadEditor.innerHTML = '<div><br></div>';
      saveCurrentNoteState();
      return;
    }
    
    const index = notesList.findIndex(n => n.id === currentNoteId);
    if (index !== -1) {
      notesList.splice(index, 1);
      const nextActiveId = notesList[0].id;
      switchNote(nextActiveId);
    }
  }

  function renameCurrentNote(newTitle) {
    if (!newTitle.trim()) return;
    const noteIndex = notesList.findIndex(n => n.id === currentNoteId);
    if (noteIndex !== -1) {
      notesList[noteIndex].title = newTitle;
      localStorage.setItem('seb-notes-list', JSON.stringify(notesList));
      updateNoteSelect();
    }
  }

  function loadNotepad() {
    if (!notepadEditor) return;
    notepadEditor.innerHTML = '';

    // Migrate old single format notes
    let oldMigratedContent = null;
    const savedBlocks = localStorage.getItem('seb-notes-blocks');
    if (savedBlocks) {
      try {
        const blocks = JSON.parse(savedBlocks);
        let html = '';
        blocks.forEach(b => {
          if (b.type === 'text') {
            html += `<div>${b.content.replace(/\n/g, '<br>')}</div>`;
          } else if (b.type === 'sketch') {
            html += `
              <div class="embedded-sketch-wrapper">
                <div class="embedded-sketch" contenteditable="false" data-id="${b.id}" data-canvas-data="${b.content || ''}">
                  <div class="block-header">
                    <div class="block-header-title">
                      <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2.5" fill="none" style="margin-right: 4px;"><path d="m12 22 1-1c1.4-1.4 2.4-3.2 3-5.2L18 9l-3-3-7 2c-2 .6-3.8 1.6-5.2 3l-1 1M18 9l3-3M21 6a2.12 2.12 0 0 0-3-3l-3 3M8.5 15.5 12 19"></path></svg>
                      <span>Sketch Drawing</span>
                    </div>
                    <div class="block-actions">
                      <button class="block-action-icon-btn block-btn-clear" title="Clear Canvas">
                        <svg viewBox="0 0 24 24" width="12" height="12" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
                      </button>
                      <button class="block-action-icon-btn block-btn-delete" title="Delete Drawing">✕</button>
                    </div>
                  </div>
                  <div class="block-draw-tools">
                    <div class="block-color-picker">
                      <span class="color-dot active" style="background-color: #ffffff;" data-color="#ffffff" title="White"></span>
                      <span class="color-dot" style="background-color: #ef4444;" data-color="#ef4444" title="Red"></span>
                      <span class="color-dot" style="background-color: #3b82f6;" data-color="#3b82f6" title="Blue"></span>
                      <span class="color-dot" style="background-color: #10b981;" data-color="#10b981" title="Green"></span>
                      <button class="block-eraser-btn" title="Eraser Mode">
                        <svg viewBox="0 0 24 24" width="11" height="11" stroke="currentColor" stroke-width="2.5" fill="none" stroke-linecap="round" stroke-linejoin="round" style="margin-right: 4px;"><path d="M20 20H7L3 16C2 15 2 13 3 12L13 2L22 11L18 15L20 20Z"></path><path d="M17 14L11 8"></path></svg>
                        <span>Eraser</span>
                      </button>
                    </div>
                    <select class="block-brush-select" title="Brush Size">
                      <option value="2">Fine</option>
                      <option value="5" selected>Medium</option>
                      <option value="10">Thick</option>
                    </select>
                  </div>
                  <canvas class="block-canvas" width="286" height="220"></canvas>
                </div>
              </div>
            `;
          }
        });
        oldMigratedContent = html;
        localStorage.removeItem('seb-notes-blocks');
      } catch (e) {
        console.error(e);
      }
    }

    const savedHtml = localStorage.getItem('seb-notes-html');
    if (savedHtml) {
      oldMigratedContent = savedHtml;
      localStorage.removeItem('seb-notes-html');
    }

    const savedList = localStorage.getItem('seb-notes-list');
    if (savedList) {
      try {
        notesList = JSON.parse(savedList);
      } catch (e) {
        console.error(e);
      }
    }

    // Initialize list if empty
    if (notesList.length === 0) {
      notesList = [{
        id: 'note-default',
        title: 'Note 1',
        content: oldMigratedContent || '<div><br></div>'
      }];
      localStorage.setItem('seb-notes-list', JSON.stringify(notesList));
    }

    // Set current note ID
    currentNoteId = localStorage.getItem('seb-current-note-id');
    if (!currentNoteId || !notesList.find(n => n.id === currentNoteId)) {
      currentNoteId = notesList[0].id;
      localStorage.setItem('seb-current-note-id', currentNoteId);
    }

    const currentNote = notesList.find(n => n.id === currentNoteId);
    notepadEditor.innerHTML = currentNote.content || '<div><br></div>';
    notepadEditor.querySelectorAll('.embedded-sketch').forEach(sketchBlock => {
      initSketchBlock(sketchBlock);
    });
    
    updateNoteSelect();
  }

  // Load notepad on launch
  loadNotepad();

  // Save notepad when user types
  if (notepadEditor) {
    notepadEditor.addEventListener('input', () => {
      saveNotepad();
    });
  }

  // Hook insert drawing button
  if (insertDrawBtn) {
    insertDrawBtn.addEventListener('click', () => {
      insertDrawingAtCursor();
    });
  }

  // Note management subheader triggers
  const noteSelect = document.getElementById('note-select');
  const newNoteBtn = document.getElementById('new-note-btn');
  const renameNoteBtn = document.getElementById('rename-note-btn');
  const deleteNoteBtn = document.getElementById('delete-note-btn');

  // Rename Note Modal DOM elements
  const renameNoteModal = document.getElementById('rename-note-modal');
  const renameNoteInput = document.getElementById('rename-note-input');
  const renameNoteCancelBtn = document.getElementById('rename-note-cancel-btn');
  const renameNoteSubmitBtn = document.getElementById('rename-note-submit-btn');

  // Delete Note Modal DOM elements
  const deleteNoteModal = document.getElementById('delete-note-modal');
  const deleteNoteCancelBtn = document.getElementById('delete-note-cancel-btn');
  const deleteNoteSubmitBtn = document.getElementById('delete-note-submit-btn');

  if (noteSelect) {
    noteSelect.addEventListener('change', (e) => {
      switchNote(e.target.value);
    });
  }

  if (newNoteBtn) {
    newNoteBtn.addEventListener('click', () => {
      createNewNote();
    });
  }

  if (deleteNoteBtn && deleteNoteModal && deleteNoteCancelBtn && deleteNoteSubmitBtn) {
    deleteNoteBtn.addEventListener('click', () => {
      deleteNoteModal.classList.remove('hidden');
    });

    deleteNoteCancelBtn.addEventListener('click', () => {
      deleteNoteModal.classList.add('hidden');
    });

    deleteNoteSubmitBtn.addEventListener('click', () => {
      deleteNoteModal.classList.add('hidden');
      deleteCurrentNote();
    });

    deleteNoteModal.addEventListener('click', (e) => {
      if (e.target === deleteNoteModal) {
        deleteNoteModal.classList.add('hidden');
      }
    });
  }

  if (renameNoteBtn && renameNoteModal && renameNoteInput) {
    renameNoteBtn.addEventListener('click', () => {
      const note = notesList.find(n => n.id === currentNoteId);
      if (note) {
        renameNoteInput.value = note.title;
        renameNoteModal.classList.remove('hidden');
        renameNoteInput.focus();
      }
    });
  }

  if (renameNoteCancelBtn && renameNoteModal) {
    renameNoteCancelBtn.addEventListener('click', () => {
      renameNoteModal.classList.add('hidden');
    });
  }

  if (renameNoteSubmitBtn && renameNoteModal && renameNoteInput) {
    renameNoteSubmitBtn.addEventListener('click', () => {
      renameCurrentNote(renameNoteInput.value);
      renameNoteModal.classList.add('hidden');
    });

    renameNoteInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        renameCurrentNote(renameNoteInput.value);
        renameNoteModal.classList.add('hidden');
      }
    });
  }

  if (renameNoteModal) {
    renameNoteModal.addEventListener('click', (e) => {
      if (e.target === renameNoteModal) {
        renameNoteModal.classList.add('hidden');
      }
    });
  }

  // Reset/Clear All notes via custom modal
  const resetNotesModal = document.getElementById('reset-notes-modal');
  const resetNotesCancelBtn = document.getElementById('reset-notes-cancel-btn');
  const resetNotesSubmitBtn = document.getElementById('reset-notes-submit-btn');

  if (notepadClearBtn && resetNotesModal && resetNotesCancelBtn && resetNotesSubmitBtn) {
    notepadClearBtn.addEventListener('click', () => {
      resetNotesModal.classList.remove('hidden');
    });

    resetNotesCancelBtn.addEventListener('click', () => {
      resetNotesModal.classList.add('hidden');
    });

    resetNotesSubmitBtn.addEventListener('click', () => {
      resetNotesModal.classList.add('hidden');
      localStorage.removeItem('seb-notes-list');
      localStorage.removeItem('seb-current-note-id');
      notesList = [];
      currentNoteId = null;
      loadNotepad();
    });

    // Hide modal if user clicks outside content on overlay
    resetNotesModal.addEventListener('click', (e) => {
      if (e.target === resetNotesModal) {
        resetNotesModal.classList.add('hidden');
      }
    });
  }

  // Sidebars toggle mutual exclusion
  function toggleNotepad() {
    if (!notepadSidebar || !toolbarNotepadBtn) return;
    
    // Check if locked during active exam
    if (toolbarNotepadBtn.classList.contains('locked')) {
      showToast('Notes are locked during active exam sessions.', 'error');
      return;
    }

    isNotepadActive = !isNotepadActive;
    if (isNotepadActive) {
      // Close Socratic AI if open
      if (isAiActive) toggleAi();
      
      notepadSidebar.classList.add('open');
      toolbarNotepadBtn.classList.add('active');
    } else {
      notepadSidebar.classList.remove('open');
      toolbarNotepadBtn.classList.remove('active');
    }
  }

  function toggleAi() {
    if (!aiSidebar || !toolbarAiBtn) return;

    // Check if locked during active exam
    if (toolbarAiBtn.classList.contains('locked')) {
      showToast('Socratic AI is disabled during active exam sessions.', 'error');
      return;
    }

    isAiActive = !isAiActive;
    if (isAiActive) {
      // Close Notes if open
      if (isNotepadActive) toggleNotepad();

      aiSidebar.classList.add('open');
      toolbarAiBtn.classList.add('active');
      if (aiChatInput) aiChatInput.focus();
    } else {
      aiSidebar.classList.remove('open');
      toolbarAiBtn.classList.remove('active');
    }
  }

  if (toolbarNotepadBtn) toolbarNotepadBtn.addEventListener('click', toggleNotepad);
  if (notepadCloseBtn) notepadCloseBtn.addEventListener('click', toggleNotepad);
  if (toolbarAiBtn) toolbarAiBtn.addEventListener('click', toggleAi);
  if (aiCloseBtn) aiCloseBtn.addEventListener('click', toggleAi);

  // Resizable Sidebar feature
  const resizers = document.querySelectorAll('.sidebar-resizer');
  const workspaceWrapper = document.getElementById('workspace-wrapper');
  
  // Load saved sidebar width from localStorage
  const savedSidebarWidth = localStorage.getItem('seb-sidebar-width');
  if (savedSidebarWidth && workspaceWrapper) {
    workspaceWrapper.style.setProperty('--sidebar-width', savedSidebarWidth + 'px');
  }

  resizers.forEach(resizer => {
    function startResize(clientX, parentSidebar) {
      resizer.classList.add('dragging');
      document.body.classList.add('resizing-sidebar');
      
      const startX = clientX;
      const startWidth = parentSidebar.offsetWidth;
      
      function onMove(currentX) {
        const deltaX = startX - currentX;
        let newWidth = startWidth + deltaX;
        
        // Boundaries
        const minWidth = 260;
        const maxWidth = Math.floor(window.innerWidth * 0.7);
        if (newWidth < minWidth) newWidth = minWidth;
        if (newWidth > maxWidth) newWidth = maxWidth;
        
        if (workspaceWrapper) {
          workspaceWrapper.style.setProperty('--sidebar-width', newWidth + 'px');
        }
        localStorage.setItem('seb-sidebar-width', newWidth);
      }
      
      function onMouseMove(moveEvent) {
        onMove(moveEvent.clientX);
      }
      
      function onTouchMove(touchEvent) {
        if (touchEvent.touches.length > 0) {
          onMove(touchEvent.touches[0].clientX);
        }
      }
      
      function onEnd() {
        resizer.classList.remove('dragging');
        document.body.classList.remove('resizing-sidebar');
        window.removeEventListener('mousemove', onMouseMove);
        window.removeEventListener('mouseup', onEnd);
        window.removeEventListener('touchmove', onTouchMove);
        window.removeEventListener('touchend', onEnd);
      }
      
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onEnd);
      window.addEventListener('touchmove', onTouchMove, { passive: true });
      window.addEventListener('touchend', onEnd);
    }

    resizer.addEventListener('mousedown', (e) => {
      e.preventDefault();
      const parentSidebar = resizer.parentElement;
      if (parentSidebar) {
        startResize(e.clientX, parentSidebar);
      }
    });

    resizer.addEventListener('touchstart', (e) => {
      const parentSidebar = resizer.parentElement;
      if (parentSidebar && e.touches.length > 0) {
        startResize(e.touches[0].clientX, parentSidebar);
      }
    }, { passive: true });
  });

  // ─── Socratic AI Chat Interface (Placeholder Engine) ──────────────────────
  const socraticResponses = [
    "That is an interesting question! What do you think is the first logical step to break this down?",
    "If you look closely at the problem statement, which information is given and which is unknown?",
    "Let's reflect on the core concept. How does the equation change when we double this value?",
    "I am here to guide you. Before I answer, what was your initial hypothesis about this question?",
    "Good start. What formula or concept do you think applies directly to solving this type of problem?"
  ];
  let responseIndex = 0;

  function appendAiMessage(text, sender) {
    if (!aiChatMessages) return;
    const msg = document.createElement('div');
    msg.className = `ai-message ${sender}`;
    msg.textContent = text;
    aiChatMessages.appendChild(msg);
    aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
  }

  function handleAiSend() {
    if (!aiChatInput) return;
    const text = aiChatInput.value.trim();
    if (!text) return;

    // Append User Message
    appendAiMessage(text, 'user');
    aiChatInput.value = '';

    // Simulate Socratic Response Delay
    const typingIndicator = document.createElement('div');
    typingIndicator.className = 'ai-message bot typing';
    typingIndicator.textContent = '...';
    if (aiChatMessages) {
      aiChatMessages.appendChild(typingIndicator);
      aiChatMessages.scrollTop = aiChatMessages.scrollHeight;
    }

    setTimeout(() => {
      if (typingIndicator.parentNode) {
        typingIndicator.parentNode.removeChild(typingIndicator);
      }
      const response = socraticResponses[responseIndex % socraticResponses.length];
      responseIndex++;
      appendAiMessage(response, 'bot');
    }, 850);
  }

  if (aiChatSendBtn) aiChatSendBtn.addEventListener('click', handleAiSend);
  if (aiChatInput) {
    aiChatInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') handleAiSend();
    });
  }

  // AI Chat Suggestion Tags
  document.querySelectorAll('.ai-suggest-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const query = btn.getAttribute('data-query');
      if (aiChatInput) {
        aiChatInput.value = query;
        handleAiSend();
      }
    });
  });

  // Event Listeners
  newTabBtn.addEventListener('click', () => createTab('seb://newtab', true, 'New Tab'));
  navBackBtn.addEventListener('click', navigateBack);
  navForwardBtn.addEventListener('click', navigateForward);
  navRefreshBtn.addEventListener('click', navigateRefresh);
  navHomeBtn.addEventListener('click', navigateHome);

  // Listen for navigation requests from the newtab iframe search bar
  window.addEventListener('message', async (event) => {
    if (event.data && event.data.type === 'seb:newtab-navigate') {
      const url = event.data.url;
      const isBlocked = await window.sebBrowser.checkBlocked(url);
      if (isBlocked) {
        showBlockedToast(url);
        return;
      }
      navigateActiveTabTo(url);
    }
  });

  if (closeAllCancelBtn) {
    closeAllCancelBtn.addEventListener('click', hideCloseAllPrompt);
  }
  if (closeAllSubmitBtn) {
    closeAllSubmitBtn.addEventListener('click', () => {
      const closeAllDontAsk = document.getElementById('close-all-dont-ask');
      if (closeAllDontAsk && closeAllDontAsk.checked) {
        try { sessionStorage.setItem('skipCloseConfirmation', 'true'); } catch (e) {}
      }
      hideCloseAllPrompt();
      attemptExit();
    });
  }

  // Zoom Button & Popover Listeners
  if (addressZoomBtn) {
    addressZoomBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      toggleZoomPopover();
    });
  }

  if (popoverZoomOut) popoverZoomOut.addEventListener('click', (e) => { e.stopPropagation(); zoomActiveTab(-0.1); });
  if (popoverZoomIn) popoverZoomIn.addEventListener('click', (e) => { e.stopPropagation(); zoomActiveTab(0.1); });
  if (popoverZoomReset) popoverZoomReset.addEventListener('click', (e) => { e.stopPropagation(); resetZoomActiveTab(); });

  // Dismiss Zoom Popover on outside click
  document.addEventListener('click', (e) => {
    if (zoomPopover && !zoomPopover.classList.contains('hidden')) {
      if (!zoomPopover.contains(e.target) && e.target !== addressZoomBtn && !addressZoomBtn.contains(e.target)) {
        zoomPopover.classList.add('hidden');
      }
    }
  });

  // Context Menu Item Listeners
  const menuReload = document.getElementById('menu-reload');
  if (menuReload) {
    menuReload.addEventListener('click', () => {
      if (contextMenuTabId !== null) {
        const tab = tabs.find(t => t.id === contextMenuTabId);
        if (tab) tab.webviewElement.reload();
      }
    });
  }

  const menuClose = document.getElementById('menu-close');
  if (menuClose) {
    menuClose.addEventListener('click', () => {
      if (contextMenuTabId !== null) {
        closeTab(contextMenuTabId);
      }
    });
  }

  const menuCloseOthers = document.getElementById('menu-close-others');
  if (menuCloseOthers) {
    menuCloseOthers.addEventListener('click', () => {
      if (contextMenuTabId !== null) {
        const tabsToClose = tabs.filter(t => t.id !== contextMenuTabId && t.canClose).map(t => t.id);
        tabsToClose.forEach(id => closeTab(id));
      }
    });
  }

  // IPC Event listeners
  window.sebBrowser.onShowToast((data) => {
    if (data && data.message) {
      showToast(data.message, data.type);
    } else {
      showToast(data, 'info');
    }
  });

  window.sebBrowser.onZoom((key) => {
    if (key === '=' || key === '+') {
      zoomActiveTab(0.1);
    } else if (key === '-') {
      zoomActiveTab(-0.1);
    } else if (key === '0') {
      resetZoomActiveTab();
    }
  });

  // Shared helper function to process address bar search/navigation input
  async function triggerAddressBarNavigation(rawInput) {
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (activeTab && !activeTab.canClose) {
      return;
    }
    const cleanInput = rawInput.trim();
    if (!cleanInput) return;

    // Check if input is blocked
    const isBlocked = await window.sebBrowser.checkBlocked(cleanInput);
    if (isBlocked) {
      // Show block toast
      showBlockedToast(cleanInput);

      // Restore previous URL
      const activeTab = tabs.find(t => t.id === activeTabId);
      if (activeTab) {
        addressInput.value = activeTab.url || '';
      }
      addressInput.blur();
      if (suggestionsContainer) suggestionsContainer.classList.add('hidden');
      return;
    }

    let url = cleanInput;
    if (!/^https?:\/\//i.test(url)) {
      // If it looks like a domain, prepend https://. Else search on Google.
      if (url.includes('.') && !url.includes(' ')) {
        url = 'https://' + url;
      } else {
        url = 'https://www.google.com/search?q=' + encodeURIComponent(url);
      }
    }
    navigateActiveTabTo(url);
    addressInput.blur();
    if (suggestionsContainer) suggestionsContainer.classList.add('hidden');
  }

  // Update suggestions dropdown container HTML dynamically
  const updateSuggestions = async () => {
    if (!suggestionsContainer) return;
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (activeTab && !activeTab.canClose) {
      suggestionsContainer.classList.add('hidden');
      suggestionsContainer.innerHTML = '';
      activeSuggestionIndex = -1;
      suggestionsList = [];
      return;
    }
    const query = addressInput.value.trim();
    if (!query) {
      suggestionsContainer.classList.add('hidden');
      suggestionsContainer.innerHTML = '';
      activeSuggestionIndex = -1;
      suggestionsList = [];
      return;
    }

    try {
      const list = await window.sebBrowser.getSuggestions(query);
      suggestionsList = list || [];
      if (suggestionsList.length === 0) {
        suggestionsContainer.classList.add('hidden');
        suggestionsContainer.innerHTML = '';
        activeSuggestionIndex = -1;
        return;
      }

      // Render autocompletion list matching standard browser dropdown UI
      suggestionsContainer.innerHTML = suggestionsList.map((item, idx) => `
        <div class="suggestion-item" data-index="${idx}">
          <div class="suggestion-icon">
            <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
          </div>
          <div class="suggestion-text">${item}</div>
        </div>
      `).join('');
      suggestionsContainer.classList.remove('hidden');
      activeSuggestionIndex = -1;

      // Handle selection click events
      const items = suggestionsContainer.querySelectorAll('.suggestion-item');
      items.forEach(el => {
        el.addEventListener('click', async (e) => {
          e.stopPropagation();
          const idx = parseInt(el.getAttribute('data-index'), 10);
          const suggestion = suggestionsList[idx];
          addressInput.value = suggestion;
          suggestionsContainer.classList.add('hidden');
          activeSuggestionIndex = -1;
          triggerAddressBarNavigation(suggestion);
        });
      });
    } catch (err) {
      console.error('[Browser] suggestions error:', err);
    }
  };

  const highlightSuggestion = () => {
    if (!suggestionsContainer) return;
    const items = suggestionsContainer.querySelectorAll('.suggestion-item');
    items.forEach((item, idx) => {
      if (idx === activeSuggestionIndex) {
        item.classList.add('selected');
        addressInput.value = suggestionsList[idx];
      } else {
        item.classList.remove('selected');
      }
    });
  };

  // Prevent any input or paste when on the main exam tab
  addressInput.addEventListener('beforeinput', (e) => {
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (activeTab && !activeTab.canClose) {
      e.preventDefault();
    }
  });

  addressInput.addEventListener('paste', (e) => {
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (activeTab && !activeTab.canClose) {
      e.preventDefault();
    }
  });

  // Keyboard navigation & selection listener
  addressInput.addEventListener('keydown', async (e) => {
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (activeTab && !activeTab.canClose) {
      e.preventDefault();
      return;
    }
    if (suggestionsContainer && !suggestionsContainer.classList.contains('hidden') && suggestionsList.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        activeSuggestionIndex = (activeSuggestionIndex + 1) % suggestionsList.length;
        highlightSuggestion();
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        activeSuggestionIndex = (activeSuggestionIndex - 1 + suggestionsList.length) % suggestionsList.length;
        highlightSuggestion();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        suggestionsContainer.classList.add('hidden');
        activeSuggestionIndex = -1;
        return;
      }
    }

    if (e.key === 'Enter') {
      e.preventDefault();
      let query = addressInput.value.trim();
      if (activeSuggestionIndex >= 0 && activeSuggestionIndex < suggestionsList.length) {
        query = suggestionsList[activeSuggestionIndex];
      }
      triggerAddressBarNavigation(query);
    }
  });

  // Debounce suggestions: wait 250 ms after the user stops typing before making a network request
  const debouncedSuggestions = debounce(updateSuggestions, 250);
  addressInput.addEventListener('input', debouncedSuggestions);
  addressInput.addEventListener('focus', debouncedSuggestions);

  // Close suggestions popover when clicking anywhere outside
  document.addEventListener('click', (e) => {
    if (suggestionsContainer && !addressInput.contains(e.target) && !suggestionsContainer.contains(e.target)) {
      suggestionsContainer.classList.add('hidden');
      activeSuggestionIndex = -1;
    }
  });

  // Modal actions
  chromeExitBtn.addEventListener('click', showExitPrompt);
  exitCancelBtn.addEventListener('click', hideExitPrompt);
  exitSubmitBtn.addEventListener('click', async () => {
    const passwordInput = document.getElementById('exit-password-input');
    const hasPwd = await window.sebBrowser.hasExitPassword();
    let pwdVal = '';
    if (hasPwd && passwordInput) {
      pwdVal = passwordInput.value;
      if (!pwdVal) {
        const errorMsg = document.getElementById('exit-password-error-msg');
        if (errorMsg) {
          errorMsg.textContent = 'Please enter the exit password.';
          errorMsg.classList.remove('hidden');
        }
        return;
      }
    }
    const success = await attemptExit(pwdVal);
    if (success) {
      const exitDontAsk = document.getElementById('exit-dont-ask');
      if (exitDontAsk && exitDontAsk.checked) {
        try { sessionStorage.setItem('skipCloseConfirmation', 'true'); } catch (e) {}
      }
    }
  });

  const exitPasswordInput = document.getElementById('exit-password-input');
  if (exitPasswordInput) {
    exitPasswordInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') exitSubmitBtn.click();
    });
  }

  // Admin Unlock Modal actions
  adminUnlockCancelBtn.addEventListener('click', hideAdminUnlockPrompt);
  adminUnlockSubmitBtn.addEventListener('click', attemptAdminUnlock);
  adminUnlockPasswordInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') attemptAdminUnlock();
  });


  // Listen for admin prompt event from main process
  window.sebBrowser.onShowAdminPrompt(() => {
    showAdminUnlockPrompt();
  });


  // Handle Close Attempt from OS (Main Process IPC)
  window.sebBrowser.onShowExitDialog(() => {
    showExitPrompt();
  });

  // Handle Multi-Monitor Detection Event
  window.sebBrowser.onMultiMonitor((data) => {
    const blocker = document.getElementById('multi-monitor-blocker');
    if (!blocker) return;
    if (data.blocked) {
      blocker.classList.remove('hidden');
      blocker.style.display = 'flex';
    } else {
      blocker.classList.add('hidden');
      blocker.style.display = 'none';
    }
  });

  // Handle Tab Opening from setWindowOpenHandler
  window.sebBrowser.onOpenTab((url) => {
    createTab(url, true);
  });

  // Handle Blocked Toast notification
  window.sebBrowser.onShowBlockedToast((data) => {
    const url = typeof data === 'string' ? data : data.url;
    const type = typeof data === 'object' ? data.type : 'ai';
    showBlockedToast(url, type);
  });

  // Fullscreen & Exit Session button visibility handling (only show in fullscreen mode)
  const exitBtn = document.getElementById('close-browser-btn');
  const updateExitButtonVisibility = (isFS) => {
    const tabsBar = document.getElementById('tabs-bar');
    if (exitBtn) {
      if (isFS) {
        exitBtn.classList.remove('hidden');
        if (tabsBar) {
          tabsBar.style.paddingRight = '12px'; // Standard header padding only in fullscreen
        }
      } else {
        exitBtn.classList.add('hidden');
        if (tabsBar) {
          if (isWin) {
            tabsBar.style.paddingRight = '140px'; // Space for caption controls in windowed mode
          } else if (isMac) {
            tabsBar.style.paddingLeft = '80px';
          }
        }
      }
    }
  };

  // Init visibility state
  const initialFS = await window.sebBrowser.isFullScreen();
  updateExitButtonVisibility(initialFS);

  // Listen for dynamic changes
  window.sebBrowser.onFullscreenChanged((isFS) => {
    updateExitButtonVisibility(isFS);
  });

  // ─── Hamburger Dropdown Menu Event Handlers ────────────────────────────────
  const menuBtn = document.getElementById('chrome-menu-btn');
  const menuDropdown = document.getElementById('menu-dropdown');

  if (menuBtn && menuDropdown) {
    // Toggle Menu
    menuBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      menuDropdown.classList.toggle('hidden');
    });

    // Close Menu on clicking outside
    document.addEventListener('click', (e) => {
      if (!menuDropdown.contains(e.target) && e.target !== menuBtn) {
        menuDropdown.classList.add('hidden');
      }
    });

    // Menu Actions Setup
    
    // New Tab
    const mNewTab = document.getElementById('menu-item-new-tab');
    if (mNewTab) {
      mNewTab.addEventListener('click', () => {
        menuDropdown.classList.add('hidden');
        createTab('seb://newtab', true, 'New Tab');
      });
    }

    // Reload Tab
    const mReload = document.getElementById('menu-item-reload');
    if (mReload) {
      mReload.addEventListener('click', () => {
        menuDropdown.classList.add('hidden');
        navigateRefresh();
      });
    }

    // Downloads
    const mDownloads = document.getElementById('menu-item-downloads');
    if (mDownloads) {
      mDownloads.addEventListener('click', () => {
        menuDropdown.classList.add('hidden');
        openDownloadsTab();
      });
    }

    // Zoom Out
    const mZoomOut = document.getElementById('menu-zoom-out');
    if (mZoomOut) {
      mZoomOut.addEventListener('click', (e) => {
        e.stopPropagation();
        zoomActiveTab(-0.1);
      });
    }

    // Zoom In
    const mZoomIn = document.getElementById('menu-zoom-in');
    if (mZoomIn) {
      mZoomIn.addEventListener('click', (e) => {
        e.stopPropagation();
        zoomActiveTab(0.1);
      });
    }

    // Toggle Fullscreen
    const mFullscreen = document.getElementById('menu-zoom-fullscreen');
    if (mFullscreen) {
      mFullscreen.addEventListener('click', async (e) => {
        e.stopPropagation();
        menuDropdown.classList.add('hidden');
        await window.sebBrowser.toggleFullScreen();
      });
    }

    // Exit Session
    const mExit = document.getElementById('menu-item-exit');
    if (mExit) {
      mExit.addEventListener('click', () => {
        menuDropdown.classList.add('hidden');
        showExitPrompt();
      });
    }

    // History Menu Action
    const mHistory = document.getElementById('menu-item-history');
    if (mHistory) {
      mHistory.addEventListener('click', () => {
        menuDropdown.classList.add('hidden');
        openHistoryTab();
      });
    }

    // Magnifier Menu Action
    const mMagnifier = document.getElementById('menu-item-magnifier');
    if (mMagnifier) {
      mMagnifier.addEventListener('click', () => {
        menuDropdown.classList.add('hidden');
        toggleMagnifier();
      });
    }

    // Hide lens if mouse moves over the chrome toolbar area
    const header = document.getElementById('browser-header');
    if (header) {
      header.addEventListener('mousemove', () => {
        if (isMagnifierActive) {
          const lens = document.getElementById('magnifier-lens');
          if (lens) lens.style.display = 'none';
        }
      });
    }

    // Global Esc key handling for magnifier cancel and Ctrl+1..9 tab switches
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && isMagnifierActive) {
        toggleMagnifier();
      }

      // Ctrl + Tab (Next tab) / Ctrl + Shift + Tab (Prev tab)
      if (e.ctrlKey && e.key === 'Tab' && !e.altKey) {
        e.preventDefault();
        if (e.shiftKey) {
          switchPrevTab();
        } else {
          switchNextTab();
        }
        return;
      }

      if (e.ctrlKey && !e.altKey) {
        const key = e.key.toLowerCase();

        // Ctrl + E (Focus Search / Address Bar)
        if (key === 'e') {
          e.preventDefault();
          if (addressInput) {
            addressInput.focus();
            addressInput.select();
          }
          return;
        }

        // Ctrl + H (Open history)
        if (key === 'h') {
          e.preventDefault();
          openHistoryTab();
          return;
        }

        // Ctrl + J (Open downloads)
        if (key === 'j') {
          e.preventDefault();
          openDownloadsTab();
          return;
        }

        // Ctrl + Shift + T (Reopen last closed tab)
        if (e.shiftKey && key === 't') {
          e.preventDefault();
          reopenLastClosedTab();
          return;
        }

        // Ctrl + T (New Tab)
        if (!e.shiftKey && key === 't') {
          e.preventDefault();
          createTab('seb://newtab', true, 'New Tab');
          return;
        }

        // Ctrl + Shift + W (Close all tabs)
        if (e.shiftKey && key === 'w') {
          e.preventDefault();
          showCloseAllPrompt();
          return;
        }

        // Ctrl + W (Close active tab)
        if (!e.shiftKey && key === 'w') {
          e.preventDefault();
          if (activeTabId !== null) {
            closeTab(activeTabId);
          }
          return;
        }

        // Ctrl + 1..9 (Switch tabs)
        if (!e.shiftKey) {
          const match = e.code.match(/^Digit([1-9])$/);
          if (match) {
            e.preventDefault();
            const digit = parseInt(match[1], 10);
            handleTabSwitchShortcut(digit);
          }
        }
      }
    });

    // Listen for keys intercepted at the main process / webview level
    if (window.sebBrowser) {
      window.sebBrowser.onTabSwitchShortcut((digit) => {
        handleTabSwitchShortcut(digit);
      });
      window.sebBrowser.onTabCloseShortcut(() => {
        if (activeTabId !== null) {
          closeTab(activeTabId);
        }
      });
      window.sebBrowser.onTabReopenShortcut(() => {
        reopenLastClosedTab();
      });
      window.sebBrowser.onTabNewShortcut(() => {
        createTab('seb://newtab', true, 'New Tab');
      });
      window.sebBrowser.onTabCloseAllShortcut(() => {
        showCloseAllPrompt();
      });
      // Open new tab with URL (e.g. target=_blank links, PDF downloads from external pages)
      window.sebBrowser.onOpenTab((url) => {
        if (url && url.startsWith('http')) {
          createTab(url, true, 'Loading...');
        }
      });
      window.sebBrowser.onFocusSearchShortcut(() => {
        if (addressInput) {
          addressInput.focus();
          addressInput.select();
        }
      });
      window.sebBrowser.onHistoryShortcut(() => {
        openHistoryTab();
      });
      window.sebBrowser.onDownloadsShortcut(() => {
        openDownloadsTab();
      });
      window.sebBrowser.onMagnifierShortcut(() => {
        toggleMagnifier();
      });
      window.sebBrowser.onReloadShortcut((opts) => {
        const ignoreCache = opts && opts.ignoreCache;
        navigateRefresh(ignoreCache);
      });
      window.sebBrowser.onTabNextShortcut(() => {
        switchNextTab();
      });
      window.sebBrowser.onTabPrevShortcut(() => {
        switchPrevTab();
      });
    }
  }

  // Break focus traps when the window loses focus
  window.addEventListener('blur', () => {
    try {
      if (document.activeElement && document.activeElement !== document.body) {
        document.activeElement.blur();
      }
    } catch (e) {}
  });

  // Alert student on network connectivity status changes (user friendliness)
  window.addEventListener('online', () => {
    showToast('Network connection restored. You are back online.', 'success');
  });

  window.addEventListener('offline', () => {
    showToast('Network connection lost. Please check your internet connectivity.', 'error');
  });
});

// ─── Tab Management ─────────────────────────────────────────────────────────

const DEFAULT_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="2" y1="12" x2="22" y2="12"></line><path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z"></path></svg>`;
const DEFAULT_FAVICON = `data:image/svg+xml;base64,${btoa(DEFAULT_FAVICON_SVG)}`;

const DOWNLOADS_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`;
const DOWNLOADS_FAVICON = `data:image/svg+xml;base64,${btoa(DOWNLOADS_FAVICON_SVG)}`;

const HISTORY_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#94a3b8" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>`;
const HISTORY_FAVICON = `data:image/svg+xml;base64,${btoa(HISTORY_FAVICON_SVG)}`;

const PDF_FAVICON_SVG = `<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>`;
const PDF_FAVICON = `data:image/svg+xml;base64,${btoa(PDF_FAVICON_SVG)}`;

function createWebviewElement(id, resolvedUrl) {
  const webview = document.createElement('webview');
  webview.id = `webview-${id}`;
  
  if (examPreloadPath) {
    webview.setAttribute('preload', examPreloadPath);
  }
  
  webview.setAttribute('nodeintegration', 'false');
  webview.setAttribute('contextisolation', 'true');
  webview.setAttribute('plugins', 'true');
  webview.setAttribute('src', resolvedUrl);
  webview.className = 'hidden';
  
  webviewsContainer.appendChild(webview);
  return webview;
}

function createTab(url, canClose = true, customTitle = 'Loading...') {
  if (isExamSessionActive()) {
    showToast("You cannot open new tabs while taking an active exam.", "error");
    return {
      id: -1,
      url: 'seb://newtab',
      title: 'New Tab',
      webviewElement: document.createElement('div'),
      tabElement: document.createElement('div'),
      canClose: true,
      zoomFactor: 1.0
    };
  }
  const id = tabIdCounter++;

  // Intercept PDF URLs to load through our custom PDF viewer
  let resolvedUrl = url;
  if (isPdfUrl(url)) {
    const folderPath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
    resolvedUrl = `file://${folderPath}/pdfviewer.html?file=${encodeURIComponent(url)}&title=${encodeURIComponent(customTitle)}`;
  }

  // Determine initial favicon
  let initialFavicon = DEFAULT_FAVICON;
  if (url === 'seb://newtab') {
    initialFavicon = 'prodigy_nbg.png';
  } else if (url === 'seb://downloads') {
    initialFavicon = DOWNLOADS_FAVICON;
  } else if (url === 'seb://history') {
    initialFavicon = HISTORY_FAVICON;
  } else if (isPdfUrl(url)) {
    initialFavicon = PDF_FAVICON;
  } else if (url.startsWith('http://') || url.startsWith('https://')) {
    try {
      const domain = new URL(url).hostname;
      initialFavicon = `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;
    } catch (e) {}
  }

  // Create UI Tab Element
  const tabEl = document.createElement('div');
  tabEl.className = 'tab';
  tabEl.id = `tab-control-${id}`;
  tabEl.innerHTML = `
    <img class="tab-favicon" id="tab-favicon-${id}" src="${initialFavicon}">
    <span class="tab-title" id="tab-title-${id}">${customTitle}</span>
    ${canClose ? `<span class="tab-close" id="tab-close-${id}">✕</span>` : ''}
  `;

  // Attach error handler to fallback to DEFAULT_FAVICON
  const faviconImg = tabEl.querySelector('.tab-favicon');
  if (faviconImg) {
    faviconImg.addEventListener('error', () => {
      faviconImg.src = DEFAULT_FAVICON;
    });
  }

  let webview;
  if (url === 'seb://newtab') {
    // Create new tab panel element dynamically to support multiple independent instances
    webview = document.createElement('div');
    webview.className = 'local-tab-view hidden';
    
    const iframe = document.createElement('iframe');
    iframe.src = 'newtab.html';
    iframe.style.width = '100%';
    iframe.style.height = '100%';
    iframe.style.border = 'none';
    iframe.style.background = 'transparent';
    iframe.sandbox = 'allow-scripts allow-same-origin allow-forms allow-popups';
    iframe.title = 'New Tab';

    // Sync theme into iframe when it loads
    iframe.addEventListener('load', () => {
      try {
        if (iframe.contentDocument && iframe.contentDocument.body) {
          const currentTheme = localStorage.getItem('prodigy-theme') || 'dark';
          iframe.contentDocument.body.className = currentTheme !== 'dark' ? `theme-${currentTheme}` : '';
        }
      } catch (e) {}
    });

    webview.appendChild(iframe);
    webviewsContainer.appendChild(webview);
  } else if (url === 'seb://downloads') {
    webview = document.getElementById('downloads-view');
    webviewsContainer.appendChild(webview);
  } else if (url === 'seb://history') {
    webview = document.getElementById('history-view');
    webviewsContainer.appendChild(webview);
  } else {
    webview = createWebviewElement(id, resolvedUrl);
  }

  tabsContainer.appendChild(tabEl);

  const tabObj = {
    id,
    url,
    title: customTitle,
    webviewElement: webview,
    tabElement: tabEl,
    canClose,
    zoomFactor: 1.0
  };

  tabs.push(tabObj);

  // Tab Events
  tabEl.addEventListener('mouseenter', () => {
    clearTimeout(tabHoverHideTimeout);
    clearTimeout(tabHoverTimeout);
    
    if (isHoverCardActive) {
      // 0 cooldown tab transition if hover card is already open
      showTabHoverCard(tabObj);
    } else {
      // 2.5 seconds cooldown initial trigger
      tabHoverTimeout = setTimeout(() => {
        isHoverCardActive = true;
        showTabHoverCard(tabObj);
      }, 2500);
    }
  });

  tabEl.addEventListener('mouseleave', () => {
    clearTimeout(tabHoverTimeout);
    // Short grace period before hiding (allows instant hover card transition to neighbor tabs)
    tabHoverHideTimeout = setTimeout(() => {
      isHoverCardActive = false;
      hideTabHoverCard();
    }, 150);
  });

  tabEl.addEventListener('click', (e) => {
    if (e.target.classList.contains('tab-close')) return;
    clearTimeout(tabHoverTimeout);
    clearTimeout(tabHoverHideTimeout);
    isHoverCardActive = false;
    hideTabHoverCard();
    switchTab(id);
  });

  // Enable HTML5 Drag and Drop for Tab Reordering
  tabEl.setAttribute('draggable', 'true');

  tabEl.addEventListener('dragstart', (e) => {
    if (isExamSessionActive()) {
      e.preventDefault();
      showToast("You cannot reorder tabs while taking an active exam.", "error");
      return;
    }
    draggedTabId = id;
    tabEl.classList.add('dragging');
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id.toString());

    // Hide default HTML5 floaty ghost image so the tab only slides inline within the tab bar
    const img = new Image();
    img.src = 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7';
    e.dataTransfer.setDragImage(img, 0, 0);
  });

  tabEl.addEventListener('dragend', () => {
    tabEl.classList.remove('dragging');
    draggedTabId = null;
    reorderInternalTabsFromDOM();
  });

  tabEl.addEventListener('dragover', (e) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    
    if (draggedTabId === null || draggedTabId === id) return;
    
    // Constrain drag to within the tabs-container bounds only
    const containerRect = tabsContainer.getBoundingClientRect();
    if (e.clientX < containerRect.left || e.clientX > containerRect.right ||
        e.clientY < containerRect.top || e.clientY > containerRect.bottom) {
      return; // Cursor outside container — do not rearrange
    }
    
    const draggingEl = document.getElementById(`tab-control-${draggedTabId}`);
    if (!draggingEl) return;
    
    const rect = tabEl.getBoundingClientRect();
    const relX = e.clientX - rect.left;
    const isAfter = relX > (rect.width / 2);
    
    if (isAfter) {
      if (tabEl.nextSibling) {
        tabsContainer.insertBefore(draggingEl, tabEl.nextSibling);
      } else {
        tabsContainer.appendChild(draggingEl);
      }
    } else {
      tabsContainer.insertBefore(draggingEl, tabEl);
    }
  });

  tabEl.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    showTabContextMenu(id, e.clientX, e.clientY);
  });

  if (canClose) {
    tabEl.querySelector('.tab-close').addEventListener('click', (e) => {
      e.stopPropagation();
      clearTimeout(tabHoverTimeout);
      clearTimeout(tabHoverHideTimeout);
      isHoverCardActive = false;
      hideTabHoverCard();
      closeTab(id);
    });
  }

  // Webview Event Listeners
  if (url !== 'seb://downloads' && url !== 'seb://newtab') {
    setupWebviewEvents(tabObj);
  }

  // Switch to new tab
  switchTab(id);
  saveTabState();
  return tabObj;
}

function reorderInternalTabsFromDOM() {
  const tabElements = Array.from(tabsContainer.querySelectorAll('.tab'));
  const newTabsOrder = [];
  
  tabElements.forEach(el => {
    const tabIdStr = el.id.replace('tab-control-', '');
    const tabId = parseInt(tabIdStr, 10);
    const tabObj = tabs.find(t => t.id === tabId);
    if (tabObj) {
      newTabsOrder.push(tabObj);
    }
  });
  
  tabs = newTabsOrder;
  saveTabState();
}

function switchTab(id) {
  if (activeTabId !== null && activeTabId !== id && isExamSessionActive()) {
    showToast("You cannot switch tabs while taking an active exam.", "error");
    return;
  }
  if (isMagnifierActive) {
    toggleMagnifier();
  }
  const previousTab = tabs.find(t => t.id === activeTabId);
  const currentTab = tabs.find(t => t.id === id);

  if (!currentTab) return;

  if (previousTab) {
    previousTab.tabElement.classList.remove('active');
    if (previousTab.webviewElement) {
      previousTab.webviewElement.classList.add('hidden');
    }
    // Start hibernation timer for backgrounded tab
    startTabHibernationTimer(previousTab);
  }

  // Clear hibernation timer for active tab
  clearTabHibernationTimer(currentTab);

  // If active tab was hibernated, restore it
  if (currentTab.isHibernated) {
    restoreTab(currentTab);
  }

  currentTab.tabElement.classList.add('active');
  if (currentTab.webviewElement) {
    currentTab.webviewElement.classList.remove('hidden');
  }
  activeTabId = id;

  updateNavigationUI(currentTab);
  updateZoomUI(currentTab);
  
  if (currentTab.url === 'seb://history') {
    renderHistoryPage();
  } else if (currentTab.url === 'seb://downloads') {
    if (window.sebBrowser && window.sebBrowser.getDownloadsList) {
      window.sebBrowser.getDownloadsList().then((list) => {
        localDownloads = list || [];
        renderDownloadsList();
      }).catch(() => {});
    }
  }
  
  // Try to focus the current webview
  try {
    if (currentTab.webviewElement) {
      currentTab.webviewElement.focus();
    }
  } catch (err) {}
  saveTabState();
  updateActiveExamStatus();
}

function handleTabSwitchShortcut(digit) {
  if (digit === 9) {
    if (tabs.length > 0) {
      switchTab(tabs[tabs.length - 1].id);
    }
  } else {
    const index = digit - 1;
    if (index < tabs.length) {
      switchTab(tabs[index].id);
    }
  }
}

function switchNextTab() {
  if (tabs.length === 0) return;
  const currentIndex = tabs.findIndex(t => t.id === activeTabId);
  const nextIndex = (currentIndex + 1) % tabs.length;
  switchTab(tabs[nextIndex].id);
}

function switchPrevTab() {
  if (tabs.length === 0) return;
  const currentIndex = tabs.findIndex(t => t.id === activeTabId);
  const prevIndex = (currentIndex - 1 + tabs.length) % tabs.length;
  switchTab(tabs[prevIndex].id);
}

function reopenLastClosedTab() {
  if (closedTabsStack.length === 0) return;
  const lastTab = closedTabsStack.pop();
  createTab(lastTab.url, true, lastTab.title);
}

function closeTab(id) {
  if (isExamSessionActive()) {
    showToast("You cannot close tabs while taking an active exam.", "error");
    return;
  }
  clearTimeout(tabHoverTimeout);
  clearTimeout(tabHoverHideTimeout);
  isHoverCardActive = false;
  hideTabHoverCard();

  const tabIndex = tabs.findIndex(t => t.id === id);
  if (tabIndex === -1) return;

  const tab = tabs[tabIndex];
  if (!tab.canClose) {
    // Can't close primary exam tab!
    return;
  }

  // Clear hibernation timer on close
  clearTabHibernationTimer(tab);

  // Push tab to closedTabsStack so it can be restored with Ctrl+Shift+T
  if (tab.url !== 'seb://downloads' && tab.url !== 'seb://newtab') {
    closedTabsStack.push({ url: tab.url, title: tab.title });
  }

  // Remove elements from DOM
  tab.tabElement.remove();
  if (tab.url === 'seb://downloads') {
    if (tab.webviewElement) {
      tab.webviewElement.classList.add('hidden');
      document.body.appendChild(tab.webviewElement);
    }
  } else {
    if (tab.webviewElement) {
      tab.webviewElement.remove();
    }
  }

  tabs.splice(tabIndex, 1);
  saveTabState();

  // If closed the active tab, switch to another
  if (activeTabId === id) {
    const nextActiveIndex = Math.min(tabIndex, tabs.length - 1);
    if (nextActiveIndex >= 0) {
      switchTab(tabs[nextActiveIndex].id);
    } else {
      activeTabId = null;
    }
  }
}

function setupWebviewEvents(tab) {
  const { id, webviewElement } = tab;

  // Track Loading State
  webviewElement.addEventListener('did-start-loading', () => {
    tab.isLoading = true;
    if (activeTabId === id) {
      loadingSpinner.classList.remove('hidden');
      updateRefreshStopButtonState();
    }
  });

  webviewElement.addEventListener('did-stop-loading', () => {
    tab.isLoading = false;
    if (activeTabId === id) {
      loadingSpinner.classList.add('hidden');
      updateNavigationUI(tab);
      updateActiveExamStatus();
    }
  });

  // Track URL & Title
  const updateTabUrl = (newUrl) => {
    if (newUrl && newUrl.startsWith('data:text/html') && tab.failedUrl) {
      tab.url = tab.failedUrl;
      if (activeTabId === id) {
        addressInput.value = tab.failedUrl;
        updateNavigationUI(tab);
      }
      return;
    }

    // Intercept pdfviewer paths to display the original PDF URL in the address bar
    let displayUrl = newUrl;
    if (newUrl && newUrl.includes('pdfviewer.html')) {
      try {
        const params = new URLSearchParams(newUrl.substring(newUrl.indexOf('?')));
        displayUrl = params.get('file') || newUrl;
      } catch (e) {}
    }

    tab.url = displayUrl;

    // Update favicon based on URL
    if (displayUrl.startsWith('http://') || displayUrl.startsWith('https://')) {
      try {
        const domain = new URL(displayUrl).hostname;
        const faviconEl = document.getElementById(`tab-favicon-${id}`);
        if (faviconEl) {
          faviconEl.src = `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;
        }
      } catch (e) {}
    } else if (displayUrl === 'seb://newtab') {
      const faviconEl = document.getElementById(`tab-favicon-${id}`);
      if (faviconEl) faviconEl.src = 'prodigy_nbg.png';
    } else if (displayUrl === 'seb://downloads') {
      const faviconEl = document.getElementById(`tab-favicon-${id}`);
      if (faviconEl) faviconEl.src = DOWNLOADS_FAVICON;
    } else if (displayUrl === 'seb://history') {
      const faviconEl = document.getElementById(`tab-favicon-${id}`);
      if (faviconEl) faviconEl.src = HISTORY_FAVICON;
    } else if (newUrl.includes('pdfviewer.html') || isPdfUrl(displayUrl)) {
      const faviconEl = document.getElementById(`tab-favicon-${id}`);
      if (faviconEl) faviconEl.src = PDF_FAVICON;
    }

    if (activeTabId === id) {
      addressInput.value = displayUrl;
      updateNavigationUI(tab);
    }
    saveTabState();
  };

  webviewElement.addEventListener('did-navigate', (e) => {
    updateTabUrl(e.url);
    if (window.sebBrowser && window.sebBrowser.addHistory) {
      window.sebBrowser.addHistory(tab.title || e.url, e.url);
    }
    if (activeTabId === id) {
      updateActiveExamStatus();
    }
  });

  webviewElement.addEventListener('did-navigate-in-page', (e) => {
    updateTabUrl(e.url);
    if (window.sebBrowser && window.sebBrowser.addHistory) {
      window.sebBrowser.addHistory(tab.title || e.url, e.url);
    }
    if (activeTabId === id) {
      updateActiveExamStatus();
    }
  });

  webviewElement.addEventListener('page-title-updated', (e) => {
    tab.title = e.title;
    const titleEl = document.getElementById(`tab-title-${id}`);
    if (titleEl) {
      titleEl.textContent = e.title || 'Untitled';
    }
    saveTabState();
    if (window.sebBrowser && window.sebBrowser.addHistory) {
      window.sebBrowser.addHistory(e.title, tab.url);
    }
  });

  webviewElement.addEventListener('page-favicon-updated', (e) => {
    if (e.favicons && e.favicons.length > 0) {
      const faviconEl = document.getElementById(`tab-favicon-${id}`);
      if (faviconEl) {
        faviconEl.src = e.favicons[0];
      }
    }
  });

  // Handle popups inside webview (target="_blank")
  webviewElement.addEventListener('new-window', (e) => {
    e.preventDefault();
    createTab(e.url, true);
  });

  // Handle window.close() inside webview
  webviewElement.addEventListener('close', () => {
    closeTab(id);
  });

  // Handle webview process crash gracefully (stability)
  webviewElement.addEventListener('render-process-gone', (e) => {
    console.error(`[Browser] Tab ${id} process gone. Details:`, e);
    showToast('The page process terminated unexpectedly. Reloading page...', 'error');
    setTimeout(() => {
      try {
        webviewElement.reload();
      } catch (err) {
        console.error('[Browser] Failed to reload crashed webview:', err);
      }
    }, 1000);
  });
  // Handle webview load failures (user friendliness)
  webviewElement.addEventListener('did-fail-load', (e) => {
    // Only handle main frame failures, and ignore common non-error codes (like -3 which is request cancellation/aborted)
    const { errorCode, errorDescription, isMainFrame } = e;
    if (isMainFrame && errorCode !== -3) {
      console.warn(`[Browser] Tab ${id} failed to load: ${errorDescription} (${errorCode})`);
      const failedUrl = e.validatedURL || tab.url || webviewElement.getURL();
      tab.failedUrl = failedUrl;
      const offlineHtml = getOfflineHtml(failedUrl, errorDescription);
      webviewElement.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(offlineHtml));
    }
  });
  // Re-apply zoom on dom-ready (since Chromium resets zoom on navigation)
  webviewElement.addEventListener('dom-ready', () => {
    try {
      if (typeof webviewElement.setZoomFactor === 'function') {
        webviewElement.setZoomFactor(tab.zoomFactor);
      }
    } catch (err) {
      console.error('[Browser] Failed to setZoomFactor on dom-ready:', err);
    }
    try {
      webviewElement.send('guest:set-zoom', tab.zoomFactor);
    } catch (err) {
      console.error('[Browser] Failed to send guest:set-zoom on dom-ready:', err);
    }

    // Re-apply dyslexia font if active
    try {
      const isDyslexia = localStorage.getItem('dyslexia-font') === 'true';
      webviewElement.executeJavaScript(getDyslexiaFontScript(isDyslexia));
    } catch (err) {
      console.error('[Browser] Failed to inject dyslexia font on dom-ready:', err);
    }

    if (activeTabId === id) {
      updateActiveExamStatus();
    }
  });

  // Listen for local zoom and magnifier changes from the guest page
  webviewElement.addEventListener('ipc-message', (e) => {
    if (e.channel === 'webview-zoom-changed') {
      const { zoomFactor } = e.args[0];
      tab.zoomFactor = zoomFactor;
      updateZoomUI(tab);
    } else if (e.channel === 'guest-magnifier-move') {
      const { x, y, scrollX, scrollY } = e.args[0];
      
      const zoom = tab.zoomFactor || 1.0;
      const zoomedX = x * zoom;
      const zoomedY = y * zoom;
      const zoomedScrollX = scrollX * zoom;
      const zoomedScrollY = scrollY * zoom;

      lastMouseX = zoomedX;
      lastMouseY = zoomedY;
      currentScrollX = zoomedScrollX;
      currentScrollY = zoomedScrollY;
      
      const lens = document.getElementById('magnifier-lens');
      const badge = document.getElementById('magnifier-lens-badge');
      if (lens && isMagnifierActive) {
        const rect = webviewElement.getBoundingClientRect();
        const hostX = rect.left + zoomedX;
        const hostY = rect.top + zoomedY;
        
        // Position lens centered on mouse cursor
        const lensWidth = 260;
        const lensHeight = 160;
        
        lens.style.display = 'block';
        lens.style.left = `${hostX - lensWidth / 2}px`;
        lens.style.top = `${hostY - lensHeight / 2}px`;
        
        // Calculate scroll delta from snapshot time
        const deltaX = zoomedScrollX - scrollXAtCapture;
        const deltaY = zoomedScrollY - scrollYAtCapture;
        
        // Offset the crop coordinate by the scroll delta
        const cropX = zoomedX + deltaX;
        const cropY = zoomedY + deltaY;
        
        // Calculate background crop zoom positioning
        const bgX = -cropX * magnifierScale + lensWidth / 2;
        const bgY = -cropY * magnifierScale + lensHeight / 2;
        
        lens.style.backgroundPosition = `${bgX}px ${bgY}px`;
        lens.style.backgroundSize = `${rect.width * magnifierScale}px ${rect.height * magnifierScale}px`;
        
        if (badge) badge.textContent = `${magnifierScale.toFixed(1)}x`;
      }
    } else if (e.channel === 'guest-magnifier-scroll-ended') {
      refreshMagnifierSnapshot();
    } else if (e.channel === 'guest-magnifier-zoom') {
      const action = e.args[0];
      if (action === 'in') {
        magnifierScale = Math.min(4.0, magnifierScale + 0.2);
      } else if (action === 'out') {
        magnifierScale = Math.max(1.5, magnifierScale - 0.2);
      }
      
      const badge = document.getElementById('magnifier-lens-badge');
      if (badge) badge.textContent = `${magnifierScale.toFixed(1)}x`;
      
      refreshMagnifierSnapshot();
    } else if (e.channel === 'guest-click') {
      const menuDropdown = document.getElementById('menu-dropdown');
      if (menuDropdown && !menuDropdown.classList.contains('hidden')) {
        menuDropdown.classList.add('hidden');
      }
      const zoomPopover = document.getElementById('zoom-popover');
      if (zoomPopover && !zoomPopover.classList.contains('hidden')) {
        zoomPopover.classList.add('hidden');
      }
    } else if (e.channel === 'tab-switch-shortcut') {
      const { digit } = e.args[0];
      handleTabSwitchShortcut(digit);
    } else if (e.channel === 'tab-close-shortcut') {
      closeTab(id);
    } else if (e.channel === 'guest-mousemove') {
      const { clientX, clientY } = e.args[0];
      const rect = webviewElement.getBoundingClientRect();
      const parentX = clientX;
      const parentY = rect.top + clientY;
      handleToastProximity(parentX, parentY);
    } else if (e.channel === 'guest-mousemove-leave') {
      handleToastProximity(-1000, -1000);
    } else if (e.channel === 'tab-reopen-shortcut') {
      reopenLastClosedTab();
    }
  });
}

// ─── Navigation ─────────────────────────────────────────────────────────────

const REFRESH_ICON = `<svg viewBox="0 0 24 24"><path d="M17.65 6.35A7.958 7.958 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08A5.99 5.99 0 0 1 12 18c-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z" fill="currentColor"/></svg>`;
const STOP_ICON = `<svg viewBox="0 0 24 24"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" fill="currentColor"/></svg>`;

function updateRefreshStopButtonState() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab || !tab.webviewElement) {
    navRefreshBtn.innerHTML = REFRESH_ICON;
    navRefreshBtn.title = "Refresh";
    return;
  }

  let isLoading = false;
  try {
    isLoading = typeof tab.webviewElement.isLoading === 'function' ? tab.webviewElement.isLoading() : false;
  } catch (e) {}

  if (isLoading && tab.url !== 'seb://newtab' && tab.url !== 'seb://downloads') {
    navRefreshBtn.innerHTML = STOP_ICON;
    navRefreshBtn.title = "Stop loading this page";
  } else {
    navRefreshBtn.innerHTML = REFRESH_ICON;
    navRefreshBtn.title = "Refresh";
  }
}

function updateNavigationUI(tab) {
  if (activeTabId !== tab.id) return;

  // Sync loading spinner visibility with the current tab's loading state
  if (tab.isLoading) {
    loadingSpinner.classList.remove('hidden');
  } else {
    loadingSpinner.classList.add('hidden');
  }

  // Show blank address bar for local Prodigy pages (like real browser new tabs)
  if (tab.url === 'seb://newtab' || tab.url === 'seb://downloads') {
    addressInput.value = '';
    addressInput.placeholder = tab.url === 'seb://newtab' ? 'Search or enter web address' : 'Downloads';
    addressInput.readOnly = false;
    const addrContainer = document.getElementById('address-container');
    if (addrContainer) addrContainer.classList.remove('locked');
    navBackBtn.disabled = true;
    navForwardBtn.disabled = true;
    updateRefreshStopButtonState();
    return;
  }

  addressInput.value = tab.url || '';
  addressInput.placeholder = 'Search or enter web address';

  const isMainExamTab = !tab.canClose;
  addressInput.readOnly = isMainExamTab;
  const addrContainer = document.getElementById('address-container');
  if (addrContainer) {
    if (isMainExamTab) {
      addrContainer.classList.add('locked');
    } else {
      addrContainer.classList.remove('locked');
    }
  }
  
  // Set back/forward buttons status
  try {
    navBackBtn.disabled = !tab.webviewElement.canGoBack();
    navForwardBtn.disabled = !tab.webviewElement.canGoForward();
  } catch (err) {
    navBackBtn.disabled = true;
    navForwardBtn.disabled = true;
  }

  updateRefreshStopButtonState();
}

function navigateBack() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && tab.webviewElement.canGoBack()) {
    tab.webviewElement.goBack();
  }
}

function navigateForward() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && tab.webviewElement.canGoForward()) {
    tab.webviewElement.goForward();
  }
}

function navigateRefresh(ignoreCache = false) {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && tab.url !== 'seb://downloads' && tab.url !== 'seb://newtab') {
    let isLoading = false;
    try {
      isLoading = typeof tab.webviewElement.isLoading === 'function' ? tab.webviewElement.isLoading() : false;
    } catch (e) {}

    if (isLoading) {
      tab.webviewElement.stop();
    } else {
      if (tab.failedUrl) {
        const urlToReload = tab.failedUrl;
        tab.failedUrl = null;
        tab.webviewElement.loadURL(urlToReload);
      } else {
        if (ignoreCache && typeof tab.webviewElement.reloadIgnoringCache === 'function') {
          tab.webviewElement.reloadIgnoringCache();
        } else {
          tab.webviewElement.reload();
        }
      }
    }
  }
}

function navigateHome() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && config && config.examUrl && tab.url !== 'seb://downloads' && tab.url !== 'seb://newtab') {
    tab.failedUrl = null;
    tab.webviewElement.loadURL(config.examUrl);
  }
}

function navigateActiveTabTo(url) {
  const tab = tabs.find(t => t.id === activeTabId);
  if (tab && tab.url !== 'seb://downloads' && tab.url !== 'seb://newtab') {
    tab.failedUrl = null;
    if (isPdfUrl(url)) {
      const folderPath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
      const resolvedUrl = `file://${folderPath}/pdfviewer.html?file=${encodeURIComponent(url)}&title=${encodeURIComponent('PDF Document')}`;
      tab.webviewElement.loadURL(resolvedUrl);
    } else {
      tab.webviewElement.loadURL(url);
    }
  } else if (tab && (tab.url === 'seb://newtab' || tab.url === 'seb://downloads')) {
    // Navigate away from local tab: create a new real webview tab
    createTab(url, true);
    closeTab(tab.id);
  }
}

function getOfflineHtml(failedUrl, errorDescription) {
  const theme = localStorage.getItem('prodigy-theme') || 'dark';
  
  let bg = '#070913';
  let cardBg = '#0d1127';
  let textMain = '#f8fafc';
  let textMuted = '#94a3b8';
  let accent = '#4f8ef7';
  let accentHover = '#3b7ad9';
  let border = 'rgba(255, 255, 255, 0.08)';

  if (theme === 'cyberpunk') {
    bg = '#0b0518';
    cardBg = '#14092b';
    accent = '#ff007f';
    accentHover = '#d9006c';
  } else if (theme === 'forest') {
    bg = '#070e0b';
    cardBg = '#0d1a14';
    accent = '#10b981';
    accentHover = '#0d9488';
  } else if (theme === 'sunset') {
    bg = '#0e0909';
    cardBg = '#1b1111';
    accent = '#f97316';
    accentHover = '#ea580c';
  }

  return `
<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <title>Offline</title>
  <style>
    body {
      background-color: ${bg};
      color: ${textMain};
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      margin: 0;
      padding: 20px;
      box-sizing: border-box;
      text-align: center;
    }
    .card {
      background-color: ${cardBg};
      border: 1px solid ${border};
      border-radius: 16px;
      padding: 40px;
      max-width: 480px;
      width: 100%;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.5), 0 8px 10px -6px rgba(0, 0, 0, 0.3);
      animation: fadeIn 0.4s ease-out;
    }
    @keyframes fadeIn {
      from { opacity: 0; transform: translateY(10px); }
      to { opacity: 1; transform: translateY(0); }
    }
    .icon {
      color: ${accent};
      margin-bottom: 24px;
    }
    h1 {
      font-size: 22px;
      font-weight: 700;
      margin: 0 0 12px 0;
      letter-spacing: -0.01em;
    }
    p {
      font-size: 14px;
      color: ${textMuted};
      line-height: 1.5;
      margin: 0 0 24px 0;
    }
    .error-details {
      font-family: monospace;
      font-size: 11px;
      background: rgba(0, 0, 0, 0.2);
      border-radius: 6px;
      padding: 10px;
      margin-bottom: 24px;
      word-break: break-all;
      color: ${textMuted};
      border: 1px solid ${border};
    }
    button {
      background-color: ${accent};
      color: white;
      border: none;
      padding: 12px 28px;
      font-size: 14px;
      font-weight: 600;
      border-radius: 9999px;
      cursor: pointer;
      transition: background-color 0.15s ease, transform 0.1s ease;
      box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.2);
    }
    button:hover {
      background-color: ${accentHover};
    }
    button:active {
      transform: scale(0.98);
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="icon">
      <svg viewBox="0 0 24 24" width="64" height="64" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
        <path d="M5 12.5a5 5 0 0 1 7-4.2a6 6 0 0 1 10.6 3.7c.3.9.4 1.8.4 2.8a5 5 0 0 1-5 5H6a5 5 0 0 1-1-9.8z"/>
        <line x1="1" y1="1" x2="23" y2="23" stroke-width="2"/>
      </svg>
    </div>
    <h1>No Internet Connection</h1>
    <p>SecureExam Browser is unable to connect to the internet. Please check your network cables, Wi-Fi, or router configuration.</p>
    <div class="error-details">
      URL: ${failedUrl}<br>
      Error: ${errorDescription}
    </div>
    <button onclick="window.location.href='${failedUrl}'">Try Again</button>
  </div>
</body>
</html>
  `;
}

function isPdfUrl(url) {
  if (!url) return false;
  const lower = url.toLowerCase();
  return lower.endsWith('.pdf') || lower.includes('.pdf#') || lower.includes('.pdf?');
}

function isExamSessionActive() {
  return tabs.some(t => t.isExamActive === true);
}

function updateTabLockStyles() {
  const tabsBar = document.getElementById('tabs-bar');
  if (!tabsBar) return;
  
  const examActive = isExamSessionActive();
  if (examActive) {
    tabsBar.classList.add('locked');
    
    // Close Notes sidebar and lock toolbar button
    if (toolbarNotepadBtn) {
      toolbarNotepadBtn.classList.add('locked');
      toolbarNotepadBtn.classList.remove('active');
    }
    if (notepadSidebar) notepadSidebar.classList.remove('open');
    isNotepadActive = false;

    // Close Socratic AI sidebar and lock toolbar button
    if (toolbarAiBtn) {
      toolbarAiBtn.classList.add('locked');
      toolbarAiBtn.classList.remove('active');
    }
    if (aiSidebar) aiSidebar.classList.remove('open');
    isAiActive = false;
  } else {
    tabsBar.classList.remove('locked');
    
    // Unlock toolbar buttons
    if (toolbarNotepadBtn) toolbarNotepadBtn.classList.remove('locked');
    if (toolbarAiBtn) toolbarAiBtn.classList.remove('locked');
  }

  // Notify main process of active exam session status
  if (window.sebBrowser && typeof window.sebBrowser.setExamActive === 'function') {
    window.sebBrowser.setExamActive(examActive);
  }
}

async function updateActiveExamStatus() {
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (!activeTab || !activeTab.webviewElement || activeTab.url === 'seb://downloads' || activeTab.url === 'seb://newtab' || activeTab.url === 'seb://history') {
    if (activeTab) {
      activeTab.isExamActive = false;
    }
    isCurrentTabExamActive = false;
    updateTabLockStyles();
    return;
  }
  
  try {
    const result = await activeTab.webviewElement.executeJavaScript(`
      (function() {
        const text = document.body ? document.body.innerText : '';
        const hasQuestionOf = /Question\\s+\\d+\\s+of\\s+\\d+/i.test(text);
        const hasQuestionSlash = /\\b\\d+\\s*\\/\\s*\\d+\\b/.test(text);
        const hasPrev = /\\bPrevious\\b/i.test(text);
        const hasNext = /\\bNext\\b/i.test(text);
        return hasQuestionOf && hasQuestionSlash && hasPrev && hasNext;
      })()
    `);
    
    activeTab.isExamActive = (result === true);
    
    const wasActive = isCurrentTabExamActive;
    isCurrentTabExamActive = (result === true);
    updateTabLockStyles();
  } catch (err) {
    activeTab.isExamActive = false;
    isCurrentTabExamActive = false;
    updateTabLockStyles();
  }
}

// Set up periodic exam status check — 5 s is sufficient; eager triggers on did-navigate / dom-ready
// already give instant response when the student navigates to/from an exam page.
setInterval(updateActiveExamStatus, 5000);

// ─── Exit Dialog ────────────────────────────────────────────────────────────

async function showExitPrompt() {
  let isTakingExam = false;
  examTabIdToReturnTo = null;
  // Scan all open tabs to detect if any of them are currently in an active exam session
  for (const tab of tabs) {
    if (tab.webviewElement && tab.url !== 'seb://downloads' && tab.url !== 'seb://newtab') {
      try {
        const result = await tab.webviewElement.executeJavaScript(`
          (function() {
            const text = document.body ? document.body.innerText : '';
            const hasQuestionOf = /Question\\s+\\d+\\s+of\\s+\\d+/i.test(text);
            const hasQuestionSlash = /\\b\\d+\\s*\\/\\s*\\d+\\b/.test(text);
            const hasPrev = /\\bPrevious\\b/i.test(text);
            const hasNext = /\\bNext\\b/i.test(text);
            return hasQuestionOf && hasQuestionSlash && hasPrev && hasNext;
          })()
        `);
        if (result === true) {
          isTakingExam = true;
          examTabIdToReturnTo = tab.id;
          break; // Found an active exam page, block exit immediately
        }
      } catch (err) {
        console.error('[Browser] Failed to detect exam status on tab ' + tab.id + ':', err);
      }
    }
  }

  // Bypass close confirmation if the user checked "Don't ask me again" previously
  // EXCEPT when an active exam is detected OR when an exit password is set
  const hasPwd = await window.sebBrowser.hasExitPassword();
  if (!isTakingExam && !hasPwd) {
    const skipConfirm = sessionStorage.getItem('skipCloseConfirmation') === 'true';
    if (skipConfirm || tabs.length <= 1) {
      attemptExit('');
      return;
    }
  }

  const modalContent = exitModal ? exitModal.querySelector('.modal-content') : null;
  const checkboxContainer = document.getElementById('exit-dont-ask-container');
  const pwdContainer = document.getElementById('exit-password-container');

  // Reset password fields
  const pwdInput = document.getElementById('exit-password-input');
  const pwdError = document.getElementById('exit-password-error-msg');
  if (pwdInput) pwdInput.value = '';
  if (pwdError) pwdError.classList.add('hidden');

  if (isTakingExam) {
    if (modalContent) modalContent.classList.add('exam-blocked');
    if (checkboxContainer) checkboxContainer.style.display = 'none';
    if (pwdContainer) pwdContainer.classList.add('hidden');

    exitModalDesc.innerHTML = `
      <div class="exam-blocked-warning">
        <span class="warning-title">⚠️ Exiting Blocked During Exam</span>
        <p class="warning-desc">You cannot exit the browser while taking an active exam. Please complete and submit your exam before attempting to close the application.</p>
      </div>
    `;
    if (exitSubmitBtn) exitSubmitBtn.style.display = 'none';
    if (exitCancelBtn) {
      exitCancelBtn.textContent = 'Return to Exam';
      exitCancelBtn.removeAttribute('style');
    }
  } else {
    if (modalContent) modalContent.classList.remove('exam-blocked');
    
    if (hasPwd) {
      if (pwdContainer) pwdContainer.classList.remove('hidden');
      if (checkboxContainer) checkboxContainer.style.display = 'none';
      exitModalDesc.innerHTML = `Enter the supervisor exit password to close the application. You have <strong>${tabs.length}</strong> tab(s) open.`;
      setTimeout(() => {
        if (pwdInput) pwdInput.focus();
      }, 50);
    } else {
      if (pwdContainer) pwdContainer.classList.add('hidden');
      if (checkboxContainer) checkboxContainer.style.display = 'flex';
      exitModalDesc.innerHTML = `Are you sure you want to close? You have <strong id="exit-modal-tab-count">${tabs.length}</strong> tab(s) open. Unsaved changes may be lost.`;
    }

    if (exitSubmitBtn) exitSubmitBtn.style.display = 'block';
    if (exitCancelBtn) {
      exitCancelBtn.textContent = 'Cancel';
      exitCancelBtn.removeAttribute('style');
    }

    const checkbox = document.getElementById('exit-dont-ask');
    if (checkbox) checkbox.checked = false;
  }

  if (exitModal) exitModal.classList.remove('hidden');
}

function hideExitPrompt() {
  exitModal.classList.add('hidden');
  const pwdInput = document.getElementById('exit-password-input');
  const pwdError = document.getElementById('exit-password-error-msg');
  if (pwdInput) pwdInput.value = '';
  if (pwdError) pwdError.classList.add('hidden');

  if (examTabIdToReturnTo !== null) {
    switchTab(examTabIdToReturnTo);
    examTabIdToReturnTo = null;
  } else {
    const activeTab = tabs.find(t => t.id === activeTabId);
    if (activeTab && activeTab.webviewElement) {
      try {
        activeTab.webviewElement.focus();
      } catch (e) {}
    }
  }
}

async function attemptExit(password = '') {
  try {
    // Clear browsing history on exit for student privacy and security
    await window.sebBrowser.clearHistory();
    const res = await window.sebBrowser.quit(password);
    if (res && res.success === false) {
      const errorMsg = document.getElementById('exit-password-error-msg');
      if (errorMsg) {
        errorMsg.textContent = res.error || 'Incorrect exit password. Please try again.';
        errorMsg.classList.remove('hidden');
      }
      return false;
    }
    return true;
  } catch (err) {
    console.error('Exit call failed', err);
    return false;
  }
}

// ─── Close All Tabs Dialog ──────────────────────────────────────────────────

async function showCloseAllPrompt() {
  // First, check if there's any active exam in any tab. If so, block exit and show exit warn modal!
  let isTakingExam = false;
  examTabIdToReturnTo = null;
  for (const tab of tabs) {
    if (tab.webviewElement && tab.url !== 'seb://downloads' && tab.url !== 'seb://newtab') {
      try {
        const result = await tab.webviewElement.executeJavaScript(`
          (function() {
            const text = document.body ? document.body.innerText : '';
            const hasQuestionOf = /Question\\s+\\d+\\s+of\\s+\\d+/i.test(text);
            const hasQuestionSlash = /\\b\\d+\\s*\\/\\s*\\d+\\b/.test(text);
            const hasPrev = /\\bPrevious\\b/i.test(text);
            const hasNext = /\\bNext\\b/i.test(text);
            return hasQuestionOf && hasQuestionSlash && hasPrev && hasNext;
          })()
        `);
        if (result === true) {
          isTakingExam = true;
          examTabIdToReturnTo = tab.id;
          break;
        }
      } catch (err) {
        console.error('[Browser] Failed to detect exam status on tab ' + tab.id + ':', err);
      }
    }
  }

  if (isTakingExam) {
    // Exiting is blocked during exam! Show exit blocked warning modal instead
    showExitPrompt();
    return;
  }

  // Bypass close confirmation if the user checked "Don't ask me again" previously
  const skipConfirm = sessionStorage.getItem('skipCloseConfirmation') === 'true';
  if (skipConfirm) {
    attemptExit();
    return;
  }

  // If no exam is active, show the "Close all tabs?" dialog
  if (closeAllDesc) {
    const count = tabs.length;
    closeAllDesc.textContent = `You have ${count} tab${count > 1 ? 's' : ''} open in this browser window.`;
  }

  const checkbox = document.getElementById('close-all-dont-ask');
  if (checkbox) checkbox.checked = false;

  if (closeAllModal) {
    closeAllModal.classList.remove('hidden');
  }
}

function hideCloseAllPrompt() {
  if (closeAllModal) {
    closeAllModal.classList.add('hidden');
  }
}

// ─── Tab Hover Card Helpers ──────────────────────────────────────────────────

function showTabHoverCard(tab) {
  if (!hoverCard || !hoverCardTitle || !hoverCardDomain || !hoverCardMemory) return;

  hoverCardTitle.textContent = tab.title || 'Loading...';
  
  let domain = 'Local Page';
  if (tab.url.startsWith('http://') || tab.url.startsWith('https://')) {
    try {
      domain = new URL(tab.url).hostname;
    } catch (e) {
      domain = tab.url;
    }
  } else if (tab.url === 'seb://downloads') {
    domain = 'prodigy://downloads';
  } else if (tab.url === 'seb://newtab') {
    domain = 'prodigy://newtab';
  }
  hoverCardDomain.textContent = domain;

  // Stable memory usage per tab
  if (!tabMemoryCache.has(tab.id)) {
    const min = 120;
    const max = 280;
    const rand = Math.floor(Math.random() * (max - min + 1)) + min;
    tabMemoryCache.set(tab.id, `${rand} MB`);
  }
  hoverCardMemory.textContent = tabMemoryCache.get(tab.id);

  // Dynamic memory stats formatting for hibernated tabs (Brave/Chrome style)
  const memoryLabelEl = document.getElementById('hover-card-memory-label');
  if (memoryLabelEl) {
    if (tab.isHibernated) {
      memoryLabelEl.textContent = '🍃 Memory saved: ';
      memoryLabelEl.style.color = '#10b981'; // Green accent
      hoverCardMemory.style.color = '#10b981';
      hoverCardMemory.style.fontWeight = 'bold';
    } else {
      memoryLabelEl.textContent = 'Memory usage: ';
      memoryLabelEl.removeAttribute('style');
      hoverCardMemory.removeAttribute('style');
    }
  }

  hoverCard.classList.remove('hidden');
  // force layout
  hoverCard.offsetHeight;
  hoverCard.classList.add('show');
  
  positionTabHoverCard(tab.tabElement);
}

function positionTabHoverCard(tabElement) {
  if (!hoverCard || !tabElement) return;
  const cardWidth = 240;
  const cardHeight = 85;
  
  const rect = tabElement.getBoundingClientRect();
  let left = rect.left + rect.width / 2 - cardWidth / 2;
  let top = rect.bottom + 6; // Position 6px directly below the tab element
  
  // Keep card inside screen bounds
  if (left < 10) left = 10;
  if (left + cardWidth > window.innerWidth - 10) {
    left = window.innerWidth - cardWidth - 10;
  }
  if (top + cardHeight > window.innerHeight - 10) {
    top = rect.top - cardHeight - 6; // show above tab if overflow
  }
  
  hoverCard.style.left = `${left}px`;
  hoverCard.style.top = `${top}px`;
}

function hideTabHoverCard() {
  if (!hoverCard) return;
  hoverCard.classList.remove('show');
  hoverCard.classList.add('hidden');
}

// ─── Admin Unlock Dialog ──────────────────────────────────────────────────────

function showAdminUnlockPrompt() {
  adminUnlockPasswordInput.value = '';
  adminUnlockErrorMsg.classList.add('hidden');
  adminUnlockModal.classList.remove('hidden');
  adminUnlockPasswordInput.focus();
}

function hideAdminUnlockPrompt() {
  adminUnlockModal.classList.add('hidden');
  // Re-focus the active webview if one is active
  const activeTab = tabs.find(t => t.id === activeTabId);
  if (activeTab && activeTab.webviewElement) {
    try {
      activeTab.webviewElement.focus();
    } catch (e) {}
  }
}

async function attemptAdminUnlock() {
  try {
    const password = adminUnlockPasswordInput.value;
    const ok = await window.sebBrowser.verifyAdminPassword(password);
    if (ok) {
      adminUnlockModal.classList.add('hidden');
      await window.sebBrowser.openAdminPanel();
    } else {
      adminUnlockErrorMsg.classList.remove('hidden');
      adminUnlockPasswordInput.select();
    }
  } catch (err) {
    console.error('Admin unlock verification failed:', err);
  }
}


// ─── Toast Notifications ─────────────────────────────────────────────────────

let lastBlockedToastTime = 0;

function isGameKeywordMatch(text) {
  if (!text) return false;
  const lower = text.toLowerCase();
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
  return GAME_KEYWORDS.some(kw => lower.includes(kw)) || lower.includes('.games') || lower.includes('.play');
}

function showBlockedToast(url, type) {
  const now = Date.now();
  if (now - lastBlockedToastTime < 3000) {
    return;
  }
  lastBlockedToastTime = now;

  let finalType = type;
  if (!finalType && url) {
    finalType = isGameKeywordMatch(url) ? 'game' : 'ai';
  }

  const toast = document.getElementById('ai-blocked-toast');
  if (toast) {
    const titleEl = toast.querySelector('.ai-blocked-toast-title');
    const descEl = toast.querySelector('.ai-blocked-toast-desc');
    
    if (titleEl && descEl) {
      if (finalType === 'game') {
        titleEl.textContent = 'Access Restricted';
        descEl.textContent = 'Access to games or unapproved external resources is blocked.';
      } else {
        titleEl.textContent = 'AI Access Restricted';
        descEl.textContent = 'Use of external AI tools is blocked. Please use the built-in AI tutor.';
      }
    }

    toast.classList.remove('hidden');
    toast.offsetHeight; // trigger reflow
    toast.classList.add('show');

    // Log the block event
    window.sebBrowser.logEvent(finalType === 'game' ? 'GAME_URL_BLOCKED' : 'AI_URL_BLOCKED', { url });

    // Set auto-hide timers
    if (aiBlockedToastTimer) clearTimeout(aiBlockedToastTimer);
    if (aiBlockedToastHideTimer) clearTimeout(aiBlockedToastHideTimer);

    aiBlockedToastTimer = setTimeout(() => {
      toast.classList.remove('show');
      
      aiBlockedToastHideTimer = setTimeout(() => {
        if (!toast.classList.contains('show')) {
          toast.classList.add('hidden');
        }
      }, 300); // match transition duration
    }, 4000);
  }
}

function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type}`;
  
  let iconSvg = '';
  let title = 'Notification';
  
  if (type === 'blocked') {
    iconSvg = `<div class="toast-icon-wrapper"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"></path></svg></div>`;
    title = 'AI Blocking Shield';
  } else if (type === 'download') {
    iconSvg = `<div class="toast-icon-wrapper"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg></div>`;
    title = 'File Download';
  } else if (type === 'success') {
    iconSvg = `<div class="toast-icon-wrapper"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"></path><polyline points="22 4 12 14.01 9 11.01"></polyline></svg></div>`;
    title = 'Success';
  } else if (type === 'error') {
    iconSvg = `<div class="toast-icon-wrapper"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg></div>`;
    title = 'Error';
  } else {
    iconSvg = `<div class="toast-icon-wrapper"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg></div>`;
    title = 'Notification';
  }
  
  toast.innerHTML = `
    <div class="toast-header">
      <span class="toast-title">
        ${iconSvg} <span>${title}</span>
      </span>
      <button class="toast-close">✕</button>
    </div>
    <div class="toast-body">${message}</div>
  `;

  container.appendChild(toast);

  // Trigger slide-in
  setTimeout(() => {
    toast.classList.add('show');
  }, 10);

  const dismiss = () => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
    }, 350);
  };

  toast.querySelector('.toast-close').addEventListener('click', dismiss);

  // Auto-dismiss after 6 seconds
  setTimeout(dismiss, 6000);
}

function promptSessionRestore(preservedTabs) {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = 'toast session-restore';
  
  toast.innerHTML = `
    <div class="toast-header">
      <span class="toast-title">
        <div class="toast-icon-wrapper"><svg viewBox="0 0 24 24" width="11" height="11" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 4 23 10 17 10"></polyline><polyline points="1 20 1 14 7 14"></polyline><path d="M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15"></path></svg></div>
        <span>Session Restore</span>
      </span>
      <button class="toast-close" id="btn-close-session-toast">✕</button>
    </div>
    <div class="toast-body">
      <p style="margin: 0 0 10px 0;">Would you like to restore the tabs from your previous session?</p>
      <div style="display: flex; gap: 4px;">
        <button id="btn-restore-session" style="background: #3b82f6; color: #ffffff; border: none; padding: 6px 12px; border-radius: 4px; font-weight: 600; cursor: pointer; font-size: 11px; transition: background 0.15s;">Restore Tabs</button>
        <button id="btn-dismiss-session" style="background: transparent; color: #64748b; border: none; padding: 6px 12px; border-radius: 4px; font-weight: 600; cursor: pointer; font-size: 11px; transition: color 0.15s;">Dismiss</button>
      </div>
    </div>
  `;

  container.appendChild(toast);

  // Trigger slide-in
  setTimeout(() => {
    toast.classList.add('show');
  }, 10);

  const dismiss = () => {
    toast.classList.remove('show');
    setTimeout(() => {
      toast.remove();
    }, 350);
  };

  toast.querySelector('#btn-close-session-toast').addEventListener('click', dismiss);
  toast.querySelector('#btn-dismiss-session').addEventListener('click', dismiss);

  toast.querySelector('#btn-restore-session').addEventListener('click', () => {
    dismiss();
    
    // Remember initial tabs to close
    const initialTabs = [...tabs];
    
    // Find the default exam tab (the one that cannot be closed)
    const existingExamTab = tabs.find(t => !t.canClose);
    
    // Restore preserved tabs
    let activeTabToSwitch = null;
    preservedTabs.forEach((savedTab) => {
      let tab;
      if (!savedTab.canClose && existingExamTab) {
        // Reuse the existing main exam tab instead of creating a duplicate
        tab = existingExamTab;
        tab.url = savedTab.url === 'about:blank' ? 'about:blank' : savedTab.url;
        tab.title = savedTab.title;
        const titleEl = document.getElementById(`tab-title-${tab.id}`);
        if (titleEl) {
          titleEl.textContent = tab.title;
        }
      } else {
        tab = createTab(savedTab.url === 'about:blank' ? 'about:blank' : savedTab.url, savedTab.canClose, savedTab.title);
      }
      
      if (savedTab.active) {
        activeTabToSwitch = tab.id;
      }
      if (savedTab.url !== 'seb://newtab' && savedTab.url !== 'seb://downloads') {
        setTimeout(() => {
          if (tab && tab.webviewElement) {
            let targetUrl = savedTab.url;
            if (isPdfUrl(targetUrl)) {
              const folderPath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
              targetUrl = `file://${folderPath}/pdfviewer.html?file=${encodeURIComponent(targetUrl)}&title=${encodeURIComponent(savedTab.title || 'PDF Document')}`;
            }
            if (typeof tab.webviewElement.loadURL === 'function') {
              try {
                tab.webviewElement.loadURL(targetUrl);
              } catch (e) {
                tab.webviewElement.setAttribute('src', targetUrl);
              }
            } else {
              tab.webviewElement.setAttribute('src', targetUrl);
            }
          }
        }, 100);
      }
    });

    if (activeTabToSwitch !== null) {
      switchTab(activeTabToSwitch);
    }

    // Safely close the initial temporary tabs to keep it clean
    initialTabs.forEach(t => {
      if (t.canClose) {
        closeTab(t.id);
      }
    });
    
    showToast('Session restored successfully.', 'success');
  });
}

// ─── Zoom Helpers ────────────────────────────────────────────────────────────

function zoomActiveTab(delta) {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  
  let newZoom = tab.zoomFactor + delta;
  // Bound zoom between 50% and 300%
  newZoom = Math.max(0.5, Math.min(3.0, newZoom));
  
  tab.zoomFactor = parseFloat(newZoom.toFixed(1));
  try {
    if (tab.webviewElement && typeof tab.webviewElement.setZoomFactor === 'function') {
      tab.webviewElement.setZoomFactor(tab.zoomFactor);
    }
  } catch (err) {
    console.error('[Browser] Failed to setZoomFactor on webview:', err);
  }
  try {
    tab.webviewElement.send('guest:set-zoom', tab.zoomFactor);
  } catch (err) {
    console.error('[Browser] Failed to send guest:set-zoom:', err);
  }
  
  updateZoomUI(tab);
  
  // Log zoom event
  window.sebBrowser.logEvent('BROWSER_ZOOM_CHANGED', { level: `${Math.round(tab.zoomFactor * 100)}%` });
}

function resetZoomActiveTab() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  
  tab.zoomFactor = 1.0;
  try {
    if (tab.webviewElement && typeof tab.webviewElement.setZoomFactor === 'function') {
      tab.webviewElement.setZoomFactor(1.0);
    }
  } catch (err) {
    console.error('[Browser] Failed to setZoomFactor on webview (reset):', err);
  }
  try {
    tab.webviewElement.send('guest:set-zoom', 1.0);
  } catch (err) {
    console.error('[Browser] Failed to send guest:set-zoom (reset):', err);
  }
  
  updateZoomUI(tab);
  window.sebBrowser.logEvent('BROWSER_ZOOM_RESET');
}

function updateZoomUI(tab) {
  if (activeTabId !== tab.id) return;
  
  const percentage = Math.round(tab.zoomFactor * 100);
  if (addressZoomText) addressZoomText.textContent = `${percentage}%`;
  if (popoverZoomVal) popoverZoomVal.textContent = `${percentage}%`;
  
  const menuZoomPercentage = document.getElementById('menu-zoom-percentage');
  if (menuZoomPercentage) menuZoomPercentage.textContent = `${percentage}%`;
  
  if (addressZoomBtn) {
    if (percentage === 100) {
      addressZoomBtn.classList.add('hidden');
      if (zoomPopover) zoomPopover.classList.add('hidden');
    } else {
      addressZoomBtn.classList.remove('hidden');
    }
  }
}

function toggleZoomPopover() {
  if (!zoomPopover || !addressZoomBtn) return;
  
  const isHidden = zoomPopover.classList.contains('hidden');
  if (isHidden) {
    const rect = addressZoomBtn.getBoundingClientRect();
    zoomPopover.style.left = `${rect.right - 145}px`;
    zoomPopover.style.top = `${rect.bottom + 6}px`;
    zoomPopover.classList.remove('hidden');
  } else {
    zoomPopover.classList.add('hidden');
  }
}

// ─── Tab Context Menu Helpers ────────────────────────────────────────────────

function showTabContextMenu(tabId, x, y) {
  contextMenuTabId = tabId;
  const menu = document.getElementById('tab-context-menu');
  if (!menu) return;
  
  menu.style.left = `${x}px`;
  menu.style.top = `${y}px`;
  
  // Disable "Close Tab" if it cannot be closed
  const tabObj = tabs.find(t => t.id === tabId);
  const closeItem = document.getElementById('menu-close');
  if (tabObj && !tabObj.canClose) {
    closeItem.classList.add('disabled');
  } else {
    closeItem.classList.remove('disabled');
  }
  
  menu.classList.remove('hidden');
  
  // Dismiss listener
  const dismissMenu = () => {
    menu.classList.add('hidden');
    document.removeEventListener('click', dismissMenu);
  };
  
  setTimeout(() => {
    document.addEventListener('click', dismissMenu);
  }, 10);
}

// ─── Live Magnifier Lens Tool ───────────────────────────────────────────────

let isMagnifierActive = false;
let magnifierScale = 2.0; // Default 2x zoom factor
let lastMouseX = 200;
let lastMouseY = 200;
let scrollXAtCapture = 0;
let scrollYAtCapture = 0;
let currentScrollX = 0;
let currentScrollY = 0;

async function toggleMagnifier() {
  const tab = tabs.find(t => t.id === activeTabId);
  if (!tab) return;
  
  const lens = document.getElementById('magnifier-lens');
  if (!lens) return;
  
  if (isMagnifierActive) {
    // Deactivate
    isMagnifierActive = false;
    lens.classList.add('hidden');
    lens.style.display = 'none';
    lens.style.opacity = '0';
    tab.webviewElement.send('guest:set-magnifier-active', false);
    showToast('Magnifier Lens deactivated.', 'info');
  } else {
    // Activate
    isMagnifierActive = true;
    tab.webviewElement.send('guest:set-magnifier-active', true);
    
    // Position lens immediately at the last known coordinates
    const rect = tab.webviewElement.getBoundingClientRect();
    const hostX = rect.left + lastMouseX;
    const hostY = rect.top + lastMouseY;
    const lensWidth = 260;
    const lensHeight = 160;
    
    lens.style.left = `${hostX - lensWidth / 2}px`;
    lens.style.top = `${hostY - lensHeight / 2}px`;
    lens.style.opacity = '0';
    
    // Capture initial snapshot
    await refreshMagnifierSnapshot();
    
    // Force set the initial background image slice position taking scroll offsets into account
    const deltaX = currentScrollX - scrollXAtCapture;
    const deltaY = currentScrollY - scrollYAtCapture;
    const cropX = lastMouseX + deltaX;
    const cropY = lastMouseY + deltaY;
    
    const bgX = -cropX * magnifierScale + lensWidth / 2;
    const bgY = -cropY * magnifierScale + lensHeight / 2;
    lens.style.backgroundPosition = `${bgX}px ${bgY}px`;
    lens.style.backgroundSize = `${rect.width * magnifierScale}px ${rect.height * magnifierScale}px`;
    
    lens.classList.remove('hidden');
    lens.style.display = 'block';
    lens.style.opacity = '1';
    
    showToast('Magnifier Lens active. Hover to magnify. Ctrl+Scroll adjusts scale. Ctrl+M to close.', 'success');
  }
}

async function refreshMagnifierSnapshot() {
  const tab = tabs.find(t => t.id === activeTabId);
  const lens = document.getElementById('magnifier-lens');
  if (!tab || !lens || !isMagnifierActive) return;
  
  try {
    const img = await tab.webviewElement.capturePage();
    lens.style.backgroundImage = `url(${img.toDataURL()})`;
    
    // Save the baseline scroll offset coordinates at capture time
    scrollXAtCapture = currentScrollX;
    scrollYAtCapture = currentScrollY;
  } catch (err) {
    console.error('[Browser] Magnifier capture failed:', err);
  }
}

// ─── Dyslexia Font System ────────────────────────────────────────────────────

function initDyslexiaFont() {
  const isDyslexia = localStorage.getItem('dyslexia-font') === 'true';
  const toggleBtn = document.getElementById('menu-dyslexia-toggle');
  
  if (isDyslexia) {
    document.body.classList.add('dyslexia-font');
    if (toggleBtn) toggleBtn.classList.add('active');
  } else {
    document.body.classList.remove('dyslexia-font');
    if (toggleBtn) toggleBtn.classList.remove('active');
  }

  if (toggleBtn) {
    toggleBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const current = localStorage.getItem('dyslexia-font') === 'true';
      const next = !current;
      localStorage.setItem('dyslexia-font', String(next));

      if (next) {
        document.body.classList.add('dyslexia-font');
        toggleBtn.classList.add('active');
        showToast('Dyslexia-friendly font enabled.', 'success');
      } else {
        document.body.classList.remove('dyslexia-font');
        toggleBtn.classList.remove('active');
        showToast('Dyslexia-friendly font disabled.', 'info');
      }

      // Sync active webviews
      const script = getDyslexiaFontScript(next);
      tabs.forEach(tab => {
        if (tab.webviewElement && tab.url !== 'seb://downloads' && tab.url !== 'seb://newtab' && tab.url !== 'seb://history') {
          try {
            tab.webviewElement.executeJavaScript(script);
          } catch (err) {}
        }
      });
    });
  }
}

function getDyslexiaFontScript(active) {
  return `
    (function() {
      let style = document.getElementById('seb-dyslexia-style');
      if (${active}) {
        if (!style) {
          style = document.createElement('style');
          style.id = 'seb-dyslexia-style';
          style.textContent = \`
            @font-face { font-family: 'OpenDyslexic'; src: url('data:font/woff;charset=utf-8;base64,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') format('woff'); font-weight: normal; font-style: normal; }
            *, body, p, span, div, h1, h2, h3, h4, h5, h6, input, button, select, textarea, a, li, ul, ol, td, th {
              font-family: 'OpenDyslexic', 'Comic Sans MS', sans-serif !important;
            }
          \`;
          document.documentElement.appendChild(style);
        }
      } else {
        if (style) {
          style.remove();
        }
      }
    })()
  `;
}

// ─── Tab Hibernation System ──────────────────────────────────────────────────

function startTabHibernationTimer(tab) {
  if (!tab || tab.url === 'seb://newtab' || tab.url === 'seb://downloads' || tab.url === 'seb://history') return;
  if (tab.isExamActive) return;

  clearTabHibernationTimer(tab);

  // Hibernate background tab after 2 minutes of inactivity (120,000 milliseconds)
  tab.hibernationTimer = setTimeout(() => {
    hibernateTab(tab);
  }, 120000);
}

function clearTabHibernationTimer(tab) {
  if (tab && tab.hibernationTimer) {
    clearTimeout(tab.hibernationTimer);
    tab.hibernationTimer = null;
  }
}

function hibernateTab(tab) {
  if (!tab || !tab.webviewElement || tab.isHibernated) return;
  
  // Never hibernate active exams
  if (tab.isExamActive) return;

  console.log(`[Hibernation] Hibernating background tab ${tab.id} (${tab.title}) to save RAM.`);
  
  try {
    tab.hibernatedUrl = tab.webviewElement.getURL() || tab.url;
  } catch (e) {
    tab.hibernatedUrl = tab.url;
  }

  // Safely tear down webview to release renderer process resources
  tab.webviewElement.remove();
  tab.webviewElement = null;
  tab.isHibernated = true;

  // Visual leaf badge update
  if (tab.tabElement) {
    tab.tabElement.classList.add('tab-hibernated');
  }
  
  showToast(`🍃 Memory Saver: Tab "${tab.title}" hibernated to save memory.`, 'info');
}

function restoreTab(tab) {
  if (!tab || !tab.isHibernated || tab.webviewElement) return;

  console.log(`[Hibernation] Restoring tab ${tab.id} (${tab.title}) from hibernation.`);
  
  let resolvedUrl = tab.hibernatedUrl || tab.url;
  if (isPdfUrl(resolvedUrl)) {
    const folderPath = window.location.pathname.substring(0, window.location.pathname.lastIndexOf('/'));
    resolvedUrl = `file://${folderPath}/pdfviewer.html?file=${encodeURIComponent(resolvedUrl)}&title=${encodeURIComponent(tab.title)}`;
  }

  // Re-build webview and restore it
  tab.webviewElement = createWebviewElement(tab.id, resolvedUrl);
  tab.isHibernated = false;

  if (tab.tabElement) {
    tab.tabElement.classList.remove('tab-hibernated');
  }

  setupWebviewEvents(tab);
  showToast(`🍃 Tab restored from hibernation (RAM freed).`, 'success');
}

// ─── Theme Switcher System ──────────────────────────────────────────────────

function initThemes() {
  // Load saved theme from IPC config (persists across app restarts)
  const savedTheme = (config && config.uiTheme) ? config.uiTheme : 'dark';
  applyTheme(savedTheme);
  
  // Wire up selectors
  const themes = ['dark', 'cyberpunk', 'forest', 'sunset', 'light', 'monochrome', 'sakura', 'fire'];
  themes.forEach(t => {
    const btn = document.getElementById(`theme-btn-${t}`);
    if (btn) {
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        applyTheme(t);
      });
    }
  });
}

function applyTheme(themeName) {
  // Clear other themes
  document.body.className = '';
  if (themeName !== 'dark') {
    document.body.classList.add(`theme-${themeName}`);
  }

  // Save theme choice — persist via IPC so it survives app restarts
  if (window.sebBrowser && window.sebBrowser.saveConfig) {
    window.sebBrowser.saveConfig({ uiTheme: themeName }).catch(() => {});
  }
  // Also write to localStorage as a fast-read cache for the new tab iframe
  try { localStorage.setItem('prodigy-theme', themeName); } catch (e) {}
  try { localStorage.setItem('seb-theme', themeName); } catch (e) {}

  // Push theme into open new tab iframes
  tabs.forEach(tab => {
    if (tab.url === 'seb://newtab' && tab.webviewElement) {
      try {
        const iframe = tab.webviewElement.querySelector('iframe');
        if (iframe && iframe.contentDocument && iframe.contentDocument.body) {
          iframe.contentDocument.body.className = themeName !== 'dark' ? `theme-${themeName}` : '';
        }
      } catch (e) {}
    }
  });

  // Update indicator dots active class
  const dots = document.querySelectorAll('.theme-dot');
  dots.forEach(dot => dot.classList.remove('active'));

  const activeDot = document.getElementById(`theme-btn-${themeName}`);
  if (activeDot) {
    activeDot.classList.add('active');
  }

  // Sync native Windows title bar overlay (caption buttons) to theme
  const overlayColors = {
    dark:        { color: '#0d1127', symbolColor: '#94a3b8' },
    cyberpunk:   { color: '#14092b', symbolColor: '#bd93f9' },
    forest:      { color: '#0d1a14', symbolColor: '#a3cfbb' },
    sunset:      { color: '#1b1111', symbolColor: '#fdba74' },
    light:       { color: '#e2e8f0', symbolColor: '#475569' },
    monochrome:  { color: '#1a1a1a', symbolColor: '#a0a0a0' },
    sakura:      { color: '#1a0b18', symbolColor: '#e8a0c0' },
    fire:        { color: '#1a0800', symbolColor: '#ffaa60' },
  };

  const ov = overlayColors[themeName] || overlayColors.dark;
  if (window.sebBrowser && window.sebBrowser.setTitleBarOverlay) {
    window.sebBrowser.setTitleBarOverlay(ov).catch(() => {});
  }

  // Sync Chromium/prefers-color-scheme setting to nativeTheme source
  if (window.sebBrowser && window.sebBrowser.setThemeSource) {
    const isLightTheme = (themeName === 'light' || themeName === 'sakura');
    window.sebBrowser.setThemeSource(isLightTheme ? 'light' : 'dark').catch(() => {});
  }
}


// ─── Downloads Tab Controller ───────────────────────────────────────────────

let localDownloads = [];

function initDownloadsTab() {
  // Bind search input to filter rendering
  const searchInput = document.getElementById('downloads-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderDownloadsList();
    });
  }

  // Listen to incoming download update broadcasts
  if (window.sebBrowser && window.sebBrowser.onDownloadsUpdated) {
    window.sebBrowser.onDownloadsUpdated((list) => {
      localDownloads = list;
      renderDownloadsList();
    });
  }

  // Try to load initial list on start
  if (window.sebBrowser && window.sebBrowser.getDownloadsList) {
    window.sebBrowser.getDownloadsList().then((list) => {
      localDownloads = list || [];
      renderDownloadsList();
    }).catch(err => console.error('[Browser] Failed to get initial downloads:', err));
  }
}

function openDownloadsTab() {
  const existing = tabs.find(t => t.url === 'seb://downloads');
  if (existing) {
    switchTab(existing.id);
  } else {
    createTab('seb://downloads', true, 'Downloads');
  }
}

function renderDownloadsList() {
  const listContainer = document.getElementById('downloads-list');
  const emptyState = document.getElementById('downloads-empty-state');
  const searchInput = document.getElementById('downloads-search-input');
  if (!listContainer || !emptyState) return;

  const filterText = searchInput ? searchInput.value.toLowerCase().trim() : '';

  // Filter downloads
  const filtered = localDownloads.filter(dl => {
    return dl.filename.toLowerCase().includes(filterText);
  });

  if (filtered.length === 0) {
    listContainer.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');
  
  // Map list
  listContainer.innerHTML = filtered.map(dl => {
    const isDownloading = dl.status === 'downloading';
    const isCompleted = dl.status === 'completed';
    const isCancelled = dl.status === 'cancelled';
    const isFailed = dl.status === 'failed';
    const isInterrupted = dl.status === 'interrupted';

    // Format bytes to readable size
    const formatBytes = (bytes) => {
      if (bytes === 0) return '0 B';
      const k = 1024;
      const sizes = ['B', 'KB', 'MB', 'GB'];
      const i = Math.floor(Math.log(bytes) / Math.log(k));
      return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
    };

    const sizeText = formatBytes(dl.totalBytes);
    const progressPercent = dl.totalBytes > 0 ? Math.round((dl.receivedBytes / dl.totalBytes) * 100) : 0;
    
    let statusText = '';
    if (isDownloading) {
      statusText = `${formatBytes(dl.receivedBytes)} of ${sizeText} (${progressPercent}%)`;
    } else if (isCompleted) {
      statusText = `Completed ${sizeText}`;
    } else if (isCancelled) {
      statusText = `Cancelled`;
    } else if (isInterrupted) {
      statusText = `Interrupted`;
    } else {
      statusText = `Failed`;
    }

    const startTimeFormatted = new Date(dl.startTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

    // File card icons using pure SVG
    const fileIconSvg = `
      <svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round">
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <line x1="16" y1="13" x2="8" y2="13"></line>
        <line x1="16" y1="17" x2="8" y2="17"></line>
        <polyline points="10 9 9 9 8 9"></polyline>
      </svg>
    `;

    return `
      <div class="download-card ${isCompleted ? 'completed' : ''}" id="dl-card-${dl.id}" ${isCompleted ? `onclick="handleDownloadCardClick('${dl.savePath.replace(/\\/g, '\\\\')}', '${dl.filename.replace(/'/g, "\\'")}')"` : ''}>
        <div class="download-card-icon">
          ${fileIconSvg}
        </div>
        
        <div class="download-card-info">
          <div class="download-card-filename" title="${dl.filename}">${dl.filename}</div>
          <div class="download-card-meta">
            <span>${statusText}</span>
            <span class="download-card-meta-dot"></span>
            <span>${startTimeFormatted}</span>
          </div>
          ${isDownloading ? `
            <div class="download-progress-bar-container">
              <div class="download-progress-bar" style="width: ${progressPercent}%"></div>
            </div>
          ` : ''}
        </div>

        <div class="download-card-actions">
          ${isDownloading ? `
            <button class="download-action-btn cancel-btn" onclick="cancelDownload('${dl.id}')">Cancel</button>
          ` : ''}
        </div>
      </div>
    `;
  }).join('');

  // Auto-refresh the floating downloads popover list whenever downloads update
  renderDownloadsPopover();
}

// Global window actions for inline onclicks
window.showItemFolder = (path) => {
  if (window.sebBrowser && window.sebBrowser.showItemInFolder) {
    window.sebBrowser.showItemInFolder(path);
  }
};

window.cancelDownload = (id) => {
  if (window.sebBrowser && window.sebBrowser.cancelDownload) {
    window.sebBrowser.cancelDownload(id);
  }
};

window.handleDownloadCardClick = (filePath, filename) => {
  if (!filePath) return;
  if (isExamSessionActive()) {
    showToast('Opening files is blocked during an active exam.', 'error');
    return;
  }
  const lowerPath = filePath.toLowerCase();
  if (lowerPath.endsWith('.pdf')) {
    let fileUrl = filePath.replace(/\\/g, '/');
    if (!fileUrl.startsWith('file:///')) {
      fileUrl = 'file:///' + fileUrl;
    }
    createTab(fileUrl, true, filename);
    showToast(`Opening PDF: ${filename}`, 'success');
  } else {
    showToast('Only PDF files can be opened in this browser.', 'error');
  }
};

// Debounced version of the raw save — collapses bursts of rapid URL / title changes
// into a single IPC write at most once every 300 ms.
const saveTabState = debounce(function _saveTabState() {
  const tabData = tabs.map(tab => ({
    url: tab.url,
    title: tab.title,
    canClose: tab.canClose,
    active: tab.id === activeTabId
  }));
  if (window.sebBrowser && window.sebBrowser.saveConfig) {
    window.sebBrowser.saveConfig({ openTabs: tabData }).catch(err => console.error('[Browser] Failed to save tabs state:', err));
  }
}, 300);

// ─── Floating Downloads Popover System ──────────────────────────────────────

const toolbarDownloadsBtn = document.getElementById('toolbar-downloads-btn');
const downloadsPopover = document.getElementById('downloads-popover');
const popoverCloseBtn = document.getElementById('popover-close-btn');
const popoverViewAllBtn = document.getElementById('popover-view-all-btn');

if (toolbarDownloadsBtn && downloadsPopover) {
  toolbarDownloadsBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    downloadsPopover.classList.toggle('hidden');
    if (!downloadsPopover.classList.contains('hidden')) {
      renderDownloadsPopover();
    }
  });
}

if (popoverCloseBtn && downloadsPopover) {
  popoverCloseBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    downloadsPopover.classList.add('hidden');
  });
}

if (popoverViewAllBtn) {
  popoverViewAllBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (downloadsPopover) downloadsPopover.classList.add('hidden');
    openDownloadsTab();
  });
}

// Close downloads popover on document click
document.addEventListener('click', (e) => {
  if (downloadsPopover && !downloadsPopover.contains(e.target) && e.target !== toolbarDownloadsBtn) {
    downloadsPopover.classList.add('hidden');
  }
});

function renderDownloadsPopover() {
  const popoverList = document.getElementById('popover-downloads-list');
  if (!popoverList) return;

  // Show top 3 most recent downloads
  const recent = localDownloads.slice(0, 3);
  if (recent.length === 0) {
    popoverList.innerHTML = '<div class="popover-downloads-empty">No recent downloads found</div>';
    return;
  }

  const formatBytes = (bytes) => {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
  };

  const timeAgo = (dateStr) => {
    const now = new Date();
    const diffMs = now - new Date(dateStr);
    const diffMins = Math.round(diffMs / 60000);
    if (diffMins < 1) return 'Just now';
    if (diffMins < 60) return `${diffMins} minutes ago`;
    const diffHrs = Math.round(diffMins / 60);
    if (diffHrs < 24) return `${diffHrs} hour${diffHrs > 1 ? 's' : ''} ago`;
    return new Date(dateStr).toLocaleDateString();
  };

  popoverList.innerHTML = recent.map(dl => {
    const sizeText = formatBytes(dl.totalBytes);
    const timeStr = timeAgo(dl.startTime);
    const isCompleted = dl.status === 'completed';
    return `
      <div class="popover-download-item ${isCompleted ? 'completed' : ''}" ${isCompleted ? `onclick="handleDownloadCardClick('${dl.savePath.replace(/\\/g, '\\\\')}', '${dl.filename.replace(/'/g, "\\'")}')"` : ''}>
        <div class="popover-download-icon">
          <svg viewBox="0 0 24 24" width="16" height="16" stroke="currentColor" stroke-width="2" fill="none"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline></svg>
        </div>
        <div class="popover-download-info">
          <div class="popover-download-name" title="${dl.filename}">${dl.filename}</div>
          <div class="popover-download-meta">${sizeText} • ${timeStr}</div>
        </div>
      </div>
    `;
  }).join('');
}


// ─── Browsing History Tab Controller ────────────────────────────────────────

let localHistory = [];

function initHistoryTab() {
  const searchInput = document.getElementById('history-search-input');
  if (searchInput) {
    searchInput.addEventListener('input', () => {
      renderHistoryList();
    });
  }

  const clearBtn = document.getElementById('history-clear-btn');
  const clearHistoryModal = document.getElementById('clear-history-modal');
  const clearHistoryCancelBtn = document.getElementById('clear-history-cancel-btn');
  const clearHistorySubmitBtn = document.getElementById('clear-history-submit-btn');

  if (clearBtn && clearHistoryModal && clearHistoryCancelBtn && clearHistorySubmitBtn) {
    clearBtn.addEventListener('click', () => {
      clearHistoryModal.classList.remove('hidden');
    });

    clearHistoryCancelBtn.addEventListener('click', () => {
      clearHistoryModal.classList.add('hidden');
    });

    clearHistorySubmitBtn.addEventListener('click', async () => {
      clearHistoryModal.classList.add('hidden');
      try {
        await window.sebBrowser.clearHistory();
        renderHistoryPage();
      } catch (err) {
        console.error('[Browser] Failed to clear history:', err);
      }
    });
  }
}

function openHistoryTab() {
  const existing = tabs.find(t => t.url === 'seb://history');
  if (existing) {
    switchTab(existing.id);
  } else {
    createTab('seb://history', true, 'History');
  }
}

async function renderHistoryPage() {
  try {
    localHistory = await window.sebBrowser.getHistory();
    renderHistoryList();
  } catch (err) {
    console.error('[Browser] Failed to load history:', err);
  }
}

function renderHistoryList() {
  const listContainer = document.getElementById('history-list');
  const emptyState = document.getElementById('history-empty-state');
  const searchInput = document.getElementById('history-search-input');
  if (!listContainer || !emptyState) return;

  const filterText = searchInput ? searchInput.value.toLowerCase().trim() : '';

  // Filter history items
  const filtered = localHistory.filter(item => {
    return (item.title && item.title.toLowerCase().includes(filterText)) ||
           (item.url && item.url.toLowerCase().includes(filterText));
  });

  if (filtered.length === 0) {
    listContainer.innerHTML = '';
    emptyState.classList.remove('hidden');
    return;
  }

  emptyState.classList.add('hidden');

  // Group by date header matching brave://history image
  const groups = {};
  filtered.forEach(item => {
    const dateStr = item.date;
    if (!groups[dateStr]) {
      groups[dateStr] = [];
    }
    groups[dateStr].push(item);
  });

  let html = '';
  for (const date in groups) {
    html += `
      <div class="history-date-group">
        <div class="history-date-header">${date}</div>
    `;

    html += groups[date].map(item => {
      let domain = '';
      try {
        domain = new URL(item.url).hostname;
      } catch {
        domain = item.url;
      }

      // Fetch high quality favicon from google autocomplete favicon service
      const googleFaviconUrl = `https://www.google.com/s2/favicons?sz=64&domain=${domain}`;

      return `
        <div class="history-item" id="history-item-${item.id}">
          <input type="checkbox" class="history-item-checkbox" data-id="${item.id}">
          <div class="history-item-time">${item.time}</div>
          <img class="history-item-favicon" src="${googleFaviconUrl}" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=%22http://www.w3.org/2000/svg%22 width=%2216%22 height=%2216%22 viewBox=%220 0 24 24%22 fill=%22none%22 stroke=%22%2394a3b8%22 stroke-width=%222%22><path d=%22M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z%22/></svg>'">
          <a class="history-item-title" href="#" onclick="event.preventDefault(); navigateToUrl('${item.url}')">${item.title}</a>
          <span class="history-item-domain">${domain}</span>
          <button class="history-item-delete-btn" onclick="deleteSingleHistoryItem('${item.id}')" title="Delete from history">
            <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z"/></svg>
          </button>
        </div>
      `;
    }).join('');

    html += `</div>`;
  }

  listContainer.innerHTML = html;
}

// Global helper functions
window.navigateToUrl = (url) => {
  navigateActiveTabTo(url);
};

window.deleteSingleHistoryItem = async (id) => {
  await window.sebBrowser.deleteHistoryItem(id);
  renderHistoryPage();
};

function handleToastProximity(x, y) {
  const toast = document.getElementById('ai-blocked-toast');
  if (!toast || toast.classList.contains('hidden') || !toast.classList.contains('show')) return;
  
  const rect = toast.getBoundingClientRect();
  if (rect.width === 0 || rect.height === 0) {
    toast.classList.remove('ghost-hover');
    return;
  }
  
  // Buffer padding of 15px around the toast card boundaries
  if (
    x >= rect.left - 15 &&
    x <= rect.right + 15 &&
    y >= rect.top - 15 &&
    y <= rect.bottom + 15
  ) {
    toast.classList.add('ghost-hover');
  } else {
    toast.classList.remove('ghost-hover');
  }
}

window.addEventListener('mousemove', (e) => {
  handleToastProximity(e.clientX, e.clientY);
});

// ─── Network Connectivity Monitor ───────────────────────────────────────────
window.addEventListener('online', () => {
  showToast('Network connection restored.', 'success');
});

window.addEventListener('offline', () => {
  showToast('Network connection lost. Please check your internet connection.', 'error');
});
