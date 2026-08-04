/* Service worker. Нужен ради двух вещей: без него телефон не предложит
   «встановити застосунок», и без него сайт в подвале без сети покажет
   пустой экран динозавра вместо кабинета.

   Три правила, нарушение любого ломает вход:

   1. Запросы к Supabase НЕ трогаем вообще. Там сидит авторизация,
      и отданный из кеша ответ означал бы чужую сессию или устаревшие
      остатки, показанные как свежие.
   2. POST и всё, что меняет данные, не кешируем никогда.
   3. Страницы — сначала сеть, кеш только как подстраховка. Обратный
      порядок означал бы, что мастер видит вчерашние остатки и не понимает,
      почему списание не сходится.
*/

const VERSION = 'v1'
const SHELL = `shell-${VERSION}`
const PAGES = `pages-${VERSION}`

// Кладём заранее только то, без чего офлайн-экран не нарисуется.
const PRECACHE = ['/offline', '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL).then((c) => c.addAll(PRECACHE)).then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)),
      ))
      .then(() => self.clients.claim()),
  )
})

// Позволяет странице попросить обновиться немедленно.
self.addEventListener('message', (event) => {
  if (event.data === 'skip-waiting') self.skipWaiting()
})

self.addEventListener('fetch', (event) => {
  const req = event.request
  if (req.method !== 'GET') return

  const url = new URL(req.url)

  // Чужие домены — мимо. В первую очередь Supabase: авторизация и данные.
  if (url.origin !== self.location.origin) return
  // Служебные пути Next и наши серверные роуты не кешируем.
  if (url.pathname.startsWith('/api/')) return
  if (url.pathname.startsWith('/auth/')) return

  // Сборочные файлы Next имеют хеш в имени и не меняются — берём из кеша.
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(cacheFirst(req, SHELL))
    return
  }
  // Иконки и манифест.
  if (/\.(png|svg|ico|webmanifest)$/.test(url.pathname)) {
    event.respondWith(cacheFirst(req, SHELL))
    return
  }

  // Навигация по страницам: сеть, потом кеш, потом честный офлайн-экран.
  if (req.mode === 'navigate') {
    event.respondWith(networkFirst(req))
  }
})

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(req)
  if (hit) return hit
  try {
    const res = await fetch(req)
    if (res.ok) cache.put(req, res.clone())
    return res
  } catch (e) {
    return new Response('', { status: 504, statusText: 'offline' })
  }
}

async function networkFirst(req) {
  const cache = await caches.open(PAGES)
  try {
    const res = await fetch(req)
    if (res.ok) cache.put(req, res.clone())
    return res
  } catch (e) {
    const hit = await cache.match(req)
    if (hit) return hit
    const fallback = await caches.match('/offline')
    if (fallback) return fallback
    return new Response('Немає мережі', {
      status: 503,
      headers: { 'Content-Type': 'text/plain; charset=utf-8' },
    })
  }
}
