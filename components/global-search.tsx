'use client'

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import Link from 'next/link'
import { usePathname, useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import type { TenantModule } from '@/lib/tenant'
// Разбор `tstzrange` — ОБЩИЙ, а не свой: копия разошлась бы с оригиналом
// на первом же изменении формата, и разошлась бы молча.
import { parseRange } from '@/app/app/bookings/staff/range'
import {
  IconSearch, IconBox, IconScissors, IconUsers, IconBag,
  IconCalendar, IconCheck, IconGear, IconClose,
} from '@/components/icons'

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
//
// ── ПОЛЕ В ШАПКЕ, ВЫДАЧА ПАДАЕТ ВНИЗ. Решение владельца 25.08.2026 ──────────
//
// Дословно: «внизу поиска быть не должно — вверху же строка поиска, там
// и должно вписываться и выпадать результат поиска, и искать по всем
// элементам системы, хоть расходник, хоть клиент, хоть что угодно».
//
// ОТМЕНЯЕТ прежнее устройство: строка в шапке была КНОПКОЙ в виде поля,
// а печатали в шторке снизу. Прежний комментарий утверждал, что иначе
// нельзя («у шапки backdrop-filter, клавиатура закроет выдачу»), — обе
// причины настоящие, и обе решаются, а не обходятся:
//
//   1. `backdrop-filter` делает шапку содержащим блоком для `position:
//      fixed` внутри неё. Поэтому выдача уходит ПОРТАЛОМ в `body` — тем же
//      приёмом, что и шторки (`components/sheet.tsx`). Без портала панель
//      открывалась бы внутри полоски шапки. Не убирать, считая лишним.
//   2. Клавиатура закрывает низ экрана. Поэтому высота панели считается
//      от НИЖНЕГО КРАЯ ПОЛЯ до верха клавиатуры: `--kb` меряет
//      `components/keyboard-fit.tsx`, и без клавиатуры он равен нулю.
//      Панель не «умещается как получится» — она ровно в свободном месте.
//
// ЧТО ИЩЕТСЯ. Семь разделов, и каждый спрашивается ТОЛЬКО если он открыт
// этому человеку по обеим осям (CLAUDE.md → «Доступ: роли и модули»):
// заведение купило модуль И у человека есть право. Спросить и показать
// пусто — это не «безопасно»: RLS всё равно не отдаст чужого, но лишний
// запрос уйдёт, а пустой раздел в выдаче читается как «у нас такого нет».
//
// ГРАНИЦА ДОВЕРИЯ здесь та же, что везде, — RLS. Фильтр по модулю и праву
// в этом файле только экономит запросы и не пускает в выдачу разделы,
// которых человек не видит в меню.
//
// РАЗДЕЛЫ ищутся БЕЗ ЗАПРОСА и первыми: список приходит из той же
// навигации, что рисует панель и шторку профиля, то есть уже отфильтрован
// по модулю и праву. «Фін» приводит в «Фінанси» мгновенно — это ровно
// правило 6: мгновенность есть ОТСУТСТВИЕ запроса, а не быстрый запрос.
//
// ЦЕНА. Запрос уходит только после набора двух знаков и с задержкой:
// поиск по мере набора без неё означает запрос на каждую букву, а до базы
// в Ирландии не меньше сотни миллисекунд.

type Section =
  | 'nav' | 'materials' | 'containers' | 'catalog'
  | 'customers' | 'orders' | 'bookings' | 'staff'

type Hit = {
  id: string
  href: string
  title: string
  note: string
  section: Section
  /** Только у разделов: их собственный значок из навигации. */
  Icon?: (p: { size?: number }) => React.ReactElement
}

/**
 * Пункт навигации, как его отдаёт оболочка. Уже отфильтрован по доступу.
 * Значок приходит СВОЙ, а не общий: раздел в выдаче обязан выглядеть так
 * же, как в панели и в шторке профиля, иначе человек ищет глазами тот
 * значок, который запомнил, и не находит.
 */
export type SearchNavItem = {
  href: string
  title: string
  Icon: (p: { size?: number }) => React.ReactElement
}

// Разделитель величин в подписи строки. Точка-разделитель снята решением
// владельца 25.08.2026 по всему продукту: на 390px подпись переносится,
// и точка оказывается в начале второй строки, читаясь как маркер списка.
// Тире переносится вместе со значением.
const SEP = ' — '

const ICON: Record<Section, (p: { size?: number }) => React.ReactElement> = {
  nav: IconGear,
  materials: IconBox,
  containers: IconCheck,
  catalog: IconScissors,
  customers: IconUsers,
  orders: IconBag,
  bookings: IconCalendar,
  staff: IconUsers,
}

const SECTION_TITLE = {
  nav: 'app.search.section.nav',
  materials: 'app.search.section.materials',
  containers: 'app.search.section.containers',
  catalog: 'app.search.section.catalog',
  customers: 'app.search.section.customers',
  orders: 'app.search.section.orders',
  bookings: 'app.search.section.bookings',
  staff: 'app.search.section.staff',
} as const

/** Порядок разделов в выдаче. Разделы первыми — они без запроса. */
const ORDER: Section[] = [
  'nav', 'materials', 'containers', 'catalog',
  'bookings', 'customers', 'orders', 'staff',
]

// PostgREST разбирает `or=(...)` строкой: запятая, скобка и звёздочка
// в запросе человека сломали бы разбор, а `%` сделал бы любой запрос
// пустым. Чистим ДО подстановки, а не экранируем: осмысленного поиска
// по этим знакам в именах и артикулах нет.
const safe = (q: string) => q.replace(/[,()%*\\]/g, ' ').trim()

/**
 * Поиск по подстроке БЕЗ регистра и БЕЗ учёта раскладки — для разделов.
 * Своя, а не `ilike` базы: разделы не в базе, они уже в памяти.
 */
const norm = (s: string) => s.toLocaleLowerCase('uk')

/** Местный день записи в виде YYYY-MM-DD — экран записей ждёт его в `?day=`. */
function localDay(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`
}


export function GlobalSearch({
  modules, perms, nav, compact = false,
}: {
  modules?: TenantModule[]
  perms?: string[]
  /**
   * Разделы кабинета для поиска по названию. Приходят из оболочки уже
   * отфильтрованными по модулю и праву — второй фильтр здесь разошёлся бы
   * с меню молча.
   */
  nav?: SearchNavItem[]
  /**
   * Значком вместо строки. Только там, где строке не хватает места:
   * на внутренних экранах шапку уже занимают стрелка «назад» и имя
   * экрана. На корневых разделах — всегда строка.
   */
  compact?: boolean
}) {
  const t = useT()
  const router = useRouter()
  const pathname = usePathname()
  const supabase = useMemo(() => createClient(), [])

  // `open` — панель выдачи под полем. В сжатом виде это же состояние
  // раскрывает само поле поверх шапки.
  const [open, setOpen] = useState(false)
  const [q, setQ] = useState('')
  const [hits, setHits] = useState<Hit[] | null>(null)
  const [busy, setBusy] = useState(false)
  const [box, setBox] = useState<{ top: number; left: number; width: number } | null>(null)

  const fieldRef = useRef<HTMLLabelElement | null>(null)
  const inputRef = useRef<HTMLInputElement | null>(null)
  const panelRef = useRef<HTMLDivElement | null>(null)

  const may = (mod: TenantModule, perm: string) =>
    (!modules || modules.includes(mod))
    && (!perms || perms.includes('*') || perms.includes(perm))

  const sections = {
    materials: may('inventory', 'stock.read'),
    // Ёмкость — это `compliance.read`, а НЕ `stock.read`, и это не
    // придирка: политика `material_containers_read` стоит на
    // `compliance.read`, и карточка `/app/inventory/containers/[id]`
    // проверяет его же. Со `stock.read` запрос ушёл бы и вернул пусто —
    // человек читал бы это как «такой банки у нас нет».
    containers: may('inventory', 'compliance.read'),
    catalog: may('catalog', 'catalog.read'),
    customers: may('customers', 'customers.read'),
    orders: may('orders', 'orders.read'),
    bookings: may('bookings', 'orders.read'),
    staff: may('bookings', 'orders.read'),
  }
  const anywhere = Object.values(sections).some(Boolean) || (nav?.length ?? 0) > 0

  const close = useCallback(() => {
    setOpen(false)
    setQ('')
    setHits(null)
    inputRef.current?.blur()
  }, [])

  // Смена экрана закрывает поиск: переход состоялся — мебель уходит сама.
  useEffect(() => { close() }, [pathname, close])

  // ── Где рисовать панель ─────────────────────────────────────────────
  // Считаем от живого поля, а не от «высоты шапки»: высота меняется
  // от выреза устройства, от того, есть ли на экране стрелка «назад»,
  // и от выбранного человеком размера текста (`--type-scale`). Число
  // в CSS разошлось бы с любым из трёх.
  const place = useCallback(() => {
    const el = fieldRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const pad = 12
    // На телефоне панель во всю ширину экрана, а не по ширине поля:
    // поле делит строку с четырьмя значками, и выдача по его ширине
    // резала бы каждую вторую подпись. На большом экране наоборот —
    // панель ровно под полем: там поле по центру и широкое, а полоса
    // выдачи во весь экран читалась бы как чужая шапка.
    const wide = window.innerWidth >= 1024
    const left = wide ? r.left : pad
    const width = wide ? r.width : window.innerWidth - pad * 2
    setBox({ top: r.bottom + 8, left, width })
  }, [])

  useLayoutEffect(() => { if (open) place() }, [open, place])

  useEffect(() => {
    if (!open) return
    const onAny = () => place()
    window.addEventListener('resize', onAny)
    window.addEventListener('scroll', onAny, true)
    window.visualViewport?.addEventListener('resize', onAny)
    return () => {
      window.removeEventListener('resize', onAny)
      window.removeEventListener('scroll', onAny, true)
      window.visualViewport?.removeEventListener('resize', onAny)
    }
  }, [open, place])

  // Escape закрывает, как любой слой поверх страницы.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, close])

  // ── Разделы: без запроса ────────────────────────────────────────────
  const navHits: Hit[] = useMemo(() => {
    const term = norm(q.trim())
    if (term.length < 2 || !nav) return []
    return nav
      .filter((n) => norm(n.title).includes(term))
      .slice(0, 4)
      .map((n) => ({
        id: n.href, href: n.href, title: n.title, Icon: n.Icon,
        note: t('app.search.goTo'), section: 'nav' as const,
      }))
  }, [q, nav, t])

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
            .filter(Boolean).join(SEP),
          section: 'materials' as const,
        }))
      })())
    }

    if (sections.containers) {
      // Ёмкость ищется по КОДУ наклейки — это то, что человек читает
      // с банки глазами, когда сканер не сработал или телефон занят.
      // Читаем из `compliance_containers`, а не из таблицы: то же
      // представление, что и на экранах склада, — иначе инспектор
      // получил бы пустоту вместо отказа (0083).
      jobs.push((async () => {
        const { data } = await supabase.from('compliance_containers')
          .select('id, code, material_name, status, use_by, volume, unit')
          .or(`code.ilike.${like},material_name.ilike.${like}`)
          .limit(5)
        return (data ?? []).map((r) => ({
          id: r.id as string,
          href: `/app/inventory/containers/${r.id}`,
          title: `${r.code} ${SEP} ${r.material_name ?? ''}`.trim(),
          note: [
            r.volume != null ? `${t.number(Number(r.volume))} ${r.unit ?? ''}`.trim() : '',
            r.use_by ? t('app.search.useBy', { date: t.date(r.use_by as string) }) : '',
          ].filter(Boolean).join(SEP),
          section: 'containers' as const,
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
          ].filter(Boolean).join(SEP),
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
          title: `№${r.number} ${SEP} ${r.contact_name}`,
          note: [t.money(Number(r.total)), t.date(r.created_at as string)].join(SEP),
          section: 'orders' as const,
        }))
      })())
    }

    if (sections.bookings) {
      // Запись открывается ДНЁМ, а не своей карточкой: карточки записи
      // отдельным адресом не существует, экран записей показывает день
      // и в нём строку. Ведём в день записи (`?day=`), считая его
      // в местном поясе — так же, как это делает переключатель дня.
      const filter = digits
        ? `contact_name.ilike.${like},number.eq.${term}`
        : `contact_name.ilike.${like},title.ilike.${like}`
      jobs.push((async () => {
        const { data } = await supabase.from('v_bookings')
          .select('id, number, period, status, title, contact_name, price')
          .or(filter)
          .order('created_at', { ascending: false })
          .limit(5)
        return (data ?? []).flatMap((r) => {
          const start = parseRange(r.period as unknown as string).from
          if (!start) return []
          return [{
            id: r.id as string,
            href: `/app/bookings?day=${localDay(start)}`,
            title: `${r.contact_name ?? ''} ${SEP} ${r.title ?? ''}`.trim(),
            note: [t.dateTime(start), r.price != null ? t.money(Number(r.price)) : '']
              .filter(Boolean).join(SEP),
            section: 'bookings' as const,
          }]
        })
      })())
    }

    if (sections.staff) {
      jobs.push((async () => {
        const { data } = await supabase.from('staff')
          .select('id, name, title, is_active')
          .or(`name.ilike.${like},title.ilike.${like}`)
          .limit(5)
        return (data ?? []).map((r) => ({
          id: r.id as string,
          href: `/app/bookings/staff/${r.id}`,
          title: r.name as string,
          note: [r.title, r.is_active ? '' : t('app.search.staffOff')]
            .filter(Boolean).join(SEP),
          section: 'staff' as const,
        }))
      })())
    }

    const done = await Promise.all(jobs)
    return done.flat()
  }

  if (!anywhere) return null

  const all = [...navHits, ...(hits ?? [])]
  const groups = ORDER
    .map((s) => [s, all.filter((h) => h.section === s)] as const)
    .filter(([, rows]) => rows.length > 0)

  const short = q.trim().length < 2
  // Разделы отвечают без запроса. Пока идёт запрос в базу, они УЖЕ видны,
  // и скелетон рисуется под ними, а не вместо них: подменять готовый
  // ответ заглушкой — это показывать меньше, чем знаешь.
  const showSkeleton = busy && hits === null

  const field = (
    <label ref={fieldRef} className="searchfield min-w-0 flex-1">
      <IconSearch size={18} />
      <input
        ref={inputRef}
        type="search"
        inputMode="search"
        value={q}
        onChange={(e) => { setQ(e.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        placeholder={t('app.search.short')}
        aria-label={t('app.search.aria')}
        // Родная крестик-кнопка `search` в Safari закрывает поле, но
        // не закрывает выдачу — свою ставим сами, ниже.
        style={{ fontSize: 'max(16px, var(--text-lg))' }}
      />
      {q ? (
        <button type="button" className="searchfield-clear"
                aria-label={t('app.search.clear')}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => { setQ(''); setHits(null); inputRef.current?.focus() }}>
          <IconClose size={16} />
        </button>
      ) : null}
    </label>
  )

  const panel = open && !short && box ? createPortal(
    <>
      {/* Подложка. Не затемняет — выдача висит под полем, а не поверх
          экрана, и затемнение читалось бы как модальное окно. Её работа
          одна: тап мимо закрывает. */}
      <div className="search-scrim" onMouseDown={close} onTouchStart={close} />
      <div
        ref={panelRef}
        className="search-panel"
        role="listbox"
        style={{
          top: box.top,
          left: box.left,
          width: box.width,
          // Ровно свободное место: от низа поля до верха клавиатуры.
          maxHeight: `calc(100dvh - ${box.top}px - var(--kb, 0px) - 12px)`,
        }}
      >
        {showSkeleton && groups.length === 0 ? (
          <div className="flex flex-col gap-2 p-2">
            {Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="skeleton-row px-1"><span /><span /><span /><span /></div>
            ))}
          </div>
        ) : groups.length === 0 ? (
          <div className="p-4 text-center">
            <p className="t-md" style={{ fontWeight: 650 }}>{t('app.search.empty')}</p>
            <p className="t-xs mt-1" style={{ color: 'var(--color-faint)' }}>
              {t('app.search.emptyDesc')}
            </p>
          </div>
        ) : (
          <div className="flex flex-col py-1">
            {groups.map(([section, rows]) => {
              const Fallback = ICON[section]
              return (
                <section key={section}>
                  <p className="eyebrow search-group">{t(SECTION_TITLE[section])}</p>
                  {rows.map((h) => {
                    const Icon = h.Icon ?? Fallback
                    return (
                    <Link key={`${section}:${h.href}`} href={h.href} className="row search-row"
                          prefetch={section === 'nav'}
                          onClick={() => {
                            close()
                            // Разделы кабинета `force-dynamic`: без тихого
                            // обновления переход показал бы вчерашний кеш
                            // (CLAUDE.md, правило 6).
                            if (section === 'nav') router.refresh()
                          }}>
                      <span aria-hidden className="thumb-sm"><Icon size={18} /></span>
                      <span className="min-w-0 flex-1">
                        <span className="t-md block truncate">{h.title}</span>
                        <span className="t-xs block truncate"
                              style={{ color: 'var(--color-faint)' }}>{h.note}</span>
                      </span>
                      <span aria-hidden style={{ color: 'var(--color-faint)' }}>›</span>
                    </Link>
                    )
                  })}
                </section>
              )
            })}
            {showSkeleton ? (
              <div className="skeleton-row mx-3 my-2"><span /><span /><span /><span /></div>
            ) : null}
          </div>
        )}
      </div>
    </>,
    document.body,
  ) : null

  // ── Сжатый вид ────────────────────────────────────────────────────
  // На внутренних экранах место занято стрелкой «назад» и именем экрана.
  // Значок РАСКРЫВАЕТ поле поверх строки шапки, а не открывает шторку:
  // печатать человек обязан в шапке везде, а не только на корневых
  // экранах, иначе поиск ведёт себя по-разному на соседних экранах.
  if (compact) {
    return (
      <>
        {open ? (
          <div className="apphead-search-over">
            {field}
            {/* Выход из поиска ЗДЕСЬ, а не только тапом мимо: подложка
                появляется вместе с выдачей, то есть с двух знаков.
                Без этой кнопки раскрытое пустое поле было бы ловушкой —
                закрыть его было бы нечем. */}
            <button type="button" onClick={close} aria-label={t('app.search.close')}
                    className="iconbtn shrink-0">
              <IconClose />
            </button>
          </div>
        ) : null}
        {/* Значок остаётся в потоке и когда поле раскрыто: убрать его
            значило бы схлопнуть ширину строки шапки, и стрелка «назад»
            с именем экрана прыгнули бы под полем. Прячем видимость,
            а не место. */}
        <button type="button"
                onClick={() => { setOpen(true); requestAnimationFrame(() => inputRef.current?.focus()) }}
                aria-label={t('app.search.aria')} className="iconbtn shrink-0"
                style={open ? { visibility: 'hidden' } : undefined}>
          <IconSearch />
        </button>
        {panel}
      </>
    )
  }

  return (
    <>
      {field}
      {panel}
    </>
  )
}
