'use client'

import { useEffect, useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import { dbErrorText } from '@/lib/errors/db'
import { NEXT, statusLabel, statusTone, type B } from './status'
import { NewBookingButton } from './new-booking'
import { WeekGrid } from './week-grid'
import { dayOf, mondayOf } from './week'

// Записи по дням. Кнопки — только разрешённые переходы; финальный
// «Виконано» сам спишет расходники по техкарте (это делает база).
//
// Состояния записи (подписи, переходы, тон) переехали в `./status.ts`,
// когда у экрана появился второй вид: недельная сетка показывает те же
// записи и обязана предлагать те же переходы. Разбор — в шапке того файла.
export function BookingsClient({
  bookings, view, weekStart, tenantId, canWrite,
}: {
  bookings: B[]
  /** Какой вид показан. Живёт в адресе — разбор в `page.tsx`. */
  view: 'day' | 'week'
  /** Понедельник показанной недели, `ГГГГ-ММ-ДД`. */
  weekStart: string
  tenantId: string
  /** `orders.write` — то же право, которое проверяет сам `create_booking`. */
  canWrite: boolean
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')

  async function move(id: string, to: string) {
    setBusy(id); setErr('')
    const { error } = await supabase.rpc('set_booking_status', {
      p_booking_id: id, p_status: to,
    })
    setBusy(null)
    if (error) { setErr(dbErrorText(t, error)); return }
    router.refresh()
  }

  // Подпись дня собирает `t.date` по локали языка интерфейса, а не
  // жёсткий 'uk-UA'. Пересчитывается при смене языка — он в зависимостях.
  const byDay = useMemo(() => {
    const map = new Map<string, B[]>()
    for (const b of bookings) {
      const key = t.date(b.start, { weekday: 'long', day: 'numeric', month: 'long' })
      map.set(key, [...(map.get(key) ?? []), b])
    }
    return [...map.entries()]
  }, [bookings, t])

  // Ссылка на неделю ведёт в ТЕКУЩУЮ неделю человека, а её знает только
  // браузер: сервер живёт в UTC. Считаем после гидратации, до неё —
  // адрес без недели, который сервер закрывает своим умолчанием. Так
  // разметка сервера и первого клиентского кадра совпадает буква в букву;
  // посчитать местный понедельник прямо в разметке значило бы отдать
  // разные `href` и получить предупреждение гидратации на пустом месте.
  const [localWeek, setLocalWeek] = useState<string | null>(null)
  useEffect(() => { setLocalWeek(mondayOf(dayOf())) }, [])
  const weekHref = localWeek === null
    ? '/app/bookings?view=week'
    : `/app/bookings?view=week&week=${localWeek}`

  // Шапка раздела: слева переключатель вида, справа вход в мастеров.
  //
  // Вход в мастеров — здесь, внутри раздела, а не пунктом нижней панели:
  // панель держит то, между чем прыгают за смену, а расписание правят
  // раз в месяц (CLAUDE.md → «Мобильная версия»). Ссылка стоит выше
  // развилки «есть записи / пусто» намеренно: на пустом экране она нужнее
  // всего — записей нет ровно потому, что мастера ещё не заведены.
  //
  // Переключатель — ССЫЛКИ, а не кнопки с состоянием: вид уезжает
  // в адрес вместе с неделей, и «назад» браузера возвращает туда,
  // откуда пришли. Скелетон перехода уже лежит в `loading.tsx`,
  // поэтому нажатие отзывается, не дожидаясь Ирландии.
  const head = (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="seg">
        <Link href="/app/bookings" className="seg-item" data-active={view === 'day'}>
          {t('bookings.view.day')}
        </Link>
        <Link href={weekHref} className="seg-item" data-active={view === 'week'}>
          {t('bookings.view.week')}
        </Link>
      </div>
      <div className="flex items-center gap-2">
        <Link href="/app/bookings/staff" className="btn-secondary t-sm">
          {t('bookings.toStaff')}
        </Link>
        {/* Единственный вход в создание записи из кабинета — и он один
            на оба вида: сетка и список показывают одни и те же записи,
            и вторая кнопка внутри сетки была бы вторым входом в одно
            действие (та же ошибка, что разбиралась на складе, М31).
            Разбор самой формы — в шапке `new-booking.tsx`. */}
        {canWrite && <NewBookingButton tenantId={tenantId} className="btn-primary t-sm" />}
      </div>
    </div>
  )

  if (view === 'week') {
    return (
      <div className="flex flex-col gap-4">
        {head}
        <WeekGrid bookings={bookings} weekStart={weekStart} />
      </div>
    )
  }

  if (bookings.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {head}
        <div className="empty card rise">
          <p className="display t-lg" style={{ color: 'var(--color-text)' }}>
            {t('bookings.empty.title')}
          </p>
          <p>{t('bookings.empty.desc')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {head}
      {err && <p className="field-error rise">{err}</p>}
      {byDay.map(([day, list], di) => (
        <section key={day} className={`rise-${Math.min(di + 1, 4)}`}>
          {/* Надзаголовок дня — из макета: капслок, а не серая строка
              над сплошной карточкой. Разделитель по датам, который
              список группирует, теперь виден и когда карточек несколько:
              каждый день — свой отступ и своя подпись, а не одна лента. */}
          <p className="eyebrow mb-2">{day}</p>
          <div className="flex flex-col gap-2">
            {list.map((b) => (
              <div key={b.id} className="list-card flex-wrap items-start">
                <span className="status-dot mt-2" data-tone={statusTone(b.status)} />
                <span className="tabular t-lg shrink-0" style={{ color: 'var(--color-accent)', minWidth: 52 }}>
                  {t.dateTime(b.start, { hour: '2-digit', minute: '2-digit' })}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="t-md block truncate">
                    {b.name}
                    {b.phone && <a href={`tel:${b.phone}`} className="prose-muted"> · {b.phone}</a>}
                  </span>
                  <span className="tabular t-xs block truncate" style={{ color: 'var(--color-faint)' }}>
                    {b.title} · {b.variant} · {b.staff}
                    {b.deposit > 0
                      && ` · ${t('bookings.deposit', { sum: t.money(b.deposit) })}`}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1.5">
                  <span className={
                    b.status === 'completed' ? 'badge-success'
                    : b.status === 'cancelled' || b.status === 'no_show' ? 'badge'
                    : 'badge-accent'
                  }>
                    {statusLabel(t, b.status)}
                  </span>
                  {/* Сумма — то, ради чего мастер вообще смотрит на строку
                      записи мельком: она в макете стоит на самом видном
                      месте, справа снизу. У нас это `price`, а не сумма
                      с депозитом — депозит уже назван строкой выше. */}
                  <span className="tabular t-sm" style={{ color: 'var(--color-faint)' }}>
                    {t.money(b.price)}
                  </span>
                </span>
                {(NEXT[b.status] ?? []).length > 0 && (
                  <div className="flex w-full shrink-0 items-center gap-2 pt-1">
                    {(NEXT[b.status] ?? []).map((a) => (
                      <button key={a.to}
                              className={a.kind === 'primary' ? 'btn-primary t-sm' : 'btn-secondary t-sm'}
                              disabled={busy === b.id}
                              onClick={() => void move(b.id, a.to)}>
                        {t(`bookings.action.${a.to}`)}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
