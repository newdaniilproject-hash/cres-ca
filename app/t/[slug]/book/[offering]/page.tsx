import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PublicHeader } from '@/components/shell'
import { BookingFlow } from './booking-flow'

export const dynamic = 'force-dynamic'

// Страница записи: вариант → день → время → имя и телефон. Четыре шага
// на одном экране, каждый следующий появляется после предыдущего —
// человек из инстаграма не должен увидеть форму из десяти полей.
export default async function BookPage({
  params,
}: {
  params: Promise<{ slug: string; offering: string }>
}) {
  const { slug, offering } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()

  const { data: shop } = await supabase
    .from('tenants')
    .select('id, name, slug')
    .eq('slug', slug)
    .eq('status', 'active')
    .eq('storefront_enabled', true)
    .maybeSingle()
  if (!shop) notFound()

  const { data: off } = await supabase
    .from('offerings')
    .select('id, title, subtitle, price, deposit_percent, cancel_window_hours')
    .eq('id', offering)
    .eq('tenant_id', shop.id)
    .eq('kind', 'service')
    .eq('status', 'active')
    .maybeSingle()
  if (!off) notFound()

  const { data: variants } = await supabase
    .from('offering_variants')
    .select('id, name, price, duration_minutes')
    .eq('offering_id', off.id)
    .eq('is_active', true)
    .order('position')

  return (
    <>
      <PublicHeader authed={!!user} />
      <main className="mx-auto max-w-xl px-4 pb-16 pt-10 sm:px-6">
        <p className="rise text-sm prose-muted">{shop.name}</p>
        <h1 className="display rise mt-1 text-3xl font-semibold tracking-tight">{off.title}</h1>
        {off.subtitle && <p className="rise-1 mt-2 text-sm prose-muted">{off.subtitle}</p>}

        <BookingFlow
          tenantId={shop.id}
          variants={(variants ?? []).map((v) => ({
            id: v.id, name: v.name,
            price: v.price != null ? Number(v.price) : null,
            minutes: v.duration_minutes ?? 60,
          }))}
          depositPercent={off.deposit_percent}
          cancelWindow={off.cancel_window_hours}
        />
      </main>
    </>
  )
}
