'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'
import { localeOf } from '@/lib/i18n/format'
import { Sheet } from '@/components/sheet'
import { IconBack, IconCalendar, IconChevronRight } from '@/components/icons'
import { eventTone, isVoid, statusLabel, statusTone, type B } from './status'
import { dayOf } from './week'
import {
  cap, dayHref, dayLabel, monthHref, monthLabel, monthOf, monthStart, monthWeeks, shiftMonth,
} from './month'

// ── Месячная сетка записей (хендофф CRESKO, раздел D «Записи») ──────────────
//
// Геометрия ТЕЛЕФОНА из README дословно и константами, а не числами по
// разметке: клетка дня 29×29 при радиусе 9, зазор между клетками 2, ряд
// дней недели 10px/650 `faint`, контейнер — радиус календаря.
//
// ГЛАВНОЕ РЕШЕНИЕ ФАЙЛА: клетка — это КНОПКА в 44px высотой, внутри
// которой лежит квадрат 29×29. Уменьшить кнопку до квадрата нельзя —
// правило зоны нажатия старше макета, и промах по соседнему дню в
// календаре стоит открытой шторки не того дня. Увеличить квадрат тоже
// нельзя: семь квадратов по 44 не помещаются в 390px вместе с полями
// экрана, а сетка календаря обязана быть квадратной.
//
// ── ДЕСКТОП: ТОТ ЖЕ КАЛЕНДАРЬ, А НЕ ВТОРОЙ ─────────────────────────────────
//
// До 26.08.2026 на широком экране стояла ровно телефонная карточка
// шириной 520px у левого края, правая половина экрана пустовала, а про
// день было известно одно: точка есть или точки нет. То есть месяц
// отвечал на вопрос «есть ли вообще записи», а не «что за месяц» —
// ради ответа приходилось открывать день за днём.
//
// Разметка при этом ОДНА. Цикл по клеткам, обработчик нажатия и разбор
// записей по дням общие; отличается то, ЧТО показано внутри клетки:
// на телефоне точка (`lg:hidden`), на широком — сами записи строками
// (`hidden lg:flex`). Второй сетки не заводим: две копии календарной
// арифметики разъехались бы на первом же переводе часов, а заметил бы
// это тот, у кого запись уехала на день.
//
// Панель дня справа — тот же `.wpanel`, что на «Клієнтах» и в «Команді»:
// список слева, карточка выбранного справа. И она показана ВСЕГДА, а не
// по нажатию: панель, появляющаяся после выбора, переставляет сетку под
// рукой, а до выбора оставляет ту же пустую половину, ради которой всё
// и переделывалось.
const CELL = 29        // сторона клетки дня (телефон)
const CELL_RADIUS = 9  // её скругление — ступень мельче `--radius-plate`

// Сколько записей показывает клетка на широком экране. Четвёртая и дальше
// сворачиваются в «+N»: клетка обязана остаться одной высоты у всех дней,
// иначе строка недели с загруженным вторником вытягивается вся.
const CHIPS = 3

/** Местная полночь дня: и на сервере, и в браузере это один календарный
 *  день, поэтому подписи совпадают и гидратация не спорит. */
const at = (day: string) => new Date(`${day}T00:00:00`)

/**
 * Список записей дня. ОДИН на шторку телефона и на панель десктопа.
 *
 * Вынесен из шторки не ради порядка в файле: у строки записи есть точка
 * состояния, бейдж словом, цена и правило «отменённую видно, но она не
 * зовёт к действию». Вторая копия этого списка потеряла бы что-нибудь
 * одно, и потеряла бы молча (правило прохода экранов, пункт 9).
 */
function DayList({ list, day, t, onGo }: {
  list: B[]
  day: string
  t: T
  /** Закрыть шторку перед уходом. На панели закрывать нечего. */
  onGo?: () => void
}) {
  return (
    <div className="flex flex-col">
      {list.length === 0 ? (
        <div className="empty">
          <span className="empty-icon"><IconCalendar size={24} /></span>
          <p className="empty-desc">{t('bookings.day.empty')}</p>
        </div>
      ) : (
        <>
          <p className="t-sm mb-1" style={{ color: 'var(--color-muted)' }}>
            {t.plural('bookings.day.count', list.length)}
          </p>
          {/* Строка записи из README: точка статуса → время → клиент
              и услуга → бейдж и цена. Разделитель линией, а не зазором:
              строки короткие и без линии слипаются. */}
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
        </>
      )}

      {/* Выход из дня в работу — и у ПУСТОГО дня тоже.
          Ссылка стояла внутри ветки «записи есть», и панель дня без
          записей оставалась тупиком: ни одной кнопки, ни одного способа
          что-то в этот день завести. Правило прохода экранов, пункт 3:
          пустое состояние — одно, и с действием. Найдено измерением
          26.08.2026 (в панели пустого дня было ноль кнопок).

          Переходы статусов и форма новой записи лежат в самом дне —
          третьей копии ни того, ни другого здесь не заводим. */}
      <Link href={dayHref(day)} className="btn-secondary mt-4" onClick={onGo}>
        {t('bookings.day.open')}
      </Link>
    </div>
  )
}

