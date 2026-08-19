'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'
import { IconBox, IconCheck, IconClock, IconGrid } from '@/components/icons'

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
  /** Назва категорії довідника платформи. Не заведена — null. */
  category: string | null
  /**
   * Залишок товару сумою по варіантах з обліком. `null` — величини нема:
   * або це послуга, або облік не ведеться в жодному варіанті. Нуль
   * і «нема обліку» — різні речі, і бейдж «немає» має право з'явитися
   * тільки на першому.
   */
  stock: number | null
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

// Бейдж состояния — один и тот же на карточке и в списке: цвет несёт
// смысл (опубликовано — зелёное, чернетка — жёлтое), и вторая таблица
// соответствий разъехалась бы с первой.
const statusBadge = (s: string) =>
  (s === 'active' ? 'badge-success' : s === 'draft' ? 'badge-warn' : 'badge')

// ── CRESKO Web: карточка позиции (§4 послуги, §11 каталог) ──────────────
//
// ОДНО тело на обе сетки: у послуги и товара различаются высота фото,
// кегль названия и нижняя строка — всё остальное совпадает, и две копии
// разъехались бы на первой правке (урок М43, «картка учасника»).
//
// Карточка ведёт ТУДА ЖЕ, куда мобильная строка, — на `/app/catalog/<id>`.
// Второго адреса у позиции нет и заводить его незачем.
function WebOfferingCard({ t, item, coverUrl, hasStorefront }: {
  t: T
  item: CatalogItem
  coverUrl: (path: string) => string
  hasStorefront: boolean
}) {
  const isService = item.kind === 'service'
  const price = item.price != null ? t.money(item.price, item.currency) : t('common.noValue')

  return (
    <Link href={`/app/catalog/${item.id}`}
          className="webcard block overflow-hidden"
          style={{ padding: 0, minHeight: 'var(--tap-min)' }}>
      {/* Высоты 132 (послуга) и 150 (товар) — из README дословно.
          Фото приезжает с CDN и меряется по месту: `next/image` здесь
          не нужен, размеров оригинала мы не храним. */}
      <span className="block" style={{ height: isService ? 132 : 150 }}>
        {item.cover ? (
          <img src={coverUrl(item.cover)} alt="" className="h-full w-full object-cover" />
        ) : (
          // Не серый прямоугольник, а плашка со значком: пустой квадрат
          // читается как несостоявшаяся загрузка, то есть как поломка.
          // Значок, а не глиф: «◷ ◫» на части прошивок приезжают
          // квадратами (М31).
          <span className="flex h-full w-full items-center justify-center"
                style={{
                  background: 'var(--web-surface-tint, var(--color-surface-2))',
                  color: 'var(--color-faint)',
                }}>
            {isService ? <IconClock size={26} /> : <IconBox size={26} />}
          </span>
        )}
      </span>

      <span className="block" style={{ padding: 14 }}>
        <span className="flex items-start justify-between gap-2">
          {/* Назва позиції — данные заклада, они не переводятся. */}
          <span className="clamp-2 block min-w-0"
                style={{
                  fontSize: isService ? 15 : 14,
                  fontWeight: 650,
                  color: 'var(--color-text)',
                }}>
            {item.title}
          </span>
          <span className={`${statusBadge(item.status)} shrink-0`}>
            {statusLabel(t, item.status)}
          </span>
        </span>

        {/* Категория — справочник платформы; когда она не выбрана,
            строку занимает подпись позиции. Пустая строка вместо обеих
            не рисуется вовсе: место под неё не резервируется, карточки
            в сетке выравнивает грид. */}
        <span className="mt-1 flex items-center justify-between gap-2">
          <span className="min-w-0 truncate" style={{ fontSize: 12, color: 'var(--color-muted)' }}>
            {item.category ?? item.subtitle ?? ''}
          </span>
          {hasStorefront && !item.listed && (
            <span className="badge shrink-0">{t('catalog.badge.unlisted')}</span>
          )}
        </span>

        <span className="mt-3 flex items-center justify-between gap-2 pt-2.5"
              style={{ borderTop: '1px solid var(--web-border-dash, var(--color-border))' }}>
          {isService ? (
            <>
              {/* Тривалість — тільки коли задана хоч на одному варіанті.
                  Число витратників (рецептура) здесь НЕ рисуется: связь
                  `variant_materials` в список каталога не приходит,
                  а «0 витратників» у послуги с рецептурой — это ложь. */}
              <span className="tabular" style={{ fontSize: 13, color: 'var(--color-muted)' }}>
                {item.durationMinutes != null
                  ? t('catalog.duration', { n: t.number(item.durationMinutes) })
                  : ''}
              </span>
              <span className="tabular"
                    style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>
                {price}
              </span>
            </>
          ) : (
            <>
              <span className="tabular"
                    style={{ fontSize: 16, fontWeight: 800, color: 'var(--color-text)' }}>
                {price}
              </span>
              {/* Остаток есть только там, где его ведут. Ноль — это
                  «немає в наявності», а отсутствие учёта — не величина,
                  и бейджа у неё нет. */}
              {item.stock != null && (
                <span className={item.stock > 0 ? 'badge shrink-0' : 'badge-warn shrink-0'}>
                  {item.stock > 0
                    ? t('catalog.web.stock', { n: t.number(item.stock) })
                    : t('catalog.web.stock.none')}
                </span>
              )}
            </>
          )}
        </span>
      </span>
    </Link>
  )
}

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

  // Сетки веб-версии: §4 — послуги по три в ряд, §11 — товари по четыре.
  // Делим уже ОТФИЛЬТРОВАННЫЙ список, а не исходный: фильтр «Чернетки»
  // должен резать обе сетки, иначе он режет только половину экрана.
  const shownServices = shown.filter((i) => i.kind === 'service')
  const shownProducts = shown.filter((i) => i.kind === 'product')

  // Вкладки веб-версии и чипы телефона — один и тот же фильтр и одни
  // и те же числа; отличается только вид.
  const tabItems: [Filter, string, number][] = [
    ['all', t('catalog.filter.all'), items.length],
    ['product', t('catalog.filter.products'), counts.product],
    ['service', t('catalog.filter.services'), counts.service],
    ['draft', t('catalog.filter.drafts'), counts.draft],
  ]

  return (
    <div className="flex flex-col gap-5">
      {/* ── CRESKO Web: хедер экрана (только lg) ─────────────────
          Слева имя экрана тем же ключом, которым его называет панель
          и вкладка браузера; справа — то же единственное действие,
          что и на телефоне. На телефоне кнопка «Додати» стоит в ряду
          фильтров, здесь — в правом углу хедера: действие одно,
          разметка разная. */}
      <div className="hidden items-center justify-between lg:flex">
        <h1 className="webh1">{t('app.screen.catalog.title')}</h1>
        {canWrite && (
          <Link href="/app/catalog/new" className="btn-primary">{t('catalog.add')}</Link>
        )}
      </div>

      {/* ── CRESKO Web: метрики (только lg) ──────────────────────
          Те же четыре числа, что и в мобильном ряду ниже, в виде
          .wmetric с иконкой-плашкой. Плитки не нажимаются: фильтр
          живёт во вкладках, и второй орган управления с тем же
          действием — это два входа в одно место.

          Тон несёт смысл: emerald — опубликованное, violet — послуги
          (акцент этого раздела), blue — нейтральные счётчики. */}
      {items.length > 0 && (
        <section className="rise hidden gap-4 lg:grid lg:grid-cols-4">
          {([
            { key: 'total', n: items.length, label: t('catalog.stats.total'), tone: 'blue', icon: IconGrid },
            { key: 'active', n: counts.active, label: t('catalog.stats.active'), tone: 'emerald', icon: IconCheck },
            { key: 'service', n: counts.service, label: t('catalog.stats.services'), tone: 'violet', icon: IconClock },
            { key: 'product', n: counts.product, label: t('catalog.stats.products'), tone: 'blue', icon: IconBox },
          ] as const).map((s) => (
            <div key={s.key} className="wmetric">
              <span className="min-w-0">
                <span className="wmetric-label block">{s.label}</span>
                <span className="wmetric-value tabular block">{t.number(s.n)}</span>
              </span>
              <span className="wmetric-icon" data-tone={s.tone}><s.icon size={19} /></span>
            </div>
          ))}
        </section>
      )}

      {/* ── CRESKO Web: вкладки чертой (только lg) ───────────────
          Тот же `setFilter`, что и у чипов. Счётчик у вкладки —
          там же, где у чипа: он отвечает на «а есть ли там что-то»
          до нажатия. */}
      <div className="wtabs hidden lg:flex">
        {tabItems.map(([key, label, n]) => (
          <button key={key} type="button" onClick={() => setFilter(key)}
                  className="wtab" data-active={filter === key}
                  style={{ minHeight: 'var(--tap-min)' }}>
            {label}{n > 0 ? ` · ${t.number(n)}` : ''}
          </button>
        ))}
      </div>

      {/* ── Счётчики ─────────────────────────────────────────────
          Все четыре — РЕАЛЬНЫЕ величины: активные, товары, послуги
          и общее число. По прототипу здесь стоял ещё рейтинг и число
          «в акції», но акций и промокодов в продукте нет (модуль
          `marketing` пуст, CLAUDE.md), а рейтинг заведения — витринная
          величина и её место в разделе «Магазин», а не здесь. Плитка
          с придуманным числом хуже отсутствующей плитки: она обещает
          функцию, которой нет. */}
      {items.length > 0 && (
        <section className="rise grid grid-cols-4 gap-2 lg:hidden">
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

      <div className="scroll-x rise-1 -mx-4 flex items-center gap-2 px-4 pb-1 lg:hidden sm:mx-0 sm:px-0">
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
        <>
        {/* ── CRESKO Web: сетки карточек (только lg) ─────────────
            Двумя сетками, а не одной: у послуги и товара разные ряды
            по README (§4 — три в ряд, §11 — четыре), и перемешать их
            в одну сетку значит выбрать одну ширину карточки для обоих
            и потерять обе. Заголовок ряда — та же подпись, что и у
            вкладки фильтра: два имени одной величины расходятся.

            Ряд, в котором после фильтра ничего не осталось, не рисуется
            вовсе — пустой заголовок сообщал бы о разделе, которого
            на экране нет. */}
        <div className="hidden flex-col gap-6 lg:flex">
          {shownServices.length > 0 && (
            <section>
              <h2 className="webh2 mb-3">
                {t('catalog.filter.services')} · {t.number(shownServices.length)}
              </h2>
              <div className="grid grid-cols-3" style={{ gap: 18 }}>
                {shownServices.map((i) => (
                  <WebOfferingCard key={i.id} t={t} item={i} coverUrl={cover}
                                   hasStorefront={hasStorefront} />
                ))}
              </div>
            </section>
          )}
          {shownProducts.length > 0 && (
            <section>
              <h2 className="webh2 mb-3">
                {t('catalog.filter.products')} · {t.number(shownProducts.length)}
              </h2>
              <div className="grid grid-cols-4" style={{ gap: 18 }}>
                {shownProducts.map((i) => (
                  <WebOfferingCard key={i.id} t={t} item={i} coverUrl={cover}
                                   hasStorefront={hasStorefront} />
                ))}
              </div>
            </section>
          )}
        </div>

        {/* Один столбец карточек, а не сетка 2×N: у позиции есть строка
            тривалості (для послуг) вдобавок к бейджам, и в узкой колонке
            сетки 390px она переносится и делает половину карточек выше
            другой половины. Список ровный — карточки ровные (М31/М32). */}
        <div className="flex flex-col gap-2 lg:hidden">
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
                  <span className={statusBadge(i.status)}>{statusLabel(t, i.status)}</span>
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
        </>
      )}

      <p className="field-hint">{t('catalog.hint.published')}</p>
    </div>
  )
}
