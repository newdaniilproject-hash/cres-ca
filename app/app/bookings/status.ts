import type { T } from '@/lib/i18n/translate'

// Состояния записи: подписи, разрешённые переходы и тон.
//
// ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ. До появления недельной сетки всё это лежало
// внутри `bookings-client.tsx` и было местным делом одного списка.
// Видов у экрана стало два, и вторая копия карты переходов разъехалась бы
// с первой в тот день, когда в базу добавят статус (CLAUDE.md → «Один
// источник правды — и сторож при каждом»). Сторожа здесь ставить не надо:
// файл ОДИН, и обе поверхности читают его, а не свою копию.
//
// Что при этом остаётся источником правды по-настоящему: таблица
// `booking_status_transitions` в базе. Здесь — только раскладка кнопок;
// сам переход всё равно выполняет `set_booking_status`, и запрещённый
// он не пропустит, даже если этот файл соврёт.

/** Запись в том виде, в каком её отдаёт `app/app/bookings/page.tsx`. */
export type B = {
  id: string; number: number; title: string; variant: string
  /** Начало и конец периода (`tstzrange`), разобранные на сервере. */
  start: string; end: string
  status: string; name: string; phone: string | null
  price: number; deposit: number; staff: string
}

// Разрешённые переходы. Подписи здесь не лежат: `to` — служебное
// значение перечисления, оно уезжает в `set_booking_status`, а надпись
// на кнопке берётся по нему из словаря (`bookings.action.<to>`).
// Тип `to` не `string` намеренно: забытый ключ ловит `tsc`, а не экран.
export type BookingAction = 'confirmed' | 'cancelled' | 'arrived' | 'no_show' | 'completed'
export const NEXT: Record<string, { to: BookingAction; kind: 'primary' | 'secondary' }[]> = {
  booked:    [{ to: 'confirmed', kind: 'primary' },
              { to: 'cancelled', kind: 'secondary' }],
  confirmed: [{ to: 'arrived', kind: 'primary' },
              { to: 'no_show', kind: 'secondary' }],
  arrived:   [{ to: 'completed', kind: 'primary' }],
}

// Подпись к состоянию записи. Значение (`no_show`) не переводится —
// переводится подпись. Незнакомое состояние выводится как есть.
const STATUSES = [
  'booked', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show',
] as const
type BookingStatus = (typeof STATUSES)[number]
export const statusLabel = (t: T, v: string): string =>
  ((STATUSES as readonly string[]).includes(v) ? t(`bookings.status.${v as BookingStatus}`) : v)

// Тон точки статуса. Три группы, а не шесть: «очікує підтвердження»
// (жовтий — вимагає дії просто зараз), «підтверджено/у кріслі» (акцент —
// відбудеться, все гаразд), «завершено, скасовано, не прийшов» (нейтральний —
// історія, дію вже не потрібно приймати).
export const statusTone = (v: string): 'warn' | 'accent' | 'success' | undefined =>
  v === 'booked' ? 'warn'
    : v === 'confirmed' || v === 'arrived' ? 'accent'
      : v === 'completed' ? 'success'
        : undefined

/**
 * Тон плашки в недельной сетке.
 *
 * ПОЧЕМУ ЗДЕСЬ ШЕСТЬ ЗНАЧЕНИЙ, А У ТОЧКИ В СПИСКЕ — ТРИ. В списке рядом
 * с точкой стоит бейдж СЛОВОМ («підтверджена»), и цвет только группирует.
 * В сетке слова нет вовсе: в плашке высотой в полчаса помещается время,
 * имя и услуга, и сказать состояние больше нечем. Поэтому тон здесь
 * разделяет то, что список сводит в одну группу, — иначе половина сетки
 * была бы одного цвета и не значила бы ничего.
 *
 * Тон берётся по СТАТУСУ, а не по мастеру и не по услуге, потому что
 * вопрос, с которым смотрят на неделю, ровно один: «где мне надо
 * вмешаться». Мастер и услуга написаны словами внутри плашки.
 *
 * Разбивка — по тому, что с записью надо сделать:
 *   booked    — янтарь: ждёт подтверждения, требует действия сегодня;
 *   confirmed — синий: состоится, трогать не нужно;
 *   arrived   — фиолетовый: человек в кресле ПРЯМО СЕЙЧАС; это
 *               единственное состояние, которое меняется на глазах,
 *               и в сетке оно обязано быть заметнее соседей;
 *   completed — зелёный: закрыто;
 *   cancelled и no_show — нейтральный. Красным их красить нельзя:
 *               тревожный тон в сетке означает «займись», а заниматься
 *               здесь уже нечем; след записи оставлен только затем,
 *               чтобы час не выглядел свободным задним числом.
 *
 * Ни одного своего цвета: только `--tone-*` и общие токены поверхности,
 * то есть обе темы и десктопная палитра CRESKO Web получаются сами.
 */
export type EventTone = { line: string; fill: string; ink: string }

export const eventTone = (v: string): EventTone =>
  v === 'booked'
    ? { line: 'var(--tone-amber)', fill: 'var(--tone-amber-soft)', ink: 'var(--tone-amber)' }
    : v === 'confirmed'
      ? { line: 'var(--tone-blue)', fill: 'var(--tone-blue-soft)', ink: 'var(--tone-blue)' }
      : v === 'arrived'
        ? { line: 'var(--tone-violet)', fill: 'var(--tone-violet-soft)', ink: 'var(--tone-violet)' }
        : v === 'completed'
          ? { line: 'var(--tone-emerald)', fill: 'var(--tone-emerald-soft)', ink: 'var(--tone-emerald)' }
          : { line: 'var(--color-border-strong)', fill: 'var(--color-surface-2)', ink: 'var(--color-muted)' }

/** Запись, которой уже не будет: время в плашке зачёркивается. */
export const isVoid = (v: string): boolean => v === 'cancelled' || v === 'no_show'
