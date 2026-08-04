import type { Metadata } from 'next'
import Link from 'next/link'
import { cache } from 'react'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PublicHeader, PublicFooter } from '@/components/shell'

export const revalidate = 60

type Offering = {
  id: string; slug: string; title: string; subtitle: string | null
  kind: 'product' | 'service'; price: number | null; currency: string
  rating_avg: number; rating_count: number
}
type Staff = { id: string; name: string; title: string | null }
type Shop = {
  name: string; tagline: string | null; description: string | null
  city: string | null; address: string | null; kind: string
}
type Storefront = { shop: Shop; offerings: Offering[] | null; staff: Staff[] | null }

// cache() из React: заголовок страницы и сама страница рендерятся в одном
// запросе, поэтому функция базы вызывается один раз, а не дважды.
const getStorefront = cache(async (slug: string): Promise<Storefront | null> => {
  const supabase = await createClient()
  const { data } = await supabase.rpc('storefront', { p_slug: slug })
  return (data ?? null) as Storefront | null
})

// Заголовок вкладки и выдачи — имя заведения: витрина живёт как отдельный
// сайт продавца, «Маркетплейс» здесь только суффиксом (шаблон из layout).
export async function generateMetadata({
  params,
}: {
  params: Promise<{ slug: string }>
}): Promise<Metadata> {
  const { slug } = await params
  const data = await getStorefront(slug)
  if (!data) return { title: 'Заклад не знайдено' }
  const { name, tagline, description, city } = data.shop
  return {
    title: city ? `${name} · ${city}` : name,
    description: tagline ?? description ?? undefined,
  }
}

// Витрина заведения — та самая ссылка в шапку Instagram.
// Всё содержимое приходит одной функцией базы (storefront).
export default async function ShopPage({
  params,
}: {
  params: Promise<{ slug: string }>
}) {
  const { slug } = await params
  const supabase = await createClient()
  const [{ data: { user } }, data] = await Promise.all([
    supabase.auth.getUser(),
    getStorefront(slug),
  ])

  if (!data) notFound()
  const shop = data.shop
  const offerings = data.offerings ?? []
  const staff = data.staff ?? []
  const services = offerings.filter((o) => o.kind === 'service')
  const products = offerings.filter((o) => o.kind === 'product')

  return (
    <>
      <PublicHeader authed={!!user} />

      <main className="mx-auto max-w-4xl px-4 sm:px-6">
        {/* Шапка заведения */}
        <section className="rise pt-12 pb-8 text-center">
          <div className="mx-auto mb-5 flex h-20 w-20 items-center justify-center"
               style={{ borderRadius: '50%', background: 'var(--color-accent-soft)' }}>
            <span className="display text-3xl" style={{ color: 'var(--color-accent)' }}>
              {shop.name.slice(0, 1)}
            </span>
          </div>
          <h1 className="display text-3xl font-semibold tracking-tight sm:text-4xl">{shop.name}</h1>
          {shop.tagline && <p className="mt-2 text-base prose-muted">{shop.tagline}</p>}
          {(shop.city || shop.address) && (
            <p className="mt-3 text-sm prose-muted">
              {[shop.address, shop.city].filter(Boolean).join(', ')}
              {' · '}
              <Link href="/map" className="underline underline-offset-2">на мапі</Link>
            </p>
          )}
        </section>

        {/* Услуги: главный сценарий — записаться */}
        {services.length > 0 && (
          <section className="rise-1 pb-8">
            <h2 className="display mb-4 text-xl font-semibold">Послуги</h2>
            <div className="card !p-0">
              {services.map((o) => (
                <div key={o.id} id={o.slug} className="row px-5">
                  <div className="min-w-0">
                    <p className="font-medium">{o.title}</p>
                    {o.subtitle && <p className="mt-0.5 text-sm prose-muted">{o.subtitle}</p>}
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    {o.price != null && (
                      <p className="font-medium">{Number(o.price).toLocaleString('uk-UA')} ₴</p>
                    )}
                    <Link href={`/t/${slug}/book/${o.id}`} className="btn-primary h-10">
                      Записатися
                    </Link>
                  </div>
                </div>
              ))}
            </div>
            {staff.length > 0 && (
              <div className="mt-4 flex flex-wrap items-center gap-2 text-sm prose-muted">
                <span>Майстри:</span>
                {staff.map((s) => (
                  <span key={s.id} className="badge">{s.name}{s.title ? ` · ${s.title}` : ''}</span>
                ))}
              </div>
            )}
          </section>
        )}

        {/* Товары */}
        {products.length > 0 && (
          <section className="rise-2 pb-8">
            <h2 className="display mb-4 text-xl font-semibold">Товари</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((o) => (
                <div key={o.id} id={o.slug} className="card-link">
                  <div className="mb-3 flex h-32 items-center justify-center"
                       style={{ borderRadius: 'var(--radius-control)', background: 'var(--color-surface-2)' }}>
                    <span className="display text-2xl" style={{ color: 'var(--color-faint)' }}>
                      {o.title.slice(0, 1)}
                    </span>
                  </div>
                  <p className="truncate font-medium">{o.title}</p>
                  <div className="mt-1 flex items-center justify-between">
                    <p className="text-sm prose-muted">{o.subtitle ?? ''}</p>
                    {o.price != null && (
                      <p className="font-medium">{Number(o.price).toLocaleString('uk-UA')} ₴</p>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-4 text-xs prose-muted">
              Замовлення товарів — за телефоном або в повідомленнях закладу;
              онлайн-кошик відкриється разом із доставкою.
            </p>
          </section>
        )}

        {offerings.length === 0 && (
          <div className="empty card rise-1">
            <p className="display text-lg" style={{ color: 'var(--color-text)' }}>
              Каталог наповнюється
            </p>
            <p>Заклад щойно приєднався — послуги та товари з’являться найближчим часом.</p>
          </div>
        )}

        {shop.description && (
          <section className="rise-3 pb-8">
            <h2 className="display mb-3 text-xl font-semibold">Про заклад</h2>
            <p className="max-w-2xl text-sm leading-relaxed prose-muted">{shop.description}</p>
          </section>
        )}
      </main>

      <PublicFooter />
    </>
  )
}
