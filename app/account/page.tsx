import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMemberships } from '@/lib/tenant'
import { PublicHeader, PublicFooter } from '@/components/shell'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Кабінет' }

export default async function AccountPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const memberships = await getMemberships()

  const [{ data: orders }, { data: bookings }] = await Promise.all([
    supabase.from('orders')
      .select('number, status, total, currency, created_at, tenant_id')
      .eq('buyer_user_id', user.id)
      .order('created_at', { ascending: false }).limit(8),
    supabase.from('bookings')
      .select('number, status, title, variant_name, period, tenant_id')
      .eq('buyer_user_id', user.id)
      .order('created_at', { ascending: false }).limit(8),
  ])

  const name = (user.user_metadata?.full_name as string | undefined) ?? user.email

  const ORDER_LABELS: Record<string, string> = {
    new: 'новий', confirmed: 'підтверджено', awaiting_payment: 'очікує оплати',
    paid: 'оплачено', packing: 'збирається', shipped: 'відправлено',
    delivered: 'доставлено', completed: 'виконано', cancelled: 'скасовано', returned: 'повернення',
  }
  const BOOKING_LABELS: Record<string, string> = {
    booked: 'заброньовано', confirmed: 'підтверджено', arrived: 'ви прийшли',
    completed: 'виконано', cancelled: 'скасовано', no_show: 'пропущено',
  }

  return (
    <>
      <PublicHeader authed cabinet />
      <main className="mx-auto max-w-3xl px-4 pt-10 sm:px-6">
        <div className="rise flex items-center justify-between gap-4">
          <div>
            <h1 className="display t-2xl">{name}</h1>
            <p className="t-sm mt-0.5 prose-muted">{user.email}</p>
          </div>
          <Link href="/account/security" className="btn-secondary">Безпека</Link>
        </div>

        {memberships.length > 0 && (
          <Link href="/app" className="card-link rise-1 mt-6 flex items-center justify-between">
            <div>
              <p className="t-lg">Кабінет підприємця</p>
              <p className="t-sm mt-0.5 prose-muted">Склад, записи, клієнти</p>
            </div>
            <span className="btn-primary">Відкрити</span>
          </Link>
        )}

        <section className="rise-2 mt-8">
          <h2 className="display mb-3 t-xl">Мої записи</h2>
          {bookings && bookings.length > 0 ? (
            <div className="card !p-0">
              {bookings.map((b) => (
                <div key={`${b.tenant_id}-${b.number}`} className="row px-5">
                  <div className="min-w-0">
                    <p className="t-md truncate">{b.title} · {b.variant_name}</p>
                    <p className="tabular t-sm mt-0.5 prose-muted">
                      {new Date(String(b.period).slice(2, 27)).toLocaleString('uk-UA', {
                        day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <span className={b.status === 'cancelled' ? 'badge' : 'badge-accent'}>
                    {BOOKING_LABELS[b.status] ?? b.status}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty card">Записів поки немає — знайдіть майстра через пошук</div>
          )}
        </section>

        <section className="rise-3 mt-8 pb-8">
          <h2 className="display mb-3 t-xl">Мої замовлення</h2>
          {orders && orders.length > 0 ? (
            <div className="card !p-0">
              {orders.map((o) => (
                <div key={`${o.tenant_id}-${o.number}`} className="row px-5">
                  <div>
                    <p className="tabular t-md">Замовлення №{o.number}</p>
                    <p className="tabular t-sm mt-0.5 prose-muted">
                      {new Date(o.created_at).toLocaleDateString('uk-UA')}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="badge">{ORDER_LABELS[o.status] ?? o.status}</span>
                    <p className="tabular t-md">{Number(o.total).toLocaleString('uk-UA')} ₴</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty card">Замовлень поки немає</div>
          )}
        </section>
      </main>
      <PublicFooter />
    </>
  )
}
