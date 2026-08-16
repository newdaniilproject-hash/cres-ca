import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { OrdersClient } from './orders-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Замовлення' }

// Значения enum order_status. Список повторяет тот, что в orders-client:
// импортировать его оттуда нельзя — серверный компонент получил бы
// не массив, а ссылку на клиентский модуль, и упал бы на первом же .includes.
const ORDER_STATUSES = [
  'new', 'confirmed', 'awaiting_payment', 'paid', 'packing',
  'shipped', 'delivered', 'completed', 'cancelled', 'returned',
]

export default async function OrdersPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>
}) {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  if (!can(m, 'orders.read')) redirect('/app')
  if (!hasModule(m, 'orders')) return <ModuleOff m={m} module="orders" />

  const { status } = await searchParams
  // Чужое значение в адресе не должно уходить в запрос: незнакомый статус
  // не enum, и база ответила бы ошибкой вместо пустого списка.
  const active = status && ORDER_STATUSES.includes(status) ? status : 'all'

  const supabase = await createClient()

  let query = supabase
    .from('v_orders')
    .select(
      'id, number, status, contact_name, contact_phone, buyer_user_id, total, source, created_at',
      { count: 'exact' },
    )
    .eq('tenant_id', m.tenantId)
  if (active !== 'all') query = query.eq('status', active)

  const { data, error, count } = await query
    .order('created_at', { ascending: false })
    .limit(100)

  return (
    <AppShell modules={m.modules} perms={m.perms} active="/app/orders" title="Замовлення">
      <OrdersClient
        active={active}
        total={count ?? 0}
        error={error?.message ?? ''}
        orders={(data ?? []).map((o) => ({
          id: o.id,
          number: Number(o.number),
          status: o.status,
          name: o.contact_name,
          phone: o.contact_phone,
          guest: o.buyer_user_id === null,
          total: Number(o.total),
          source: o.source,
          createdAt: o.created_at,
        }))}
      />
    </AppShell>
  )
}
