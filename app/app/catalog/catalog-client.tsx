'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'

export type CatalogItem = {
  id: string
  kind: 'product' | 'service'
  status: string
  title: string
  subtitle: string | null
  slug: string
  listed: boolean
  currency: string
  price: number | null
  variants: number
  cover: string | null
}

const STATUS_LABEL: Record<string, string> = {
  draft: 'чернетка',
  active: 'опубліковано',
  hidden: 'прихована',
  archived: 'в архіві',
}

type Filter = 'all' | 'product' | 'service' | 'draft'

// Список позиций. Фильтр — по виду и по «чернеткам»: продавец возвращается
// сюда именно за недоделанным, а не за поиском по всему каталогу.
export function CatalogClient({ items, error }: { items: CatalogItem[]; error: string | null }) {
  const supabase = useMemo(() => createClient(), [])
  const [filter, setFilter] = useState<Filter>('all')
  const [q, setQ] = useState('')

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase()
    return items.filter((i) => {
      if (filter === 'draft' && i.status !== 'draft') return false
      if ((filter === 'product' || filter === 'service') && i.kind !== filter) return false
      if (needle && !`${i.title} ${i.subtitle ?? ''} ${i.slug}`.toLowerCase().includes(needle)) return false
      return true
    })
  }, [items, filter, q])

  const counts = useMemo(() => ({
    product: items.filter((i) => i.kind === 'product').length,
    service: items.filter((i) => i.kind === 'service').length,
    draft: items.filter((i) => i.status === 'draft').length,
  }), [items])

  const cover = (path: string) => supabase.storage.from('media').getPublicUrl(path).data.publicUrl

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-wrap items-center gap-2">
        <button onClick={() => setFilter('all')}
                className={filter === 'all' ? 'chip-active' : 'chip'}>
          Усі {items.length > 0 && `· ${items.length}`}
        </button>
        <button onClick={() => setFilter('product')}
                className={filter === 'product' ? 'chip-active' : 'chip'}>
          Товари {counts.product > 0 && `· ${counts.product}`}
        </button>
        <button onClick={() => setFilter('service')}
                className={filter === 'service' ? 'chip-active' : 'chip'}>
          Послуги {counts.service > 0 && `· ${counts.service}`}
        </button>
        <button onClick={() => setFilter('draft')}
                className={filter === 'draft' ? 'chip-active' : 'chip'}>
          Чернетки {counts.draft > 0 && `· ${counts.draft}`}
        </button>
        <Link href="/app/catalog/new" className="btn-primary ml-auto t-sm">
          Додати
        </Link>
      </div>

      {error && <p className="field-error rise">{error}</p>}

      {items.length > 8 && (
        <input className="input rise-1" placeholder="Пошук за назвою…"
               value={q} onChange={(e) => setQ(e.target.value)} />
      )}

      {shown.length === 0 ? (
        <div className="card rise-1">
          <div className="empty">
            {items.length === 0 ? (
              <>
                <p>Каталог порожній. Заведіть перший товар або послугу —
                  без цього вітрина нічого не показує.</p>
                <Link href="/app/catalog/new" className="btn-primary">Додати позицію</Link>
              </>
            ) : (
              <p>За цим фільтром нічого немає</p>
            )}
          </div>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {shown.map((i) => (
            <Link key={i.id} href={`/app/catalog/${i.id}`} className="card-link rise-1 !p-3">
              <div className="flex items-center gap-3">
                {i.cover ? (
                  // next/image здесь не нужен: это миниатюра 64×64 с CDN,
                  // размеры оригинала мы не храним.
                  <img src={cover(i.cover)} alt=""
                       className="h-16 w-16 shrink-0 object-cover"
                       style={{ borderRadius: 'var(--radius-control)' }} />
                ) : (
                  <div className="card-flat flex h-16 w-16 shrink-0 items-center justify-center !p-0 t-xl prose-muted">
                    {i.kind === 'service' ? '◷' : '◫'}
                  </div>
                )}

                <div className="min-w-0 flex-1">
                  <p className="t-lg truncate">{i.title}</p>
                  {i.subtitle && <p className="t-xs truncate prose-muted">{i.subtitle}</p>}
                  <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    <span className={i.status === 'active' ? 'badge-success'
                      : i.status === 'draft' ? 'badge-warn' : 'badge'}>
                      {STATUS_LABEL[i.status] ?? i.status}
                    </span>
                    <span className="badge">{i.kind === 'service' ? 'послуга' : 'товар'}</span>
                    {i.variants > 1 && <span className="badge">{i.variants} варіанти</span>}
                    {!i.listed && <span className="badge">поза каталогом</span>}
                  </div>
                </div>

                <div className="shrink-0 text-right">
                  <p className="tabular t-md">
                    {i.price != null
                      ? `${i.price.toLocaleString('uk-UA')} ${i.currency === 'UAH' ? '₴' : i.currency}`
                      : '—'}
                  </p>
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}

      <p className="field-hint">
        Опублікована позиція одразу видно на вашій сторінці та в загальному
        пошуку. Чернетку бачите тільки ви.
      </p>
    </div>
  )
}
