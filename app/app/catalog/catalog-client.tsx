'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'
import { IconBox, IconClock } from '@/components/icons'

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
  /** Тільки для послуг; у товару завжди null. */
  durationMinutes: number | null
  variants: number
  cover: string | null
}

// Подписи к состояниям позиции. Само значение (`draft`, `hidden`) —
// служебное значение перечисления и не переводится: по нему сверяется база.
// Переводится ПОДПИСЬ. Неизвестное состояние выводится как есть — новое
// появится в базе раньше, чем в словаре.
const STATUSES = ['draft', 'active', 'hidden', 'archived'] as const
type Status = (typeof STATUSES)[number]
const statusLabel = (t: T, s: string): string =>
  ((STATUSES as readonly string[]).includes(s) ? t(`catalog.status.${s as Status}`) : s)

type Filter = 'all' | 'product' | 'service' | 'draft'

// Список позиций. Фильтр — по виду и по «чернеткам»: продавец возвращается
// сюда именно за недоделанным, а не за поиском по всему каталогу.
export function CatalogClient({ items, error, canWrite, hasStorefront = false }: {
  items: CatalogItem[]
  error: string | null
  /** Есть ли `catalog.write`. Считает сервер — см. `page.tsx`. */
  canWrite: boolean
  /**
   * Модуль `storefront` — вторая ось, не право. Список позиций сам
   * принадлежит модулю `catalog`, но пара строк в нём говорит о витрине:
   * зачем заводить позицию («вітрина нічого не показує») и отметка
   * «поза каталогом» — про общий каталог маркетплейса. Заведению без
   * витрины оба утверждения обещают публичную страницу, которой нет.
   */
  hasStorefront?: boolean
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const [filter, setFilter] = useState<Filter>('all')

  const shown = useMemo(() => items.filter((i) => {
    if (filter === 'draft' && i.status !== 'draft') return false
    if ((filter === 'product' || filter === 'service') && i.kind !== filter) return false
    return true
  }), [items, filter])

  const counts = useMemo(() => ({
    product: items.filter((i) => i.kind === 'product').length,
    service: items.filter((i) => i.kind === 'service').length,
    active: items.filter((i) => i.status === 'active').length,
    draft: items.filter((i) => i.status === 'draft').length,
  }), [items])

  const cover = (path: string) => supabase.storage.from('media').getPublicUrl(path).data.publicUrl

  return (
    <div className="flex flex-col gap-5">
      {/* ── Счётчики ─────────────────────────────────────────────
          Все четыре — РЕАЛЬНЫЕ величины: активные, товары, послуги
          и общее число. По прототипу здесь стоял ещё рейтинг и число
          «в акції», но акций и промокодов в продукте нет (модуль
          `marketing` пуст, CLAUDE.md), а рейтинг заведения — витринная
          величина и её место в разделе «Магазин», а не здесь. Плитка
          с придуманным числом хуже отсутствующей плитки: она обещает
          функцию, которой нет. */}
      {items.length > 0 && (
        <section className="rise grid grid-cols-4 gap-2">
          <div className="metric" data-tone="blue">
            <span className="metric-value">{t.number(items.length)}</span>
            <span className="metric-label">{t('catalog.stats.total')}</span>
          </div>
          <div className="metric" data-tone="emerald">
            <span className="metric-value">{t.number(counts.active)}</span>
            <span className="metric-label">{t('catalog.stats.active')}</span>
          </div>
          <div className="metric">
            <span className="metric-value">{t.number(counts.service)}</span>
            <span className="metric-label">{t('catalog.stats.services')}</span>
          </div>
          <div className="metric">
            <span className="metric-value">{t.number(counts.product)}</span>
            <span className="metric-label">{t('catalog.stats.products')}</span>
          </div>
        </section>
      )}

      <div className="scroll-x rise-1 -mx-4 flex items-center gap-2 px-4 pb-1 sm:mx-0 sm:px-0">
        <button onClick={() => setFilter('all')}
                className={`${filter === 'all' ? 'chip-active' : 'chip'} shrink-0`}>
          {t('catalog.filter.all')} {items.length > 0 && `· ${items.length}`}
        </button>
        <button onClick={() => setFilter('product')}
                className={`${filter === 'product' ? 'chip-active' : 'chip'} shrink-0`}>
          {t('catalog.filter.products')} {counts.product > 0 && `· ${counts.product}`}
        </button>
        <button onClick={() => setFilter('service')}
                className={`${filter === 'service' ? 'chip-active' : 'chip'} shrink-0`}>
          {t('catalog.filter.services')} {counts.service > 0 && `· ${counts.service}`}
        </button>
        <button onClick={() => setFilter('draft')}
                className={`${filter === 'draft' ? 'chip-active' : 'chip'} shrink-0`}>
          {t('catalog.filter.drafts')} {counts.draft > 0 && `· ${counts.draft}`}
        </button>
        {canWrite && (
          <Link href="/app/catalog/new" className="btn-primary ml-auto shrink-0 t-sm">
            {t('catalog.add')}
          </Link>
        )}
      </div>

      {error && <p className="field-error rise">{error}</p>}

      {shown.length === 0 ? (
        <div className="card rise-1">
          <div className="empty">
            {items.length === 0 ? (
              // Пустой каталог без права записи — не задача этого человека:
              // предлагать ему «завести первую позицию» значит послать
              // за кнопкой, которой у него нет.
              canWrite ? (
                <>
                  {/* Две развилки — две отдельные строки словаря целиком,
                      а не общее начало плюс хвост: в другом языке
                      предложение строится иначе, и склейка из кусков
                      даёт неграмотную фразу. */}
                  <p>{hasStorefront
                    ? t('catalog.empty.write.storefront')
                    : t('catalog.empty.write.plain')}</p>
                  <Link href="/app/catalog/new" className="btn-primary">
                    {t('catalog.empty.add')}
                  </Link>
                </>
              ) : (
                <p>{t('catalog.empty.readonly')}</p>
              )
            ) : (
              <p>{t('catalog.empty.filter')}</p>
            )}
          </div>
        </div>
      ) : (
        // Один столбец карточек, а не сетка 2×N: у позиции теперь строка
        // тривалості (для послуг) вдобавок к бейджам, и в узкой колонке
        // сетки 390px она переносится и делает половину карточек выше
        // другой половины. Список ровный — карточки ровные (М31/М32).
        <div className="flex flex-col gap-2">
          {shown.map((i) => (
            <Link key={i.id} href={`/app/catalog/${i.id}`} className="list-card !items-start">
              {i.cover ? (
                // next/image здесь не нужен: это миниатюра 64×64 с CDN,
                // размеры оригинала мы не храним.
                <img src={cover(i.cover)} alt="" className="list-card-thumb object-cover" />
              ) : (
                // Значок, не символ: текстовые глифы вроде «◷ ◫» на части
                // телефонов рисуются квадратами (М31 — та же грабля,
                // уже пойманная на складе).
                <span className="list-card-thumb">
                  {i.kind === 'service' ? <IconClock size={20} /> : <IconBox size={20} />}
                </span>
              )}

              <span className="min-w-0 flex-1">
                <span className="t-md clamp-2 block">{i.title}</span>
                {i.subtitle && (
                  <span className="t-xs mt-0.5 block truncate" style={{ color: 'var(--color-faint)' }}>
                    {i.subtitle}
                  </span>
                )}
                {/* Тривалість — тільки в послуг, і тільки коли задана.
                    Формат «60 хв», а не «1 год»: варіанти рідко переходять
                    годинну позначку, а секунди читача не цікавлять. */}
                {i.durationMinutes != null && (
                  <span className="tabular t-xs mt-0.5 block" style={{ color: 'var(--color-faint)' }}>
                    {t('catalog.duration', { n: t.number(i.durationMinutes) })}
                  </span>
                )}
                <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                  <span className={i.status === 'active' ? 'badge-success'
                    : i.status === 'draft' ? 'badge-warn' : 'badge'}>
                    {statusLabel(t, i.status)}
                  </span>
                  {i.variants > 1 && (
                    <span className="badge">{t.plural('catalog.variants.count', i.variants)}</span>
                  )}
                  {/* «Поза каталогом» — про общий каталог маркетплейса,
                      то есть про витрину. Без модуля отметка сообщала бы
                      об отсутствии в списке, которого у заведения нет. */}
                  {hasStorefront && !i.listed && (
                    <span className="badge">{t('catalog.badge.unlisted')}</span>
                  )}
                </span>
              </span>

              <span className="shrink-0 text-right">
                <span className="tabular t-md block">
                  {/* Символ валюты ставит Intl (`t.money`), а не мы:
                      ручная подстановка «₴» ломается на второй валюте
                      и ставит символ не с той стороны в английской. */}
                  {i.price != null ? t.money(i.price, i.currency) : '—'}
                </span>
              </span>
            </Link>
          ))}
        </div>
      )}

      <p className="field-hint">{t('catalog.hint.published')}</p>
    </div>
  )
}
