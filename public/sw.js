/* Stall'd service worker
 * - Precache the app shell
 * - Cache-first for hashed build assets
 * - Network-first (falling back to cache) for navigations and Supabase GET
 *   reads, so the last-loaded portal data works offline.
 */
const SHELL_CACHE = 'stalld-shell-v1'
const DATA_CACHE = 'stalld-data-v1'
const SHELL = ['/', '/index.html', '/manifest.json', '/icons/icon-192.png', '/icons/icon-512.png']

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(SHELL_CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()))
})

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => ![SHELL_CACHE, DATA_CACHE].includes(k)).map((k) => caches.delete(k)))
    ).then(() => self.clients.claim())
  )
})

const isSupabaseRead = (req, url) =>
  req.method === 'GET' &&
  /supabase\.(co|in)$/.test(url.hostname.split('.').slice(-2).join('.')) &&
  (url.pathname.startsWith('/rest/v1/') || url.pathname.startsWith('/auth/v1/user'))

self.addEventListener('fetch', (e) => {
  const req = e.request
  const url = new URL(req.url)

  // App shell for navigations: network first, offline → cached shell.
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then((res) => {
          caches.open(SHELL_CACHE).then((c) => c.put('/index.html', res.clone()))
          return res
        })
        .catch(() => caches.match('/index.html'))
    )
    return
  }

  // Hashed assets + icons: cache first.
  if (url.origin === self.location.origin &&
      (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/icons/') || url.pathname === '/manifest.json')) {
    e.respondWith(
      caches.match(req).then((hit) => hit ||
        fetch(req).then((res) => {
          const copy = res.clone()
          caches.open(SHELL_CACHE).then((c) => c.put(req, copy))
          return res
        }))
    )
    return
  }

  // Supabase reads (RPC stall_board is POST — not cached; REST GETs are):
  // network first so data is fresh, cache fallback so the last-loaded
  // portal data still renders offline.
  if (isSupabaseRead(req, url)) {
    e.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const copy = res.clone()
            caches.open(DATA_CACHE).then((c) => c.put(req, copy))
          }
          return res
        })
        .catch(() => caches.match(req).then((hit) => hit ||
          new Response(JSON.stringify({ offline: true }), {
            status: 503, headers: { 'Content-Type': 'application/json' }
          })))
    )
  }
})
