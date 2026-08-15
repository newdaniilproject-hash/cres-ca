/* Service worker. Нужен ради двух вещей: без него телефон не предложит
   «встановити застосунок», и без него сайт в подвале без сети покажет
   пустой экран вместо кабинета.

   Три правила, нарушение любого ломает вход:

   1. Запросы к Supabase НЕ трогаем вообще. Там сидит авторизация,
      и отданный из кеша ответ означал бы чужую сессию или устаревшие
      остатки, показанные как свежие.
   2. POST и всё, что меняет данные, не кешируем никогда.
   3. Страницы — сначала сеть, кеш только как подстраховка. Обратный
      порядок означал бы, что мастер видит вчерашние остатки и не понимает,
      почему списание не сходится.

   ── Разбор отказа 15.08.2026: «выключил интернет — чёрный экран» ──

   Владелец выключил сеть, открыл приложение и увидел чёрный экран вместо
   экрана «немає мережі». Три причины, каждая достаточна сама по себе,
   и все три здесь закрыты.

   A. ЗАПАСНЫМ ЭКРАНОМ БЫЛА СТРАНИЦА NEXT `/offline`, А НЕ ФАЙЛ.
      Её HTML ссылается на `/_next/static/...` с ХЕШЕМ сборки в имени.
      Положили в кеш при первой установке — а через сборку хеши сменились.
      Офлайн отдаём тот старый HTML, он просит скрипты и стили, которых
      нет ни в сети, ни в кеше, и браузер рисует ровно ничего. Чёрный
      экран — это и есть «ничего» на тёмной теме.

      Теперь запасной экран — `/offline.html`: один файл, стили и скрипт
      внутри, ни одной внешней ссылки. Он не может «протухнуть», потому
      что ему не на что ссылаться. Тот же файл уже служит запасным
      экраном нативной оболочке — второй копии смысла не заводим.

   Б. `cache.addAll` — ВСЁ ИЛИ НИЧЕГО.
      Один недоступный адрес из списка — и Promise отклоняется, установка
      падает, service worker НЕ активируется вовсе. То есть одна опечатка
      в списке означает полное отсутствие офлайна, и молча: ошибка
      установки в интерфейсе не видна. Теперь каждый адрес кладётся
      отдельно, и отсутствие одного не уносит остальные.

   В. VERSION НЕ МЕНЯЛСЯ, И КЕШ НЕ ЧИСТИЛСЯ НИКОГДА.
      `activate` удаляет кеши, чьё имя не заканчивается на VERSION.
      Пока VERSION остаётся 'v1', удалять нечего — старое живёт вечно.
      Это и позволило пункту А накопиться. VERSION обязан расти при
      КАЖДОЙ правке этого файла; это не формальность, а единственный
      способ выбросить протухшее.
*/

const VERSION = 'v2'
const SHELL = `shell-${VERSION}`
const PAGES = `pages-${VERSION}`

// Запасной экран — первым и отдельной строкой: без него офлайн не имеет
// смысла, а всё остальное в списке — необязательная приятность.
const OFFLINE_URL = '/offline.html'
const PRECACHE = [OFFLINE_URL, '/manifest.webmanifest', '/icon-192.png', '/icon-512.png']

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(SHELL)

    // Поимённо и по одному. `addAll` уронил бы установку целиком из-за
    // одного адреса — см. пункт Б в шапке.
    await Promise.allSettled(PRECACHE.map((url) => cache.add(url)))

    // Запасной экран проверяем отдельно: если не лёг именно он, офлайна
    // нет вовсе, и это стоит увидеть в консоли, а не гадать.
    if (!(await cache.match(OFFLINE_URL))) {
      console.error(`[sw] ${OFFLINE_URL} не потрапив у кеш — офлайн-екран не покажеться`)
    }

    await self.skipWaiting()
  })())
})

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys()
    await Promise.all(
      keys.filter((k) => !k.endsWith(VERSION)).map((k) => caches.delete(k)),
    )
    await self.clients.claim()
  })())
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

// Класть в кеш можно не всякий ответ. `cache.put` БРОСАЕТ на ответе после
// перенаправления и на частичном (206) — а `/app` без сессии как раз
// перенаправляет на `/login`. Отклонение здесь никто не ловил, и оно
// оставалось необработанным на каждом переходе.
function cacheable(res) {
  return res && res.ok && !res.redirected && res.status === 200
}

async function cacheFirst(req, cacheName) {
  const cache = await caches.open(cacheName)
  const hit = await cache.match(req)
  if (hit) return hit
  try {
    const res = await fetch(req)
    if (cacheable(res)) cache.put(req, res.clone())
    return res
  } catch {
    return new Response('', { status: 504, statusText: 'offline' })
  }
}

async function networkFirst(req) {
  const cache = await caches.open(PAGES)
  try {
    const res = await fetch(req)
    if (cacheable(res)) cache.put(req, res.clone())
    return res
  } catch {
    const hit = await cache.match(req)
    if (hit) return hit

    // Запасной экран ищем по всем кешам и без учёта строки запроса:
    // иначе `/offline.html?x=1` не найдёт `/offline.html`.
    const fallback = await caches.match(OFFLINE_URL, { ignoreSearch: true })
    if (fallback) return fallback

    // Досюда доходим, только если не легло вообще ничего. Текстом,
    // потому что любая разметка здесь снова зависела бы от файлов.
    return new Response(
      'Немає мережі. Перевірте звʼязок і спробуйте ще раз.',
      { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    )
  }
}
