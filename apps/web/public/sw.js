/*
 * Job4me service worker (plan, section 10), written by hand:
 * - an offline page when the server cannot be reached;
 * - hashed build files kept in cache (they never change under the same name);
 * - push notifications and their click.
 * API answers are never cached: they hold personal data.
 */
const VERSION = 'v1';
const SHELL_CACHE = `job4me-shell-${VERSION}`;
const ASSET_CACHE = `job4me-assets-${VERSION}`;
const OFFLINE_URL = '/offline.html';
const SHELL_FILES = [OFFLINE_URL, '/offline.css', '/icons/icon-192.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_FILES))
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter(
              (key) => key.startsWith('job4me-') && key !== SHELL_CACHE && key !== ASSET_CACHE,
            )
            .map((key) => caches.delete(key)),
        ),
      )
      .then(() => self.clients.claim()),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate') {
    event.respondWith(fetch(request).catch(() => caches.match(OFFLINE_URL)));
    return;
  }

  if (url.pathname.startsWith('/assets/')) {
    event.respondWith(
      caches.open(ASSET_CACHE).then(async (cache) => {
        const cached = await cache.match(request);
        if (cached) return cached;
        const response = await fetch(request);
        if (response.ok) await cache.put(request, response.clone());
        return response;
      }),
    );
  }
});

self.addEventListener('push', (event) => {
  let message = { title: 'Job4me', body: '', url: '/' };
  try {
    message = { ...message, ...event.data.json() };
  } catch {
    // A push without a JSON payload still shows a notification.
  }
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      icon: '/icons/icon-192.png',
      lang: 'fr',
      data: { url: message.url },
    }),
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url ?? '/', self.location.origin);
  if (target.origin !== self.location.origin) return;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      for (const client of windows) {
        if (new URL(client.url).origin === self.location.origin) {
          return client.focus().then((focused) => focused.navigate(target.href));
        }
      }
      return self.clients.openWindow(target.href);
    }),
  );
});
