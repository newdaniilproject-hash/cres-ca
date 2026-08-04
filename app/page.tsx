import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PublicHeader, PublicFooter } from '@/components/shell'

export const revalidate = 120

// Главная. Решение против чистого лендинга и против голого списка:
// первый экран — поиск (посетитель пришёл ЗА ЧЕМ-ТО), сразу под ним —
// живой каталог заведений. Маркетинговый этаж один и в самом низу,
// для продавца, а не покупателя. Это гибрид Rozetka (сразу польза)
// и Fresha (заведения, мапа, запись).
export default async function Home() {
  const supabase = await createClient()
  const [{ data: { user } }, { data: cities }, { data: shops }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc('active_cities'),
    supabase
      .from('tenants')
      .select('slug, name, tagline, city, kind, logo_path, cover_path')
      .eq('status', 'active')
      .eq('storefront_enabled', true)
      .order('activated_at', { ascending: false, nullsFirst: false })
      .limit(9),
  ])

  return (
    <>
      <PublicHeader authed={!!user} />

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* Поиск — первый экран */}
        <section className="pt-14 pb-10 sm:pt-20">
          <h1 className="display rise max-w-2xl text-4xl font-semibold leading-tight tracking-tight sm:text-5xl">
            Знайдіть майстра або товар&nbsp;—
            <span className="prose-muted"> поруч із вами</span>
          </h1>

          <form action="/search" className="rise-1 relative mt-8 max-w-2xl">
            <span aria-hidden className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 text-lg"
                  style={{ color: 'var(--color-faint)' }}>⌕</span>
            <input
              name="q"
              className="search-hero"
              placeholder="Манікюр, брейди, пальто, назва закладу…"
              autoComplete="off"
            />
          </form>

          <div className="rise-2 mt-5 flex flex-wrap items-center gap-2">
            <Link href="/search?kind=service" className="chip">Послуги</Link>
            <Link href="/search?kind=product" className="chip">Товари</Link>
            <Link href="/map" className="chip">На мапі ↗</Link>
            {(cities ?? []).slice(0, 4).map((c: { city: string }) => (
              <Link key={c.city} href={`/search?city=${encodeURIComponent(c.city)}`} className="chip">
                {c.city}
              </Link>
            ))}
          </div>
        </section>

        {/* Заведения */}
        <section className="py-10">
          <div className="mb-5 flex items-end justify-between">
            <h2 className="display text-2xl font-semibold">Заклади</h2>
            <Link href="/map" className="btn-ghost">Показати на мапі</Link>
          </div>

          {shops && shops.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shops.map((s, i) => (
                <Link key={s.slug} href={`/t/${s.slug}`}
                      className={`card-link rise-${Math.min(i % 3 + 1, 4)}`}>
                  <div className="mb-3 flex h-28 items-center justify-center overflow-hidden"
                       style={{ borderRadius: 'var(--radius-control)', background: 'var(--color-surface-2)' }}>
                    <span className="display text-3xl" style={{ color: 'var(--color-faint)' }}>
                      {s.name.slice(0, 1)}
                    </span>
                  </div>
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{s.name}</p>
                      <p className="mt-0.5 truncate text-sm prose-muted">
                        {s.tagline ?? (s.kind === 'services' ? 'Послуги' : 'Товари')}
                        {s.city ? ` · ${s.city}` : ''}
                      </p>
                    </div>
                    <span className="badge-accent shrink-0">
                      {s.kind === 'services' ? 'запис' : s.kind === 'both' ? 'все' : 'магазин'}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty card">
              <p className="display text-lg" style={{ color: 'var(--color-text)' }}>
                Перші заклади вже готуються до відкриття
              </p>
              <p>Ми відкриваємо платформу поступово — спочатку майстри та салони.</p>
            </div>
          )}
        </section>

        {/* Этаж для продавца — один, внизу, тихий */}
        <section className="card rise mt-10 overflow-hidden !p-0">
          <div className="grid items-center gap-6 p-8 sm:grid-cols-[1fr_auto] sm:p-10"
               style={{ background: 'linear-gradient(120deg, var(--color-accent-soft), transparent 60%)' }}>
            <div>
              <h2 className="display text-2xl font-semibold">Ведете бізнес?</h2>
              <p className="mt-2 max-w-lg text-sm leading-relaxed prose-muted">
                Склад із термінами придатності, запис клієнтів, санітарні журнали
                для перевірок і власна сторінка із посиланням для Instagram.
                Клієнтська база — ваша, з вивантаженням у будь-який момент.
              </p>
            </div>
            <Link href="/register/seller" className="btn-primary">Почати безкоштовно</Link>
          </div>
        </section>
      </main>

      <PublicFooter />
    </>
  )
}
