/**
 * sw.js — SecureExam PWA Service Worker
 * Caches the kiosk shell so it loads instantly even on slow school WiFi,
 * and satisfies the PWA installability requirement on Android Chrome.
 */

const CACHE_NAME = 'secureexam-v1';
const SHELL_FILES = [
  './',
  './index.html',
  './style.css',
  './kiosk.js',
  './manifest.json',
  './icon-512.png',
];

// Install: cache the app shell
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(SHELL_FILES))
  );
  self.skipWaiting();
});

// Activate: clean up old caches
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

// Fetch: serve shell from cache, exam content from network
self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  // Only cache-first for same-origin shell files
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(event.request).then((cached) => cached || fetch(event.request))
    );
  }
  // All exam content (cross-origin) goes straight to network
});
