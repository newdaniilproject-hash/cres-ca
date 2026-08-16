'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, createContext, useContext, useEffect, useState } from 'react'
import { ThemeToggle } from '@/components/theme'
import { Sheet } from '@/components/sheet'
import { createClient } from '@/lib/supabase/client'
import type { TenantModule } from '@/lib/tenant'
import {
  IconBack, IconBag, IconBox, IconCalendar, IconCheck, IconDoc,
  IconExit, IconGear, IconHome, IconMoney, IconScan, IconScissors,
  IconSearch, IconUser, IconUsers,
} from '@/components/icons'

// Навигация кабинета. Переписана 15.08.2026 по макетам CRESKO,
// решение владельца: единый стиль, снизу — Склад, Записи, Послуги,
// Профіль, всё остальное под аватаром.
//
// ГДЕ ЖИВЁТ ОБОЛОЧКА. В `app/app/layout.tsx`, один раз на весь кабинет.
// Раньше её рисовала каждая страница, и это дало дефект, который владелец
// увидел глазами: при переходе Next показывает `loading.tsx` сегмента,
// а тот рисовал ВТОРУЮ оболочку — на экране оказывались две нижние панели
// одна поверх другой («навбар со всеми иконками») плюс скелетон чужого
// экрана под правильным заголовком.
//
// Поэтому AppShell теперь идемпотентен: вызванный внутри уже отрисованной
// оболочки, он не рисует ничего своего и отдаёт только содержимое.
// Двадцать шесть страниц кабинета продолжают звать его как звали —
// переписывать их не пришлось, и второй панели больше не появится.
//
// ЧТО ИЗМЕНИЛОСЬ В САМОЙ НАВИГАЦИИ:
//
//   БЫЛО: снизу — экраны ТЕКУЩЕГО раздела, разделы — за бургером слева.
//   СТАЛО: снизу — сами разделы, четыре главных. Экраны раздела живут
//   внутри экрана (быстрые действия и вкладки), а не в панели.
//
// Причина не вкусовая. Мастер за смену переключается между складом,
// записями и услугами десятки раз, а внутрь одного раздела заходит
// подряд. Панель обязана держать то, между чем прыгают, а не то, что
// открывают один раз. Бургер слева при этом исчез: путь к остальным
// разделам — аватар справа, там же тема и выход.

type Item = {
  href: string
  label: string
  icon: (p: { size?: number }) => React.ReactElement
  module?: TenantModule
  /** exact: пункт активен только при точном совпадении пути. */
  exact?: boolean
}

// ── Нижняя панель: четыре пункта ────────────────────────────────
// Больше четырёх сюда не поместится так, чтобы подпись читалась
// на 390px и зона нажатия осталась 44px.
const TABS: Item[] = [
  { href: '/app/inventory', label: 'Склад', icon: IconBox, module: 'inventory' },
  { href: '/app/bookings', label: 'Записи', icon: IconCalendar, module: 'bookings' },
  { href: '/app/catalog', label: 'Послуги', icon: IconScissors, module: 'catalog' },
  { href: '/app/profile', label: 'Профіль', icon: IconUser },
]

// ── Под аватаром: всё остальное ─────────────────────────────────
const MENU: Item[] = [
  { href: '/app', label: 'Сьогодні', icon: IconHome, exact: true },
  { href: '/app/journals', label: 'Журнали', icon: IconCheck, module: 'compliance' },
  { href: '/app/documents', label: 'Документи', icon: IconDoc, module: 'compliance' },
  { href: '/app/techcards', label: 'Техкарти', icon: IconDoc, module: 'compliance' },
  { href: '/app/orders', label: 'Замовлення', icon: IconBag, module: 'orders' },
  { href: '/app/customers', label: 'Клієнти', icon: IconUsers, module: 'customers' },
  { href: '/app/finance', label: 'Фінанси', icon: IconMoney, module: 'finance' },
  { href: '/app/team', label: 'Команда', icon: IconUsers },
  { href: '/app/settings', label: 'Магазин', icon: IconGear },
]

