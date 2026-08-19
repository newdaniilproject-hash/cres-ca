'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useT } from '@/lib/i18n/client'
import { localeOf } from '@/lib/i18n/format'
import { Sheet } from '@/components/sheet'
import { IconBack, IconCalendar, IconChevronRight } from '@/components/icons'
import { statusLabel, statusTone, type B } from './status'
import { dayOf } from './week'
import { cap, dayHref, dayLabel, monthHref, monthLabel, monthWeeks, shiftMonth } from './month'

// ── Месячная сетка записей (хендофф CRESKO, раздел D «Записи») ──────────────
//
// Геометрия из README дословно и константами, а не числами по разметке:
// клетка дня 29×29 при радиусе 9, зазор между клетками 2, ряд дней недели
// 10px/650 `faint`, контейнер — радиус календаря.
//
// ГЛАВНОЕ РЕШЕНИЕ ФАЙЛА: клетка — это КНОПКА в 44px высотой, внутри
// которой лежит квадрат 29×29. Уменьшить кнопку до квадрата нельзя —
// правило зоны нажатия старше макета, и промах по соседнему дню в
// календаре стоит открытой шторки не того дня. Увеличить квадрат тоже
// нельзя: семь квадратов по 44 не помещаются в 390px вместе с полями
// экрана, а сетка календаря обязана быть квадратной.
const CELL = 29        // сторона клетки дня
const CELL_RADIUS = 9  // её скругление — ступень мельче `--radius-plate`
const GAP = 2          // зазор между клетками

/** Местная полночь дня: и на сервере, и в браузере это один календарный
 *  день, поэтому подписи совпадают и гидратация не спорит. */
const at = (day: string) => new Date(`${day}T00:00:00`)

