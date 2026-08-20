'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useT } from '@/lib/i18n/client'
import { localeOf } from '@/lib/i18n/format'
import { IconBack, IconCalendar, IconChevronRight } from '@/components/icons'
import { eventTone, isVoid, type B } from './status'
import { dayOf, mondayOf, shiftDay, weekDays, weekHref, weekLabel } from './week'
import { BookingSheet } from './booking-sheet'

// ── Недельная сетка записей (хендофф CRESKO Web §2) ─────────────────────────
//
// Геометрия из хендоффа дословно: колонка часов 64px, час — 60px, семь
// дней равными долями. Числа лежат константами, а не рассыпаны по разметке:
// высота плашки, её отступ сверху и положение линии считаются из ОДНОГО
// значения `HOUR`, и разъехаться им негде.
const HOUR = 60      // px в одном часе — вся вертикаль считается отсюда
const GUTTER = 64    // колонка часов слева
const MIN_COL = 120  // минимальная ширина дня, ниже которой имя не читается
const COL = 100 / 7  // доля одного дня в процентах ширины полосы дней

// Диапазон часов по умолчанию. Сетка расширяется по фактическим записям
// недели (самая ранняя минус час, самая поздняя плюс час), но НИКОГДА не
// сужается уже этого: пустая неделя, показанная полосой в два часа,
// читается как поломка, а не как «записей нет».
const HOUR_MIN = 8
const HOUR_MAX = 20

/** Местная полночь дня. Формат `ГГГГ-ММ-ДД` без зоны читается как местное
 *  время, поэтому и на сервере, и в браузере это ровно тот же календарный
 *  день — подписи колонок совпадают, гидратация не спорит. */
const dayDate = (day: string) => new Date(`${day}T00:00:00`)

type Slot = {
  b: B
  /** Колонка 0–6 и дорожка внутри неё, когда записи наложились. */
  col: number; lane: number; lanes: number
  /** Начало и конец в часах от полуночи, местных. */
  from: number; to: number
}

