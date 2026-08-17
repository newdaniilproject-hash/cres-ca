// Чей это запрос: определение адреса за Cloudflare и за Vercel.
//
// ── Почему это отдельный файл и почему он самый важный ─────────────────────
//
// Ограничитель считает обращения «с одного адреса». Возьмём не тот заголовок
// — получим одно из двух, и оба хуже отсутствия ограничителя:
//
//   • взяли адрес ПОДКЛЮЧЕНИЯ, а перед нами Cloudflare → все посетители
//     страны приходят с двух десятков адресов CDN, счётчик у них общий,
//     и предел 300/хв закрывает витрину для всех разом;
//   • взяли `cf-connecting-ip` НА ВЕРУ → любой, кто стучится к Vercel мимо
//     Cloudflare, пишет туда что угодно, меняет значение на каждом запросе
//     и не ограничен вовсе.
//
// ── Что проверено на бою (17.08.2026) ──────────────────────────────────────
//
//   1. `cres-ca.com` и `www.cres-ca.com` резолвятся в `2606:4700:3037::…`
//      и `2606:4700:3035::…` — это сеть `2606:4700::/32` из публичного
//      списка Cloudflare. Значит боевой домен ПРОКСИРУЕТСЯ Cloudflare,
//      и до Vercel доходит адрес узла Cloudflare, а не человека.
//   2. `https://marketplace-alpha-seven-98.vercel.app/api/health` отвечает
//      200 напрямую: `server: Vercel`, `x-vercel-id: iad1`, никакого
//      Cloudflare в ответе нет. То есть origin доступен в обход, и это
//      не гипотетическая «утечка адреса» из плана — домен вида
//      `<проект>-<команда>.vercel.app` перебирается, а не утекает.
//      Ровно поэтому ограничитель дублируется в приложении.
//
// ── Решение ────────────────────────────────────────────────────────────────
//
// Заголовку клиента верим ТОЛЬКО тогда, когда его прислал тот, кому можно:
// смотрим, с какого адреса запрос реально пришёл в Vercel, и если этот адрес
// принадлежит Cloudflare — берём `cf-connecting-ip` (Cloudflare затирает
// его своим значением, подделать через него нельзя). Если адрес НЕ
// Cloudflare — значит с нами говорят напрямую, и все заголовки клиента
// игнорируются целиком, считаем по адресу подключения.
//
// Это же правило автоматически закрывает превью-развёртывания: они живут
// на `*.vercel.app` без Cloudflare, и там всегда работает вторая ветка.

/** Минимум, который умеют и `NextRequest.headers`, и `next/headers`. */
export type HeaderBag = { get(name: string): string | null | undefined }

// ── Список сетей Cloudflare ────────────────────────────────────────────────
//
// Источник — https://api.cloudflare.com/client/v4/ips (снят 17.08.2026).
// Список меняется редко и объявляется заранее; проверять его — часть
// того же обслуживания, что и обновление правил на самом Cloudflare.
// Держать его файлом, а не ходить за ним по сети: запрос за списком на
// пути пользовательского запроса — это ровно та задержка, ради избавления
// от которой счётчики не живут в базе (см. `store.ts`).
const CLOUDFLARE = [
  '173.245.48.0/20', '103.21.244.0/22', '103.22.200.0/22', '103.31.4.0/22',
  '141.101.64.0/18', '108.162.192.0/18', '190.93.240.0/20', '188.114.96.0/20',
  '197.234.240.0/22', '198.41.128.0/17', '162.158.0.0/15', '104.16.0.0/13',
  '104.24.0.0/14', '172.64.0.0/13', '131.0.72.0/22',
  '2400:cb00::/32', '2606:4700::/32', '2803:f800::/32', '2405:b500::/32',
  '2405:8100::/32', '2a06:98c0::/29', '2c0f:f248::/32',
]

type Addr = { value: bigint; v6: boolean }
type Net = { value: bigint; prefix: number; v6: boolean }

