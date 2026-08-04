import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PublicHeader, PublicFooter } from '@/components/shell'

export const dynamic = 'force-dynamic'
export const metadata = { title: 'Пошук' }

type Result = {
  result_type: 'shop' | 'offering'
  id: string
  title: string
  subtitle: string | null
  slug: string
  shop_slug: string
  shop_name: string
  city: string | null
  kind: string
  price: number | null
  currency: string | null
}

// Поиск: магазины и позиции в одной выдаче, одной функцией базы.
export default async function SearchPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string; kind?: string; city?: string }>
}) {
  const { q = '', kind, city } = await searchParams
  const supabase = await createClient()

  const [{ data: { user } }, { data: cities }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc('active_cities'),
  ])

  let results: Result[] = []
  if (q.trim().length >= 2) {
    const { data } = await supabase.rpc('search_all', {
      p_query: q.trim(),
      p_kind: kind === 'product' || kind === 'service' ? kind : null,
      p_city: city || null,
      p_limit: 30,
    })
    results = (data ?? []) as Result[]
  }

  const qs = (over: Record<string, string | undefined>) => {
    const p = new URLSearchParams()
    const merged = { q, kind, city, ...over }
    for (const [k, v] of Object.entries(merged)) if (v) p.set(k, v)
    return `/search?${p.toString()}`
  }

  return (
    <>
      <PublicHeader authed={!!user} />

      <main className="mx-auto max-w-4xl px-4 pt-10 sm:px-6">
        <form action="/search" className="relative rise">
          <span aria-hidden className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 t-xl"
                style={{ color: 'var(--color-faint)' }}>⌕</span>
          <input name="q" defaultValue={q} className="search-hero" autoFocus
                 placeholder="Що шукаєте?" autoComplete="off" />
          {kind && <input type="hidden" name="kind" value={kind} />}
          {city && <input type="hidden" name="city" value={city} />}
        </form>

        <div className="rise-1 mt-4 flex flex-wrap gap-2">
          <Link href={qs({ kind: undefined })} className={!kind ? 'chip-active' : 'chip'}>Усе</Link>
          <Link href={qs({ kind: 'service' })} className={kind === 'service' ? 'chip-active' : 'chip'}>Послуги</Link>
          <Link href={qs({ kind: 'product' })} className={kind === 'product' ? 'chip-active' : 'chip'}>Товари</Link>
          {(cities ?? []).slice(0, 5).map((c: { city: string }) => (
            <Link key={c.city} href={qs({ city: city === c.city ? undefined : c.city })}
                  className={city === c.city ? 'chip-active' : 'chip'}>
              {c.city}
            </Link>
          ))}
        </div>

        <section className="mt-8 pb-10">
          {q.trim().length < 2 ? (
            <div className="empty">Введіть щонайменше дві літери</div>
          ) : results.length === 0 ? (
            <div className="empty card">
              <p className="display t-lg" style={{ color: 'var(--color-text)' }}>
                Нічого не знайшли за «{q}»
              </p>
              <p>Спробуйте коротше слово або перевірте розкладку.</p>
            </div>
          ) : (
            <div className="flex flex-col gap-3">
              {results.map((r, i) => (
                <Link
                  key={`${r.result_type}-${r.id}`}
                  href={r.result_type === 'shop' ? `/t/${r.shop_slug}` : `/t/${r.shop_slug}#${r.slug}`}
                  className={`card-link rise-${Math.min(i + 1, 4)} flex items-center justify-between gap-4`}
                >
                  <div className="min-w-0">
                    <div className="flex items-center gap-2">
                      <p className="t-lg truncate">{r.title}</p>
                      <span className={r.result_type === 'shop' ? 'badge-accent' : 'badge'}>
                        {r.result_type === 'shop' ? 'заклад'
                          : r.kind === 'service' ? 'послуга' : 'товар'}
                      </span>
                    </div>
                    <p className="t-sm mt-0.5 truncate prose-muted">
                      {r.result_type === 'shop'
                        ? (r.subtitle ?? r.city ?? '')
                        : `${r.shop_name}${r.city ? ` · ${r.city}` : ''}`}
                    </p>
                  </div>
                  {r.price != null && (
                    <p className="tabular t-md shrink-0">
                      {Number(r.price).toLocaleString('uk-UA')} ₴
                    </p>
                  )}
                </Link>
              ))}
            </div>
          )}
        </section>
      </main>

      <PublicFooter />
    </>
  )
}
