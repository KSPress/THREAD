// THREAD service worker: offline app shell + notification taps.
// Built assets are content-hashed, so they are cached forever on first use;
// the HTML shell is network-first so new releases arrive when online.
const CACHE = 'thread-v2'
// Everything is relative to where THREAD is hosted (site root, /THREAD/ on GitHub Pages, …).
const BASE = new URL(self.registration.scope).pathname

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll([BASE, BASE + 'manifest.webmanifest', BASE + 'thread.svg'])))
  self.skipWaiting()
})

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()))
})

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)
  if (req.method !== 'GET' || url.origin !== location.origin) return
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone()
          caches.open(CACHE).then((c) => c.put(BASE, copy))
          return res
        })
        .catch(() => caches.match(BASE)),
    )
    return
  }
  if (/^(assets|excalidraw|pdfjs|icons)\//.test(url.pathname.slice(BASE.length))) {
    e.respondWith(
      caches.match(req).then(
        (hit) =>
          hit ||
          fetch(req).then((res) => {
            if (res.ok) {
              const copy = res.clone()
              caches.open(CACHE).then((c) => c.put(req, copy))
            }
            return res
          }),
      ),
    )
  }
})

self.addEventListener('notificationclick', (e) => {
  e.notification.close()
  const path = e.notification.data?.path
  const target = path ? `${BASE}#open=${encodeURIComponent(path)}` : BASE
  e.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          c.navigate?.(target)
          return c.focus()
        }
      }
      return self.clients.openWindow(target)
    }),
  )
})
