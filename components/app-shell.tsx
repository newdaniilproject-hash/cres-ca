'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, createContext, useContext, useEffect, useState } from 'react'
import { ThemeToggle } from '@/components/theme'
import { LangSwitch } from '@/components/lang-switch'
import { Sheet } from '@/components/sheet'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import type { Key } from '@/lib/i18n/dict'
import type { T } from '@/lib/i18n/translate'
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

// Пункт меню фильтруется по ДВУМ независимым осям (CLAUDE.md → «Доступ:
// роли и модули — две разные оси»):
//
//   module — что заведение купило. Нет модуля — раздела нет ни у кого,
//            включая владельца с полными правами.
//   perm   — что можно ЭТОМУ человеку. Право берётся из `role_grants`
//            (миграции 0001, 0014, 0015, 0035, 0039) и приезжает в токене.
//
// Пока фильтра по праву не было, `operator`, `accountant` и `viewer`
// видели в меню «Команда», «Фінанси» и «Магазин», нажимали — и страница
// молча возвращала их на `/app` своим `redirect`. Пункт, который нельзя
// открыть, — это не «защищено», это сломанная навигация: человек считает,
// что у него что-то не работает, а не что ему туда нельзя.
//
// Граница доверия при этом по-прежнему RLS и редиректы страниц, а не
// этот список: скрытый пункт не запрещает прямой адрес и не должен.
//
// Подпись пункта — КЛЮЧ СЛОВАРЯ, а не строка. Тип `Key` выведен из
// `lib/i18n/locales/uk.json`, поэтому опечатка в ключе останавливает сборку,
// а не появляется пустым пунктом в панели.
type Item = {
  href: string
  label: Key
  icon: (p: { size?: number }) => React.ReactElement
  module?: TenantModule
  /** Право из `role_grants`. Нет права — пункта нет в меню. */
  perm?: string
  /** exact: пункт активен только при точном совпадении пути. */
  exact?: boolean
}

// ── Нижняя панель: четыре пункта ────────────────────────────────
// Больше четырёх сюда не поместится так, чтобы подпись читалась
// на 390px и зона нажатия осталась 44px.
const TABS: Item[] = [
  // Записи закрыты `orders.read`, а не своим правом: отдельного
  // `bookings.*` в базе нет — политики `bookings_read`, `slots_read`
  // и `booking_events_read` в 0010 стоят на `orders.read`.
  { href: '/app/inventory', label: 'app.nav.inventory', icon: IconBox, module: 'inventory', perm: 'stock.read' },
  { href: '/app/bookings', label: 'app.nav.bookings', icon: IconCalendar, module: 'bookings', perm: 'orders.read' },
  { href: '/app/catalog', label: 'app.nav.catalog', icon: IconScissors, module: 'catalog', perm: 'catalog.read' },
  // Профиль — личный кабинет самого человека, права заведения его не
  // касаются: он есть у любого, кто вошёл.
  { href: '/app/profile', label: 'app.nav.profile', icon: IconUser },
]