export function MonthGrid({ bookings, month }: { bookings: B[]; month: string }) {
  const t = useT()
  const [open, setOpen] = useState<string | null>(null)
  // Куда показывать выбранный день. Шторка уходит порталом в `body`,
  // и спрятать её обёрткой `lg:hidden` нельзя — раскладку решает то,
  // ОТКУДА пришло нажатие. Тот же приём и та же причина, что на экране
  // клиентов. Начальное значение — `panel`: день выбирается сам (ниже),
  // и на телефоне это не должно распахивать шторку без нажатия.
  const [where, setWhere] = useState<'sheet' | 'panel'>('panel')

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
    // Внутри дня — по времени. Порядок из выборки сюда не годится:
    // сервер сортирует весь месяц, а клетка показывает первые три
    // записи ДНЯ, и без сортировки это были бы три случайные.
    for (const [k, v] of map) {
      map.set(k, [...v].sort((a, b) => a.start.localeCompare(b.start)))
    }
    return map
  }, [bookings, today])

  // ── Какой день открыт по умолчанию ───────────────────────────────────
  //
  // Сегодняшний, если показанный месяц — текущий. Иначе первый день
  // с записями: человек листает месяцы, чтобы что-то найти, и панель
  // с пустым первым числом ему об этом месяце ничего не говорит.
  // Если записей нет вовсе — первое число: панель обязана сказать
  // «в цей день записів немає», а не остаться пустым местом.
  const fallback = useMemo(() => {
    if (today === null) return null
    if (monthOf(today) === month) return today
    const withBookings = weeks
      .flat()
      .filter((c) => c.inMonth && (byDay.get(c.day)?.length ?? 0) > 0)
    return withBookings[0]?.day ?? monthStart(month)
  }, [today, month, weeks, byDay])

  // Выбор сбрасывается на умолчание при смене месяца — иначе панель
  // показывала бы день, которого в сетке уже нет.
  useEffect(() => { setOpen(fallback) }, [fallback])

  const list = open === null ? [] : byDay.get(open) ?? []

  return (
    <>
      {/* На широком: сетка и панель дня рядом. `items-start` — чтобы
          панель не растягивалась под высоту сетки, а стояла у верха. */}
      <div className="flex flex-col gap-5 lg:flex-row lg:items-start">

        <div className="card rise min-w-0 flex-1"
             style={{ borderRadius: 'var(--radius-calendar)' }}>
          {/* Шапка месяца. Стрелки — ССЫЛКИ, а не кнопки с состоянием:
              месяц живёт в адресе, поэтому «назад» браузера возвращает
              предыдущий, а перезагрузка не сбрасывает на текущий. Зона
              нажатия — 44px от `.btn-icon`, а не размер стрелки. */}
          <div className="flex items-center justify-between gap-2">
            <Link href={monthHref(shiftMonth(month, -1))} className="btn-icon"
                  aria-label={t('bookings.month.prev.aria')}>
              <IconBack size={20} />
            </Link>
            <span className="lg:text-[17px]"
                  style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>
              {label}
            </span>
            <Link href={monthHref(shiftMonth(month, 1))} className="btn-icon"
                  aria-label={t('bookings.month.next.aria')}>
              <IconChevronRight size={20} />
            </Link>
          </div>

          {/* Ряд дней недели */}
          <div className="mt-2 grid grid-cols-7 gap-[2px] lg:gap-1.5">
            {/* Подписи дней недели — от известного понедельника, а не от
                `weeks[0]`: первая клетка сетки почти всегда лежит в прошлом
                месяце, но день недели у неё тот же. Первый день недели —
                понедельник и только он (разбор — в шапке `./week`). */}
            {weeks[0].map((c) => (
              <span key={c.day} className="text-center lg:text-left lg:px-2"
                    style={{ fontSize: 10, fontWeight: 650, color: 'var(--color-faint)' }}>
                {cap(t.date(at(c.day), { weekday: 'short' }))}
              </span>
            ))}
          </div>

          {/* Недели */}
          <div className="mt-1 flex flex-col gap-[2px] lg:gap-1.5">
            {weeks.map((week) => (
              <div key={week[0].day} className="grid grid-cols-7 gap-[2px] lg:gap-1.5">
                {week.map((c) => {
                  // Дни соседних месяцев занимают своё место ПУСТЫМИ, а не
                  // числами: ряд без них поехал бы, и «1 травня» встало бы
                  // не под своим днём недели, — но показанный «31 квітня»
                  // на экране «Серпень» отвечает на вопрос о другом месяце.
                  if (!c.inMonth) {
                    return <span key={c.day} className="min-h-[var(--tap-min)] lg:min-h-[104px]" />
                  }

                  const day = byDay.get(c.day) ?? []
                  const isToday = c.day === today
                  const picked = c.day === open
                  return (
                    <button key={c.day} type="button"
                            aria-pressed={picked}
                            onClick={() => {
                              // Раскладку выясняет `matchMedia` в момент
                              // нажатия: обработчик клиентский, разметку он
                              // не рисует, поэтому расхождения с серверным
                              // рендером не бывает. Тот же приём, что на
                              // экране клиентов.
                              setWhere(window.matchMedia('(min-width: 1024px)').matches
                                ? 'panel' : 'sheet')
                              setOpen(c.day)
                            }}
                            data-picked={picked}
                            // Подсветка выбранного дня живёт в `.mday`
                            // (globals.css) и только на широком экране:
                            // инлайновым стилем медиазапрос не выразить,
                            // и заливка протекала на телефон.
                            className="mday min-h-[var(--tap-min)] flex flex-col items-center
                                       justify-center gap-[3px] lg:min-h-[104px] lg:items-stretch
                                       lg:justify-start lg:gap-1 lg:rounded-xl lg:border
                                       lg:border-[var(--color-border)] lg:p-1.5
                                       lg:transition-colors">
                      <span className="tabular self-center lg:self-start" style={{
                        width: CELL, height: CELL, borderRadius: CELL_RADIUS,
                        display: 'grid', placeItems: 'center',
                        fontSize: 14, fontWeight: 650,
                        background: isToday ? 'var(--color-accent)' : undefined,
                        color: isToday ? 'var(--color-accent-text)' : 'var(--color-text)',
                      }}>
                        {t.date(at(c.day), { day: 'numeric' })}
                      </span>

                      {/* ТЕЛЕФОН: точка — единственный признак «здесь есть
                          записи». Место под неё занято всегда, иначе клетки
                          с записями и без прыгали бы по высоте. Цвет один
                          и тот же под любым днём: точка лежит НА КАРТОЧКЕ,
                          а не внутри клетки, и «белая на сегодня» просто
                          исчезала бы с белого фона. */}
                      <span aria-hidden className="lg:hidden" style={{
                        width: 4, height: 4, borderRadius: 999,
                        background: day.length > 0 ? 'var(--color-accent)' : 'transparent',
                      }} />

                      {/* ШИРОКИЙ ЭКРАН: сами записи. Тон — из `eventTone`,
                          того же, что красит плашки недельной сетки: одно
                          состояние обязано выглядеть одинаково во всех трёх
                          видах, иначе цвет перестаёт что-либо значить. */}
                      <span aria-hidden className="hidden min-w-0 flex-col gap-0.5 lg:flex">
                        {day.slice(0, CHIPS).map((b) => {
                          const tone = eventTone(b.status)
                          return (
                            <span key={b.id}
                                  className="flex min-w-0 items-center gap-1 truncate"
                                  style={{
                                    background: tone.fill, color: tone.ink,
                                    borderLeft: `2px solid ${tone.line}`,
                                    // Левый угол ПРЯМОЙ, и это не придирка:
                                    // скруглённый угол рядом с полоской тона
                                    // рисует дугу, и плашка читается как
                                    // открывающая скобка перед временем.
                                    // Найдено рендером 26.08.2026.
                                    borderRadius: '0 5px 5px 0',
                                    paddingInline: '3px 4px',
                                    fontSize: 11, lineHeight: '17px', fontWeight: 600,
                                  }}>
                              <span className="tabular shrink-0"
                                    style={{
                                      textDecoration: isVoid(b.status) ? 'line-through' : undefined,
                                    }}>
                                {t.dateTime(b.start, { hour: '2-digit', minute: '2-digit' })}
                              </span>
                              <span className="truncate">{b.name}</span>
                            </span>
                          )
                        })}
                        {day.length > CHIPS && (
                          <span className="px-1"
                                style={{ fontSize: 11, lineHeight: '15px', color: 'var(--color-muted)' }}>
                            {t('bookings.month.more', { n: t.number(day.length - CHIPS) })}
                          </span>
                        )}
                      </span>
                    </button>
                  )
                })}
              </div>
            ))}
          </div>
        </div>

        {/* Панель дня — только на широком. Стоит ВСЕГДА: см. шапку файла. */}
        <aside className="wpanel hidden lg:block">
          <p className="mb-1" style={{ fontSize: 17, fontWeight: 700, color: 'var(--color-text)' }}>
            {open === null ? ' ' : dayLabel(localeOf(t.lang), open)}
          </p>
          {open !== null && <DayList list={list} day={open} t={t} />}
        </aside>
      </div>

      {/* Шторка дня — телефон. Общий `Sheet`, а не своя всплывающая панель:
          у шторки в этом продукте есть жест, замок прокрутки под ней и
          портал в `body` (разбор — в шапке `components/sheet.tsx`), и
          вторая реализация потеряла бы всё это молча. */}
      <Sheet open={where === 'sheet' && open !== null} onClose={() => setWhere('panel')}
             title={open === null ? undefined : dayLabel(localeOf(t.lang), open)}>
        {open !== null && (
          <DayList list={list} day={open} t={t} onGo={() => setWhere('panel')} />
        )}
      </Sheet>
    </>
  )
}
