import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { OrdersClient } from './orders-client'
// Список статусов — из общего модуля, а не своей копией. Копия здесь
// была вынужденной, пока перечисление жило в клиентском `orders-client`;
// теперь оно в `./status` (без `'use client'`), и вторая копия молча
// разошлась бы с первой на первой же миграции.
import { ORDER_STATUSES } from './status'
import { getT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

// Заголовок вкладки браузера — строка интерфейса, поэтому из словаря.
// Разбор решения — в `app/app/journals/page.tsx`.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('orders.meta.title') }
}

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
  //
  // `working` — единственное значение, которого в перечислении НЕТ, и оно
  // здесь не «ещё один статус», а починка плитки. Плитка «В роботі» знает
  // своё число, но вела на «Усі» — то есть говорила «дев'ять» и открывала
  // сто двадцать восемь. Число, которое нельзя открыть, заставляет искать
  // эти девять глазами по списку, а два разных числа на одну дверь читаются
  // как ошибка счёта.
  const active = status === 'working' || (status && ORDER_STATUSES.includes(status))
    ? status
    : 'all'

  const supabase = await createClient()

  // «В роботі» — не отдельный статус, а всё, что уже принято и ещё
  // не закрыто: от `confirmed` до `delivered`. `new` из него исключён
  // намеренно — у него своя плитка, и заказ, посчитанный дважды, делает
  // сумму плиток больше «усього». Один список и на счётчик, и на отбор:
  // две копии разошлись бы, и плитка показывала бы одно число, а список
  // под ней — другое.
  const IN_WORK = ['confirmed', 'awaiting_payment', 'paid', 'packing', 'shipped', 'delivered']

  // ⚠️ `contact_phone` ЗДЕСЬ НЕ ЗАПРАШИВАЕТСЯ, и это то же решение, что
  // на экране клиентов. Телефон покупателя в СПИСКЕ читается глазами
  // и не оставляет следа; в карточке заказа он открывается осознанно.
  // Список, отдающий контакты сотне строк за раз, — это выгрузка базы
  // без кнопки «выгрузить». Разбор — notes/pii-leaks.md.
  //
  // `paid_amount` тянется ради колонки «Оплата» на десктопе: заказ
  // «оплачено» по статусу и «деньги пришли» — разные утверждения, и
  // второе есть только в этом числе.
  let query = supabase
    .from('v_orders')
    .select(
      'id, number, status, contact_name, buyer_user_id, total, paid_amount, source, created_at',
      { count: 'exact' },
    )
    .eq('tenant_id', m.tenantId)
  if (active === 'working') query = query.in('status', IN_WORK)
  else if (active !== 'all') query = query.eq('status', active)

  // Счётчики шапки — тремя запросами БЕЗ строк (`head: true`): считать их
  // из выданной сотни значило бы показывать «усього 100» у заведения
  // с тысячей заказов. README, розділ G: «Статистика (усього / нові /
  // виконані)» — три величины и ровно они, потому что отвечают на
  // «сколько всего», «что требует меня» и «что закрыто».
  //
  // Четвёртая величина «в роботі» (§19) считается по тому же `IN_WORK`,
  // по которому идёт её отбор, — разбор выше.
  const countOf = (status?: string | string[]) => {
    let q = supabase.from('v_orders')
      .select('id', { count: 'exact', head: true })
      .eq('tenant_id', m.tenantId)
    if (Array.isArray(status)) q = q.in('status', status)
    else if (status) q = q.eq('status', status)
    return q
  }

  const [{ data, error, count }, all, fresh, working, done] = await Promise.all([
    query.order('created_at', { ascending: false }).limit(100),
    countOf(),
    countOf('new'),
    countOf(IN_WORK),
    countOf('completed'),
  ])

  // Число позиций в заказе — вторым запросом по видимым строкам, а не
  // связью из `v_orders`: у представления PostgREST выводит связи не всегда,
  // и отказ в разборе положил бы весь список ради одной колонки. Запрос
  // отдаёт только `order_id` — это индекс, и он не читает ни цен, ни имён.
  const ids = (data ?? []).map((o) => o.id)
  const { data: itemRows } = ids.length
    ? await supabase.from('order_items').select('order_id')
        .eq('tenant_id', m.tenantId).in('order_id', ids)
    : { data: [] as { order_id: string }[] }
  const itemCount = new Map<string, number>()
  for (const row of itemRows ?? []) {
    itemCount.set(row.order_id, (itemCount.get(row.order_id) ?? 0) + 1)
  }

  return (
    <AppShell modules={m.modules} perms={m.perms}>
      <OrdersClient
        active={active}
        tenantId={m.tenantId}
        // `orders.write` решает только, рисовать ли кнопку «Нове
        // замовлення»: сам `create_order` проверяет это право внутри.
        canWrite={can(m, 'orders.write')}
        total={count ?? 0}
        stats={{
          all: all.count ?? 0,
          fresh: fresh.count ?? 0,
          working: working.count ?? 0,
          done: done.count ?? 0,
        }}
        error={error?.message ?? ''}
        orders={(data ?? []).map((o) => ({
          id: o.id,
          number: Number(o.number),
          status: o.status,
          name: o.contact_name,
          guest: o.buyer_user_id === null,
          total: Number(o.total),
          paid: Number(o.paid_amount ?? 0),
          items: itemCount.get(o.id) ?? 0,
          source: o.source,
          createdAt: o.created_at,
        }))}
      />
    </AppShell>
  )
}
