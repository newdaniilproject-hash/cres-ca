import { mondayOf, shiftDay } from './week'

// Календарная арифметика МЕСЯЧНОЙ сетки.
//
// Те же два правила, что и в `./week`, и по той же причине: месяц — это
// СТРОКА `ГГГГ-ММ`, а не `Date`, и вся арифметика идёт в `Date.UTC`.
// Складывать месяцы к местной полуночи нельзя: у неё смещение, и на
// переводе часов сложение промахивается на день, а на 31-м числе —
// на целый месяц («31 марта + 1 месяц» в `Date` даёт 1 мая).
//
// Почему отдельный файл, а не дописать в `./week`: недельная сетка
// оперирует ДНЯМИ от понедельника, месячная — КЛЕТКАМИ таблицы,
// у которой первая и последняя неделя торчат в соседние месяцы.
// Общее у них ровно две функции (`shiftDay`, `mondayOf`), и они
// импортируются, а не копируются.

const RE_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/

/** Месяц, в который попал день: `2026-08-19` → `2026-08`. */
export const monthOf = (day: string): string => day.slice(0, 7)

/** Значение из адреса — настоящий месяц, а не мусор. */
export const isMonth = (v: unknown): v is string =>
  typeof v === 'string' && RE_MONTH.test(v)

/** Первый день месяца, `ГГГГ-ММ-ДД`. */
export const monthStart = (month: string): string => `${month}-01`

/** Сдвиг на месяцы. Только через год и номер месяца — см. шапку файла. */
export function shiftMonth(month: string, months: number): string {
  const y = Number(month.slice(0, 4))
  const m = Number(month.slice(5, 7)) - 1 + months
  const year = y + Math.floor(m / 12)
  const mm = ((m % 12) + 12) % 12
  return `${String(year).padStart(4, '0')}-${String(mm + 1).padStart(2, '0')}`
}

/** Первый день СЛЕДУЮЩЕГО месяца — правая граница полуоткрытого окна. */
export const monthEnd = (month: string): string => monthStart(shiftMonth(month, 1))

/**
 * Клетки календаря: полные недели от понедельника, покрывающие месяц.
 *
 * Возвращается ровно столько недель, сколько нужно (4–6), а не жёсткие
 * шесть: пустая седьмая строка в феврале — это дыра под сеткой, которую
 * человек читает как «дальше что-то не загрузилось».
 *
 * Дни соседних месяцев в клетках ОСТАЮТСЯ (их отличает `inMonth`), а не
 * заменяются пустотой: без них ломается ряд, и «1 травня» уезжает из-под
 * своего дня недели.
 */
export function monthWeeks(month: string): { day: string; inMonth: boolean }[][] {
  const first = monthStart(month)
  const last = shiftDay(monthEnd(month), -1)
  const out: { day: string; inMonth: boolean }[][] = []
  for (let cur = mondayOf(first); cur <= last; cur = shiftDay(cur, 7)) {
    out.push(Array.from({ length: 7 }, (_, i) => {
      const day = shiftDay(cur, i)
      return { day, inMonth: monthOf(day) === month }
    }))
  }
  return out
}

/** Адрес месячного вида. Сборщик один — как `weekHref` у недели. */
export const monthHref = (month: string): string =>
  `/app/bookings?view=calendar&month=${month}`

/** Адрес вида дня. День живёт в адресе по тем же причинам, что и неделя. */
export const dayHref = (day: string): string =>
  `/app/bookings?day=${day}`

/** Первая буква вверх. `Intl` отдаёт месяц и день недели строчными
 *  («травень», «пн»), а в шапке календаря и в ряду дней они стоят
 *  подписями, а не внутри предложения. */
export const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

/**
 * Подпись месяца: «Травень 2025».
 *
 * Собирается ИЗ ДВУХ ЧАСТЕЙ, а не одним `{ month, year }`: украинский
 * `Intl` в паре с годом печатает «травень 2025 р.», и это верно в дате,
 * но не в заголовке — в макете стоит «Травень 2025». Год берётся числом
 * из самой строки месяца: форматировать его отдельно бессмысленно,
 * разрядов у года не бывает, а «р.» вернулось бы вместе с локалью.
 *
 * `T00:00:00` без зоны читается как местная полночь, поэтому и на сервере,
 * и в браузере это тот же календарный месяц — подпись совпадает,
 * гидратация не спорит.
 */
/**
 * Подпись дня: «Середа, 19 серпня».
 *
 * СОБИРАЕТСЯ ИЗ ДВУХ ВЫЗОВОВ, и это не украшательство. Один вызов
 * `{ weekday, day, month }` в украинской локали Chromium печатает
 * «середу, 19 серпня» — знахідний відмінок: в CLDR у дня недели два
 * контекста, и внутри даты берётся тот, который читается как «у середу».
 * Заголовок называет день, а не говорит «в такой-то день», и в макете
 * стоит «Пʼятниця, 9 травня». Отдельный вызов `{ weekday }` даёт
 * самостоятельную форму — другого способа получить именительный
 * из `Intl` нет.
 *
 * Проверено в Chromium: Node с другой сборкой ICU отдаёт «середа»
 * и в слитном виде, то есть на сервере ошибки не видно вовсе.
 */
export function dayLabel(locale: string, day: string): string {
  const d = new Date(`${day}T00:00:00`)
  const weekday = new Intl.DateTimeFormat(locale, { weekday: 'long' }).format(d)
  const date = new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long' }).format(d)
  return `${cap(weekday)}, ${date}`
}

export function monthLabel(locale: string, month: string): string {
  const name = new Intl.DateTimeFormat(locale, { month: 'long' })
    .format(new Date(`${monthStart(month)}T00:00:00`))
  return `${cap(name)} ${month.slice(0, 4)}`
}
