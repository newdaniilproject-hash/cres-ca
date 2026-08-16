import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can, hasModule } from '@/lib/tenant'
import { ModuleOff } from '@/components/module-gate'
import { AppShell } from '@/components/shell'
import { BookingsClient } from './bookings-client'
import { getT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

// Заголовок вкладки браузера — строка интерфейса, поэтому из словаря.
// Разбор решения — в `app/app/journals/page.tsx`.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('bookings.meta.title') }
}

export default async function BookingsPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  // Записи закрыты `orders.read`, а не своим правом: отдельного
  // `bookings.*` в базе нет — политика `bookings_read` (0010) стоит
  // на `orders.read`. Без этой проверки accountant и inspector
  // открывали экран прямым адресом и видели пустой список вместо
  // внятного «этот раздел не ваш».
  if (!can(m, 'orders.read')) redirect('/app')
  // Право `orders.read` общее у записей и заказов (0010), а модули у них
  // разные: заведение может взять записи и не брать интернет-заказы.
  if (!hasModule(m, 'bookings')) return <ModuleOff m={m} module="bookings" />

  const supabase = await createClient()

  const { data } = await supabase
    .from('v_bookings')
    .select('id, number, title, variant_name, period, status, contact_name, contact_phone, price, deposit_due, staff(name)')
    .eq('tenant_id', m.tenantId)
    .gte('period', `[${new Date(Date.now() - 864e5).toISOString()},)`)
    .order('period')
    .limit(100)

  return (
    <AppShell modules={m.modules} perms={m.perms}>
      <BookingsClient
        bookings={(data ?? []).map((b) => ({
          id: b.id, number: b.number, title: b.title, variant: b.variant_name,
          start: String(b.period).match(/"([^"]+)"/)?.[1] ?? '',
          status: b.status, name: b.contact_name, phone: b.contact_phone,
          price: Number(b.price), deposit: Number(b.deposit_due),
          staff: (b.staff as unknown as { name: string })?.name ?? '',
        }))}
      />
    </AppShell>
  )
}
