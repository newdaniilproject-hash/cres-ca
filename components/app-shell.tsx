'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, useEffect, useState } from 'react'
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
// Что изменилось против прежней схемы и почему:
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
//
// Правило одной структуры сохранено: с любого экрана видно, где ты
// (заголовок), куда можно отсюда (панель снизу), и как попасть
// в остальное (аватар). Стрелка «назад» — только на подэкранах.

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
  { href: '/app/settings', label: 'Магазин', icon: IconGear },
]

// ── Подписи разделов ────────────────────────────────────────────
//
// Заголовок и строка под ним — часть НАВИГАЦИИ, а не страницы: они
// отвечают на вопрос «где я», и ответ обязан быть одинаковым, с какого
// бы экрана человек сюда ни пришёл. Держать их в каждой странице значит
// собирать одиннадцать источников правды и ловить «Каталог» в заголовке
// там, где в панели написано «Послуги».
//
// Страница всё же может перебить оба: у «Сьогодні» заголовок — имя
// заведения, и словарь его не знает.
const HEADINGS: Record<string, { title?: string; subtitle: string }> = {
  '/app': { subtitle: 'Що потребує уваги сьогодні' },
  '/app/inventory': { title: 'Склад', subtitle: 'Огляд запасів та матеріалів' },
  '/app/bookings': { title: 'Записи', subtitle: 'Розклад і клієнти на сьогодні' },
  '/app/catalog': { title: 'Послуги', subtitle: 'Каталог послуг і товарів' },
  '/app/profile': { title: 'Профіль', subtitle: 'Обліковий запис, безпека та вихід' },
  '/app/journals': { title: 'Журнали', subtitle: 'Прибирання, розчини, стерилізація' },
  '/app/documents': { title: 'Документи', subtitle: 'MSDS, сертифікати, висновки СЕС' },
  '/app/techcards': { title: 'Техкарти', subtitle: 'Регламенти обробки канекалону' },
  '/app/orders': { title: 'Замовлення', subtitle: 'Статуси, склад і оплати' },
  '/app/customers': { title: 'Клієнти', subtitle: 'База клієнтів та історія візитів' },
  '/app/finance': { title: 'Фінанси', subtitle: 'Доходи, витрати та підсумки' },
  '/app/settings': { title: 'Налаштування закладу', subtitle: 'Інформація, публікація та команда' },
}

export function AppShell(props: {
  active: string
  title: string
  /** Строка под заголовком — как на макетах: «Огляд запасів та матеріалів». */
  subtitle?: string
  modules?: TenantModule[]
  back?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  // useSearchParams обязан жить под Suspense — иначе статическая сборка
  // страницы падает. Кабинет весь динамический, но правило дешевле
  // соблюсти, чем однажды словить его на новом экране.
  return (
    <Suspense fallback={<div className="appshell min-h-dvh" />}>
      <AppShellInner {...props} />
    </Suspense>
  )
}

function AppShellInner({
  title, subtitle, modules, back, action, children,
}: {
  active: string
  title: string
  subtitle?: string
  modules?: TenantModule[]
  back?: string
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

  // Подэкран карточки берёт заголовок у страницы: «Картка засобу»
  // не должна называться «Склад». Поэтому словарь смотрит на точное
  // совпадение адреса, а не на префикс.
  const preset = HEADINGS[pathname]
  const heading = {
    title: preset?.title ?? title,
    subtitle: subtitle ?? preset?.subtitle ?? '',
  }

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
            {back && (
              <Link href={back} aria-label="Назад"
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

          {/* ── Заголовок раздела ─────────────────────────────── */}
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
