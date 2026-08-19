'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { useT } from '@/lib/i18n/client'
import type { TenantModule } from '@/lib/tenant'
import { IconSearch, IconBox, IconScissors, IconUsers, IconBag } from '@/components/icons'

// ── Один поиск на весь кабинет ──────────────────────────────────────────────
//
// Решение владельца 19.08.2026: «пусть в хедере будет один единый поиск
// по всему — по клиентам, расходникам, заказам и всему, а на самих экранах
// поля поиска не будет».
//
// ЭТО ОТМЕНЯЕТ решение 18.08.2026 («поиск переехал НА страницу склада»),
// и отменяет по названной причине. Поиск на странице ищет только то, что
// на этой странице лежит, — значит человек обязан СНАЧАЛА угадать раздел,
// а потом искать. «Оксана» — это клиент, «Оксана» в заказе и «Оксана»
// в записи лежат в трёх разных экранах, и на складе её не найти вовсе.
// Полей при этом становилось столько же, сколько экранов, и каждое
// работало по своим правилам.
//
// Здесь одно поле и один ответ на вопрос «где это лежит»: разделы —
// это уже результат поиска, а не его условие.
//
// ЧТО ИЩЕТСЯ. Четыре раздела, и каждый спрашивается ТОЛЬКО если он открыт
// этому человеку по обеим осям (CLAUDE.md → «Доступ: роли и модули»):
// заведение купило модуль И у человека есть право. Спросить и показать
// пусто — это не «безопасно»: RLS всё равно не отдаст чужого, но лишний
// запрос уйдёт, а пустой раздел в выдаче читается как «у нас такого нет».
//
// ГРАНИЦА ДОВЕРИЯ здесь та же, что везде, — RLS. Фильтр по модулю и праву
// в этом файле только экономит запросы и не пускает в выдачу разделы,
// которых человек не видит в меню.
//
// ЦЕНА. Запрос уходит только после набора двух знаков и с задержкой:
// поиск по мере набора без неё означает запрос на каждую букву, а до базы
// в Ирландии не меньше сотни миллисекунд.

type Hit = {
  id: string
  href: string
  title: string
  note: string
  section: Section
}

type Section = 'materials' | 'catalog' | 'customers' | 'orders'

const ICON: Record<Section, (p: { size?: number }) => React.ReactElement> = {
  materials: IconBox,
  catalog: IconScissors,
  customers: IconUsers,
  orders: IconBag,
}

const SECTION_TITLE = {
  materials: 'app.search.section.materials',
  catalog: 'app.search.section.catalog',
  customers: 'app.search.section.customers',
  orders: 'app.search.section.orders',
} as const

// PostgREST разбирает `or=(...)` строкой: запятая, скобка и звёздочка
// в запросе человека сломали бы разбор, а `%` сделал бы любой запрос
// пустым. Чистим ДО подстановки, а не экранируем: осмысленного поиска
// по этим знакам в именах и артикулах нет.
const safe = (q: string) => q.replace(/[,()%*\\]/g, ' ').trim()

