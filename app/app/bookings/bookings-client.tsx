'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useT } from '@/lib/i18n/client'
import { localeOf } from '@/lib/i18n/format'
import { IconBack, IconCalendar, IconChevronRight, IconGrid, IconList } from '@/components/icons'
import { NewBookingButton } from './new-booking'
import { WeekGrid } from './week-grid'
import { MonthGrid } from './month-grid'
import { DayTimeline } from './day-timeline'
import { dayOf, mondayOf, shiftDay, weekHref, weekLabel } from './week'
import { dayHref, monthHref, monthOf } from './month'
import type { B } from './status'

// Записи. Три вида одних и тех же данных, и вид живёт в АДРЕСЕ:
// `?view=calendar&month=…`, `?day=…`, `?view=week&week=…`.
//
// Состояния записи (подписи, переходы, тон) лежат в `./status.ts`,
// карточка записи — в `./booking-sheet.tsx`: их читают все три вида,
// и второй копии ни у чего из этого нет.
export function BookingsClient({
  bookings, view, weekStart, month, day, tenantId, canWrite,
}: {
  bookings: B[]
  /** Какой вид показан. Живёт в адресе — разбор в `page.tsx`. */
  view: 'day' | 'week' | 'calendar'
  /** Понедельник показанной недели, `ГГГГ-ММ-ДД`. */
  weekStart: string
  /** Показанный месяц, `ГГГГ-ММ`. */
  month: string
  /** Показанный день, `ГГГГ-ММ-ДД`. */
  day: string
  tenantId: string
  /** `orders.write` — то же право, которое проверяет сам `create_booking`. */
  canWrite: boolean
}) {
  const t = useT()

  // Ссылки на «сегодня» ведут в ТЕКУЩИЙ день человека, а его знает только
  // браузер: сервер живёт в UTC. Считаем после гидратации, до неё — адрес
  // без параметра, который сервер закрывает своим умолчанием. Так разметка
  // сервера и первого клиентского кадра совпадает буква в букву.
  const [localDay, setLocalDay] = useState<string | null>(null)
  useEffect(() => { setLocalDay(dayOf()) }, [])

  const toDayHref = localDay === null ? '/app/bookings' : dayHref(localDay)
  const toWeekHref = localDay === null
    ? '/app/bookings?view=week'
    : weekHref(mondayOf(localDay))
  const toMonthHref = localDay === null
    ? '/app/bookings?view=calendar'
    : monthHref(monthOf(localDay))

  // Подпись недели — тем же сборщиком, что и в сетке (`./week`): одна
  // строка стоит и в мобильном ряду навигации, и подзаголовком веб-хедера.
  const label = useMemo(
    () => weekLabel(localeOf(t.lang), weekStart),
    [weekStart, t],
  )

  // ── Переключатель вида ──────────────────────────────────────────────────
  //
  // Геометрия из README (раздел D) дословно: контейнер `padding:4`,
  // `radius:14`, `1px solid border`; активный вариант на `accentSoft`
  // с текстом акцентом. Это НЕ общая `.seg` из globals.css — та пилюля
  // на 999px живёт в настройках профиля (тема, язык), и обе формы
  // осознанно разные: там переключают настройку, здесь — рабочий вид
  // экрана во всю ширину.
  //
  // Варианты — ССЫЛКИ, а не кнопки с состоянием: вид уезжает в адрес
  // вместе с днём, месяцем и неделей, и «назад» браузера возвращает
  // туда, откуда пришли. Скелетон перехода лежит в `loading.tsx`,
  // поэтому нажатие отзывается, не дожидаясь Ирландии.
  //
  // ТРЕТИЙ ВАРИАНТ — «Тиждень» — сверх макета, и он остаётся. В хендоффе
  // его нет, потому что там вида два; в продукте недельная сетка уже
  // построена и отвечает на вопрос, которого не задают ни месяц, ни
  // день: «как загружена неделя целиком». Удалить работающий вид
  // ради совпадения с картинкой значило бы вернуть его через неделю.
  // По ширине он помещается: три подписи на 390px занимают около 230px
  // из 358 доступных, и зона нажатия остаётся 44px у каждой.
  const seg: [string, string, boolean, typeof IconCalendar][] = [
    [toMonthHref, t('bookings.view.calendar'), view === 'calendar', IconCalendar],
    [toDayHref, t('bookings.view.day'), view === 'day', IconList],
    [toWeekHref, t('bookings.view.week'), view === 'week', IconGrid],
  ]

  const head = (
    <>
      {/* ═══ CRESKO Web §2 «Календар» — хедер экрана, ТОЛЬКО lg ═════════
          Плашка со значком, имя экрана тем же ключом, которым его называют
          панель и вкладка браузера; подзаголовок — неделя словами, когда
          показана сетка, и обычное описание раздела в остальных видах.
          Справа — две иконки-кнопки навигации недели и «Додати запис», как
          в хендоффе. Кнопка не дублируется, а ПЕРЕЕЗЖАЕТ: мобильный её
          экземпляр ниже стоит под `lg:hidden` (шторка формы рисуется
          только у открытой — двух форм в документе не бывает). */}
      <div className="mb-1 hidden items-center gap-3 lg:flex">
        <span aria-hidden className="flex shrink-0 items-center justify-center"
              style={{
                width: 44, height: 44,
                borderRadius: 'var(--radius-plate)',
                background: 'var(--color-accent-soft)',
                color: 'var(--color-accent-ink)',
              }}>
          <IconCalendar size={22} />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="webh1" data-size="27">{t('app.screen.bookings.title')}</h1>
          <p style={{ fontSize: 14, color: 'var(--color-muted)' }}>
            {view === 'week'
              ? t('bookings.web.subtitle', { range: label })
              : t('app.screen.bookings.desc')}
          </p>
        </div>
        {view === 'week' && (
          <div className="flex shrink-0 items-center gap-1">
            {/* «Поточний тиждень» — сверх README: на телефоне он есть,
                и десктоп, листнувший на месяц вперёд, без него остался бы
                со стрелками наперевес. Рисуется после гидратации — текущую
                неделю ЧЕЛОВЕКА знает только браузер (см. `localDay`). */}
            {localDay !== null && mondayOf(localDay) !== weekStart && (
              <Link href={weekHref(mondayOf(localDay))} className="btn-secondary t-sm mr-1">
                {t('bookings.week.current')}
              </Link>
            )}
            {/* Стрелки — обведённые квадраты 44px, как в §2, а не голые
                значки: на белой карточке-шапке `.btn-icon` без рамки
                не читается кнопкой вовсе. Ширина утилитой поверх
                `.btn-secondary` — её горизонтальный отступ рассчитан
                на подпись, которой здесь нет. */}
            <Link href={weekHref(shiftDay(weekStart, -7))} className="btn-secondary w-11 !px-0"
                  aria-label={t('bookings.week.prev.aria')}>
              <IconBack size={20} />
            </Link>
            <Link href={weekHref(shiftDay(weekStart, 7))} className="btn-secondary w-11 !px-0"
                  aria-label={t('bookings.week.next.aria')}>
              <IconChevronRight size={20} />
            </Link>
          </div>
        )}
        {canWrite && <NewBookingButton tenantId={tenantId} className="btn-primary shrink-0" />}
      </div>

      {/* Переключатель вида и вход в карточки мастеров — ОДНОЙ строкой
          на широком экране и двумя на телефоне.

          На lg переключатель перестаёт тянуться во всю ширину: три подписи,
          растянутые на 1140px, читаются не переключателем, а тремя
          вкладками страницы, и между «Календар» и «Тиждень» получается
          пол-экрана пустоты. Ширина по содержимому плюс «Майстри» справа
          снимают с экрана целый ряд — тот самый, которого в макете нет. */}
      <div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex lg:flex-none" style={{
          gap: 4, padding: 4,
          borderRadius: 'var(--radius-card)',
          border: '1px solid var(--color-border)',
          background: 'var(--color-surface)',
        }}>
          {seg.map(([href, text, active, Icon]) => (
            <Link key={href} href={href} className="flex-1 lg:flex-none lg:px-5"
                  style={{
                    minHeight: 'var(--tap-min)',
                    display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                    gap: 6,
                    borderRadius: 'var(--radius-plate)',
                    fontSize: 13, fontWeight: 650,
                    background: active ? 'var(--color-accent-soft)' : undefined,
                    color: active ? 'var(--color-accent-ink)' : 'var(--color-muted)',
                  }}>
              <Icon size={16} />
              {text}
            </Link>
          ))}
        </div>

        <div className="flex items-center justify-between gap-2">
          <Link href="/app/bookings/staff" className="btn-secondary t-sm">
            {t('bookings.toStaff')}
          </Link>
          {/* Единственный вход в создание записи из кабинета — и он один
              на все три вида: они показывают одни и те же записи, и вторая
              кнопка внутри вида была бы вторым входом в одно действие (та же
              ошибка, что разбиралась на складе, М31). На lg кнопка живёт
              в веб-хедере выше — этот экземпляр прячется, а не дублируется.
              Разбор самой формы — в шапке `new-booking.tsx`. */}
          {canWrite && <NewBookingButton tenantId={tenantId} className="btn-primary t-sm lg:hidden" />}
        </div>
      </div>
    </>
  )

  return (
    <div className="flex flex-col gap-4">
      {head}
      {view === 'week' ? (
        <WeekGrid bookings={bookings} weekStart={weekStart} />
      ) : view === 'calendar' ? (
        <MonthGrid bookings={bookings} month={month} />
      ) : (
        <DayTimeline bookings={bookings} day={day} />
      )}
    </div>
  )
}
