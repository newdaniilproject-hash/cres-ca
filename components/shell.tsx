import Link from 'next/link'
import { ThemeToggle } from '@/components/theme'
import type { TenantModule } from '@/lib/tenant'

// Публичная шапка. Ссылок мало сознательно: поиск — главный вход.
export function PublicHeader({ authed }: { authed: boolean }) {
  return (
    <header className="topbar">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="display t-xl">
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
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-10 t-sm sm:flex-row sm:items-center sm:justify-between sm:px-6 prose-muted">
        <p>© {new Date().getFullYear()} · Платформа для українських підприємців</p>
        {/* Ссылки на политику и удаление данных обязаны быть видны с любой
            страницы: этого требуют и Meta при верификации бизнеса, и обе
            магазинные проверки. Прятать их в подвале второго уровня —
            повод для отказа. */}
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/register/seller" className="hover:underline">Відкрити бізнес</Link>
          <Link href="/login" className="hover:underline">Вхід</Link>
          <Link href="/privacy" className="hover:underline">Конфіденційність</Link>
          <Link href="/privacy/delete" className="hover:underline">Видалення даних</Link>
        </div>
      </div>
    </footer>
  )
}

// Полный список — сайдбар на десктопе. На телефоне помещается пять пунктов,
// поэтому там показываются только отмеченные phone: мастер за работой
// открывает склад, записи и журналы, а каталог и финансы правит за столом.
// module: раздел показывается, только если арендатор его купил.
// Пункты без module видны всем — это «Сьогодні» и настройки, без них
// кабинета не существует. Первому клиенту включён только склад
// и журналы, и он увидит ровно четыре пункта из одиннадцати.
const APP_NAV: {
  href: string; label: string; icon: string
  phone: boolean; module?: TenantModule
}[] = [
  { href: '/app',            label: 'Сьогодні',   icon: '◐', phone: true },
  { href: '/app/inventory',  label: 'Склад',      icon: '▦', phone: true,  module: 'inventory' },
  { href: '/app/catalog',    label: 'Каталог',    icon: '◫', phone: false, module: 'catalog' },
  { href: '/app/bookings',   label: 'Записи',     icon: '◷', phone: true,  module: 'bookings' },
  { href: '/app/orders',     label: 'Замовлення', icon: '⬒', phone: false, module: 'orders' },
  { href: '/app/journals',   label: 'Журнали',    icon: '✓', phone: true,  module: 'compliance' },
  { href: '/app/documents',  label: 'Документи',  icon: '⎘', phone: false, module: 'compliance' },
  { href: '/app/techcards',  label: 'Техкарти',   icon: '❑', phone: false, module: 'compliance' },
  { href: '/app/customers',  label: 'Клієнти',    icon: '◎', phone: false, module: 'customers' },
  { href: '/app/finance',    label: 'Фінанси',    icon: '₴', phone: false, module: 'finance' },
  { href: '/app/settings',   label: 'Магазин',    icon: '⚙', phone: true },
]

// Кабинет продавца: сайдбар на десктопе, нижняя навигация на телефоне.
// Мастер работает с телефона стоя — нижняя навигация первична.
export function AppShell({
  active,
  title,
  modules,
  children,
}: {
  active: string
  title: string
  /** Модули арендатора. Не передан — показываем всё: так ведут себя
      экраны, которые ещё не научились их прокидывать. */
  modules?: TenantModule[]
  children: React.ReactNode
}) {
  const nav = APP_NAV.filter((i) => !i.module || !modules || modules.includes(i.module))
  const phoneNav = nav.filter((i) => i.phone)
  return (
    // Отступ снизу 128px, а не высота панели: плавающая навигация
    // висит над контентом, и без запаса последняя карточка уезжает
    // под неё вместе с индикатором жестов.
    <div className="min-h-dvh pb-32 lg:pb-0">
      <div className="mx-auto flex max-w-6xl gap-8 px-4 pt-6 sm:px-6">
        <aside className="hidden w-52 shrink-0 lg:block">
          <Link href="/" className="display mb-8 block t-xl">
            Маркет<span style={{ color: 'var(--color-gold)' }}>.</span>
          </Link>
          <nav className="flex flex-col gap-1">
            {nav.map((item) => (
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
            <h1 className="display rise t-2xl">{title}</h1>
            <ThemeToggle className="lg:hidden" />
          </div>
          {children}
        </main>
      </div>

      <nav className="bottomnav flex justify-around gap-1 p-1 lg:hidden">
        {phoneNav.map((item) => (
          <Link key={item.href} href={item.href} className="bottomnav-item flex-1"
                data-active={active === item.href}>
            <span aria-hidden className="t-lg leading-none">{item.icon}</span>
            {item.label}
          </Link>
        ))}
      </nav>
    </div>
  )
}
