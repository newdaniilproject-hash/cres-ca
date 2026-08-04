import Link from 'next/link'
import { ThemeToggle } from '@/components/theme'

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
          <ThemeToggle className="hidden sm:inline-flex" />
          {authed ? (
            <Link href="/account" className="btn-secondary h-10">Кабінет</Link>
          ) : (
            <>
              <Link href="/login" className="btn-ghost">Увійти</Link>
              {/* Регистрация покупателя нужна отдельной ссылкой: без неё
                  единственный вход в неё — со страницы логина, то есть
                  на клик глубже, чем регистрация продавца. */}
              <Link href="/register" className="btn-ghost hidden sm:inline-flex">
                Реєстрація
              </Link>
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

// Полный список — сайдбар на десктопе. На телефоне помещается пять пунктов,
// поэтому там показываются только отмеченные phone: мастер за работой
// открывает склад, записи и журналы, а каталог и финансы правит за столом.
const APP_NAV = [
  { href: '/app',            label: 'Сьогодні',  icon: '◐', phone: true },
  { href: '/app/inventory',  label: 'Склад',     icon: '▦', phone: true },
  { href: '/app/catalog',    label: 'Каталог',   icon: '◫', phone: false },
  { href: '/app/bookings',   label: 'Записи',    icon: '◷', phone: true },
  { href: '/app/orders',     label: 'Замовлення', icon: '⬒', phone: false },
  { href: '/app/journals',   label: 'Журнали',   icon: '✓', phone: true },
  { href: '/app/documents',  label: 'Документи', icon: '⎘', phone: false },
  { href: '/app/techcards',  label: 'Техкарти',  icon: '❑', phone: false },
  { href: '/app/customers',  label: 'Клієнти',   icon: '◎', phone: false },
  { href: '/app/finance',    label: 'Фінанси',   icon: '₴', phone: false },
  { href: '/app/settings',   label: 'Магазин',   icon: '⚙', phone: true },
]

const PHONE_NAV = APP_NAV.filter((i) => i.phone)

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
    // data-surface="app" переключает весь набор переменных на тёмную
    // рабочую палитру: кабинет и витрина — две разные поверхности
    // одной системы (см. шапку app/globals.css).
    // Отступ снизу 128px, а не высота панели: плавающая навигация
    // висит над контентом, и без запаса последняя карточка уезжает
    // под неё вместе с индикатором жестов.
    <div data-surface="app" className="min-h-dvh pb-32 lg:pb-0">
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
          <div className="mt-8 border-t pt-4" style={{ borderColor: 'var(--color-border)' }}>
            <ThemeToggle />
          </div>
        </aside>

        <main className="min-w-0 flex-1 pb-12">
          <div className="mb-6 flex items-center justify-between gap-4">
            <h1 className="display rise text-2xl font-semibold tracking-tight">{title}</h1>
            <ThemeToggle className="lg:hidden" />
          </div>
          {children}
        </main>
      </div>

      <nav className="bottomnav grid grid-cols-5 p-1 lg:hidden">
        {PHONE_NAV.map((item) => (
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