export function WeekGrid({ bookings, weekStart }: { bookings: B[]; weekStart: string }) {
  const t = useT()
  const [open, setOpen] = useState<B | null>(null)

  // ЧАСЫ БРАУЗЕРА — ТОЛЬКО ПОСЛЕ ГИДРАТАЦИИ, и это не перестраховка.
  // Записи хранятся моментом (`tstzrange`), а колонка и высота плашки
  // считаются в МЕСТНОМ поясе — том же, в котором список дня печатает
  // время. Сервер живёт в UTC (Vercel, Dublin), мастер — в Києві: одна
  // и та же запись встала бы на сервере в 09:00, а в браузере в 12:00,
  // то есть разметка сервера и клиента разошлись бы на три часа сразу
  // в сотне inline-стилей.
  //
  // Поэтому с сервера приходит КАРКАС — часы 08:00–20:00 и подписи дней,
  // которые от пояса не зависят вовсе, — а плашки появляются первым же
  // кадром после гидратации. Каркас на месте сразу, прыгать нечему
  // (диапазон часов может только вырасти, и только если в неделе есть
  // ранняя или поздняя запись).
  const [ready, setReady] = useState(false)
  useEffect(() => { setReady(true) }, [])
  const today = ready ? dayOf() : null

  const days = useMemo(() => weekDays(weekStart), [weekStart])

  // ── Раскладка ─────────────────────────────────────────────────────────
  const { slots, hourFrom, hourTo } = useMemo(() => {
    if (!ready) return { slots: [] as Slot[], hourFrom: HOUR_MIN, hourTo: HOUR_MAX }

    let from = HOUR_MIN
    let to = HOUR_MAX
    const byDay = new Map<string, Slot[]>()

    for (const b of bookings) {
      const s = new Date(b.start)
      if (Number.isNaN(s.getTime())) continue
      const day = dayOf(s)
      const col = days.indexOf(day)
      // Окно запроса шире недели на сутки с каждой стороны (см. page.tsx):
      // хвосты нужны серверу, чтобы не потерять запись из-за разницы
      // поясов, а в сетку они не попадают.
      if (col < 0) continue

      const e = new Date(b.end)
      const a = s.getHours() + s.getMinutes() / 60
      // Запись за полночь: конец лежит уже в следующем дне, и без +24
      // высота вышла бы отрицательной. Ниже она всё равно упрётся
      // в конец суток — переносить хвост во вторую колонку незачем,
      // в салоне таких записей не бывает, а сетку это усложнило бы вдвое.
      const raw = Number.isNaN(e.getTime())
        ? a + 1
        : e.getHours() + e.getMinutes() / 60 + (dayOf(e) !== day ? 24 : 0)
      // Пол в 15 минут: запись «на 10 хвилин» иначе даёт плашку в 10px,
      // в которой не помещается даже время.
      const b2 = Math.min(24, Math.max(a + 0.25, raw))

      from = Math.min(from, Math.max(0, Math.floor(a) - 1))
      to = Math.max(to, Math.min(24, Math.ceil(b2) + 1))

      byDay.set(day, [...(byDay.get(day) ?? []), { b, col, lane: 0, lanes: 1, from: a, to: b2 }])
    }

    // Наложения. Два мастера в 10:00 — обычный день салона, и без дорожек
    // одна запись просто накрывала бы другую целиком: невидимая запись
    // хуже узкой. Дорожки считаются ГРУППОЙ пересечений, а не на весь день,
    // иначе одно совпадение в обед сплющивало бы все двенадцать часов.
    const out: Slot[] = []
    for (const list of byDay.values()) {
      list.sort((x, y) => x.from - y.from || x.to - y.to)
      let group: Slot[] = []
      let groupEnd = -1
      const close = () => {
        const lanes = group.reduce((n, s) => Math.max(n, s.lane + 1), 1)
        for (const s of group) { s.lanes = lanes; out.push(s) }
        group = []
      }
      for (const s of list) {
        if (s.from >= groupEnd && group.length) close()
        const busyLanes = new Set(group.filter((g) => g.to > s.from).map((g) => g.lane))
        let lane = 0
        while (busyLanes.has(lane)) lane += 1
        s.lane = lane
        group.push(s)
        groupEnd = Math.max(groupEnd, s.to)
      }
      if (group.length) close()
    }

    return { slots: out, hourFrom: from, hourTo: to }
  }, [bookings, days, ready])

  const hours = useMemo(
    () => Array.from({ length: Math.max(1, hourTo - hourFrom) }, (_, i) => hourFrom + i),
    [hourFrom, hourTo],
  )

  // Подпись недели — общим сборщиком из `./week`: та же строка стоит
  // подзаголовком веб-хедера, и двух правил склейки быть не должно.
  const label = useMemo(() => weekLabel(localeOf(t.lang), weekStart), [weekStart, t])

  const atCurrent = today !== null && mondayOf(today) === weekStart

  const empty = ready ? slots.length === 0 : bookings.length === 0

  return (
    <div className="flex flex-col gap-4">
      {/* Навигация по неделям. Ссылки, а не кнопки с состоянием: неделя
          живёт в адресе, поэтому «назад» браузера возвращает предыдущую,
          а перезагрузка не сбрасывает на текущую. Зона нажатия — 44px
          от `.btn-icon`, а не от размера стрелки.
          Ряд — ТОЛЬКО до lg: на десктопе стрелки и подпись недели живут
          в веб-хедере экрана (CRESKO Web §2, bookings-client), и вторая
          пара стрелок под ним была бы вторым входом в одно действие. */}
      <div className="flex flex-wrap items-center justify-between gap-2 lg:hidden">
        <div className="flex items-center gap-1">
          <Link href={weekHref(shiftDay(weekStart, -7))} className="btn-icon"
                aria-label={t('bookings.week.prev.aria')}>
            <IconBack size={20} />
          </Link>
          <span className="tabular" style={{ minWidth: 168, textAlign: 'center', fontSize: 14, fontWeight: 650 }}>
            {label}
          </span>
          <Link href={weekHref(shiftDay(weekStart, 7))} className="btn-icon"
                aria-label={t('bookings.week.next.aria')}>
            <IconChevronRight size={20} />
          </Link>
        </div>
        {!atCurrent && (
          <Link href={weekHref(mondayOf(today ?? weekStart))} className="btn-secondary t-sm">
            {t('bookings.week.current')}
          </Link>
        )}
      </div>

      {empty ? (
        <div className="empty card rise">
          <span className="empty-icon"><IconCalendar size={24} /></span>
          <p className="empty-title">{t('bookings.week.empty.title')}</p>
          <p className="empty-desc">{t('bookings.week.empty.desc')}</p>
          <div className="empty-actions">
            <Link href="/app/bookings/staff" className="btn-secondary t-sm">{t('bookings.toStaff')}</Link>
          </div>
        </div>
      ) : (
        // Сетка либо помещается целиком, либо честно едет вбок: семь дней
        // на 390px — это 46px на колонку, где не читается ни имя, ни время.
        // Ниже xl (сайдбар кабинета съедает 232px) полоса дней держит
        // 120px на день и прокручивается, начиная с xl — растягивается
        // по месту. Ползунка у `.scroll-x` нет нигде, включая десктоп.
        <div className="scroll-x card !p-0" style={{ borderRadius: 'var(--radius-calendar)' }}>
          <div className="min-w-[904px] xl:min-w-0">
            {/* Шапка дней */}
            <div style={{ display: 'grid', gridTemplateColumns: `${GUTTER}px 1fr` }}>
              {/* Затычка над колонкой часов — липкая заодно с ней:
                  иначе при прокрутке вбок под пришпиленными часами
                  проезжали бы подписи дней. */}
              <span style={{ position: 'sticky', left: 0, zIndex: 1, background: 'var(--color-surface)' }} />
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7, minmax(0, 1fr))' }}>
                {days.map((d) => (
                  <div key={d} data-today={d === today}
                       style={{
                         padding: '10px 0 8px', textAlign: 'center',
                         borderRadius: '10px 10px 0 0',
                         background: d === today ? 'var(--color-accent-soft)' : undefined,
                       }}>
                    {/* Кегль 10 — ступень шкалы для подписи-«шапки»
                        (README: 10px 700 uppercase). Стоявшие здесь 11px
                        в шкале не существуют вовсе, а ряд дней недели
                        в месячной сетке рисуется теми же десятью. */}
                    <span style={{ display: 'block', fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', color: d === today ? 'var(--color-accent-ink)' : 'var(--color-muted)' }}>
                      {t.date(dayDate(d), { weekday: 'short' })}
                    </span>
                    <span className="tabular" style={{ display: 'block', fontSize: 15, fontWeight: 700, color: d === today ? 'var(--color-accent-ink)' : 'var(--color-text)' }}>
                      {t.date(dayDate(d), { day: 'numeric' })}
                    </span>
                  </div>
                ))}
              </div>
            </div>

            {/* Полотно */}
            <div style={{ display: 'grid', gridTemplateColumns: `${GUTTER}px 1fr` }}>
              {/* Часы. Подпись стоит ПОД своей линией, а не по центру
                  клетки: у верхней иначе не хватило бы места и она
                  вылезла бы за карточку. Колонка пришпилена к левому
                  краю — на телефоне сетка едет вбок, и уехавшие часы
                  оставили бы плашки без единственной подписи, которая
                  говорит, КОГДА это. */}
              <div style={{ position: 'sticky', left: 0, zIndex: 1, background: 'var(--color-surface)' }}>
                {hours.map((h) => (
                  <div key={h} style={{ height: HOUR, paddingRight: 10, textAlign: 'right' }}>
                    {/* Кегль 12 — из README §2 (підпис години 12px faint);
                        на телефоне ступень ниже: колонка часов там делит
                        390px с семью днями, и лишний пиксель кегля — это
                        лишние пиксели самой колонки. Ступень именно
                        СЛЕДУЮЩАЯ (10), а не 11: одиннадцати в шкале нет,
                        а заведённый ради одного места кегль перестаёт
                        быть исключением на втором. */}
                    <span className="tabular text-[10px] lg:text-[12px]" style={{ color: 'var(--color-faint)' }}>
                      {t.dateTime(new Date(2000, 0, 1, h), { hour: '2-digit', minute: '2-digit' })}
                    </span>
                  </div>
                ))}
              </div>

              <div style={{ position: 'relative' }}>
                {/* Сегодняшний день — подложка. Стоит первой, а часовые
                    линии ниже несут `position: relative` — только поэтому
                    они рисуются ПОВЕРХ заливки: позиционированное всегда
                    перекрывает обычный поток, в каком бы порядке оно
                    ни лежало. */}
                {today !== null && days.indexOf(today) >= 0 && (
                  <span aria-hidden
                        style={{
                          position: 'absolute', top: 0, bottom: 0,
                          left: `${days.indexOf(today) * COL}%`, width: `${COL}%`,
                          background: 'var(--color-accent-soft)', pointerEvents: 'none',
                        }} />
                )}

                {/* Горизонтальные линии — потоком: они же задают высоту
                    полотна, и высота не может разойтись с числом часов. */}
                {hours.map((h) => (
                  <div key={h} style={{
                    position: 'relative', height: HOUR,
                    borderTop: '1px solid var(--web-border-row, var(--color-border))',
                  }} />
                ))}

                {/* Вертикальные — оверлеем, чтобы не резать полотно
                    на семь потоков; сквозь них проходит нажатие. */}
                <span aria-hidden style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                  {[1, 2, 3, 4, 5, 6].map((i) => (
                    <span key={i} style={{
                      position: 'absolute', top: 0, bottom: 0, width: 1,
                      left: `${i * COL}%`,
                      background: 'var(--web-border-row, var(--color-border))',
                    }} />
                  ))}
                </span>

                {/* Плашки записей.
                    Зона нажатия здесь МЕНЬШЕ 44px, и это осознанно: высота
                    плашки — это её длительность, и растянуть получасовую
                    запись до пальца значит соврать о времени и накрыть
                    соседний час. Правило 44px остаётся у всего, что рядом:
                    стрелки недели, переключатель вида, кнопки в шторке.
                    Кегли 10/12 — из ЗАКРЫТОЙ шкалы (10·12·13·14·15·16·17·
                    21·22·24·30); множитель размера текста они не слушают
                    по той же причине: высота задана временем, и увеличенный
                    текст просто не поместился бы в свои минуты.

                    Здесь стояло 11 — размер, которого в шкале нет вовсе
                    (20.08.2026, проход телефона: сетка недели видна и на
                    390px, то есть это был живой кегль вне шкалы, а не
                    десктопная мелочь). Вниз, а не вверх: час — это 60px,
                    из них под текст остаётся 44, и три строки по 12
                    в них уже не помещаются — часовая запись потеряла бы
                    название услуги. */}
                {slots.map((s) => {
                  const tone = eventTone(s.b.status)
                  const top = (s.from - hourFrom) * HOUR
                  const height = Math.max(22, (s.to - s.from) * HOUR - 2)
                  return (
                    <button key={s.b.id} type="button" onClick={() => setOpen(s.b)}
                            title={`${s.b.name} · ${s.b.variant}`}
                            style={{
                              position: 'absolute',
                              left: `calc(${s.col * COL + (s.lane * COL) / s.lanes}% + 4px)`,
                              width: `calc(${COL / s.lanes}% - 8px)`,
                              top, height,
                              overflow: 'hidden', textAlign: 'left',
                              padding: '7px 9px',
                              borderRadius: 8,
                              borderLeft: `3px solid ${tone.line}`,
                              background: tone.fill,
                            }}>
                      <span className="tabular" style={{
                        display: 'block', fontSize: 10, fontWeight: 650, lineHeight: 1.2,
                        color: tone.ink,
                        textDecoration: isVoid(s.b.status) ? 'line-through' : undefined,
                      }}>
                        {t.dateTime(s.b.start, { hour: '2-digit', minute: '2-digit' })}
                      </span>
                      <span style={{
                        display: 'block', fontSize: 12, fontWeight: 650, lineHeight: 1.3,
                        color: 'var(--color-text)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {s.b.name}
                      </span>
                      <span style={{
                        display: 'block', fontSize: 10, lineHeight: 1.3,
                        color: 'var(--color-muted)',
                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                      }}>
                        {s.b.variant || s.b.title}
                      </span>
                    </button>
                  )
                })}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Карточка записи — общая с таймлайном дня (`./booking-sheet`).
          Отдельного экрана записи в продукте нет вовсе: в плашку не
          помещается ни одна кнопка, поэтому нажатие открывает шторку
          с разрешёнными переходами. Вторая её копия разъехалась бы
          с первой ровно так же, как разъехалась бы карта переходов, —
          и по той же причине вынесена в свой файл. */}
      <BookingSheet booking={open} onClose={() => setOpen(null)} />
    </div>
  )
}
