'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'
import { dbErrorText } from '@/lib/errors/db'

type B = {
  id: string; number: number; title: string; variant: string; start: string
  status: string; name: string; phone: string | null
  price: number; deposit: number; staff: string
}

// Разрешённые переходы. Подписи здесь больше не лежат: `to` — служебное
// значение перечисления, оно уезжает в `set_booking_status`, а надпись
// на кнопке берётся по нему из словаря (`bookings.action.<to>`).
// Тип `to` не `string` намеренно: забытый ключ ловит `tsc`, а не экран.
type BookingAction = 'confirmed' | 'cancelled' | 'arrived' | 'no_show' | 'completed'
const NEXT: Record<string, { to: BookingAction; kind: 'primary' | 'secondary' }[]> = {
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
const statusLabel = (t: T, v: string): string =>
  ((STATUSES as readonly string[]).includes(v) ? t(`bookings.status.${v as BookingStatus}`) : v)

// Записи по дням. Кнопки — только разрешённые переходы; финальный
// «Виконано» сам спишет расходники по техкарте (это делает база).
export function BookingsClient({ bookings }: { bookings: B[] }) {
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

  // Вход в мастеров — здесь, внутри раздела, а не пунктом нижней панели:
  // панель держит то, между чем прыгают за смену, а расписание правят
  // раз в месяц (CLAUDE.md → «Мобильная версия»). Ссылка стоит выше
  // развилки «есть записи / пусто» намеренно: на пустом экране она нужнее
  // всего — записей нет ровно потому, что мастера ещё не заведены.
  const toStaff = (
    <div className="flex items-center justify-end">
      <Link href="/app/bookings/staff" className="btn-secondary t-sm">
        {t('bookings.toStaff')}
      </Link>
    </div>
  )

  if (bookings.length === 0) {
    return (
      <div className="flex flex-col gap-4">
        {toStaff}
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
      {toStaff}
      {err && <p className="field-error rise">{err}</p>}
      {byDay.map(([day, list], di) => (
        <section key={day} className={`rise-${Math.min(di + 1, 4)}`}>
          <h2 className="t-sm mb-2 capitalize prose-muted">{day}</h2>
          <div className="card !p-0">
            {list.map((b) => (
              <div key={b.id} className="row flex-wrap px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="tabular t-xl" style={{ color: 'var(--color-accent)' }}>
                    {t.dateTime(b.start, { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <div className="min-w-0">
                    <p className="t-md truncate">
                      {b.name}
                      {b.phone && <a href={`tel:${b.phone}`} className="prose-muted"> · {b.phone}</a>}
                    </p>
                    <p className="tabular t-xs truncate prose-muted">
                      {b.title} · {b.variant} · {b.staff}
                      {b.deposit > 0
                        && ` · ${t('bookings.deposit', { sum: t.money(b.deposit) })}`}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={
                    b.status === 'completed' ? 'badge-success'
                    : b.status === 'cancelled' || b.status === 'no_show' ? 'badge'
                    : 'badge-accent'
                  }>
                    {statusLabel(t, b.status)}
                  </span>
                  {(NEXT[b.status] ?? []).map((a) => (
                    <button key={a.to}
                            className={a.kind === 'primary' ? 'btn-primary t-sm' : 'btn-secondary t-sm'}
                            disabled={busy === b.id}
                            onClick={() => void move(b.id, a.to)}>
                      {t(`bookings.action.${a.to}`)}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </section>
      ))}
    </div>
  )
}
