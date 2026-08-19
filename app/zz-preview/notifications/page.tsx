// ⚠️ ВРЕМЕННАЯ страница приёмки вида. НЕ КОММИТИТЬ.
// Разбор — в шапке `app/zz-preview/page.tsx`. Данные — из хендоффа CRESKO,
// экран `notifications`: те же пять поводов, что нарисованы в макете.
'use client'

import { useT } from '@/lib/i18n/client'
import { Sheet } from '@/components/sheet'
import { NotifyList } from '@/components/notify-bell'

const EXTRA: Record<string, string> = {
  'app.chrome.bell.pending': 'У черзі: {n}',
  'app.chrome.bell.sheetTitle': 'Сповіщення',
}

const ROWS = [
  { id: 'n1', event: 'expiry.warning', channel: 'email', send_after: '2026-08-19T09:12:00Z', payload: {} },
  { id: 'n2', event: 'expiry.warning', channel: 'email', send_after: '2026-08-19T08:40:00Z', payload: {} },
  { id: 'n3', event: 'booking.created', channel: 'push', send_after: '2026-08-19T08:05:00Z', payload: {} },
  { id: 'n4', event: 'order.created', channel: 'email', send_after: '2026-08-18T18:20:00Z', payload: {} },
  { id: 'n5', event: 'booking.reminder', channel: 'push', send_after: '2026-08-18T21:15:00Z', payload: {} },
]

export default function NotificationsPreview() {
  const base = useT()
  const t = new Proxy(base, {
    apply(target, thisArg, args: [string, Record<string, string>?]) {
      const raw = EXTRA[args[0]]
      if (raw === undefined) return Reflect.apply(target as never, thisArg, args)
      return Object.entries(args[1] ?? {}).reduce(
        (s, [k, v]) => s.replaceAll(`{${k}}`, String(v)), raw,
      )
    },
  }) as typeof base

  return (
    <div id="page">
      <Sheet open onClose={() => {}} title={t('app.chrome.bell.sheetTitle')}>
        <NotifyList t={t} rows={ROWS} />
      </Sheet>
    </div>
  )
}
