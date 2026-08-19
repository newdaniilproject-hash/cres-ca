// ⚠️ ВРЕМЕННАЯ страница приёмки вида. НЕ КОММИТИТЬ.
// Разбор — в шапке `app/zz-preview/page.tsx`. Данные — из хендоффа
// CRESKO, раздел D «Записи»: те же пять записей дня и та же россыпь
// дней с записями по месяцу.
//
// Месяц взят ТЕКУЩИЙ, а не «Травень 2025» из макета: подсветка «сьогодні»
// считается от часов браузера, и в мае 2025 её не увидеть вовсе — то есть
// именно та клетка, ради которой сверяют сетку, осталась бы непроверенной.
// Числа дней с записями повторены из макета один в один.
'use client'

import { useEffect, useState } from 'react'
import { BookingsClient } from '../../app/bookings/bookings-client'
import type { B } from '../../app/bookings/status'

const pad = (n: number) => String(n).padStart(2, '0')
const now = new Date()
const MONTH = `${now.getFullYear()}-${pad(now.getMonth() + 1)}`
const TODAY = `${MONTH}-${pad(now.getDate())}`

// Дни с записями — те же, что в макете (там это 1,2,3,5,6,8,9,10,…).
// Плюс сегодняшний: без него не проверить клетку «акцент + точка».
const DOTS = [1, 2, 3, 5, 6, 8, 10, 12, 13, 15, 16, 19, 20, 22, 23, 26, 27, 29, 30]

const at = (day: string, h: number, m: number, plusMinutes = 0) =>
  new Date(new Date(`${day}T${pad(h)}:${pad(m)}:00`).getTime() + plusMinutes * 60000)
    .toISOString()

let n = 0
const mk = (
  day: string, h: number, m: number, mins: number,
  name: string, variant: string, price: number, status: string,
): B => {
  n += 1
  return {
    id: `b${n}`, number: 1000 + n, title: variant, variant,
    start: at(day, h, m), end: at(day, h, m, mins),
    status, name, phone: null, price, deposit: 0, staff: 'Оксана',
  }
}

const DAY_LIST: B[] = [
  mk(TODAY, 9, 0, 60, 'Анна К.', 'Манікюр + гель-лак', 450, 'confirmed'),
  mk(TODAY, 10, 30, 60, 'Марія І.', 'Педикюр', 600, 'completed'),
  mk(TODAY, 12, 0, 90, 'Олена П.', 'Нарощування нігтів', 800, 'arrived'),
  mk(TODAY, 14, 30, 60, 'Вікторія С.', 'Корекція брів', 300, 'booked'),
  mk(TODAY, 16, 0, 45, 'Ірина В.', 'Зняття покриття', 250, 'confirmed'),
]

const MONTH_LIST: B[] = [
  ...DAY_LIST,
  ...DOTS.map((d, i) => mk(
    `${MONTH}-${pad(d)}`, 11, 0, 60,
    'Клієнтка', 'Манікюр', 500, i % 3 === 0 ? 'completed' : 'confirmed',
  )),
]

export default function BookingsPreview() {
  // Вид из адреса: `?view=day` рисует таймлайн, всё остальное — календарь.
  // Читается после монтирования — на сервере `location` не существует.
  const [view, setView] = useState<'calendar' | 'day' | 'week'>('calendar')
  useEffect(() => {
    const v = new URLSearchParams(window.location.search).get('view')
    if (v === 'day' || v === 'week') setView(v)
  }, [])

  return (
    <div id="page">
      <div className="px-4 py-4">
        <BookingsClient
          bookings={view === 'day' ? DAY_LIST : MONTH_LIST}
          view={view}
          weekStart={TODAY}
          month={MONTH}
          day={TODAY}
          tenantId="aaaaaaaa-0000-0000-0000-000000000001"
          canWrite
        />
      </div>
    </div>
  )
}
