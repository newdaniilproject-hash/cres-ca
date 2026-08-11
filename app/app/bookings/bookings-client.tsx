'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

type B = {
  id: string; number: number; title: string; variant: string; start: string
  status: string; name: string; phone: string | null
  price: number; deposit: number; staff: string
}

const NEXT: Record<string, { to: string; label: string; kind: 'primary' | 'secondary' }[]> = {
  booked:    [{ to: 'confirmed', label: 'Підтвердити', kind: 'primary' },
              { to: 'cancelled', label: 'Скасувати', kind: 'secondary' }],
  confirmed: [{ to: 'arrived', label: 'Клієнт прийшов', kind: 'primary' },
              { to: 'no_show', label: 'Не прийшов', kind: 'secondary' }],
  arrived:   [{ to: 'completed', label: 'Виконано', kind: 'primary' }],
}

const LABEL: Record<string, string> = {
  booked: 'нова', confirmed: 'підтверджена', arrived: 'у кріслі',
  completed: 'виконана', cancelled: 'скасована', no_show: 'не прийшов',
}

// Записи по дням. Кнопки — только разрешённые переходы; финальный
// «Виконано» сам спишет расходники по техкарте (это делает база).
export function BookingsClient({ bookings }: { bookings: B[] }) {
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
    if (error) { setErr(error.message); return }
    router.refresh()
  }

  const byDay = useMemo(() => {
    const map = new Map<string, B[]>()
    for (const b of bookings) {
      const key = new Date(b.start).toLocaleDateString('uk-UA', {
        weekday: 'long', day: 'numeric', month: 'long',
      })
      map.set(key, [...(map.get(key) ?? []), b])
    }
    return [...map.entries()]
  }, [bookings])

  if (bookings.length === 0) {
    return (
      <div className="empty card rise">
        <p className="display t-lg" style={{ color: 'var(--color-text)' }}>Записів немає</p>
        <p>Поділіться посиланням на вашу сторінку в Instagram — записи зʼявляться тут.</p>
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {err && <p className="field-error rise">{err}</p>}
      {byDay.map(([day, list], di) => (
        <section key={day} className={`rise-${Math.min(di + 1, 4)}`}>
          <h2 className="t-sm mb-2 capitalize prose-muted">{day}</h2>
          <div className="card !p-0">
            {list.map((b) => (
              <div key={b.id} className="row flex-wrap px-5">
                <div className="flex min-w-0 items-center gap-3">
                  <span className="tabular t-xl" style={{ color: 'var(--color-accent)' }}>
                    {new Date(b.start).toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <div className="min-w-0">
                    <p className="t-md truncate">
                      {b.name}
                      {b.phone && <a href={`tel:${b.phone}`} className="prose-muted"> · {b.phone}</a>}
                    </p>
                    <p className="tabular t-xs truncate prose-muted">
                      {b.title} · {b.variant} · {b.staff}
                      {b.deposit > 0 && ` · передоплата ${b.deposit.toLocaleString('uk-UA')} ₴`}
                    </p>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={
                    b.status === 'completed' ? 'badge-success'
                    : b.status === 'cancelled' || b.status === 'no_show' ? 'badge'
                    : 'badge-accent'
                  }>
                    {LABEL[b.status]}
                  </span>
                  {(NEXT[b.status] ?? []).map((a) => (
                    <button key={a.to}
                            className={a.kind === 'primary' ? 'btn-primary t-sm' : 'btn-secondary t-sm'}
                            disabled={busy === b.id}
                            onClick={() => void move(b.id, a.to)}>
                      {a.label}
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
