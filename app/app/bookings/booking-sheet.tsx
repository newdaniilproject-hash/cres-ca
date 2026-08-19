'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import { dbErrorText } from '@/lib/errors/db'
import { Sheet } from '@/components/sheet'
import { NEXT, isVoid, statusLabel, type B } from './status'

// Карточка записи в шторке — ОДНА на все виды раздела.
//
// Отдельного экрана записи в продукте нет вовсе: в списке дня действия
// лежат прямо в строке, а в сетках (неделя, таймлайн дня) в плашку не
// помещается ни одна кнопка. Поэтому нажатие на плашку открывает эту
// шторку, и она же несёт разрешённые переходы.
//
// ПОЧЕМУ ОТДЕЛЬНЫЙ ФАЙЛ. До таймлайна дня она жила внутри недельной
// сетки. Видов с плашками стало два, и вторая копия разъехалась бы
// с первой в тот день, когда в карточку добавят строку, — ровно та
// причина, по которой из экрана уже вынут `./status.ts`. Карта
// переходов при этом всё равно одна и лежит там; здесь только
// раскладка и вызов `set_booking_status`, который запрещённый переход
// не пропустит, даже если этот файл соврёт.
export function BookingSheet({ booking, onClose }: {
  /** Открытая запись; `null` — шторка закрыта. */
  booking: B | null
  onClose: () => void
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  async function move(id: string, to: string) {
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('set_booking_status', {
      p_booking_id: id, p_status: to,
    })
    setBusy(false)
    if (error) { setErr(dbErrorText(t, error)); return }
    onClose()
    router.refresh()
  }

  return (
    <Sheet open={booking !== null} onClose={onClose}
           title={booking ? t('bookings.card.title', { number: booking.number }) : undefined}>
      {booking && (
        <div className="flex flex-col gap-3">
          <p className="tabular t-lg" style={{ color: 'var(--color-accent-ink)' }}>
            {t.dateTime(booking.start, {
              weekday: 'long', day: 'numeric', month: 'long',
              hour: '2-digit', minute: '2-digit',
            })}
          </p>
          <p className="t-md">
            {booking.name}
            {booking.phone && <a href={`tel:${booking.phone}`} className="prose-muted"> · {booking.phone}</a>}
          </p>
          <p className="t-sm" style={{ color: 'var(--color-faint)' }}>
            {booking.title} · {booking.variant} · {booking.staff}
          </p>
          <p className="flex items-center gap-2">
            <span className={
              booking.status === 'completed' ? 'badge-success'
              : isVoid(booking.status) ? 'badge'
              : 'badge-accent'
            }>
              {statusLabel(t, booking.status)}
            </span>
            <span className="tabular t-sm" style={{ color: 'var(--color-faint)' }}>
              {t.money(booking.price)}
              {booking.deposit > 0 && ` · ${t('bookings.deposit', { sum: t.money(booking.deposit) })}`}
            </span>
          </p>
          {err && <p className="field-error">{err}</p>}
          {(NEXT[booking.status] ?? []).length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1">
              {(NEXT[booking.status] ?? []).map((a) => (
                <button key={a.to} type="button"
                        className={a.kind === 'primary' ? 'btn-primary t-sm' : 'btn-secondary t-sm'}
                        disabled={busy}
                        onClick={() => void move(booking.id, a.to)}>
                  {t(`bookings.action.${a.to}`)}
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </Sheet>
  )
}