// ── Подписи экранов ─────────────────────────────────────────────
//
// Заголовок и строка под ним — часть НАВИГАЦИИ, а не страницы: они
// отвечают на вопрос «где я», и ответ обязан быть одинаковым, с какого
// бы экрана человек сюда ни пришёл. Держать их в двадцати шести
// страницах значит завести двадцать шесть источников правды и получить
// «Каталог» в заголовке там, где в панели написано «Послуги».
//
// `*` — любой один сегмент: под него попадают адреса карточек.
const HEADINGS: [string, string, string][] = [
  ['/app/inventory', 'Склад', 'Огляд запасів та матеріалів'],
  ['/app/inventory/receipts', 'Приймання', 'Накладні та оприбуткування'],
  ['/app/inventory/receipts/*', 'Приймання', 'Документ надходження'],
  ['/app/inventory/movements', 'Рухи залишку', 'Журнал надходжень і списань'],
  ['/app/inventory/counts', 'Інвентаризація', 'Перерахунок фактичних залишків'],
  ['/app/inventory/counts/*', 'Інвентаризація', 'Документ перерахунку'],
  ['/app/inventory/recipes', 'Рецептура', 'Автосписання матеріалів за послугу'],
  ['/app/inventory/barcodes', 'Штрихкоди', 'Заводські коди EAN на засобах'],
  ['/app/inventory/reorder', 'Пора замовити', 'Що закінчується і скільки докупити'],
  ['/app/inventory/materials/*', 'Картка засобу', 'Паспорт, партія та терміни'],
  ['/app/inventory/materials/*/docs', 'Документи засобу', 'MSDS, сертифікати, нотифікація'],
  ['/app/inventory/materials/*/pao', 'Відкриття та фасування', 'PAO, розлив і наліпки'],
  ['/app/bookings', 'Записи', 'Розклад і клієнти на сьогодні'],
  ['/app/catalog', 'Послуги', 'Каталог послуг і товарів'],
  ['/app/catalog/new', 'Нова позиція', 'Послуга або товар'],
  ['/app/catalog/*', 'Позиція каталогу', 'Опис, ціна та наявність'],
  ['/app/journals', 'Журнали', 'Прибирання, розчини, стерилізація'],
  ['/app/journals/report', 'Звіт для перевірки', 'Вивантаження за період'],
  ['/app/documents', 'Документи', 'MSDS, сертифікати, висновки СЕС'],
  ['/app/techcards', 'Техкарти', 'Регламенти обробки канекалону'],
  ['/app/orders', 'Замовлення', 'Статуси, склад і оплати'],
  ['/app/orders/*', 'Замовлення', 'Склад, статус і оплата'],
  ['/app/customers', 'Клієнти', 'База клієнтів та історія візитів'],
  ['/app/finance', 'Фінанси', 'Доходи, витрати та підсумки'],
  ['/app/profile', 'Профіль', 'Обліковий запис, безпека та вихід'],
  ['/app/team', 'Команда', 'Доступи, ролі, запрошення та сеанси'],
  ['/app/settings', 'Налаштування закладу', 'Інформація та публікація'],
]

function matches(pattern: string, pathname: string): boolean {
  const p = pattern.split('/')
  const a = pathname.split('/')
  if (p.length !== a.length) return false
  return p.every((seg, i) => seg === '*' || seg === a[i])
}

/** Заголовок, подпись и адрес «назад» — из адреса, а не из страницы. */
function headingOf(pathname: string, shopName: string) {
  if (pathname === '/app') {
    return { title: shopName || 'Кабінет', subtitle: 'Що потребує уваги сьогодні', back: '' }
  }
  // Сначала точное совпадение, потом шаблоны: «/app/catalog/new» обязан
  // выиграть у «/app/catalog/*», иначе новая позиция назовётся карточкой.
  const hit = HEADINGS.find(([p]) => p === pathname)
    ?? HEADINGS.find(([p]) => p.includes('*') && matches(p, pathname))
  const root = [...TABS, ...MENU].some((i) => i.href === pathname)
  const back = root ? '' : pathname.split('/').slice(0, -1).join('/')
  return { title: hit?.[1] ?? '', subtitle: hit?.[2] ?? '', back }
}

// Отрисована ли оболочка выше по дереву. Внутри неё AppShell прозрачен.
const InsideShell = createContext(false)

