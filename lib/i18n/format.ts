import type { Lang } from './dict'

// Даты, числа, деньги и числительные. Файл без React и без Next: его читают
// и серверные компоненты, и клиентские, и (по смыслу, не по коду) будущий
// Flutter — там ровно те же три правила.

/**
 * Язык интерфейса → тег локали для Intl.
 *
 * Регион у всех трёх — UA намеренно: заклад работает в Украине, и человек,
 * читающий интерфейс по-русски или по-английски, всё равно видит гривну
 * и дату «31.12.2026», а не «12/31/2026». Меняется язык подписи месяца,
 * а не денежная система вокруг.
 */
const LOCALE: Record<Lang, string> = {
  uk: 'uk-UA',
  ru: 'ru-UA',
  en: 'en-UA',
}

export const localeOf = (lang: Lang): string => LOCALE[lang]

/** Валюта заклада. Пока одна; когда появится вторая — придёт параметром. */
const DEFAULT_CURRENCY = 'UAH'

// ── Числительные ────────────────────────────────────────────────────────────
//
// Выбор формы по остатку, без внешней библиотеки — тот же приём, что уже
// стоит в `lib/email/templates.ts` и в `components/offline.tsx`. Правило
// короче, чем подключение зависимости, и одинаково для украинского
// и русского. Проверка `n > 1` вместо этого даёт «5 сеанси».
//
// Intl.PluralRules здесь НЕ используется намеренно: он вернул бы те же
// категории, но потянул бы за собой второе место, где живёт правило языка,
// — а в письмах и в офлайн-панели правило уже написано руками, и разъехаться
// эти два места обязаны на первой же правке.
export type PluralForm = 'one' | 'few' | 'many'

export function pluralForm(lang: Lang, n: number): PluralForm {
  // Английский: единственное против множественного, третьей формы нет.
  if (lang === 'en') return Math.abs(n) === 1 ? 'one' : 'many'

  const abs = Math.abs(n)
  const m10 = abs % 10
  const m100 = abs % 100
  if (m10 === 1 && m100 !== 11) return 'one'
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'few'
  return 'many'
}

// ── Даты ────────────────────────────────────────────────────────────────────
//
// Пустое значение отдаёт длинное тире, а не пустоту: в строке «доступ до —»
// прочерк говорит «не задано», а дыра читается как поломка вёрстки.
const EMPTY = '—'

type DateInput = string | number | Date | null | undefined

function toDate(v: DateInput): Date | null {
  if (v === null || v === undefined || v === '') return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d
}

/** Дата: 31.12.2026. Через локаль, а не ручной сборкой из частей. */
export function formatDate(
  lang: Lang, v: DateInput, opts: Intl.DateTimeFormatOptions = {
    day: '2-digit', month: '2-digit', year: 'numeric',
  },
): string {
  const d = toDate(v)
  return d ? d.toLocaleDateString(LOCALE[lang], opts) : EMPTY
}

/** Дата и время: 31.12.2026, 14:05. */
export function formatDateTime(
  lang: Lang, v: DateInput, opts: Intl.DateTimeFormatOptions = {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  },
): string {
  const d = toDate(v)
  return d ? d.toLocaleString(LOCALE[lang], opts) : EMPTY
}

/**
 * Дата для `<input type="date">`: строго `ГГГГ-ММ-ДД` по МЕСТНЫМ частям.
 *
 * Не локализуется и локализоваться не может — это формат поля, а не текст.
 * Срез `toISOString()` здесь неверен: он режет по UTC, а поле показывает
 * местную дату, и для отрицательных смещений одно и то же значение
 * выводилось в поле одним днём, а в бейдже «до …» — предыдущим.
 */
export function formatInputDay(v: DateInput): string {
  const d = toDate(v)
  if (!d) return ''
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// ── Числа и деньги ──────────────────────────────────────────────────────────

/** Число с разрядами: 1 234,5. */
export function formatNumber(
  lang: Lang, n: number, opts: Intl.NumberFormatOptions = { maximumFractionDigits: 2 },
): string {
  return new Intl.NumberFormat(LOCALE[lang], opts).format(n)
}

/**
 * Деньги: 1 234,50 ₴.
 *
 * Символ валюты ставит Intl, а не мы: подстановка «` ₴`» руками (так сейчас
 * написано в финансах, заказах, приёмке и каталоге) ломается на первой же
 * второй валюте и ставит символ не с той стороны в английской локали.
 *
 * Так это заменяется на экране, где сейчас лежит своя `money`:
 *
 *     const money = (n: number) => `${n.toLocaleString('uk-UA')} ₴`   // было
 *     <span>{money(o.total)}</span>
 *
 *     const t = useT()                                               // стало
 *     <span>{t.money(o.total)}</span>
 *
 * Дробную часть у гривны показываем всегда: «1 200 ₴» и «1 200,00 ₴»
 * в одном столбце выглядят как разные суммы.
 */
export function formatMoney(
  lang: Lang, n: number, currency: string = DEFAULT_CURRENCY,
): string {
  return new Intl.NumberFormat(LOCALE[lang], {
    style: 'currency',
    currency,
    // Знак «₴», а не слово «грн»: так задано в хендоффе CRESKO («450 ₴»)
    // и так короче в узких столбцах. Выбор знака остаётся за Intl —
    // `narrowSymbol` просит КОРОТКУЮ форму, а не подставляет символ руками,
    // поэтому и вторая валюта, и английская локаль остаются правильными.
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(n)
}

/**
 * Проценты: 20 % (в украинской локали — с неразрывным пробелом, в английской
 * без него, и это решает Intl, а не мы).
 *
 * На вход — ПУНКТЫ, как их держит база (`discount_cap_pct` = 20), а не доля.
 */
export function formatPercent(lang: Lang, pct: number): string {
  return new Intl.NumberFormat(LOCALE[lang], {
    style: 'percent',
    maximumFractionDigits: 2,
  }).format(pct / 100)
}