export function MonthGrid({ bookings, month }: { bookings: B[]; month: string }) {
  const t = useT()
  const [open, setOpen] = useState<string | null>(null)

  // СЕГОДНЯ — ТОЛЬКО ПОСЛЕ ГИДРАТАЦИИ. Записи хранятся моментом, а день
  // считается в МЕСТНОМ поясе; сервер живёт в UTC (Vercel, Dublin), мастер
  // в Києві — и подсветка «сьогодні» разошлась бы на сутки прямо в разметке.
  // Сама сетка от пояса не зависит и приезжает с сервера целиком: прыгать
  // нечему, появляется только заливка одной клетки.
  const [today, setToday] = useState<string | null>(null)
  useEffect(() => { setToday(dayOf()) }, [])

  const weeks = useMemo(() => monthWeeks(month), [month])
  const label = useMemo(() => monthLabel(localeOf(t.lang), month), [month, t])

  // Записи по дням. Ключ — местный день начала: тот же, по которому
  // сетка подписывает клетки. Считается после гидратации по той же
  // причине, что и «сьогодні».
  const byDay = useMemo(() => {
    const map = new Map<string, B[]>()
    if (today === null) return map
    for (const b of bookings) {
      const d = new Date(b.start)
      if (Number.isNaN(d.getTime())) continue
      const key = dayOf(d)
      map.set(key, [...(map.get(key) ?? []), b])
    }
    return map
  }, [bookings, today])

  // Подписи дней недели — от известного понедельника, а не от `weeks[0]`:
  // первая клетка сетки почти всегда лежит в прошлом месяце, но день
  // недели у неё тот же. Первый день недели — понедельник и только он
  // (разбор — в шапке `./week`), поэтому ряд собирается сдвигом от даты,
  // про которую точно известно, что это понеділок.
  const weekdays = useMemo(
    () => weeks[0].map((c) => cap(t.date(at(c.day), { weekday: 'short' }))),
    [weeks, t],
  )

  const list = open === null ? [] : byDay.get(open) ?? []

  return (
    <>
      {/* Ширина на десктопе ограничена: клетка дня — 29px по README,
          и растянутая на 1200px сетка превращается в семь колонок с
          ладонью пустоты между числами. Ограничение стоит на карточке,
          а не на клетке: сама сетка обязана остаться квадратной. */}
      <div className="card rise lg:max-w-[520px]" style={{ borderRadius: 'var(--radius-calendar)' }}>
        {/* Шапка месяца. Стрелки — ССЫЛКИ, а не кнопки с состоянием:
            месяц живёт в адресе, поэтому «назад» браузера возвращает
            предыдущий, а перезагрузка не сбрасывает на текущий. Зона
            нажатия — 44px от `.btn-icon`, а не размер стрелки. */}
        <div className="flex items-center justify-between gap-2">
          <Link href={monthHref(shiftMonth(month, -1))} className="btn-icon"
                aria-label={t('bookings.month.prev.aria')}>
            <IconBack size={20} />
          </Link>
          <span style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>
            {label}
          </span>
          <Link href={monthHref(shiftMonth(month, 1))} className="btn-icon"
                aria-label={t('bookings.month.next.aria')}>
            <IconChevronRight size={20} />
          </Link>
        </div>

        {/* Ряд дней недели */}
        <div className="mt-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: GAP }}>
          {weekdays.map((w, i) => (
            <span key={i} style={{
              textAlign: 'center', fontSize: 10, fontWeight: 650,
              color: 'var(--color-faint)',
            }}>
              {w}
            </span>
          ))}
        </div>

        {/* Недели */}
        <div className="mt-1">
          {weeks.map((week) => (
            <div key={week[0].day}
                 style={{ display: 'grid', gridTemplateColumns: 'repeat(7, 1fr)', gap: GAP }}>
              {week.map((c) => {
                // Дни соседних месяцев занимают своё место ПУСТЫМИ, а не
                // числами: ряд без них поехал бы, и «1 травня» встало бы
                // не под своим днём недели, — но показанный «31 квітня»
                // на экране «Серпень» отвечает на вопрос о другом месяце.
                if (!c.inMonth) return <span key={c.day} style={{ minHeight: 'var(--tap-min)' }} />

                const has = (byDay.get(c.day)?.length ?? 0) > 0
                const isToday = c.day === today
                return (
                  <button key={c.day} type="button" onClick={() => setOpen(c.day)}
                          style={{
                            minHeight: 'var(--tap-min)',
                            display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center', gap: 3,
                          }}>
                    <span className="tabular" style={{
                      width: CELL, height: CELL, borderRadius: CELL_RADIUS,
                      display: 'grid', placeItems: 'center',
                      fontSize: 14, fontWeight: 650,
                      background: isToday ? 'var(--color-accent)' : undefined,
                      color: isToday ? 'var(--color-accent-text)' : 'var(--color-text)',
                    }}>
                      {t.date(at(c.day), { day: 'numeric' })}
                    </span>
                    {/* Точка — ЕДИНСТВЕННЫЙ признак «здесь есть записи»
                        на всём месяце. Место под неё занято всегда, иначе
                        клетки с записями и без прыгали бы по высоте.
                        Цвет один и тот же под любым днём: точка лежит НА
                        КАРТОЧКЕ, а не внутри клетки, и «белая на сегодня»
                        просто исчезала бы с белого фона. */}
                    <span aria-hidden style={{
                      width: 4, height: 4, borderRadius: 999,
                      background: has ? 'var(--color-accent)' : 'transparent',
                    }} />
                  </button>
                )
              })}
            </div>
          ))}
        </div>
      </div>

      {/* Шторка дня. Общий `Sheet`, а не своя всплывающая панель: у шторки
          в этом продукте есть жест, замок прокрутки под ней и портал в
          `body` (разбор — в шапке `components/sheet.tsx`), и вторая
          реализация потеряла бы всё это молча. */}
      <Sheet open={open !== null} onClose={() => setOpen(null)}
             title={open === null ? undefined : dayLabel(localeOf(t.lang), open)}>
        {open !== null && (list.length === 0 ? (
          <div className="empty">
            <span className="empty-icon"><IconCalendar size={24} /></span>
            <p className="empty-desc">{t('bookings.day.empty')}</p>
          </div>
        ) : (
          <div className="flex flex-col">
            <p className="t-sm mb-1" style={{ color: 'var(--color-muted)' }}>
              {t.plural('bookings.day.count', list.length)}
            </p>
            {/* Строка записи из README: точка статуса → время → клиент
                и услуга → бейдж и цена. Разделитель линией, а не зазором:
                в шторке строки короткие и без линии слипаются. */}
            {list.map((b) => (
              <span key={b.id} className="flex items-center gap-3 border-b"
                    style={{ paddingBlock: 11, borderColor: 'var(--color-border)' }}>
                <span className="status-dot" data-tone={statusTone(b.status)}
                      style={{ width: 7, height: 7 }} />
                <span className="tabular shrink-0"
                      style={{ width: 44, fontSize: 13, fontWeight: 600, color: 'var(--color-text)' }}>
                  {t.dateTime(b.start, { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate"
                        style={{ fontSize: 13, fontWeight: 650, color: 'var(--color-text)' }}>
                    {b.name}
                  </span>
                  <span className="block truncate"
                        style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                    {b.variant || b.title}
                  </span>
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className={
                    b.status === 'completed' ? 'badge-success'
                    : b.status === 'booked' ? 'badge-warn'
                    : b.status === 'cancelled' || b.status === 'no_show' ? 'badge'
                    : 'badge-accent'
                  }>
                    {statusLabel(t, b.status)}
                  </span>
                  <span className="tabular"
                        style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text)' }}>
                    {t.money(b.price)}
                  </span>
                </span>
              </span>
            ))}
            {/* Единственный выход из шторки в работу: день целиком.
                Переходы статусов лежат в таймлайне дня и в недельной
                сетке — третьей копии карты переходов не заводим. */}
            <Link href={dayHref(open)} className="btn-secondary mt-4"
                  onClick={() => setOpen(null)}>
              {t('bookings.view.day')}
            </Link>
          </div>
        ))}
      </Sheet>
    </>
  )
}
