import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getMemberships } from '@/lib/tenant'
import { PublicHeader, PublicFooter } from '@/components/shell'
import { getT } from '@/lib/i18n/server'

export const dynamic = 'force-dynamic'

// Заголовок вкладки браузера — строка интерфейса, поэтому из словаря.
// Разбор решения — в `app/app/journals/page.tsx`.
export async function generateMetadata() {
  const t = await getT()
  return { title: t('account.meta.title') }
}

export default async function AccountPage() {
  const t = await getT()
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

  // Подписи к состояниям — свои, покупательские: продавец видит
  // «нове замовлення», покупатель — «новий». Значения перечислений
  // (`awaiting_payment`, `no_show`) не переводятся: это ключи базы.
  const ORDER_STATUSES = [
    'new', 'confirmed', 'awaiting_payment', 'paid', 'packing',
    'shipped', 'delivered', 'completed', 'cancelled', 'returned',
  ] as const
  const BOOKING_STATUSES = [
    'booked', 'confirmed', 'arrived', 'completed', 'cancelled', 'no_show',
  ] as const
  const orderLabel = (v: string) =>
    ((ORDER_STATUSES as readonly string[]).includes(v)
      ? t(`account.order.status.${v as (typeof ORDER_STATUSES)[number]}`) : v)
  const bookingLabel = (v: string) =>
    ((BOOKING_STATUSES as readonly string[]).includes(v)
      ? t(`account.booking.status.${v as (typeof BOOKING_STATUSES)[number]}`) : v)

  return (
    <>
      <PublicHeader authed />
      <main className="mx-auto max-w-3xl px-4 pt-10 sm:px-6">
        <div className="rise flex items-center justify-between gap-4">
          <div>
            <h1 className="display t-2xl">{name}</h1>
            <p className="t-sm mt-0.5 prose-muted">{user.email}</p>
          </div>
          <Link href="/account/security" className="btn-secondary">{t('account.link.security')}</Link>
        </div>

        {memberships.length > 0 && (
          <Link href="/app" className="card-link rise-1 mt-6 flex items-center justify-between">
            <div>
              <p className="t-lg">{t('account.business.title')}</p>
              <p className="t-sm mt-0.5 prose-muted">{t('account.business.desc')}</p>
            </div>
            <span className="btn-primary">{t('account.business.open')}</span>
          </Link>
        )}

        <section className="rise-2 mt-8">
          <h2 className="display mb-3 t-xl">{t('account.bookings.title')}</h2>
          {bookings && bookings.length > 0 ? (
            <div className="card !p-0">
              {bookings.map((b) => (
                <div key={`${b.tenant_id}-${b.number}`} className="row px-5">
                  <div className="min-w-0">
                    <p className="t-md truncate">{b.title} · {b.variant_name}</p>
                    <p className="tabular t-sm mt-0.5 prose-muted">
                      {t.dateTime(String(b.period).slice(2, 27), {
                        day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
                      })}
                    </p>
                  </div>
                  <span className={b.status === 'cancelled' ? 'badge' : 'badge-accent'}>
                    {bookingLabel(b.status)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty card">{t('account.bookings.empty')}</div>
          )}
        </section>

        <section className="rise-3 mt-8 pb-8">
          <h2 className="display mb-3 t-xl">{t('account.orders.title')}</h2>
          {orders && orders.length > 0 ? (
            <div className="card !p-0">
              {orders.map((o) => (
                <div key={`${o.tenant_id}-${o.number}`} className="row px-5">
                  <div>
                    <p className="tabular t-md">
                      {t('account.order.number', { number: Number(o.number) })}
                    </p>
                    <p className="tabular t-sm mt-0.5 prose-muted">{t.date(o.created_at)}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="badge">{orderLabel(o.status)}</span>
                    {/* Символ валюты ставит Intl (`t.money`), а не подстановка «₴». */}
                    <p className="tabular t-md">{t.money(Number(o.total), o.currency)}</p>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="empty card">{t('account.orders.empty')}</div>
          )}
        </section>
      </main>
      <PublicFooter />
    </>
  )
}
