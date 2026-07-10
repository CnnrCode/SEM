// pdfviewer.js — Secure PDF rendering logic using PDF.js

'use strict';

// Initialize PDF.js
const pdfjsLib = window['pdfjs-dist/build/pdf'];
pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.4.120/pdf.worker.min.js';

let pdfDoc = null;
let pageNum = 1;
let pageRendering = false;
let pageNumPending = null;
let scale = 1.25; // Default zoom level
const canvas = document.getElementById('pdf-canvas');
const ctx = canvas.getContext('2d');

const prevBtn = document.getElementById('prev-btn');
const nextBtn = document.getElementById('next-btn');
const zoomInBtn = document.getElementById('zoom-in-btn');
const zoomOutBtn = document.getElementById('zoom-out-btn');
const zoomResetBtn = document.getElementById('zoom-reset-btn');
const closeBtn = document.getElementById('close-btn');

const pageNumSpan = document.getElementById('page-num');
const pageCountSpan = document.getElementById('page-count');
const zoomValueSpan = document.getElementById('zoom-value');
const documentTitleSpan = document.getElementById('document-title');
const spinner = document.getElementById('loading-spinner');
const errorContainer = document.getElementById('error-message');

// Get query parameters
const urlParams = new URLSearchParams(window.location.search);
const fileUrl = urlParams.get('file');
const fileTitle = urlParams.get('title') || 'PDF Document';

// Sync Dyslexia Font preference from localStorage
const syncDyslexiaFont = () => {
  const isDyslexia = localStorage.getItem('dyslexia-font') === 'true';
  if (isDyslexia) {
    document.body.classList.add('dyslexia-font');
  } else {
    document.body.classList.remove('dyslexia-font');
  }
};

// Monitor theme/accessibility settings
window.addEventListener('DOMContentLoaded', () => {
  syncDyslexiaFont();
  // Listen for storage changes from the main window
  window.addEventListener('storage', (e) => {
    if (e.key === 'dyslexia-font') {
      syncDyslexiaFont();
    }
  });

  if (fileUrl) {
    documentTitleSpan.textContent = fileTitle;
    loadDocument(fileUrl);
  } else {
    showError();
  }
});

// Load the PDF document
function loadDocument(url) {
  spinner.classList.remove('hidden');
  errorContainer.classList.add('hidden');

  pdfjsLib.getDocument(url).promise.then((pdf) => {
    pdfDoc = pdf;
    pageCountSpan.textContent = pdf.numPages;
    
    // Update button states
    updateToolbarButtons();

    // Render the initial page
    pageNum = 1;
    renderPage(pageNum);
  }).catch((err) => {
    console.error('[PDFViewer] Error loading document:', err);
    showError();
  });
}

// Render the specified page onto the canvas
function renderPage(num) {
  pageRendering = true;
  spinner.classList.remove('hidden');

  pdfDoc.getPage(num).then((page) => {
    const viewport = page.getViewport({ scale: scale });
    
    // Adapt to retina displays
    const outputScale = window.devicePixelRatio || 1;
    canvas.width = Math.floor(viewport.width * outputScale);
    canvas.height = Math.floor(viewport.height * outputScale);
    canvas.style.width = Math.floor(viewport.width) + "px";
    canvas.style.height = Math.floor(viewport.height) + "px";

    const transform = outputScale !== 1 
      ? [outputScale, 0, 0, outputScale, 0, 0] 
      : null;

    const renderContext = {
      canvasContext: ctx,
      transform: transform,
      viewport: viewport
    };

    const renderTask = page.render(renderContext);

    renderTask.promise.then(() => {
      pageRendering = false;
      spinner.classList.add('hidden');

      if (pageNumPending !== null) {
        renderPage(pageNumPending);
        pageNumPending = null;
      }
    });
  }).catch((err) => {
    console.error('[PDFViewer] Error rendering page:', err);
    spinner.classList.add('hidden');
  });

  // Update page counter
  pageNumSpan.textContent = num;
  updateToolbarButtons();
}

// Queue page rendering if one is in progress
function queueRenderPage(num) {
  if (pageRendering) {
    pageNumPending = num;
  } else {
    renderPage(num);
  }
}

// Update state of buttons based on current page
function updateToolbarButtons() {
  if (!pdfDoc) return;
  prevBtn.disabled = (pageNum <= 1);
  nextBtn.disabled = (pageNum >= pdfDoc.numPages);
  zoomValueSpan.textContent = `${Math.round(scale * 100)}%`;
}

// Show error screen
function showError() {
  spinner.classList.add('hidden');
  errorContainer.classList.remove('hidden');
}

// Navigation Actions
prevBtn.addEventListener('click', () => {
  if (pageNum <= 1) return;
  pageNum--;
  queueRenderPage(pageNum);
});

nextBtn.addEventListener('click', () => {
  if (!pdfDoc || pageNum >= pdfDoc.numPages) return;
  pageNum++;
  queueRenderPage(pageNum);
});

// Zoom Actions
zoomInBtn.addEventListener('click', () => {
  if (scale >= 4.0) return;
  scale += 0.25;
  if (pdfDoc) queueRenderPage(pageNum);
});

zoomOutBtn.addEventListener('click', () => {
  if (scale <= 0.5) return;
  scale -= 0.25;
  if (pdfDoc) queueRenderPage(pageNum);
});

zoomResetBtn.addEventListener('click', () => {
  scale = 1.25;
  if (pdfDoc) queueRenderPage(pageNum);
});

// Close Action: sends close request back or navigates back in browser history
closeBtn.addEventListener('click', () => {
  // If embedded in a tab, we close the tab using custom action
  // In our case, the parent tab has a canClose button, but we can also use browser navigation back
  window.close();
});
