import Link from 'next/link'

// Публичная шапка. Ссылок мало сознательно: поиск — главный вход.
export function PublicHeader({ authed }: { authed: boolean }) {
  return (
    <header className="topbar">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="display text-xl font-semibold tracking-tight">
          Маркет<span style={{ color: 'var(--color-gold)' }}>.</span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link href="/map" className="btn-ghost">Мапа</Link>
          <Link href="/search" className="btn-ghost hidden sm:inline-flex">Пошук</Link>
          {authed ? (
            <Link href="/account" className="btn-secondary h-10">Кабінет</Link>
          ) : (
            <>
              <Link href="/login" className="btn-ghost">Увійти</Link>
              <Link href="/register/seller" className="btn-primary h-10 hidden sm:inline-flex">
                Для бізнесу
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}

export function PublicFooter() {
  return (
    <footer className="divider mt-20">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-10 text-sm sm:flex-row sm:items-center sm:justify-between sm:px-6 prose-muted">
        <p>© {new Date().getFullYear()} · Платформа для українських підприємців</p>
        <div className="flex gap-5">
          <Link href="/register/seller" className="hover:underline">Відкрити бізнес</Link>
          <Link href="/login" className="hover:underline">Вхід</Link>
        </div>
      </div>
    </footer>
  )
}

const APP_NAV = [
  { href: '/app', label: 'Сьогодні', icon: '◐' },
  { href: '/app/inventory', label: 'Склад', icon: '▦' },
  { href: '/app/bookings', label: 'Записи', icon: '◷' },
  { href: '/app/journals', label: 'Журнали', icon: '✓' },
  { href: '/app/customers', label: 'Клієнти', icon: '◎' },
  { href: '/app/settings', label: 'Магазин', icon: '⚙' },
]

// Кабинет продавца: сайдбар на десктопе, нижняя навигация на телефоне.
// Мастер работает с телефона стоя — нижняя навигация первична.
export function AppShell({
  active,
  title,
  children,
}: {
  active: string
  title: string
  children: React.ReactNode
}) {
  return (
    <div className="min-h-dvh pb-20 lg:pb-0">
      <div className="mx-auto flex max-w-6xl gap-8 px-4 pt-6 sm:px-6">
        <aside className="hidden w-52 shrink-0 lg:block">
          <Link href="/" className="display mb-8 block text-xl font-semibold">
            Маркет<span style={{ color: 'var(--color-gold)' }}>.</span>
          </Link>
          <nav className="flex flex-col gap-1">
            {APP_NAV.map((item) => (
              <Link key={item.href} href={item.href} className="sidebar-item"
                    data-active={active === item.href}>
                <span aria-hidden className="w-4 text-center">{item.icon}</span>
                {item.label}
              </Link>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 flex-1 pb-12">
          <h1 className="display rise mb-6 text-2xl font-semibold tracking-tight">{title}</h1>
          {children}
        </main>
      </div>

      <nav className="bottomnav grid grid-cols-6 lg:hidden">
        {APP_NAV.map((item) => (
          <Link key={item.href} href={item.href} className="bottomnav-item"
                data-active={active === item.href}>
            <span aria-hidden className="text-base leading-none">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
