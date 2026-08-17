import { DEFAULT_LANG, DICTS, type Key, type Lang, type PluralKey } from './dict'
import {
  formatDate, formatDateTime, formatInputDay, formatMoney, formatNumber,
  formatPercent, pluralForm,
} from './format'

// Переводчик. Ни React, ни Next: одна и та же функция работает в серверном
// компоненте (`lib/i18n/server.ts`) и в клиентском (`lib/i18n/client.tsx`).

/** Значения подстановок. Только именованные: `{shop}`, `{date}`, `{n}`. */
export type Vars = Record<string, string | number>

export type T = {
  /** Обычная строка и строка с подстановкой: `t('team.beyond', { name })`. */
  (key: Key, vars?: Vars): string
  /** Текущий язык — нужен там, где строку собирает сама страница. */
  readonly lang: Lang
  /** Числительное: `t.plural('team.sessions.count', n)`. `{n}` подставляется сам. */
  plural(base: PluralKey, n: number, vars?: Vars): string
  /** Дата: 31.12.2026. Пусто — длинное тире. */
  date(v: string | number | Date | null | undefined, opts?: Intl.DateTimeFormatOptions): string
  /** Дата и время: 31.12.2026, 14:05. */
  dateTime(v: string | number | Date | null | undefined, opts?: Intl.DateTimeFormatOptions): string
  /** Значение для `<input type="date">`. Не локализуется — это формат поля. */
  inputDay(v: string | number | Date | null | undefined): string
  /** Число с разрядами. */
  number(n: number, opts?: Intl.NumberFormatOptions): string
  /** Деньги вместе с символом валюты: 1 234,50 ₴. */
  money(n: number, currency?: string): string
  /** Проценты из пунктов: `percent(20)` → «20 %». */
  percent(pct: number): string
}

// ── Пропущенный ключ ────────────────────────────────────────────────────────
//
// РЕШЕНИЕ: показываем УКРАИНСКУЮ строку, а в консоль — предупреждение. Ключ
// на экране (`team.invite.title`) остаётся только если его нет и в украинском.
//
// Почему не падать на сборке: сборка и так не пропустит опечатку — `Key`
// выведен из `uk.json`, и несуществующий ключ это ошибка `tsc` (задание
// «Збірка» гоняет `tsc --noEmit` до слияния). Значит на бою пропуск бывает
// ровно одного вида: ключ ЕСТЬ, а перевода на `ru`/`en` ещё нет. Ронять
// сборку на этом — значит запретить выкладывать неполный `ru`, а план прямо
// говорит собирать его постепенно.
//
// Почему не показывать сам ключ: `team.block.reason.placeholder` в поле
// у мастера — это мусор, из которого он не поймёт ничего. Украинский запасной
// — настоящая строка с настоящим смыслом, и человек в Украине её прочтёт.
//
// Почему не пустая строка: пропавшая кнопка выглядит поломкой, а не
// непереведённым местом, и находится в день, когда на неё нажимают.
const warned = new Set<string>()

function lookup(lang: Lang, key: Key): string {
  const own = DICTS[lang][key]
  if (own !== undefined) return own

  const fallback = DICTS[DEFAULT_LANG][key]
  if (fallback !== undefined) {
    const mark = `${lang}:${key}`
    if (!warned.has(mark)) {
      warned.add(mark)
      console.warn(`[i18n] немає перекладу ${mark} — показано українською`)
    }
    return fallback
  }

  // Сюда не попасть при живом `tsc`. Оставлено на случай ключа, собранного
  // строкой в обход типов: увидеть имя ключа лучше, чем дыру в вёрстке.
  console.warn(`[i18n] невідомий ключ ${key}`)
  return key
}

// Подстановка. Неизвестное имя остаётся как есть — `{shop}` на экране виден
// сразу, а тихо съеденная подстановка означала бы предложение без слова.
function fill(s: string, vars?: Vars): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(vars, name) ? String(vars[name]) : whole)
}

const CACHE = new Map<Lang, T>()

/** Переводчик для языка. Один объект на язык — пересоздавать незачем. */
export function createT(lang: Lang): T {
  const cached = CACHE.get(lang)
  if (cached) return cached

  const t = (key: Key, vars?: Vars): string => fill(lookup(lang, key), vars)

  const api: T = Object.assign(t, {
    lang,
    plural(base: PluralKey, n: number, vars?: Vars): string {
      // Присваивание, а не `as`: если у новой группы забыли форму `.few`,
      // строка `…few` не сойдётся с `Key` и это остановит сборку — ровно
      // там, где ошибку ещё дёшево исправить.
      const key: Key = `${base}.${pluralForm(lang, n)}`
      return fill(lookup(lang, key), { n, ...vars })
    },
    date: (v: string | number | Date | null | undefined, opts?: Intl.DateTimeFormatOptions) =>
      formatDate(lang, v, opts),
    dateTime: (v: string | number | Date | null | undefined, opts?: Intl.DateTimeFormatOptions) =>
      formatDateTime(lang, v, opts),
    inputDay: (v: string | number | Date | null | undefined) => formatInputDay(v),
    number: (n: number, opts?: Intl.NumberFormatOptions) => formatNumber(lang, n, opts),
    money: (n: number, currency?: string) => formatMoney(lang, n, currency),
    percent: (pct: number) => formatPercent(lang, pct),
  })

  CACHE.set(lang, api)
  return api
}