function parseV4(s: string): bigint | null {
  const parts = s.split('.')
  if (parts.length !== 4) return null
  let out = 0n
  for (const p of parts) {
    if (!/^\d{1,3}$/.test(p)) return null
    const n = Number(p)
    if (n > 255) return null
    out = (out << 8n) | BigInt(n)
  }
  return out
}

/**
 * Разбор адреса. Понимает IPv4, IPv6 со сжатием `::` и запись
 * `::ffff:1.2.3.4`, которую отдают некоторые прокси для адресов IPv4.
 */
export function parseAddr(raw: string): Addr | null {
  let s = raw.trim()

  // Скобочная запись с портом: `[2001:db8::1]:443`.
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(s)
  if (bracketed) s = bracketed[1]

  // Зона интерфейса (`fe80::1%eth0`) к адресу не относится.
  s = s.split('%')[0]
  if (s === '') return null

  // `1.2.3.4:5678` — IPv4 с портом. Признак: двоеточие ровно одно и до
  // него стоят точки. В IPv6 двоеточий всегда не меньше двух.
  const colon = s.indexOf(':')
  if (colon > 0 && s.indexOf(':', colon + 1) === -1 && s.slice(0, colon).includes('.')) {
    s = s.slice(0, colon)
  }

  if (!s.includes(':')) {
    const v4 = parseV4(s)
    return v4 === null ? null : { value: v4, v6: false }
  }

  // Хвост в точечной записи: `::ffff:1.2.3.4`.
  let tail: bigint | null = null
  const lastColon = s.lastIndexOf(':')
  const after = s.slice(lastColon + 1)
  if (after.includes('.')) {
    tail = parseV4(after)
    if (tail === null) return null
    s = s.slice(0, lastColon + 1) + '0:0'
  }

  const halves = s.split('::')
  if (halves.length > 2) return null
  const head = halves[0] === '' ? [] : halves[0].split(':')
  const rear = halves.length === 2 ? (halves[1] === '' ? [] : halves[1].split(':')) : []
  const groups = halves.length === 2 ? 8 - head.length - rear.length : 0
  if (groups < 0 || (halves.length === 1 && head.length !== 8)) return null

  const all = [...head, ...Array<string>(groups).fill('0'), ...rear]
  if (all.length !== 8) return null

  let value = 0n
  for (const g of all) {
    if (!/^[0-9a-fA-F]{1,4}$/.test(g)) return null
    value = (value << 16n) | BigInt(parseInt(g, 16))
  }
  if (tail !== null) value = ((value >> 32n) << 32n) | tail

  // `::ffff:x.x.x.x` — это адрес IPv4, записанный по-другому (сеть
  // `::ffff:0:0/96`). Приводим к одному виду, иначе один и тот же человек
  // получит два счётчика — по одному на запись.
  if ((value >> 32n) === 0xffffn) return { value: value & 0xffffffffn, v6: false }

  return { value, v6: true }
}

const NETS: Net[] = CLOUDFLARE.map((cidr) => {
  const [ip, bits] = cidr.split('/')
  const a = parseAddr(ip)
  // Список константный и разбирается на старте: неразобранная строка —
  // это опечатка в файле, и молча пропустить её значит тихо снять доверие
  // к Cloudflare для целой сети.
  if (!a) throw new Error(`ratelimit: неразбираемая сеть Cloudflare ${cidr}`)
  return { value: a.value, prefix: Number(bits), v6: a.v6 }
})

function inNet(a: Addr, n: Net): boolean {
  if (a.v6 !== n.v6) return false
  const width = n.v6 ? 128 : 32
  const shift = BigInt(width - n.prefix)
  return (a.value >> shift) === (n.value >> shift)
}

/** Пришёл ли запрос через узел Cloudflare. */
export function fromCloudflare(a: Addr): boolean {
  return NETS.some((n) => inNet(a, n))
}

/** Последнее значение списка `a, b, c` — то, что дописал ближайший прокси. */
function last(v: string | null | undefined): string | null {
  if (!v) return null
  const parts = v.split(',').map((s) => s.trim()).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : null
}

