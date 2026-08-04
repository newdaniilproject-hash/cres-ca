import { notFound, redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { OrderDetail } from './order-detail'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Замовлення' }

export default async function OrderPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  if (!can(m, 'orders.read')) redirect('/app')

  const { id } = await params
  const supabase = await createClient()

  // Явный фильтр по арендатору поверх RLS: политика orders_read пускает
  // ещё и покупателя к своим заказам, а это кабинет продавца — сюда
  // чужой заказ не должен попасть даже случайно.
  const { data: order, error } = await supabase
    .from('orders')
    .select(
      `id, number, status, contact_name, contact_phone, contact_email, buyer_user_id,
       delivery_method, delivery_city, delivery_branch, delivery_address, tracking_number,
       comment, cancel_reason, subtotal, discount, total, paid_amount, source, created_at`,
    )
    .eq('id', id)
    .eq('tenant_id', m.tenantId)
    .maybeSingle()

  if (error) {
    return (
      <AppShell active="/app/orders" title="Замовлення">
        <p className="field-error rise">Не вдалося відкрити замовлення: {error.message}</p>
      </AppShell>
    )
  }
  if (!order) notFound()

  const [
    { data: { user } },
    { data: items, error: itemsError },
    { data: events, error: eventsError },
    { data: transitions, error: transitionsError },
  ] = await Promise.all([
    supabase.auth.getUser(),
    supabase.from('order_items')
      .select('id, title, variant_name, unit_price, quantity')
      .eq('order_id', order.id)
      .order('created_at'),
    supabase.from('order_events')
      .select('id, from_status, to_status, note, actor, created_at')
      .eq('order_id', order.id)
      .order('created_at'),
    // Разрешённые переходы — данные, а не константа в коде: матрица
    // может поменяться миграцией, и экран обязан узнать об этом сам.
    supabase.from('order_status_transitions')
      .select('to_status')
      .eq('from_status', order.status),
  ])

  return (
    <AppShell active="/app/orders" title={`Замовлення №${order.number}`}>
      <OrderDetail
        canWrite={can(m, 'orders.write')}
        userId={user?.id ?? ''}
        loadError={[itemsError?.message, eventsError?.message, transitionsError?.message]
          .filter(Boolean).join(' · ')}
        allowed={(transitions ?? []).map((t) => String(t.to_status))}
        order={{
          id: order.id,
          number: Number(order.number),
          status: order.status,
          name: order.contact_name,
          phone: order.contact_phone,
          email: order.contact_email,
          guest: order.buyer_user_id === null,
          deliveryMethod: order.delivery_method,
          deliveryCity: order.delivery_city,
          deliveryBranch: order.delivery_branch,
          deliveryAddress: order.delivery_address,
          tracking: order.tracking_number,
          comment: order.comment,
          cancelReason: order.cancel_reason,
          subtotal: Number(order.subtotal),
          discount: Number(order.discount),
          total: Number(order.total),
          paid: Number(order.paid_amount),
          source: order.source,
          createdAt: order.created_at,
        }}
        items={(items ?? []).map((i) => ({
          id: i.id,
          title: i.title,
          variant: i.variant_name,
          price: Number(i.unit_price),
          qty: Number(i.quantity),
        }))}
        events={(events ?? []).map((e) => ({
          id: e.id,
          from: e.from_status,
          to: e.to_status,
          note: e.note,
          actor: e.actor,
          at: e.created_at,
        }))}
      />
    </AppShell>
  )
}
