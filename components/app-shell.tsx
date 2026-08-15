'use client'

import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { Suspense, useCallback, useEffect, useState } from 'react'
import { ThemeToggle } from '@/components/theme'
import { Sheet } from '@/components/sheet'
import { createClient } from '@/lib/supabase/client'
import type { TenantModule } from '@/lib/tenant'

// Навигация кабинета. Архитектура — решение директора 05.08.2026:
//
//   РАЗДЕЛЫ живут в боковой шторке за бургером — как в инстаграме.
//   НИЖНЯЯ ПАНЕЛЬ показывает табы ТЕКУЩЕГО раздела.
//
// Почему так, а не «разделы снизу», как раньше: разделов одиннадцать,
// снизу помещается пять — и внутри каждого раздела есть свои экраны
// (у склада семь). Прятать экраны склада в глубину — значит заставить
// мастера искать «Приймання» по ссылкам. А так большой палец всегда
// на экранах того раздела, в котором человек работает, — и это тот же
// приём, что у рабочих приложений вроде Slack.
//
// Правило одной структуры: с любого экрана видно, где ты (заголовок),
// куда можно отсюда (нижние табы), и как попасть в другой раздел
// (бургер). Стрелка «назад» появляется только на подэкранах карточек.

// ── Разделы ──────────────────────────────────────────────────────
// module: раздел виден, только если арендатор его купил. Первый клиент
// (только склад и журналы) увидит в шторке пять пунктов из одиннадцати.
type SectionTab = {
  href: string
  label: string
  icon: string
  /** exact: таб активен только при точном совпадении пути — для «Огляд»,
      иначе он горит на каждом подэкране раздела. */
  exact?: boolean
  /** tab: значение ?tab= — для экранов, где табы живут в одном адресе. */
  tab?: string
}

type Section = {
  href: string
  label: string
  icon: string
  module?: TenantModule
  tabs?: SectionTab[]
  /** Экраны, не поместившиеся в панель, — уезжают в шторку «Ще». */
  more?: { href: string; label: string; hint: string }[]
}

const SECTIONS: Section[] = [
  { href: '/app', label: 'Сьогодні', icon: '◐' },
  {
    href: '/app/inventory', label: 'Склад', icon: '▦', module: 'inventory',
    tabs: [
      { href: '/app/inventory', label: 'Огляд', icon: '▦', exact: true },
      { href: '/app/inventory/receipts', label: 'Приймання', icon: '⬓' },
      { href: '/app/inventory/movements', label: 'Рухи', icon: '⇅' },
      { href: '/app/inventory/counts', label: 'Інвентар', icon: '☰' },
    ],
    more: [
      { href: '/app/inventory/recipes', label: 'Рецептури', hint: 'Автосписання матеріалів за послугу' },
      { href: '/app/inventory/barcodes', label: 'Штрихкоди', hint: 'Заводські коди EAN на засобах' },
      { href: '/app/inventory/reorder', label: 'Пора замовити', hint: 'Що закінчується і скільки докупити' },
    ],
  },
  { href: '/app/bookings', label: 'Записи', icon: '◷', module: 'bookings' },
  {
    href: '/app/journals', label: 'Журнали', icon: '✓', module: 'compliance',
    tabs: [
      { href: '/app/journals', label: 'Прибирання', icon: '✓', tab: 'cleaning' },
      { href: '/app/journals?tab=solutions', label: 'Розчини', icon: '◍', tab: 'solutions' },
      { href: '/app/journals?tab=sterilization', label: 'Стериліз.', icon: '♨', tab: 'sterilization' },
      { href: '/app/journals?tab=actions', label: 'Дії', icon: '≡', tab: 'actions' },
    ],
  },
  { href: '/app/catalog', label: 'Каталог', icon: '◫', module: 'catalog' },
  { href: '/app/orders', label: 'Замовлення', icon: '⬒', module: 'orders' },
  { href: '/app/documents', label: 'Документи', icon: '⎘', module: 'compliance' },
  { href: '/app/techcards', label: 'Техкарти', icon: '❑', module: 'compliance' },
  { href: '/app/customers', label: 'Клієнти', icon: '◎', module: 'customers' },
  { href: '/app/finance', label: 'Фінанси', icon: '₴', module: 'finance' },
  { href: '/app/settings', label: 'Магазин', icon: '⚙' },
]

// Раздел определяется по началу пути, самый длинный префикс побеждает:
// /app/inventory/receipts/17 — это Склад, а не Сьогодні.
function sectionOf(pathname: string): Section {
  let best = SECTIONS[0]
  for (const s of SECTIONS) {
    if (s.href === '/app' ? pathname === '/app' : pathname.startsWith(s.href)) {
      if (s.href.length > best.href.length) best = s
    }
  }
  return best
}

