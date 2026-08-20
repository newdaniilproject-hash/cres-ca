'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useT } from '@/lib/i18n/client'
import { localeOf } from '@/lib/i18n/format'
import { IconBack, IconChevronRight, IconUser } from '@/components/icons'
import { eventTone, isVoid, statusLabel, type B } from './status'
import { dayOf, shiftDay } from './week'
import { dayHref, dayLabel } from './month'
import { BookingSheet } from './booking-sheet'

// ── Таймлайн дня (хендофф CRESKO, раздел D «Записи», вид «День») ────────────
//
// Час — это СТРОКА, а не пиксели по высоте. Разница с недельной сеткой
// принципиальная: там высота плашки означает длительность и потому
// считается от `HOUR`, здесь строка занимает столько, сколько занимает
// её содержимое, — в неё помещается аватар, имя, услуга, бейдж и цена,
// и растянуть её по минутам значило бы получить пустые полполосы
// у получасовой записи и обрезанный текст у пятнадцатиминутной.
//
// Что это даёт взамен: СВОБОДНЫЙ ЧАС виден как отдельная строка. Ради
// неё вид и существует — «куда я могу поставить клиента» на неделе
// не читается вовсе, а здесь это единственная пунктирная плашка.
const HOUR_MIN = 8   // границы дня по умолчанию: салон работает с 8
const HOUR_MAX = 20  // до 20, и уже этого сетка не сужает никогда
const GUTTER = 42    // колонка часов слева, README дословно

// Короче этого «свободное окно» не показываем. Причина не в вёрстке:
// плашка «09:55 – 10:00 Вільний час» приглашает поставить клиента в щель,
// в которую не помещается ни одна услуга салона (самая короткая в хендоффе
// — 45 хв). Пустая плашка, обещающая невозможное, хуже её отсутствия.
const MIN_FREE = 15