/**
 * Адрес, с которого запрос пришёл В VERCEL.
 *
 * Порядок источников: `x-vercel-forwarded-for` → `x-real-ip` →
 * `x-forwarded-for`. Первый выбран головным намеренно: заголовки `x-vercel-*`
 * платформа СРЕЗАЕТ у входящего запроса и ставит свои, то есть подделать
 * его снаружи нельзя. Из списка берётся ПОСЛЕДНЕЕ значение: что бы клиент
 * ни прислал в `x-forwarded-for`, свою запись прокси дописывает в конец,
 * и последняя запись — единственная, за которую отвечает не клиент.
 */
function edgeAddr(h: HeaderBag): Addr | null {
  const raw = last(h.get('x-vercel-forwarded-for'))
    ?? h.get('x-real-ip')?.trim()
    ?? last(h.get('x-forwarded-for'))
  return raw ? parseAddr(raw) : null
}

export type Client = {
  /** Ключ счётчика. Не адрес: IPv6 сворачивается до сети (см. ниже). */
  key: string
  /** Откуда взят адрес — попадает в предупреждение при отказе. */
  via: 'cloudflare' | 'edge'
}

/**
 * Кого считаем. `null` означает «адрес не определён» — и это ПРОПУСК,
 * а не отказ: складывать всех неопознанных в один счётчик значит выдать
 * им общий предел и закрыть сайт при первой же ошибке платформы.
 * `null` штатно бывает при локальной разработке, где заголовков нет вовсе.
 */
export function client(h: HeaderBag): Client | null {
  const edge = edgeAddr(h)
  if (!edge) return null

  if (fromCloudflare(edge)) {
    const claimed = h.get('cf-connecting-ip')
    const a = claimed ? parseAddr(claimed) : null
    if (a) return { key: bucket(a), via: 'cloudflare' }
    // Пришли через Cloudflare, а адреса человека нет: считаем по узлу CDN.
    // Счётчик получится общим — но это заведомо реже, чем ошибка «не
    // ограничили никого», и видно в предупреждении при отказе.
    return { key: bucket(edge), via: 'edge' }
  }

  // Диагностика открытого вопроса, который нельзя закрыть иначе как на бою.
  //
  // Порядок заголовков выше опирается на то, что платформа СРЕЗАЕТ входящие
  // `x-vercel-*` и ставит свои. Если это когда-нибудь окажется не так, мы
  // возьмём за адрес подключения то, что прислал клиент, и весь разбор
  // рассыплется молча. Признак ровно один и он проверяется здесь: пришёл
  // `cf-connecting-ip`, а адрес подключения при этом НЕ из сетей Cloudflare.
  // Так бывает в двух случаях, и оба надо увидеть:
  //   • кто-то стучится к origin напрямую и подделывает заголовок (значит
  //     ограничитель работает правильно — мы его игнорируем);
  //   • заголовки читаются не те (значит чинить надо этот файл).
  // Пишем один раз на экземпляр: это признак настройки, а не событие.
  if (h.get('cf-connecting-ip') && !warnedFake) {
    warnedFake = true
    console.warn(
      '[ratelimit] cf-connecting-ip пришёл, а адрес подключения не из сетей'
      + ' Cloudflare — заголовок проигнорирован. Если это боевой домен,'
      + ' а не *.vercel.app, значит порядок заголовков в address.ts неверен.',
    )
  }

  return { key: bucket(edge), via: 'edge' }
}

let warnedFake = false

/**
 * Ключ счётчика из адреса.
 *
 * IPv4 — сам адрес. IPv6 — СЕТЬ /64, а не адрес: провайдер выдаёт человеку
 * не один адрес, а блок от /64 до /48, и внутри своего блока он меняет
 * адрес на каждом запросе бесплатно. Счёт по /128 в IPv6 — это отсутствие
 * счёта. То же делает и Cloudflare на своей стороне.
 */
function bucket(a: Addr): string {
  if (!a.v6) return `4:${a.value.toString(16)}`
  return `6:${(a.value >> 64n).toString(16)}`
}