export function AppShell(props: {
  active?: string
  title?: string
  subtitle?: string
  modules?: TenantModule[]
  /** Имя заведения — заголовок экрана «Сьогодні». */
  shopName?: string
  back?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  const inside = useContext(InsideShell)
  // Страница вызвала AppShell внутри layout — отдаём только содержимое.
  // Так двадцать шесть старых вызовов перестали плодить вторую панель.
  if (inside) return <>{props.children}</>

  // useSearchParams обязан жить под Suspense — иначе статическая сборка
  // страницы падает.
  return (
    <Suspense fallback={<div className="appshell min-h-dvh" />}>
      <InsideShell.Provider value>
        <AppShellInner {...props} />
      </InsideShell.Provider>
    </Suspense>
  )
}

function AppShellInner({
  modules, shopName = '', action, children,
}: {
  modules?: TenantModule[]
  shopName?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const params = useSearchParams()
  const router = useRouter()
  const [menu, setMenu] = useState(false)
  const [query, setQuery] = useState('')
  const [initial, setInitial] = useState('')

  const has = (i: Item) => !i.module || !modules || modules.includes(i.module)
  const tabs = TABS.filter(has)
  const menuItems = MENU.filter(has)
  const heading = headingOf(pathname, shopName)

  // Смена экрана закрывает меню: навигация произошла — мебель обязана
  // уйти с дороги сама.
  useEffect(() => { setMenu(false) }, [pathname, params])

  // Буква на аватаре. Имя берём из профиля токена, а не запросом
  // к базе: аватар не стоит похода в сеть на каждом экране.
  useEffect(() => {
    let alive = true
    void createClient().auth.getUser().then(({ data }) => {
      if (!alive) return
      const u = data.user
      const name = (u?.user_metadata?.full_name as string | undefined)
        ?? (u?.user_metadata?.first_name as string | undefined)
        ?? u?.email ?? ''
      setInitial(name.trim().charAt(0).toUpperCase())
    })
    return () => { alive = false }
  }, [])

  const active = (i: Item) =>
    i.exact ? pathname === i.href : pathname.startsWith(i.href)

  async function signOut() {
    await createClient().auth.signOut()
    window.location.href = '/'
  }

  // Поиск сверху ведёт на склад. Подпись честная: глобального поиска
  // по кабинету нет, и обещать его строкой «Пошук у CRESKO» значит
  // соврать на первом же запросе.
  function search(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    router.push(q ? `/app/inventory?q=${encodeURIComponent(q)}` : '/app/inventory')
  }

  return (
    <div className="appshell min-h-dvh pb-32 lg:pb-0">
      <div className="mx-auto flex max-w-6xl gap-8 px-4 pt-3 sm:px-6">

        {/* ── Десктоп: постоянный сайдбар ─────────────────────── */}
        <aside className="hidden w-52 shrink-0 lg:block">
          <Link href="/app" className="display mb-8 block t-xl">
            CRES<span style={{ color: 'var(--color-accent)' }}>KO</span>
          </Link>
          <nav className="flex flex-col gap-1">
            {[...menuItems.slice(0, 1), ...tabs, ...menuItems.slice(1)].map((s) => (
              <Link key={s.href + s.label} href={s.href} className="sidebar-item"
                    data-active={active(s)}>
                <span aria-hidden className="flex w-5 justify-center">
                  <s.icon size={18} />
                </span>
                {s.label}
              </Link>
            ))}
          </nav>
          <div className="mt-8 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
            <ThemeToggle />
          </div>
        </aside>

        <main className="min-w-0 flex-1 pb-12">

          {/* ── Верхняя строка: назад, поиск, сканер, аватар ──── */}
          <div className="apphead mb-4 flex items-center gap-2">
            {heading.back && (
              <Link href={heading.back} aria-label="Назад"
                    className="apphead-back flex shrink-0 items-center justify-center">
                <IconBack />
              </Link>
            )}

            <form onSubmit={search} className="min-w-0 flex-1">
              <label className="searchbar flex items-center gap-2">
                <span aria-hidden style={{ color: 'var(--color-faint)' }}><IconSearch /></span>
                <input
                  className="searchbar-input min-w-0 flex-1"
                  placeholder="Пошук на складі…"
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  aria-label="Пошук на складі"
                />
              </label>
            </form>

            <Link href="/app/inventory?scan=1" aria-label="Сканувати код"
                  className="iconbtn shrink-0">
              <IconScan />
            </Link>

            <button type="button" onClick={() => setMenu(true)}
                    aria-label="Розділи та профіль" className="avatarbtn shrink-0">
              {initial || <IconUser size={18} />}
            </button>
          </div>

          {/* ── Заголовок экрана ──────────────────────────────── */}
          <div className="mb-5 flex items-end gap-3">
            <div className="min-w-0 flex-1">
              <h1 className="display rise t-3xl truncate">{heading.title}</h1>
              {heading.subtitle && (
                <p className="t-sm mt-0.5 truncate" style={{ color: 'var(--color-muted)' }}>
                  {heading.subtitle}
                </p>
              )}
            </div>
            {action}
          </div>

          {children}
        </main>
      </div>

      {/* ── Нижняя панель: разделы ──────────────────────────── */}
      {tabs.length > 1 && (
        <nav className="bottomnav flex justify-around gap-1 p-1 lg:hidden">
          {tabs.map((t) => (
            <Link key={t.href} href={t.href} className="bottomnav-item flex-1"
                  data-active={active(t)}>
              <span aria-hidden><t.icon size={22} /></span>
              {t.label}
            </Link>
          ))}
        </nav>
      )}

      {/* ── Под аватаром: остальные разделы, тема, выход ─────── */}
      <Sheet open={menu} onClose={() => setMenu(false)} title="Розділи">
        <div className="flex flex-col gap-1">
          {menuItems.map((s) => (
            <Link key={s.href + s.label} href={s.href} className="drawer-item"
                  data-active={active(s)}>
              <span aria-hidden className="flex w-6 justify-center">
                <s.icon size={20} />
              </span>
              {s.label}
            </Link>
          ))}
        </div>
        <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
          <ThemeToggle />
          <button type="button" onClick={() => void signOut()}
                  className="drawer-item mt-1 w-full text-left"
                  style={{ color: 'var(--color-muted)' }}>
            <span aria-hidden className="flex w-6 justify-center"><IconExit /></span>
            Вийти
          </button>
        </div>
      </Sheet>
    </div>
  )
}