// ── Под аватаром: всё остальное ─────────────────────────────────
const MENU: Item[] = [
  { href: '/app', label: 'app.nav.today', icon: IconHome, exact: true },
  { href: '/app/journals', label: 'app.nav.journals', icon: IconCheck, module: 'compliance', perm: 'compliance.read' },
  { href: '/app/documents', label: 'app.nav.documents', icon: IconDoc, module: 'compliance', perm: 'compliance.read' },
  { href: '/app/techcards', label: 'app.nav.techcards', icon: IconDoc, module: 'compliance', perm: 'compliance.read' },
  { href: '/app/orders', label: 'app.nav.orders', icon: IconBag, module: 'orders', perm: 'orders.read' },
  { href: '/app/customers', label: 'app.nav.customers', icon: IconUsers, module: 'customers', perm: 'customers.read' },
  { href: '/app/finance', label: 'app.nav.finance', icon: IconMoney, module: 'finance', perm: 'finances.read' },
  { href: '/app/team', label: 'app.nav.team', icon: IconUsers, perm: 'team.read' },
  { href: '/app/settings', label: 'app.nav.settings', icon: IconGear, perm: 'settings.read' },
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
//
// В таблице лежат КЛЮЧИ, а не подписи: заголовок экрана — такая же строка
// интерфейса, как кнопка, и жить в двух языках она обязана так же. Тип
// `[string, Key, Key]` не даст завести экран с ключом, которого нет
// в словаре: адрес — обычная строка, обе подписи — ключи.
const HEADINGS: [string, Key, Key][] = [
  ['/app/inventory', 'app.screen.inventory.title', 'app.screen.inventory.desc'],
  ['/app/inventory/receipts', 'app.screen.inventory.receipts.title', 'app.screen.inventory.receipts.desc'],
  ['/app/inventory/receipts/*', 'app.screen.inventory.receipt.title', 'app.screen.inventory.receipt.desc'],
  ['/app/inventory/movements', 'app.screen.inventory.movements.title', 'app.screen.inventory.movements.desc'],
  ['/app/inventory/counts', 'app.screen.inventory.counts.title', 'app.screen.inventory.counts.desc'],
  ['/app/inventory/counts/*', 'app.screen.inventory.count.title', 'app.screen.inventory.count.desc'],
  ['/app/inventory/recipes', 'app.screen.inventory.recipes.title', 'app.screen.inventory.recipes.desc'],
  ['/app/inventory/barcodes', 'app.screen.inventory.barcodes.title', 'app.screen.inventory.barcodes.desc'],
  ['/app/inventory/reorder', 'app.screen.inventory.reorder.title', 'app.screen.inventory.reorder.desc'],
  ['/app/inventory/materials/*', 'app.screen.inventory.material.title', 'app.screen.inventory.material.desc'],
  ['/app/inventory/materials/*/docs', 'app.screen.inventory.materialDocs.title', 'app.screen.inventory.materialDocs.desc'],
  ['/app/inventory/materials/*/pao', 'app.screen.inventory.materialPao.title', 'app.screen.inventory.materialPao.desc'],
  ['/app/bookings', 'app.screen.bookings.title', 'app.screen.bookings.desc'],
  // Мастера живут ВНУТРИ раздела записей, а не отдельным пунктом панели:
  // снизу лежит только то, между чем прыгают за смену. Отсюда и адрес.
  ['/app/bookings/staff', 'app.screen.staff.title', 'app.screen.staff.desc'],
  ['/app/bookings/staff/*', 'app.screen.staffCard.title', 'app.screen.staffCard.desc'],
  ['/app/catalog', 'app.screen.catalog.title', 'app.screen.catalog.desc'],
  ['/app/catalog/new', 'app.screen.catalog.new.title', 'app.screen.catalog.new.desc'],
  ['/app/catalog/*', 'app.screen.catalog.item.title', 'app.screen.catalog.item.desc'],
  ['/app/journals', 'app.screen.journals.title', 'app.screen.journals.desc'],
  ['/app/journals/report', 'app.screen.journals.report.title', 'app.screen.journals.report.desc'],
  ['/app/documents', 'app.screen.documents.title', 'app.screen.documents.desc'],
  ['/app/techcards', 'app.screen.techcards.title', 'app.screen.techcards.desc'],
  ['/app/orders', 'app.screen.orders.title', 'app.screen.orders.desc'],
  ['/app/orders/*', 'app.screen.orders.item.title', 'app.screen.orders.item.desc'],
  ['/app/customers', 'app.screen.customers.title', 'app.screen.customers.desc'],
  ['/app/finance', 'app.screen.finance.title', 'app.screen.finance.desc'],
  ['/app/profile', 'app.screen.profile.title', 'app.screen.profile.desc'],
  ['/app/team', 'app.screen.team.title', 'app.screen.team.desc'],
  ['/app/settings', 'app.screen.settings.title', 'app.screen.settings.desc'],
]

function matches(pattern: string, pathname: string): boolean {
  const p = pattern.split('/')
  const a = pathname.split('/')
  if (p.length !== a.length) return false
  return p.every((seg, i) => seg === '*' || seg === a[i])
}

// Существует ли такой экран. Оракул — сам HEADINGS: в нём ровно двадцать
// восемь страниц кабинета, потому что заголовок нужен КАЖДОЙ, и новый
// экран без строки здесь приезжает без названия — это замечают сразу.
// Отдельного списка «а вот этих адресов нет» не заводим: он устареет на
// первом же экране, который добавят, а этот список — нет.
const screenExists = (path: string) =>
  path === '/app'
  || HEADINGS.some(([p]) => p === path || (p.includes('*') && matches(p, path)))

// Адрес «назад».
//
// Было: отбрасывание последнего сегмента. Для `/app/inventory/materials/[id]`
// это давало `/app/inventory/materials` — сегмент маршрута, у которого нет
// своей страницы, то есть 404 на кнопке «назад» у всех ролей сразу.
//
// Стало: ближайший предок, который И существует, И открыт этому человеку.
// Второе условие — тот же дефект, что у поиска: у `inspector` карточка
// засоба открыта (`compliance.read`), а `/app/inventory` закрыт
// (`stock.read`, миграция 0035), и стрелка «назад» молча уносила его
// на «Сьогодні».
//
// `openable` знает только корни разделов — те, что перечислены в TABS
// и MENU со своим правом. Про экраны глубже она не судит и судить не
// должна: их правила живут в самих страницах (у карточки засоба это
// `compliance.read OR stock.read`), и повторять их здесь значит завести
// вторую копию политики, которая разъедется с первой.
function backOf(pathname: string, openable: (href: string) => boolean): string {
  const segs = pathname.split('/')
  // i > 2 — не поднимаемся выше `/app`: он и так конечная остановка.
  for (let i = segs.length - 1; i > 2; i -= 1) {
    const parent = segs.slice(0, i).join('/')
    if (screenExists(parent) && openable(parent)) return parent
  }
  // «Сьогодні» открыт любому, кто вошёл: у пункта нет ни модуля, ни права.
  return '/app'
}

/** Заголовок, подпись и адрес «назад» — из адреса, а не из страницы. */
function headingOf(
  t: T, pathname: string, shopName: string, openable: (href: string) => boolean,
) {
  if (pathname === '/app') {
    // Имя заведения не переводится: это данные арендатора, а не строка
    // интерфейса. Запасное «Кабінет» — строка, и оно из словаря.
    return {
      title: shopName || t('app.screen.today.title'),
      subtitle: t('app.screen.today.desc'),
      back: '',
    }
  }
  // Сначала точное совпадение, потом шаблоны: «/app/catalog/new» обязан
  // выиграть у «/app/catalog/*», иначе новая позиция назовётся карточкой.
  const hit = HEADINGS.find(([p]) => p === pathname)
    ?? HEADINGS.find(([p]) => p.includes('*') && matches(p, pathname))
  const root = [...TABS, ...MENU].some((i) => i.href === pathname)
  const back = root ? '' : backOf(pathname, openable)
  return {
    title: hit ? t(hit[1]) : '',
    subtitle: hit ? t(hit[2]) : '',
    back,
  }
}

// Отрисована ли оболочка выше по дереву. Внутри неё AppShell прозрачен.
const InsideShell = createContext(false)

// Пропов `active`, `title`, `subtitle` и `back` здесь больше нет
// (16.08.2026). Их передавали двадцать шесть страниц, а читать перестали
// в тот день, когда заголовок начал собираться из адреса по `HEADINGS`,
// а активный пункт — сравнением с `usePathname()`. Молча проглоченный
// проп хуже отсутствующего: страница передавала «Записи», оболочка
// рисовала своё, и расхождение нашлось бы только глазами. Заодно это
// были последние украинские строки в тех файлах — заголовок теперь
// один и из словаря.
export function AppShell(props: {
  modules?: TenantModule[]
  /**
   * Готовый набор прав из токена (`Membership.perms`). Владельцу приходит
   * `['*']`. Не передан — фильтра по праву нет, как и с модулями: так
   * вложенные вызовы AppShell не режут меню, которое собрал layout.
   */
  perms?: string[]
  /** Имя заведения — заголовок экрана «Сьогодні». */
  shopName?: string
  /** Кнопка справа в шапке. Читается и рисуется — см. `AppShellInner`. */
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
  modules, perms, shopName = '', action, children,
}: {
  modules?: TenantModule[]
  perms?: string[]
  shopName?: string
  action?: React.ReactNode
  children: React.ReactNode
}) {
  const t = useT()
  const pathname = usePathname()
  const params = useSearchParams()
  const router = useRouter()
  const [menu, setMenu] = useState(false)
  const [query, setQuery] = useState('')
  const [initial, setInitial] = useState('')

  // Пункт показывается, только если совпало И то, и другое: заведение
  // купило модуль И человеку разрешено право. Правило `'*'` повторяет
  // `can()` из lib/tenant.ts, а не зовёт её: тот файл тянет серверный
  // клиент Supabase первой строкой и в клиентский бандл не годится
  // (сюда из него приходит только тип, а он стирается при сборке).
  const hasModule = (i: Item) => !i.module || !modules || modules.includes(i.module)
  const can = (i: Item) =>
    !i.perm || !perms || perms.includes('*') || perms.includes(i.perm)
  const allowed = (i: Item) => hasModule(i) && can(i)
  const tabs = TABS.filter(allowed)
  const menuItems = MENU.filter(allowed)

  // Открыт ли КОРЕНЬ раздела. Адрес, которого нет в навигации, эта
  // функция не запрещает: про экраны внутри раздела список ничего
  // не знает (см. комментарий у `backOf`).
  const openable = (href: string) => {
    const item = [...TABS, ...MENU].find((i) => i.href === href)
    return !item || allowed(item)
  }
  const heading = headingOf(t, pathname, shopName, openable)

  // Поиск и сканер — это два входа в склад (`?q=` и `?scan=1`, решение
  // владельца 15.08.2026). Значит и фильтруются они как вкладка «Склад»:
  // модуль `inventory` у заведения И право `stock.read` у человека.
  // У `inspector` права нет (0035), и `/app/inventory` разворачивал его
  // на «Сьогодні»: человек набирал запрос, жал «найти» и оказывался
  // на чужом экране, решив, что поиск сломан.
  const stockTab = TABS.find((i) => i.href === '/app/inventory')
  const canSearch = stockTab !== undefined && allowed(stockTab)

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
                {t(s.label)}
              </Link>
            ))}
          </nav>
          {/* Тема и язык — две настройки одного рода, поэтому стоят рядом
              и здесь, и в шторке под аватаром. Разносить их по разным
              местам значит заставить искать вторую там, где нашлась первая. */}
          <div className="mt-8 flex flex-col items-start gap-2 border-t pt-4"
               style={{ borderColor: 'var(--color-border)' }}>
            <ThemeToggle />
            <LangSwitch />
          </div>
        </aside>

        <main className="min-w-0 flex-1 pb-12">

          {/* ── Верхняя строка: назад, поиск, сканер, аватар ──── */}
          <div className="apphead mb-4 flex items-center gap-2">
            {heading.back && (
              <Link href={heading.back} aria-label={t('app.chrome.back.aria')}
                    className="apphead-back flex shrink-0 items-center justify-center">
                <IconBack />
              </Link>
            )}

            {canSearch ? (
              <>
                <form onSubmit={search} className="min-w-0 flex-1">
                  <label className="searchbar flex items-center gap-2">
                    <span aria-hidden style={{ color: 'var(--color-faint)' }}><IconSearch /></span>
                    <input
                      className="searchbar-input min-w-0 flex-1"
                      placeholder={t('app.chrome.search.placeholder')}
                      value={query}
                      onChange={(e) => setQuery(e.target.value)}
                      aria-label={t('app.chrome.search.aria')}
                    />
                  </label>
                </form>

                <Link href="/app/inventory?scan=1" aria-label={t('app.chrome.scan.aria')}
                      className="iconbtn shrink-0">
                  <IconScan />
                </Link>
              </>
            ) : (
              // Распорка вместо строки поиска: аватар обязан остаться
              // справа, иначе он приезжает к стрелке «назад».
              <div className="min-w-0 flex-1" />
            )}

            <button type="button" onClick={() => setMenu(true)}
                    aria-label={t('app.chrome.avatar.aria')} className="avatarbtn shrink-0">
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
      {/* Порог был `> 1` — пока фильтр знал только модули, панель с одним
          пунктом означала пустое заведение. С фильтром по правам один
          пункт стал нормой: у `inspector` есть только `compliance.read`,
          и из табов ему остаётся «Профіль». При старом пороге панель
          пропадала целиком, а «Профіль» лежит в TABS, не в MENU, — то
          есть с телефона он становился недостижим вовсе. */}
      {tabs.length > 0 && (
        <nav className="bottomnav flex justify-around gap-1 p-1 lg:hidden">
          {/* Параметр назван `tab`, а не `t`: `t` — это переводчик,
              и тень над ним ломала бы подписи прямо здесь. */}
          {tabs.map((tab) => (
            <Link key={tab.href} href={tab.href} className="bottomnav-item flex-1"
                  data-active={active(tab)}>
              <span aria-hidden><tab.icon size={22} /></span>
              {t(tab.label)}
            </Link>
          ))}
        </nav>
      )}

      {/* ── Под аватаром: остальные разделы, тема, выход ─────── */}
      <Sheet open={menu} onClose={() => setMenu(false)} title={t('app.chrome.menu.title')}>
        <div className="flex flex-col gap-1">
          {menuItems.map((s) => (
            <Link key={s.href + s.label} href={s.href} className="drawer-item"
                  data-active={active(s)}>
              <span aria-hidden className="flex w-6 justify-center">
                <s.icon size={20} />
              </span>
              {t(s.label)}
            </Link>
          ))}
        </div>
        <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
          {/* Тема и язык — здесь же, под аватаром: решение владельца
              15.08.2026 отправило сюда всё, что не разделы. */}
          <div className="flex flex-wrap items-center gap-2">
            <ThemeToggle />
            <LangSwitch />
          </div>
          <button type="button" onClick={() => void signOut()}
                  className="drawer-item mt-1 w-full text-left"
                  style={{ color: 'var(--color-muted)' }}>
            <span aria-hidden className="flex w-6 justify-center"><IconExit /></span>
            {t('app.chrome.signOut')}
          </button>
        </div>
      </Sheet>
    </div>
  )
}
