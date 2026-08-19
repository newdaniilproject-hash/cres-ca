'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import { localeOf } from '@/lib/i18n/format'
import { dbErrorText } from '@/lib/errors/db'
import { Sheet } from '@/components/sheet'
import { IconBack, IconCalendar, IconChevronRight } from '@/components/icons'
import { NEXT, eventTone, isVoid, statusLabel, type B } from './status'
import { dayOf, mondayOf, shiftDay, weekDays } from './week'

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
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
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

  // Подпись недели. `formatRange` сам решает, что вынести за скобки:
  // «17–23 серпня 2026 р.» в одном месяце и «29 червня – 5 липня 2026 р.»
  // на стыке. Собирать это подстановкой руками — значит написать правило
  // склейки для каждого языка заново.
  const label = useMemo(
    () => new Intl.DateTimeFormat(localeOf(t.lang), { day: 'numeric', month: 'long', year: 'numeric' })
      .formatRange(dayDate(days[0]), dayDate(days[6])),
    [days, t],
  )

  const href = (monday: string) => `/app/bookings?view=week&week=${monday}`
  const atCurrent = today !== null && mondayOf(today) === weekStart

  async function move(id: string, to: string) {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('set_booking_status', {
      p_booking_id: id, p_status: to,
    })
    setBusy(false)
    if (error) { setErr(dbErrorText(t, error)); return }
    setOpen(null)
    router.refresh()
  }

  const empty = ready ? slots.length === 0 : bookings.length === 0

  return (
    <div className="flex flex-col gap-4">
      {/* Навигация по неделям. Ссылки, а не кнопки с состоянием: неделя
          живёт в адресе, поэтому «назад» браузера возвращает предыдущую,
          а перезагрузка не сбрасывает на текущую. Зона нажатия — 44px
          от `.btn-icon`, а не от размера стрелки. */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-1">
          <Link href={href(shiftDay(weekStart, -7))} className="btn-icon"
                aria-label={t('bookings.week.prev.aria')}>
            <IconBack size={20} />
          </Link>
          <span className="tabular" style={{ minWidth: 168, textAlign: 'center', fontSize: 14, fontWeight: 650 }}>
            {label}
          </span>
          <Link href={href(shiftDay(weekStart, 7))} className="btn-icon"
                aria-label={t('bookings.week.next.aria')}>
            <IconChevronRight size={20} />
          </Link>
        </div>
        {!atCurrent && (
          <Link href={href(mondayOf(today ?? weekStart))} className="btn-secondary t-sm">
            {t('bookings.week.current')}
          </Link>
        )}
      </div>

      {err && <p className="field-error rise">{err}</p>}

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
                    <span style={{ display: 'block', fontSize: 11, textTransform: 'uppercase', letterSpacing: '0.04em', color: d === today ? 'var(--color-accent-ink)' : 'var(--color-muted)' }}>
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
                    <span className="tabular" style={{ fontSize: 11, color: 'var(--color-faint)' }}>
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
                    Кегли 11/12 — из хендоффа CRESKO Web §2; множитель
                    размера текста они не слушают по той же причине:
                    высота задана временем, и увеличенный текст просто
                    не поместился бы в свои минуты. */}
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
                        display: 'block', fontSize: 11, fontWeight: 650, lineHeight: 1.2,
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
                        display: 'block', fontSize: 11, lineHeight: 1.3,
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

      {/* Карточка записи. Отдельного экрана записи в продукте нет вовсе —
          в списке дня действия лежат прямо в строке. Поэтому нажатие
          на плашку открывает шторку с тем же составом и с теми же
          разрешёнными переходами: карта переходов одна на оба вида
          (`./status.ts`), второй её копии не заведено. */}
      <Sheet open={open !== null} onClose={() => setOpen(null)}
             title={open ? t('bookings.card.title', { number: open.number }) : undefined}>
        {open && (
          <div className="flex flex-col gap-3">
            <p className="tabular t-lg" style={{ color: 'var(--color-accent-ink)' }}>
              {t.dateTime(open.start, {
                weekday: 'long', day: 'numeric', month: 'long',
                hour: '2-digit', minute: '2-digit',
              })}
            </p>
            <p className="t-md">
              {open.name}
              {open.phone && <a href={`tel:${open.phone}`} className="prose-muted"> · {open.phone}</a>}
            </p>
            <p className="t-sm" style={{ color: 'var(--color-faint)' }}>
              {open.title} · {open.variant} · {open.staff}
            </p>
            <p className="flex items-center gap-2">
              <span className={
                open.status === 'completed' ? 'badge-success'
                : isVoid(open.status) ? 'badge'
                : 'badge-accent'
              }>
                {statusLabel(t, open.status)}
              </span>
              <span className="tabular t-sm" style={{ color: 'var(--color-faint)' }}>
                {t.money(open.price)}
                {open.deposit > 0 && ` · ${t('bookings.deposit', { sum: t.money(open.deposit) })}`}
              </span>
            </p>
            {(NEXT[open.status] ?? []).length > 0 && (
              <div className="flex flex-wrap items-center gap-2 pt-1">
                {(NEXT[open.status] ?? []).map((a) => (
                  <button key={a.to} type="button"
                          className={a.kind === 'primary' ? 'btn-primary t-sm' : 'btn-secondary t-sm'}
                          disabled={busy}
                          onClick={() => void move(open.id, a.to)}>
                    {t(`bookings.action.${a.to}`)}
                  </button>
                ))}
              </div>
            )}
          </div>
        )}
      </Sheet>
    </div>
  )
}