export function AppShell(props: {
  active: string
  title: string
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
  active, title, modules, back, action, children,
}: {
  active: string
  title: string
  modules?: TenantModule[]
  back?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  const pathname = usePathname()
  const params = useSearchParams()
  const [drawer, setDrawer] = useState(false)
  const [more, setMore] = useState(false)

  const visible = SECTIONS.filter((s) => !s.module || !modules || modules.includes(s.module))
  const section = sectionOf(pathname)
  const tabs = section.tabs ?? []

  // Смена экрана закрывает и шторку разделов, и «Ще»: навигация
  // произошла — навигационная мебель обязана уйти с дороги сама.
  useEffect(() => { setDrawer(false); setMore(false) }, [pathname, params])

  const openDrawer = useCallback(() => setDrawer(true), [])

  const tabActive = (t: SectionTab): boolean => {
    if (t.tab !== undefined) {
      const current = params.get('tab') ?? (section.tabs?.[0]?.tab ?? '')
      return pathname === section.href.split('?')[0] && current === t.tab
    }
    if (t.exact) return pathname === t.href
    return pathname.startsWith(t.href)
  }

  async function signOut() {
    await createClient().auth.signOut()
    // Раньше здесь была развилка по `data-native`: из обёртки уводили
    // на /m, из браузера — на главную. Обёртки нет, развилка удалена.
    window.location.href = '/'
  }

  return (
    <div className="appshell min-h-dvh pb-32 lg:pb-0">
      <div className="mx-auto flex max-w-6xl gap-8 px-4 pt-6 sm:px-6">
        {/* ── Десктоп: постоянный сайдбар, ничего не пряталось ── */}
        <aside className="hidden w-52 shrink-0 lg:block">
          <Link href="/app" className="display mb-8 block t-xl">
            CRES<span style={{ color: 'var(--color-accent)' }}>KO</span>
          </Link>
          <nav className="flex flex-col gap-1">
            {visible.map((s) => (
              <Link key={s.href} href={s.href} className="sidebar-item"
                    data-active={active === s.href || section.href === s.href}>
                <span aria-hidden className="w-4 text-center">{s.icon}</span>
                {s.label}
              </Link>
            ))}
          </nav>
          <div className="mt-8 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
            <ThemeToggle />
          </div>
        </aside>

        <main className="min-w-0 flex-1 pb-12">
          <div className="apphead mb-6 flex items-center gap-3">
            {back ? (
              <Link href={back} aria-label="Назад"
                    className="apphead-back flex shrink-0 items-center justify-center">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2"
                     strokeLinecap="round" strokeLinejoin="round">
                  <path d="M15 18l-6-6 6-6" />
                </svg>
              </Link>
            ) : (
              // Бургер — только на корневых экранах и только на телефоне:
              // на десктопе разделы всегда на виду слева, а на подэкране
              // это место занимает «назад» — два навигационных начала
              // в одной шапке путают.
              <button type="button" onClick={openDrawer} aria-label="Розділи"
                      className="apphead-back flex shrink-0 items-center justify-center lg:hidden">
                <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M4 7h16M4 12h16M4 17h16" />
                </svg>
              </button>
            )}
            <h1 className="display rise t-2xl min-w-0 flex-1 truncate">{title}</h1>
            {action}
            <ThemeToggle className="lg:hidden" />
          </div>
          {children}
        </main>
      </div>

      {/* ── Нижняя панель: табы ТЕКУЩЕГО раздела ─────────────── */}
      {/* У раздела один экран — панели нет: пустая полоса снизу это
          мебель ради мебели. Разделы всегда в бургере. */}
      {tabs.length > 0 && (
        <nav className="bottomnav flex justify-around gap-1 p-1 lg:hidden">
          {tabs.map((t) => (
            <Link key={t.href} href={t.href} className="bottomnav-item flex-1"
                  data-active={tabActive(t)}>
              <span aria-hidden className="t-lg leading-none">{t.icon}</span>
              {t.label}
            </Link>
          ))}
          {section.more && section.more.length > 0 && (
            <button type="button" className="bottomnav-item flex-1"
                    onClick={() => setMore(true)}>
              <span aria-hidden className="t-lg leading-none">⋯</span>
              Ще
            </button>
          )}
        </nav>
      )}

      {/* ── Шторка разделов ──────────────────────────────────── */}
      {drawer && (
        <div className="drawer-layer" onClick={() => setDrawer(false)}>
          <div className="drawer" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between" style={{ height: 56 }}>
              <span className="display t-xl">
                CRES<span style={{ color: 'var(--color-accent)' }}>KO</span>
              </span>
              <button type="button" aria-label="Закрити" onClick={() => setDrawer(false)}
                      className="flex items-center justify-center"
                      style={{ width: 'var(--tap-min)', height: 'var(--tap-min)', marginRight: -8 }}>
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
                     stroke="currentColor" strokeWidth="2" strokeLinecap="round">
                  <path d="M6 6l12 12M18 6L6 18" />
                </svg>
              </button>
            </div>

            <nav className="mt-2 flex flex-col gap-1">
              {visible.map((s) => (
                <Link key={s.href} href={s.href} className="drawer-item"
                      data-active={section.href === s.href}
                      >
                  <span aria-hidden className="w-5 text-center t-lg">{s.icon}</span>
                  {s.label}
                </Link>
              ))}
            </nav>

            <div className="mt-auto border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
              <ThemeToggle />
              <button type="button" onClick={() => void signOut()}
                      className="drawer-item mt-1 w-full text-left"
                      style={{ color: 'var(--color-muted)' }}>
                <span aria-hidden className="w-5 text-center t-lg">→</span>
                Вийти
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── «Ще»: экраны раздела, не поместившиеся в панель ──── */}
      <Sheet open={more} onClose={() => setMore(false)} title={`${section.label} — ще`}>
        <div className="flex flex-col gap-2">
          {(section.more ?? []).map((m) => (
            <Link key={m.href} href={m.href}
                  className="card-flat flex items-center justify-between gap-3"
                  style={{ minHeight: 'var(--tap-min)' }}
                  >
              <span>
                <span className="t-md block">{m.label}</span>
                <span className="t-xs block" style={{ color: 'var(--color-faint)' }}>{m.hint}</span>
              </span>
              <span aria-hidden style={{ color: 'var(--color-faint)' }}>›</span>
            </Link>
          ))}
        </div>
      </Sheet>
    </div>
  )
}
