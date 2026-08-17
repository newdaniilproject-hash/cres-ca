import { timingSafeEqual } from 'node:crypto'
import { SITE_URL } from '@/lib/site'

// Кто имеет право звать `/api/cron/*`. Шаг 6, пункт третий.
//
// ── Откуда эти запросы приходят на самом деле ──────────────────────────────
//
// НЕ из Vercel Cron. Расписание живёт внутри Supabase: `pg_cron` раз
// в 5 минут дёргает `net.http_get` (0018, секрет переехал в Vault в 0032),
// то есть запрос выходит из базы через `pg_net`. Проверено на живой базе
// 17.08.2026 запросом на эхо-адрес — вызывающий шлёт ровно это:
//
//   user-agent: pg_net/0.20.4
//   accept: */*
//   accept-encoding: gzip, br
//   authorization: Bearer <cron_secret из Vault>
//
// И НЕ шлёт ничего браузерного: ни `cookie`, ни `origin`, ни `referer`,
// ни `sec-fetch-*`. Проект стоит в eu-west-1, выход у него был 46.137.81.1
// (NAT AWS Ирландии) — на адрес не опираемся, он у AWS меняется без
// предупреждения и запрет по нему сломал бы настоящий вызов молча.
//
// ── Что проверяется дополнительно к секрету ────────────────────────────────
//
// Секрет остаётся единственной НАСТОЯЩЕЙ проверкой: всё ниже — сужение
// поверхности, а не замена ему. Каждый пункт сверен с наблюдением выше,
// то есть настоящий вызов проходит их все.
//
//  1. Секрет сравнивается за постоянное время и обязан быть длинным.
//     Короткий секрет — это конфигурационная ошибка, а не «слабая защита»:
//     подобрать его по 401-ответам дешевле, чем кажется.
//  2. `user-agent` начинается с `pg_net/`. Это не аутентификация — строку
//     подделает кто угодно, — но она отсекает сканеры и случайные обходы,
//     которые ходят по `/api/*` пачками.
//  3. Запрос не браузерный. Смысл не в CSRF (без заголовка Authorization
//     сюда всё равно не попасть), а в том, что секрет, случайно попавший
//     в ссылку или в историю браузера, отсюда не сработает.
//  4. Хост — канонический домен сайта. Служебные адреса сборок Vercel
//     (`*.vercel.app`) публичны и живут вечно; без этой проверки крон
//     дёргается через любую старую сборку с тем же секретом.
//  5. Страна выхода — ТОЛЬКО если её назвали явно переменной
//     `CRON_ALLOWED_COUNTRY`. По умолчанию проверка выключена, и это
//     осознанно: перед сайтом стоит Cloudflare, поэтому `x-vercel-ip-*`
//     показывает страну узла Cloudflare, а не звонящего, и правду говорит
//     только `cf-ipcountry`. Включать её можно лишь после того, как
//     значение увидели в журнале живого вызова, — иначе проверка
//     источника сама и станет тем, что сломало уведомления.
//
// Отладка руками после этой правки требует подписаться тем же именем:
//   curl -H 'Authorization: Bearer …' -A 'pg_net/0.20.4' https://cres-ca.com/api/cron/notifications

/** Меньше — это не секрет, а пароль от вайфая. 48 hex-знаков в 0032. */
const MIN_SECRET_LEN = 24

const UA_PREFIX = process.env.CRON_CALLER_UA ?? 'pg_net/'

const BROWSER_HEADERS = ['cookie', 'origin', 'referer', 'sec-fetch-mode', 'sec-fetch-site']

/** Канонический домен и его www-двойник; localhost — для `next dev`. */
const ALLOWED_HOSTS = (() => {
  const canonical = new URL(SITE_URL).hostname.toLowerCase()
  const bare = canonical.replace(/^www\./, '')
  return new Set([canonical, bare, `www.${bare}`, 'localhost', '127.0.0.1'])
})()

function safeEqual(a: string, b: string): boolean {
  const x = Buffer.from(a)
  const y = Buffer.from(b)
  // Буферы разной длины timingSafeEqual не принимает вовсе, а сама длина
  // секретом не является — сравниваем её обычным способом.
  return x.length === y.length && timingSafeEqual(x, y)
}

/**
 * `null` — запрос принят. Иначе строка с причиной ДЛЯ ЖУРНАЛА.
 *
 * Наружу причина не уходит никогда: тело ответа читает кто угодно,
 * а «секрет верный, но хост не тот» — это подсказка. То же соображение,
 * что в `app/api/health/route.ts`: код ответа наружу, подробность в журнал.
 */
export function cronDenial(req: Request): string | null {
  const secret = process.env.CRON_SECRET
  if (!secret || secret.length < MIN_SECRET_LEN) return 'CRON_SECRET відсутній або закороткий'

  if (!safeEqual(req.headers.get('authorization') ?? '', `Bearer ${secret}`)) {
    return 'секрет не збігається'
  }

  const ua = req.headers.get('user-agent') ?? ''
  if (!ua.startsWith(UA_PREFIX)) return `чужий user-agent: ${ua.slice(0, 60) || '—'}`

  for (const h of BROWSER_HEADERS) {
    if (req.headers.get(h)) return `запит із браузера (${h})`
  }

  // Смотрим оба заголовка и требуем совпадения ХОТЯ БЫ одного. Перед
  // Vercel стоит Cloudflare, то есть цепочка прокси длиннее обычной,
  // и жёсткое «только x-forwarded-host» сломало бы настоящий вызов
  // молча в тот день, когда цепочка поменяется. На служебном адресе
  // сборки оба заголовка одинаковы, поэтому смысл проверки сохраняется.
  const hosts = [req.headers.get('x-forwarded-host'), req.headers.get('host')]
    .filter((h): h is string => Boolean(h))
    .map((h) => h.toLowerCase().split(':')[0])
  if (hosts.length > 0 && !hosts.some((h) => ALLOWED_HOSTS.has(h))) {
    return `чужий хост: ${hosts.join(', ')}`
  }

  const pin = process.env.CRON_ALLOWED_COUNTRY
  if (pin) {
    const country = (req.headers.get('cf-ipcountry')
      ?? req.headers.get('x-vercel-ip-country') ?? '').toUpperCase()
    if (country !== pin.toUpperCase()) return `чужа країна: ${country || '—'}`
  }

  return null
}
