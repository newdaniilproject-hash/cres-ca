import type { Metadata } from 'next'
import Link from 'next/link'
import { cache } from 'react'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { PublicHeader, PublicFooter, publicT as t } from '@/components/shell'
import { AttributionCapture } from '@/components/attribution-capture'
import { AddToCart, CartProvider, type CartVariant } from './cart'

export const revalidate = 60

type Offering = {
  id: string; slug: string; title: string; subtitle: string | null
  kind: 'product' | 'service'; price: number | null; currency: string
  rating_avg: number; rating_count: number
  /** Первый кадр из `offering_media` — отдаёт сама `storefront()`. */
  image: string | null
}
type Staff = { id: string; name: string; title: string | null }
type VariantRow = {
  id: string; offering_id: string; name: string; price: number | null
  track_stock: boolean; stock_qty: number; reserved_qty: number
}
type Shop = {
  id: string; name: string; tagline: string | null; description: string | null
  city: string | null; address: string | null; kind: string
  logo_path: string | null; cover_path: string | null
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
  if (!data) return { title: t('public.storefront.notFound.title') }
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

  // Файлы витрины лежат в публичном бакете `media` и раздаются с CDN без
  // подписи (CLAUDE.md → «Файлы»). `getPublicUrl` — чистая склейка строки,
  // в сеть она не ходит. Обложка и логотип рисуются ТОЛЬКО когда продавец
  // их загрузил: плейсхолдер-«фикстура» вместо настоящей обложки — обман,
  // а буква-заглушка логотипа собрана из настоящего имени заведения.
  const mediaUrl = (p: string) =>
    supabase.storage.from('media').getPublicUrl(p).data.publicUrl
  const coverUrl = shop.cover_path ? mediaUrl(shop.cover_path) : null
  const logoUrl = shop.logo_path ? mediaUrl(shop.logo_path) : null

  // ── Варианты товаров: второй запрос, и он объяснён ─────────────────────
  //
  // `storefront()` возвращает позиции без вариантов, а корзине нужен
  // `variant_id`: `create_order` принимает только его — товар без варианта
  // купить нельзя в принципе (правило 4 CLAUDE.md — характеристики живут
  // в вариантах). Расширять саму функцию базы — это миграция и правка
  // общей для витрины, поиска и карты точки; здесь это отдельно названное
  // изменение, а не побочный эффект корзины.
  //
  // Цена запроса — один поход в базу и только когда товары вообще есть.
  // Страница уже динамическая (она читает куки ради `authed` в шапке —
  // см. `components/shell.tsx`), так что кэша он не отнимает.
  //
  // Читается это анонимом законно: политика `variants_read` (0004) отдаёт
  // активные варианты активных позиций опубликованной витрины.
  const productIds = products.map((o) => o.id)
  const { data: variantRows } = productIds.length
    ? await supabase
        .from('offering_variants')
        .select('id, offering_id, name, price, track_stock, stock_qty, reserved_qty')
        .in('offering_id', productIds)
        .eq('is_active', true)
        .order('position')
    : { data: [] as VariantRow[] }

  const priceOf = (o: Offering, v: VariantRow) =>
    Number(v.price ?? o.price ?? 0)

  const cartVariants: CartVariant[] = (variantRows ?? []).flatMap((v) => {
    const o = products.find((p) => p.id === v.offering_id)
    if (!o) return []
    return [{
      id: v.id,
      offeringId: v.offering_id,
      title: o.title,
      name: v.name,
      price: priceOf(o, v),
      currency: o.currency,
      // Остаток считаем так же, как `variant_available` в базе: остаток
      // минус резерв. Чужой резерв — это уже не наш товар.
      available: v.track_stock ? Math.max(0, v.stock_qty - v.reserved_qty) : null,
    }]
  })

  // Рейтинг лежал в `storefront()` и в этом типе с самого начала и никогда
  // не рисовался (0104). Порог — ровно тот, что назван в правилах домена:
  // меньше пяти оценок показывает «мало оцінок», а не число — единичная
  // пятёрка от знакомого не должна выглядеть как проверенная репутация.
  // Ноль отзывов не показывает вовсе: пустая строка честнее, чем «0.00».
  const rating = (o: Offering) =>
    o.rating_count === 0 ? null
      : o.rating_count < 5
        ? <span className="t-xs prose-muted">{t('public.storefront.rating.few')}</span>
        : <span className="tabular t-xs prose-muted">
            ★ {o.rating_avg.toFixed(1)} · {t('public.storefront.rating.count', { n: o.rating_count })}
          </span>

  return (
    <>
      {/* Ссылка из шапки Instagram — `cres-ca.com/t/<slug>?from=ig` (0105).
          Ничего не рисует, только запоминает источник для оформления. */}
      <AttributionCapture tenantId={shop.id} />
      <PublicHeader authed={!!user} />

      {/* Корзина — клиентский островок вокруг серверной разметки: провайдер
          клиентский, содержимое внутри него остаётся серверным. Полосу
          корзины он дорисовывает сам, после содержимого и до подвала. */}
      <CartProvider slug={slug} tenantId={shop.id} variants={cartVariants}>
      {/* Ширина — как у остальной публичной поверхности (шапка, подвал,
          главная): max-w-6xl. Витрина живёт и на десктопе, а не только
          в телефонном столбце. */}
      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Шапка заведения. Обложка и логотип-файл появляются только когда
            они есть у продавца; без обложки шапка остаётся прежним
            центрированным столбцом на телефоне и строкой на десктопе. */}
        <section className="rise pt-8 pb-8 sm:pt-10">
          {coverUrl && (
            <div className="overflow-hidden"
                 style={{ borderRadius: 'var(--radius-calendar)', background: 'var(--color-surface-2)' }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={coverUrl} alt="" className="h-44 w-full object-cover sm:h-60 lg:h-72" />
            </div>
          )}
          <div
            className={
              coverUrl
                ? 'relative -mt-10 flex flex-col items-center gap-4 px-4 text-center sm:px-8 lg:-mt-12 lg:flex-row lg:items-end lg:gap-6 lg:text-left'
                : 'flex flex-col items-center gap-4 pt-4 text-center lg:flex-row lg:items-center lg:gap-6 lg:text-left'
            }
          >
            <div
              className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden lg:h-28 lg:w-28"
              style={{
                borderRadius: '50%',
                background: 'var(--color-accent-soft)',
                // Поверх обложки логотип обводится цветом поверхности —
                // токеном, а не белым: в тёмной теме белое кольцо кричало бы.
                ...(coverUrl
                  ? { border: '3px solid var(--color-surface)', boxShadow: 'var(--shadow-card)' }
                  : null),
              }}
            >
              {logoUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={logoUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                <span className="display t-3xl" style={{ color: 'var(--color-accent)' }}>
                  {shop.name.slice(0, 1)}
                </span>
              )}
            </div>
            <div className="min-w-0">
              <h1 className="display t-3xl sm:t-4xl">{shop.name}</h1>
              {shop.tagline && <p className="t-md mt-2 prose-muted">{shop.tagline}</p>}
              {/* Имя, подзаголовок, описание, адрес и город заведения —
                  данные продавца: не переводятся ни в каком языке. В словарь
                  уезжают только подписи вокруг них. */}
              {(shop.city || shop.address) && (
                <p className="t-sm mt-3 prose-muted">
                  {[shop.address, shop.city].filter(Boolean).join(', ')}
                  {' · '}
                  <Link href="/map" className="underline underline-offset-2">
                    {t('public.storefront.onMap')}
                  </Link>
                </p>
              )}
            </div>
            {/* Главное действие витрины услуг — запись. Якорь, а не второй
                поток: кнопки «Записатися» с датой и мастером живут у самих
                услуг ниже, шапка лишь доводит до них. */}
            {services.length > 0 && (
              <div className="shrink-0 lg:ml-auto lg:pb-2">
                <a href="#services" className="btn-primary">
                  {t('public.storefront.book')}
                </a>
              </div>
            )}
          </div>
        </section>

        {/* Услуги: главный сценарий — записаться. На десктопе — сетка
            в две колонки, на телефоне те же карточки столбцом. */}
        {services.length > 0 && (
          <section id="services" className="rise-1 pb-8">
            <h2 className="display mb-4 t-xl">{t('public.storefront.services.title')}</h2>
            <div className="grid gap-3 lg:grid-cols-2 lg:gap-4">
              {services.map((o) => (
                <div key={o.id} id={o.slug} className="card flex items-center gap-4">
                  {o.image && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={mediaUrl(o.image)} alt=""
                      className="h-14 w-14 shrink-0 object-cover"
                      style={{ borderRadius: 'var(--radius-plate)', background: 'var(--color-surface-2)' }}
                    />
                  )}
                  <div className="min-w-0 flex-1">
                    <p className="t-lg">{o.title}</p>
                    {o.subtitle && <p className="t-sm mt-0.5 prose-muted">{o.subtitle}</p>}
                    {rating(o)}
                  </div>
                  <div className="flex shrink-0 items-center gap-4">
                    {/* Символ валюты ставит Intl, а не подстановка «` ₴`»:
                        у позиции своя `currency`, и вторая валюта появится
                        раньше, чем кто-нибудь вспомнит про эту строку. */}
                    {o.price != null && (
                      <p className="tabular t-md">{t.money(Number(o.price), o.currency)}</p>
                    )}
                    <Link href={`/t/${slug}/book/${o.id}`} className="btn-primary">
                      {t('public.storefront.book')}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
            {staff.length > 0 && (
              <div className="t-sm mt-4 flex flex-wrap items-center gap-2 prose-muted">
                <span>{t('public.storefront.staff.label')}</span>
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
            <h2 className="display mb-4 t-xl">{t('public.storefront.products.title')}</h2>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((o) => {
                const mine = cartVariants.filter((v) => v.offeringId === o.id)
                // Цена в карточке: своя у позиции, иначе самая низкая из
                // вариантов. Товар, у которого цена живёт только на варианте,
                // до этого показывался вовсе без цены.
                const price = o.price != null
                  ? Number(o.price)
                  : mine.length > 0 ? Math.min(...mine.map((v) => v.price)) : null
                return (
                  <div key={o.id} id={o.slug} className="card-link">
                    <div className="mb-3 flex h-32 items-center justify-center overflow-hidden lg:h-40"
                         style={{ borderRadius: 'var(--radius-control)', background: 'var(--color-surface-2)' }}>
                      {o.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={mediaUrl(o.image)} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <span className="display t-2xl" style={{ color: 'var(--color-faint)' }}>
                          {o.title.slice(0, 1)}
                        </span>
                      )}
                    </div>
                    <p className="t-lg truncate">{o.title}</p>
                    {rating(o)}
                    <div className="mt-1 flex items-center justify-between">
                      <p className="t-sm prose-muted">{o.subtitle ?? ''}</p>
                      {price != null && (
                        <p className="tabular t-md">{t.money(price, o.currency)}</p>
                      )}
                    </div>
                    {/* Кнопка корзины. У услуг остаётся «Записатися» выше —
                        два разных действия и два разных потока. */}
                    <AddToCart variants={mine} />
                  </div>
                )
              })}
            </div>
          </section>
        )}

        {offerings.length === 0 && (
          <div className="empty card rise-1">
            <p className="display t-lg" style={{ color: 'var(--color-text)' }}>
              {t('public.storefront.empty.title')}
            </p>
            <p>{t('public.storefront.empty.desc')}</p>
          </div>
        )}

        {shop.description && (
          <section className="rise-3 pb-8">
            <h2 className="display mb-3 t-xl">{t('public.storefront.about.title')}</h2>
            <p className="t-md max-w-2xl leading-relaxed prose-muted">{shop.description}</p>
          </section>
        )}
      </main>
      </CartProvider>

      <PublicFooter />
    </>
  )
}
