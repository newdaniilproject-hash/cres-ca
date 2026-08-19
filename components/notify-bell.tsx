'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { useT } from '@/lib/i18n/client'
import { IconBell } from '@/components/icons'

// ── Колокол в шапке ─────────────────────────────────────────────────────────
//
// В прототипе CRESKO шапка держит колокол со счётчиком, и владелец просил
// «чтобы то, что макет показывает, было в точности отображено». Значок
// поставить легко; вопрос был в том, ЧТО он открывает.
//
// Кнопка, которая не открывает ничего, — это не украшение, а сломанная
// навигация: человек нажимает и решает, что приложение не работает
// (то же правило, по которому из меню убраны пункты без права).
// Поэтому колокол показывает НАСТОЯЩУЮ очередь — `notification_outbox`,
// строки со статусом `pending`: напоминания за 24 и 2 часа до записи,
// предупреждения о сроках годности, письма по заказам. То есть ровно
// то, что «потребує уваги» и вот-вот уйдёт клиенту.
//
// Чего он НЕ делает и почему. Это не «входящие» и не лента: своей ленты
// уведомлений у продавца в базе нет, и выдумывать её значит показывать
// пустоту с бодрой подписью. Здесь честно: что стоит в очереди на отправку.
//
// ЦЕНА ЗАПРОСА. Оболочка живёт в `app/app/layout.tsx` и НЕ перерисовывается
// при переходах внутри кабинета — значит счётчик считается один раз за
// открытие приложения, а не на каждый экран. Список подтягивается только
// когда шторку открыли: до нажатия за него не платим.
type Row = {
  id: string
  event: string
  channel: string
  send_after: string
  payload: Record<string, unknown>
}

export function NotifyBell({ tenantPerms }: { tenantPerms: string[] }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [count, setCount] = useState(0)
  const [rows, setRows] = useState<Row[] | null>(null)

  // Политика чтения очереди (0011) пускает по `customers.read` либо
  // к своим строкам. Без права спрашивать незачем — вернётся пусто,
  // а запрос уйдёт.
  const may = tenantPerms.includes('*') || tenantPerms.includes('customers.read')

  useEffect(() => {
    if (!may) return
    let alive = true
    void createClient()
      .from('notification_outbox')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'pending')
      .then(({ count: n }) => { if (alive && n) setCount(n) })
    return () => { alive = false }
  }, [may])

  useEffect(() => {
    if (!open || rows !== null) return
    let alive = true
    void createClient()
      .from('notification_outbox')
      .select('id, event, channel, send_after, payload')
      .eq('status', 'pending')
      .order('send_after', { ascending: true })
      .limit(30)
      .then(({ data }) => { if (alive) setRows((data ?? []) as Row[]) })
    return () => { alive = false }
  }, [open, rows])

  if (!may) return null

  return (
    <>
      <button type="button" onClick={() => setOpen(true)}
              aria-label={t('app.chrome.bell.aria')}
              className="iconbtn relative shrink-0">
        <IconBell />
        {count > 0 && (
          // Счётчик — это ЧИСЛО, а не точка: «есть что-то» и «висит
          // восемнадцать напоминаний» — разные новости. Больше 99
          // не показываем: три цифры не влезают в кружок, а разница
          // между 100 и 240 здесь ничего не меняет.
          <span
            aria-hidden
            className="tabular absolute grid place-items-center"
            style={{
              top: -4, right: -4, minWidth: 18, height: 18, padding: '0 5px',
              borderRadius: 999, fontSize: 11, fontWeight: 700, lineHeight: 1,
              background: 'var(--color-danger)', color: 'var(--color-accent-text)',
              border: '2px solid var(--color-bg)',
            }}
          >
            {count > 99 ? '99+' : count}
          </span>
        )}
      </button>

      <Sheet open={open} onClose={() => setOpen(false)} title={t('app.chrome.bell.title')}>
        {rows === null ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="skeleton-row px-1"><span /><span /><span /><span /></div>
            ))}
          </div>
        ) : rows.length === 0 ? (
          <div className="empty">
            <span className="empty-icon"><IconBell size={24} /></span>
            <p className="empty-title">{t('app.chrome.bell.empty')}</p>
            <p className="empty-desc">{t('app.chrome.bell.emptyDesc')}</p>
          </div>
        ) : (
          <div className="flex flex-col">
            {rows.map((r) => (
              <div key={r.id} className="row">
                <span className="min-w-0">
                  {/* Название события — служебный код (`booking.reminder`),
                      и человеку он ничего не говорит. Переводим по словарю,
                      а незнакомое показываем как есть: молчать о письме,
                      которое уйдёт клиенту, хуже, чем показать его код. */}
                  <span className="t-md block truncate">{eventLabel(t, r.event)}</span>
                  <span className="t-xs block truncate" style={{ color: 'var(--color-faint)' }}>
                    {t.date(r.send_after, {
                      day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
                    })} · {r.channel}
                  </span>
                </span>
              </div>
            ))}
          </div>
        )}
      </Sheet>
    </>
  )
}

// Подписи известных событий. Ключей мало намеренно: список пополняется
// по мере того, как события реально начинают ставиться в очередь, —
// заводить подпись под то, чего никто не шлёт, значит держать словарь
// строк, которых не увидят.
function eventLabel(t: ReturnType<typeof useT>, event: string): string {
  const known: Record<string, string> = {
    'booking.reminder': t('app.chrome.bell.event.bookingReminder'),
    'booking.created': t('app.chrome.bell.event.bookingCreated'),
    'order.created': t('app.chrome.bell.event.orderCreated'),
    'expiry.warning': t('app.chrome.bell.event.expiry'),
  }
  return known[event] ?? event
}