export function GlobalSearch({
  modules, perms, compact = false,
}: {
  modules?: TenantModule[]
  perms?: string[]
  /**
   * Значком вместо строки. Только там, где строке не хватает места:
   * на внутренних экранах шапку уже занимают стрелка «назад» и имя
   * экрана. На корневых разделах — всегда строка.
   */
  compact?: boolean
}) {
  const t = useT()
  const pathname = usePathname()
  const supabase = useMemo(() => createClient(), [])
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [busy, setBusy] = useState(false)

  const may = (mod: TenantModule, perm: string) =>
    (!modules || modules.includes(mod))
    && (!perms || perms.includes('*') || perms.includes(perm))

  const sections = {
    materials: may('inventory', 'stock.read'),
    catalog: may('catalog', 'catalog.read'),
    customers: may('customers', 'customers.read'),
    orders: may('orders', 'orders.read'),
  }
  const anywhere = Object.values(sections).some(Boolean)

  // Смена экрана закрывает поиск: переход состоялся — мебель уходит сама.
  useEffect(() => { setOpen(false) }, [pathname])

  // Закрыли — забыли. Иначе следующее открытие показывает прошлую выдачу,
  // и человек секунду читает чужой ответ на свой новый вопрос.
  useEffect(() => { if (!open) { setQ(''); setHits(null) } }, [open])

  const seq = useRef(0)
  useEffect(() => {
    const term = safe(q)
    if (!open || term.length < 2) { setHits(null); setBusy(false); return }
    setBusy(true)
    const my = ++seq.current
    const id = setTimeout(() => {
      void run(term).then((rows) => {
        // Ответ на устаревший запрос выбрасываем: сеть возвращает не
        // в том порядке, в каком спрашивали, и без этой проверки выдача
        // мигает предыдущим словом поверх текущего.
        if (my !== seq.current) return
        setHits(rows)
        setBusy(false)
      })
    }, 220)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, open])

  async function run(term: string): Promise<Hit[]> {
    const like = `%${term}%`
    const digits = /^\d+$/.test(term)
    const jobs: Promise<Hit[]>[] = []

    if (sections.materials) {
      jobs.push((async () => {
        const { data } = await supabase.from('materials')
          .select('id, name, brand, sku, unit, current_stock')
          .or(`name.ilike.${like},brand.ilike.${like},sku.ilike.${like}`)
          .eq('is_active', true)
          .limit(5)
        return (data ?? []).map((r) => ({
          id: r.id as string,
          href: `/app/inventory/materials/${r.id}`,
          title: r.name as string,
          note: [r.brand, `${t.number(Number(r.current_stock))} ${r.unit}`]
            .filter(Boolean).join(' · '),
          section: 'materials' as const,
        }))
      })())
    }

    if (sections.catalog) {
      jobs.push((async () => {
        const { data } = await supabase.from('offerings')
          .select('id, title, subtitle, sku, kind, price')
          .or(`title.ilike.${like},subtitle.ilike.${like},sku.ilike.${like}`)
          .limit(5)
        return (data ?? []).map((r) => ({
          id: r.id as string,
          href: `/app/catalog/${r.id}`,
          title: r.title as string,
          note: [
            t(r.kind === 'service' ? 'app.search.kind.service' : 'app.search.kind.good'),
            r.price != null ? t.money(Number(r.price)) : '',
          ].filter(Boolean).join(' · '),
          section: 'catalog' as const,
        }))
      })())
    }

    if (sections.customers) {
      // Телефон и почта здесь НЕ спрашиваются и НЕ ищутся, и это то же
      // решение, что на экране клиентов: контакт отдаёт `customer_card`
      // с проверкой права и записью в журнал доступа. Поиск, который
      // отдаёт телефон в подписи строки, обходит и то, и другое.
      jobs.push((async () => {
        const { data } = await supabase.from('customers')
          .select('id, name, orders_count, last_order_at')
          .ilike('name', like)
          .limit(5)
        return (data ?? []).map((r) => ({
          id: r.id as string,
          href: `/app/customers?id=${r.id}`,
          title: r.name as string,
          note: r.last_order_at
            ? t('app.search.lastVisit', { date: t.date(r.last_order_at as string) })
            : t('customers.noVisits'),
          section: 'customers' as const,
        }))
      })())
    }

    if (sections.orders) {
      // Номер заказа — bigint, и `ilike` по нему база не умеет. Поэтому
      // цифровой запрос ищется точным номером, а не подстрокой: человек,
      // набравший «103», ищет заказ №103, а не все, где встретилась сотня.
      const filter = digits
        ? `contact_name.ilike.${like},number.eq.${term}`
        : `contact_name.ilike.${like}`
      jobs.push((async () => {
        const { data } = await supabase.from('v_orders')
          .select('id, number, status, contact_name, total, created_at')
          .or(filter)
          .order('created_at', { ascending: false })
          .limit(5)
        return (data ?? []).map((r) => ({
          id: r.id as string,
          href: `/app/orders/${r.id}`,
          title: `№${r.number} · ${r.contact_name}`,
          note: [t.money(Number(r.total)), t.date(r.created_at as string)].join(' · '),
          section: 'orders' as const,
        }))
      })())
    }

    const done = await Promise.all(jobs)
    return done.flat()
  }

  if (!anywhere) return null

  const order: Section[] = ['materials', 'catalog', 'customers', 'orders']
  const groups = order
    .map((s) => [s, (hits ?? []).filter((h) => h.section === s)] as const)
    .filter(([, rows]) => rows.length > 0)

  return (
    <>
      {/* Строка, а не значок (поправка владельца 19.08.2026: «поисковая
          строка в хедере пропала»). Значок открывал тот же поиск, но
          молчал о себе: строка — это ещё и приглашение искать.

          Это КНОПКА в виде поля, а не поле. Печатать прямо в шапке
          нельзя: у неё `backdrop-filter`, своя высота и липкое
          положение, а поднявшаяся клавиатура закрыла бы выдачу.
          Шторка держит поле, список и клавиатуру одним слоем —
          так же сделаны телеграм и почта на телефоне. */}
      {compact ? (
        <button type="button" onClick={() => setOpen(true)}
                aria-label={t('app.search.aria')} className="iconbtn shrink-0">
          <IconSearch />
        </button>
      ) : (
        <button type="button" onClick={() => setOpen(true)}
                aria-label={t('app.search.aria')}
                className="searchfield min-w-0 flex-1 text-left">
          <IconSearch size={18} />
          <span className="truncate" style={{ fontSize: 'max(15px, var(--text-lg))' }}>
            {t('app.search.short')}
          </span>
        </button>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title={t('app.search.title')}>
        <label className="searchfield mb-3">
          <IconSearch size={18} />
          {/* autoFocus здесь уместен: шторку открыли ровно затем, чтобы
              набирать. Клавиатура на телефоне поднимется сама, а высота
              шторки в dvh — поле не уедет под неё. */}
          <input autoFocus type="search" inputMode="search" value={q}
                 onChange={(e) => setQ(e.target.value)}
                 placeholder={t('app.search.placeholder')} />
        </label>

        {q.trim().length < 2 ? (
          <p className="field-hint">{t('app.search.hint')}</p>
        ) : busy ? (
          <div className="flex flex-col gap-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton-row px-1"><span /><span /><span /><span /></div>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="empty">
            <span className="empty-icon"><IconSearch size={24} /></span>
            <p className="empty-title">{t('app.search.empty')}</p>
            <p className="empty-desc">{t('app.search.emptyDesc')}</p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {groups.map(([section, rows]) => {
              const Icon = ICON[section]
              return (
                <section key={section}>
                  <p className="eyebrow mb-1">{t(SECTION_TITLE[section])}</p>
                  <div className="flex flex-col">
                    {rows.map((h) => (
                      <Link key={h.href} href={h.href} className="row"
                            onClick={() => setOpen(false)}
                            style={{ minHeight: 'var(--tap-min)' }}>
                        <span aria-hidden className="thumb-sm">
                          <Icon size={18} />
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="t-md block truncate">{h.title}</span>
                          <span className="t-xs block truncate"
                                style={{ color: 'var(--color-faint)' }}>{h.note}</span>
                        </span>
                        <span aria-hidden style={{ color: 'var(--color-faint)' }}>›</span>
                      </Link>
                    ))}
                  </div>
                </section>
              )
            })}
          </div>
        )}
      </Sheet>
    </>
  )
}