export function DayTimeline({ bookings, day }: {
  bookings: B[]
  /** Показанный день, `ГГГГ-ММ-ДД`. Живёт в адресе — разбор в `page.tsx`. */
  day: string
}) {
  const t = useT()
  const [open, setOpen] = useState<B | null>(null)

  // ЧАСЫ БРАУЗЕРА — ТОЛЬКО ПОСЛЕ ГИДРАТАЦИИ, по той же причине, что
  // и в недельной сетке: запись хранится моментом, а её час считается
  // в МЕСТНОМ поясе. Сервер живёт в UTC, мастер в Києві — одна и та же
  // запись встала бы на сервере в 09:00, а в браузере в 12:00, и разметка
  // сервера разошлась бы с первым кадром клиента.
  //
  // Поэтому с сервера приходит КАРКАС — часы 08:00–20:00 и подпись дня,
  // которые от пояса не зависят, — а записи раскладываются первым же
  // кадром после гидратации.
  const [ready, setReady] = useState(false)
  useEffect(() => { setReady(true) }, [])

  // Записи этого дня по часу начала. Часы дня расширяются по фактическим
  // записям (самая ранняя минус час, самая поздняя плюс час), но НИКОГДА
  // не сужаются уже 8–20: день, показанный полосой в два часа, читается
  // как поломка, а не как «записей нет».
  //
  // ВТОРАЯ ВЕЛИЧИНА ТОГО ЖЕ ПРОХОДА — ЗАНЯТЫЕ ОТРЕЗКИ, и без неё вид врал.
  // Раскладка шла по ЧАСУ НАЧАЛА, то есть запись 12:00–15:30 занимала одну
  // строку из четырёх, а 13:00, 14:00 и 15:00 рисовались пунктиром «Вільний
  // час» — прямо поверх клиента в кресле. Ради ответа «куда я могу поставить
  // клиента» этот вид и существует, и ошибался он ровно в нём.
  //
  // Отрезки минутами от полуночи, а не часами: услуга кончается в 15:30,
  // и округление до часа снова соврало бы — в одну сторону или в другую.
  const { byHour, freeByHour, hours, count } = useMemo(() => {
    const map = new Map<number, B[]>()
    // Занятое время дня, отрезками `[початок, кінець)` в минутах.
    // Отменённая запись и неявка занимают время НАРАВНЕ с остальными:
    // час, который уже прошёл, не становится свободным задним числом
    // (то же решение, что и у тона плашки — см. `./status`).
    const busy: [number, number][] = []
    let from = HOUR_MIN
    let to = HOUR_MAX
    if (ready) {
      for (const b of bookings) {
        const s = new Date(b.start)
        if (Number.isNaN(s.getTime()) || dayOf(s) !== day) continue
        const h = s.getHours()
        map.set(h, [...(map.get(h) ?? []), b])
        from = Math.min(from, h)

        // Конец записи может лежать в СЛЕДУЮЩИХ сутках (ночная смена)
        // либо быть неразобранным. В обоих случаях отрезок обрезается
        // концом дня: рисовать завтрашние часы в сегодняшнем дне нельзя.
        const e = new Date(b.end)
        const startMin = s.getHours() * 60 + s.getMinutes()
        const endMin = Number.isNaN(e.getTime()) || dayOf(e) !== day
          ? 24 * 60
          : Math.max(startMin, e.getHours() * 60 + e.getMinutes())
        busy.push([startMin, endMin])
        // Час КОНЦА, а не начала: иначе хвост длинной записи уезжал бы
        // за нижнюю границу показанных часов и просто не рисовался.
        to = Math.max(to, Math.min(24, Math.ceil(endMin / 60)))
      }
    }
    for (const list of map.values()) {
      list.sort((x, y) => x.start.localeCompare(y.start))
    }

    // Слияние пересекающихся отрезков: две записи разных мастеров на один
    // час — обычное дело, и без слияния свободное окно вычиталось бы
    // дважды, оставляя дыры там, где их нет.
    busy.sort((a, b) => a[0] - b[0])
    const merged: [number, number][] = []
    for (const [s, e] of busy) {
      const last = merged[merged.length - 1]
      if (last && s <= last[1]) last[1] = Math.max(last[1], e)
      else merged.push([s, e])
    }

    const hours = Array.from({ length: Math.max(1, to - from) }, (_, i) => from + i)

    // Свободные окна ЧАСА — это час минус занятое. Их может не быть вовсе
    // (час занят целиком), быть одно (обычный случай) или два (запись
    // посреди часа). Считаются на всём часе, а не «есть ли запись»:
    // ответ «свободно с 15:30» и есть то, за чем сюда приходят.
    const freeByHour = new Map<number, [number, number][]>()
    for (const h of hours) {
      const gaps: [number, number][] = []
      let cur = h * 60
      const end = cur + 60
      for (const [s, e] of merged) {
        if (e <= cur || s >= end) continue
        if (s > cur) gaps.push([cur, Math.min(s, end)])
        cur = Math.max(cur, e)
        if (cur >= end) break
      }
      if (cur < end) gaps.push([cur, end])
      freeByHour.set(h, gaps.filter(([s, e]) => e - s >= MIN_FREE))
    }

    return {
      byHour: map,
      freeByHour,
      hours,
      count: [...map.values()].reduce((n, l) => n + l.length, 0),
    }
  }, [bookings, day, ready])

  // Подпись времени по минутам от полуночи. Форматирует `t.dateTime`,
  // то есть локаль, а не экран; 24:00 сам печатается как «00:00».
  const atMin = (m: number) =>
    t.dateTime(new Date(2000, 0, 1, Math.floor(m / 60), m % 60),
               { hour: '2-digit', minute: '2-digit' })

  const hourLabel = (h: number) => atMin(h * 60)

  return (
    <div className="flex flex-col gap-3">
      {/* Шапка дня. Стрелки — ссылки: день живёт в адресе, «назад»
          браузера возвращает предыдущий, перезагрузка не сбрасывает
          на сегодня. Зона нажатия — 44px от `.btn-icon`. */}
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate" style={{ fontSize: 15, fontWeight: 700, color: 'var(--color-text)' }}>
          {dayLabel(localeOf(t.lang), day)}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <Link href={dayHref(shiftDay(day, -1))} className="btn-icon"
                aria-label={t('bookings.day.prev.aria')}>
            <IconBack size={20} />
          </Link>
          <Link href={dayHref(shiftDay(day, 1))} className="btn-icon"
                aria-label={t('bookings.day.next.aria')}>
            <IconChevronRight size={20} />
          </Link>
        </span>
      </div>

      {/* Число записей акцентом — из README. Оно отвечает на вопрос,
          с которым мастер открывает день, до того как он прочитает
          хоть одну строку. */}
      <p className="tabular" style={{ fontSize: 13, fontWeight: 650, color: 'var(--color-accent-ink)' }}>
        {t.plural('bookings.day.count', count)}
      </p>

      <div className="flex flex-col gap-2">
        {hours.map((h) => {
          const list = byHour.get(h) ?? []
          const gaps = freeByHour.get(h) ?? []
          // Час, занятый ЦЕЛИКОМ записью, которая началась раньше, строки
          // не получает вовсе. Сказать ему нечего: карточка выше называет
          // свой конец («12:00 – 15:30»), повторить её значило бы показать
          // одну запись четырьмя плашками, а пустая строка с одним номером
          // часа читается как «здесь что-то не загрузилось».
          if (list.length === 0 && gaps.length === 0) return null

          // Внутри часа окна и записи идут ПО ВРЕМЕНИ, а не сперва одни,
          // потом другие: в 16:00 запись до 16:30 обязана стоять выше
          // свободного окна 16:30–17:00, иначе строка читается задом
          // наперёд. Минута начала берётся здесь, а не в разборе выше:
          // до гидратации записей в часе нет вовсе (см. `ready`).
          const items: ({ at: number } & (
            { free: [number, number]; b?: never } | { b: B; free?: never }
          ))[] = [
            ...gaps.map((g) => ({ at: g[0], free: g })),
            ...list.map((b) => {
              const s = new Date(b.start)
              return { at: s.getHours() * 60 + s.getMinutes(), b }
            }),
          ].sort((x, y) => x.at - y.at)

          return (
            <div key={h} className="flex items-start gap-2">
              <span className="tabular shrink-0"
                    style={{
                      width: GUTTER, textAlign: 'right', paddingTop: 10,
                      fontSize: 12, fontWeight: 600, color: 'var(--color-faint)',
                    }}>
                {hourLabel(h)}
              </span>

              <span className="flex min-w-0 flex-1 flex-col gap-2">
                {/* Содержимое часа: свободные окна и записи вперемешку,
                    по времени.

                    Свободное окно — пунктир, а не сплошная рамка: это
                    не объект, а его отсутствие, и сплошная граница
                    читалась бы как ещё одна запись. И не кнопка:
                    запись заводится одним входом — «Новий запис» выше,
                    а двенадцать «кнопок» свободных часов были бы
                    двенадцатью вторыми входами в то же действие.

                    Границы окна — НАСТОЯЩИЕ, а не круглый час: после
                    записи до 15:30 плашка говорит «15:30 – 16:00», и это
                    ровно то время, в которое можно поставить клиента.
                    Окон в часе бывает и два — когда запись стоит посреди
                    него, — поэтому это список, а не развилка «есть запись
                    или нет». */}
                {items.map((it) => {
                  if (it.free) {
                    const [s, e] = it.free
                    return (
                      <span key={`f${s}`} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        gap: 8, minHeight: 'var(--tap-min)', padding: '10px 12px',
                        borderRadius: 'var(--radius-control)',
                        border: '1px dashed var(--color-border-strong)',
                        background: 'var(--color-surface-2)',
                      }}>
                        <span className="tabular" style={{ fontSize: 12, fontWeight: 600, color: 'var(--color-muted)' }}>
                          {atMin(s)} – {atMin(e)}
                        </span>
                        <span style={{ fontSize: 12, color: 'var(--color-faint)' }}>
                          {t('bookings.day.free')}
                        </span>
                      </span>
                    )
                  }
                  const b = it.b
                  const tone = eventTone(b.status)
                  return (
                    <button key={b.id} type="button" onClick={() => setOpen(b)}
                            style={{
                              display: 'flex', alignItems: 'center', gap: 10,
                              width: '100%', minHeight: 'var(--tap-min)',
                              padding: '10px 12px', textAlign: 'left',
                              borderRadius: 'var(--radius-control)',
                              border: `1px solid ${tone.line}`,
                              background: tone.fill,
                            }}>
                      {/* Аватар-кружок 34px из README. Фотографий клиентов
                          в продукте нет вовсе, поэтому в кружке значок,
                          а не буква имени: инициал «А» одинаков у Анни,
                          Анастасії й Аліни, то есть не различает никого. */}
                      <span aria-hidden style={{
                        width: 34, height: 34, borderRadius: 999,
                        display: 'grid', placeItems: 'center', flexShrink: 0,
                        background: 'var(--color-surface)', color: tone.ink,
                      }}>
                        <IconUser size={18} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="tabular block" style={{
                          fontSize: 12, fontWeight: 600, color: tone.ink,
                          textDecoration: isVoid(b.status) ? 'line-through' : undefined,
                        }}>
                          {t.dateTime(b.start, { hour: '2-digit', minute: '2-digit' })}
                          {' – '}
                          {t.dateTime(b.end, { hour: '2-digit', minute: '2-digit' })}
                        </span>
                        <span className="block truncate"
                              style={{ fontSize: 13, fontWeight: 650, color: 'var(--color-text)' }}>
                          {b.name}
                        </span>
                        <span className="block truncate"
                              style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                          {b.variant || b.title}
                        </span>
                      </span>
                      <span className="flex shrink-0 flex-col items-end gap-1">
                        <span className={
                          b.status === 'completed' ? 'badge-success'
                          : b.status === 'booked' ? 'badge-warn'
                          : isVoid(b.status) ? 'badge'
                          : 'badge-accent'
                        }>
                          {statusLabel(t, b.status)}
                        </span>
                        <span className="tabular"
                              style={{ fontSize: 12, fontWeight: 700, color: 'var(--color-text)' }}>
                          {t.money(b.price)}
                        </span>
                      </span>
                    </button>
                  )
                })}
              </span>
            </div>
          )
        })}
      </div>

      {/* Точки статуса, как в списке дня, здесь нет: состояние записи
          в плашке несут и тон заливки, и бейдж словом, а третий показ
          одной величины — это третий источник правды о ней. */}
      <BookingSheet booking={open} onClose={() => setOpen(null)} />
    </div>
  )
}
