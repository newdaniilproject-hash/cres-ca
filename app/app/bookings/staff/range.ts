// Разбор `tstzrange` в две даты.
//
// PostgREST отдаёт диапазон СТРОКОЙ ровно в том виде, в каком его печатает
// Postgres: `["2026-08-19 21:00:00+00","2026-08-25 21:00:00+00")`. Ни один
// клиент этого не разбирает сам, и в проекте это уже делалось по месту —
// в `bookings-client.tsx` регулярка достаёт из периода только НАЧАЛО.
// Отпуску нужны обе границы, поэтому разбор вынесен сюда целиком.
//
// Что важно помнить о верхней границе: её ставит `add_time_off` как начало
// СЛЕДУЮЩЕГО дня со скобкой `[)`. Значит показывать её человеку как есть
// нельзя — «відпустка до 26 серпня» при отпуске по 25-е читается как лишний
// день. Поэтому `lastDay()` отнимает сутки: экран говорит то же, что
// человек вводил.
export type Range = { from: string; to: string }

export function parseRange(v: string | null | undefined): Range {
  const s = String(v ?? '')
  const inner = s.slice(1, -1)
  const parts = inner.split(',')
  const clean = (x: string) => x.trim().replace(/^"|"$/g, '')
  return { from: clean(parts[0] ?? ''), to: clean(parts[1] ?? '') }
}

/** Последний день диапазона `[)` — тот, что человек назвал последним. */
export function lastDay(to: string): string {
  const d = new Date(to)
  if (Number.isNaN(d.getTime())) return to
  return new Date(d.getTime() - 864e5).toISOString()
}

/** Отпуск идёт прямо сейчас. */
export function isNow(r: Range, at = Date.now()): boolean {
  const from = new Date(r.from).getTime()
  const to = new Date(r.to).getTime()
  return Number.isFinite(from) && Number.isFinite(to) && from <= at && at < to
}
