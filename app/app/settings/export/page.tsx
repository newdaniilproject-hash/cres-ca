import { redirect } from 'next/navigation'
import { currentMembership, can } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { ExportClient } from './export-client'
import { getT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getT()
  return { title: t('app.screen.export.title') }
}

// ── Выгрузка заведения ─────────────────────────────────────────────────────
//
// В условиях сделки с первым клиентом записано дословно: «его данные —
// его собственность с выгрузкой в любой момент». Выгрузка существовала
// ровно одна — база клиентов; заказы, записи, склад, журналы, техкарты
// и финансы не выгружались никак. То есть обещание не выполнялось.
//
// ПОЧЕМУ ЭКРАН НИЧЕГО НЕ ЧИТАЕТ ЗДЕСЬ, НА СЕРВЕРЕ. Данные тянет клиент,
// вызовами `tenant_export` по разделам. Это не лень: выгрузка — действие,
// а не просмотр, и каждый её вызов пишется в журнал доступа (0090).
// Прочитать всё на сервере «на всякий случай» значило бы записать
// выгрузку заведения при каждом ОТКРЫТИИ страницы — журнал перестал бы
// отличать «зашёл посмотреть» от «унёс всё».
//
// Модуля у экрана нет намеренно: право забрать свои данные не продаётся
// отдельно и не зависит от того, что заведение купило.
export default async function ExportPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  // На вход — `settings.read`, как и у самих настроек. Что именно человек
  // сможет выгрузить, решают права РАЗДЕЛОВ, и решает их база: экран лишь
  // не показывает заведомо недоступное.
  if (!can(m, 'settings.read')) redirect('/app')

  return (
    <AppShell modules={m.modules} perms={m.perms}>
      <ExportClient
        tenantId={m.tenantId}
        allowed={{
          tenant: can(m, 'settings.read'),
          catalog: can(m, 'catalog.read'),
          orders: can(m, 'orders.read'),
          bookings: can(m, 'orders.read'),
          customers: can(m, 'customers.read'),
          staff: can(m, 'orders.read'),
          inventory: can(m, 'stock.read'),
          movements: can(m, 'stock.read'),
          journals: can(m, 'compliance.read'),
          techcards: can(m, 'compliance.read'),
          finance: can(m, 'finances.read'),
        }}
        contacts={can(m, 'customers.contacts')}
      />
    </AppShell>
  )
}
