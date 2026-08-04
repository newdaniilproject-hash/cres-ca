import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { currentMembership } from '@/lib/tenant'
import { AppShell } from '@/components/shell'
import { BookingsClient } from './bookings-client'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Записи' }

export default async function BookingsPage() {
  const m = await currentMembership()
  if (!m) redirect('/register/seller')
  const supabase = await createClient()

  const { data } = await supabase
    .from('bookings')
    .select('id, number, title, variant_name, period, status, contact_name, contact_phone, price, deposit_due, staff(name)')
    .eq('tenant_id', m.tenantId)
    .gte('period', `[${new Date(Date.now() - 864e5).toISOString()},)`)
    .order('period')
    .limit(100)

  return (
    <AppShell modules={m.modules} active="/app/bookings" title="Записи">
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
