'use client'

import Link from 'next/link'
import { usePathname, useRouter, useSearchParams } from 'next/navigation'
import { Suspense, createContext, useContext, useEffect, useRef, useState, useTransition } from 'react'
import { ThemeToggle } from '@/components/theme'
import { TextSize } from '@/components/text-size'
import { LangSwitch } from '@/components/lang-switch'
import { NotifyBell } from '@/components/notify-bell'
import { GlobalSearch } from '@/components/global-search'
import { Sheet } from '@/components/sheet'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import type { Key } from '@/lib/i18n/dict'
import type { T } from '@/lib/i18n/translate'
import type { TenantModule } from '@/lib/tenant'
import {
  IconBack, IconBag, IconBox, IconCalendar, IconCheck, IconDoc,
  IconExit, IconGear, IconHome, IconMoney, IconScan, IconScissors,
  IconUser, IconUsers,
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
// ── Откуда берутся разделы ──────────────────────────────────────────────
//
// РАЗДЕЛЫ-МОДУЛИ приходят из РЕЕСТРА (`public.modules`, миграция 0110):
// код, подпись, значок, адрес, право и место в нижней панели лежат
// строками в базе. Массивов `TABS` и `MENU` здесь больше нет — они были
// двумя из восьми мест, которые приходилось править ради одного нового
// модуля, и правились они молча: забыл пункт — раздел просто не появился.
//
// В КОДЕ ОСТАЛИСЬ ровно те пункты, которые модулями НЕ ЯВЛЯЮТСЯ, потому
// что их нельзя купить и нельзя отключить заведению:
//
//   «Сьогодні» — сводка кабинета, есть у всех;
//   «Профіль»  — личный кабинет самого человека, права заведения его
//                не касаются;
//   «Команда» и «Налаштування» — управление самим заведением; они не
//                покупаются, а стоят на праве (`team.read`,
//                `settings.read`).
//
// Признак принадлежности к панели снизу — `in_tabs` в реестре, и панель
// берёт из него первые три плюс «Профіль»: больше четырёх на 390px
// не помещается так, чтобы подпись читалась, а зона нажатия осталась 44px.
type Item = {
  href: string
  /** Подпись: либо ключ словаря (для пунктов кода), либо готовая строка. */
  label: Key | { text: string }
  icon: (p: { size?: number }) => React.ReactElement
  module?: TenantModule
  perm?: string
  exact?: boolean
}

/** Пункты, которые не являются модулями, — они в коде и это решение. */
const FIXED_TOP: Item[] = [
  { href: '/app', label: 'app.nav.today', icon: IconHome, exact: true },
]
const FIXED_BOTTOM: Item[] = [
  { href: '/app/team', label: 'app.nav.team', icon: IconUsers, perm: 'team.read' },
  { href: '/app/settings', label: 'app.nav.settings', icon: IconGear, perm: 'settings.read' },
]
/** Профиль — в нижней панели, последним и всегда. */
const PROFILE: Item = { href: '/app/profile', label: 'app.nav.profile', icon: IconUser }

// Значок по ИМЕНИ из реестра. Реестр знает имя, сами значки живут здесь
// инлайновым SVG (не шрифт и не пакет). Имя без значка рисуется
// нейтральным: пустое место в навигации хуже неточного значка.
const ICONS: Record<string, (p: { size?: number }) => React.ReactElement> = {
  IconBox, IconCalendar, IconScissors, IconCheck, IconBag,
  IconUsers, IconMoney, IconDoc, IconGear, IconHome, IconUser,
}

/** Строка реестра, как её отдаёт `lib/modules.ts`. */
export type NavModule = {
  code: string
  title: string
  icon: string | null
  route: string | null
  perm: string | null
  inTabs: boolean
}

/**
 * Подпись пункта. Пункты кода несут КЛЮЧ словаря (опечатка останавливает
 * сборку — тип `Key` выведен из `uk.json`), пункты реестра — готовую
 * строку из `modules.title`. Название раздела продукта — справочник,
 * и переводится оно данными, как названия специальностей.
 */
const labelOf = (t: T, label: Item['label']) =>
  (typeof label === 'string' ? t(label) : label.text)

const itemOf = (m: NavModule): Item => ({
  href: m.route ?? '',
  label: { text: m.title },
  icon: ICONS[m.icon ?? ''] ?? IconGear,
  module: m.code,
  perm: m.perm ?? undefined,
})

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
  ['/app/settings/export', 'app.screen.export.title', 'app.screen.export.desc'],
]

function matches(pattern: string, pathname: string): boolean {
  const p = pattern.split('/')
  const a = pathname.split('/')
  if (p.length !== a.length) return false
  return p.every((seg, i) => seg === '*' || seg === a[i])
}

// Существует ли такой экран. Оракул — сам HEADINGS: в нём ровно двадцать
// девять страниц кабинета, потому что заголовок нужен КАЖДОЙ, и новый
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
  t: T, pathname: string, shopName: string,
  openable: (href: string) => boolean,
  /** Адреса корней разделов — из реестра плюс пункты кода. */
  roots: string[],
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
  const root = roots.includes(pathname)
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
   * Реестр модулей продукта (`public.modules`). Передаёт ТОЛЬКО макет
   * кабинета: страницы зовут AppShell внутри уже отрисованной оболочки
   * и своей навигации не строят.
   */
  registry?: NavModule[]
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
  modules, registry, perms, shopName = '', action, children,
}: {
  modules?: TenantModule[]
  registry?: NavModule[]
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
  // Разделы-модули из реестра плюс пункты кода. Порядок: «Сьогодні»,
  // затем модули по `position`, затем управление заведением.
  // Реестр, оставленный по набору заведения. Модуль без адреса
  // (`storefront`, `marketing`) своего раздела в кабинете не имеет
  // и в навигацию не попадает — это не пропуск, а свойство модуля.
  const owned = (registry ?? []).filter(
    (r) => !modules || modules.includes(r.code),
  )
  const fromRegistry = owned.map(itemOf).filter((i) => i.href !== '')
  const all: Item[] = [...FIXED_TOP, ...fromRegistry, ...FIXED_BOTTOM]

  // Нижняя панель: помеченные `in_tabs` (первые три) плюс «Профіль».
  const tabs = [
    ...fromRegistry.filter((i) => owned.find((m) => m.code === i.module)?.inTabs),
    PROFILE,
  ].filter(allowed)
  // Под аватаром — всё остальное, чего нет в панели.
  const menuItems = all.filter((i) => !tabs.some((x) => x.href === i.href)).filter(allowed)

  // Открыт ли КОРЕНЬ раздела. Адрес, которого нет в навигации, эта
  // функция не запрещает: про экраны внутри раздела список ничего
  // не знает (см. комментарий у `backOf`).
  const openable = (href: string) => {
    const item = [...all, PROFILE].find((i) => i.href === href)
    return !item || allowed(item)
  }
  const heading = headingOf(t, pathname, shopName, openable, all.map((i) => i.href))

  // Сканер — это вход в склад (`?scan=1`). Значит и фильтруется он как
  // вкладка «Склад»: модуль `inventory` у заведения И право `stock.read`
  // у человека. У `inspector` права нет (0035), и `/app/inventory`
  // разворачивал его на «Сьогодні»: человек нажимал значок и оказывался
  // на чужом экране, решив, что сканер сломан.
  const stockTab = tabs.find((i) => i.href === '/app/inventory')
  const canScan = stockTab !== undefined && allowed(stockTab)

  // Называет ли экран нижняя панель. Если да — имени в шапке не нужно:
  // подпись под значком уже сказала, где мы (решение владельца
  // 19.08.2026). Сравнение точное, а не по префиксу: «Склад» подписан
  // в панели, а «Приймання» внутри склада — нет, и оно обязано
  // назваться в шапке.
  const inNav = tabs.some((i) => i.href === pathname) || pathname === '/app'

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

  // ── Подсветка пункта. Оптимистичная, а не по факту перехода ──────────
  //
  // Отзыв владельца 18.08.2026: «переход между табами прогружается где-то
  // секунду, а должен быть мгновенным». Секунда — это серверная отрисовка
  // страницы кабинета: все они `force-dynamic` и ходят в базу в Ирландии,
  // и убрать её отсюда нельзя. Но ЖДАЛ он не её, а хоть какого-нибудь
  // ответа на нажатие: `usePathname()` меняется только КОГДА переход уже
  // совершился, поэтому всю эту секунду нажатая вкладка выглядела
  // ненажатой. Палец попал, а панель это никак не показала — читается
  // как «не сработало», и человек жмёт второй раз.
  //
  // Поэтому подсветка переезжает в момент нажатия, а `pathname` её потом
  // подтверждает. Если переход не состоялся (отказ прав, redirect),
  // намерение снимается эффектом ниже, и подсветка возвращается на место —
  // соврать надолго она не может.
  const [going, setGoing] = useState<string | null>(null)
  useEffect(() => { setGoing(null) }, [pathname])
  // Страховка от застрявшего намерения. Переход может не состояться вовсе —
  // порвалась сеть, человек ушёл из приложения на середине, — и тогда
  // `pathname` не сменится НИКОГДА, а подсветка так и останется на разделе,
  // где мы не находимся. Оптимистичная подсветка имеет право забежать
  // вперёд на время перехода, но не имеет права врать бессрочно.
  useEffect(() => {
    if (going === null) return
    const id = setTimeout(() => setGoing(null), 5000)
    return () => clearTimeout(id)
  }, [going])

  // ── Переход без сети: показать сразу, обновить тихо ───────────────────
  //
  // Требование владельца 18.08.2026: «должно сразу всё мгновенно
  // и бесшовно, молниеносно как в инсте, телеграмме». Так вот, ни инстаграм,
  // ни телеграм в момент нажатия НИКУДА НЕ ХОДЯТ: экран рисуется из того,
  // что уже лежит на устройстве, а сеть догоняет потом и правит его молча.
  // Мгновенность — это не быстрый запрос, это отсутствие запроса.
  //
  // Здесь то же самое, двумя частями:
  //
  //   1. Панель просит ПОЛНЫЙ упреждающий запрос (`prefetch` у вкладок).
  //      Четыре вкладки всегда на экране, значит их ответы приезжают,
  //      пока человек смотрит на первую. Нажатие потом не ходит в сеть
  //      вовсе — страница уже в памяти маршрутизатора.
  //   2. `staleTimes.static` (next.config.ts) держит эти ответы три минуты,
  //      иначе Next выбросил бы их почти сразу и упреждать было бы незачем.
  //
  // Чем это честно платится: показанное могло устареть. Поэтому — тихое
  // обновление. Оно не блокирует отрисовку и не показывает скелетон:
  // человек уже видит экран, данные в нём меняются сами.
  //
  // Два условия, оба обязательны:
  //   • не чаще, чем раз в 20 секунд на адрес (иначе каждый прыжок
  //     склад → записи → склад стоил бы серверу столько же, сколько
  //     стоил бы БЕЗ всего этого кеша — и смысл пропадает);
  //   • при возвращении в приложение обновляем всегда: телефон мог
  //     пролежать в кармане час, и три минуты окна давно вышли.
  const seen = useRef(new Map<string, number>())
  const [, startRefresh] = useTransition()
  useEffect(() => {
    const fresh = (force = false) => {
      // Без сети обновлять нечем. Мастер у кресла работает офлайн штатно
      // (очередь действий, М12) — тихий запрос в никуда там не нужен.
      if (typeof navigator !== 'undefined' && navigator.onLine === false) return
      const now = Date.now()
      const last = seen.current.get(pathname) ?? 0
      if (!force && now - last < 20_000) return
      seen.current.set(pathname, now)
      startRefresh(() => router.refresh())
    }
    // После отрисовки, а не вместо неё: экран обязан появиться первым.
    const id = setTimeout(() => fresh(), 300)
    const onShow = () => { if (document.visibilityState === 'visible') fresh(true) }
    document.addEventListener('visibilitychange', onShow)
    return () => { clearTimeout(id); document.removeEventListener('visibilitychange', onShow) }
  }, [pathname, router])

  const active = (i: Item) => {
    if (going !== null) return i.exact ? going === i.href : going.startsWith(i.href)
    return i.exact ? pathname === i.href : pathname.startsWith(i.href)
  }

  async function signOut() {
    // scope: 'local' — по умолчанию supabase-js гасит сессии ГЛОБАЛЬНО,
    // и «Вийти» на ноутбуке разлогинивал телефон. Выход со всех
    // устройств — отдельное действие в профиле, с подтверждением.
    await createClient().auth.signOut({ scope: 'local' })
    window.location.href = '/'
  }

  return (
    // Запас снизу — ровно под плавающую панель и не больше. Было `pb-32`
    // (128px) у оболочки И ещё `pb-12` (48px) у `main`: 176 пикселей
    // пустоты под последней карточкой при панели высотой около семидесяти.
    // Владелец назвал это 19.08.2026 («пустые пространства сверху и снизу
    // на экранах убери»), и он прав — два запаса складывались, потому что
    // ставились в разное время и в разных файлах.
    <div className="appshell min-h-dvh pb-24 lg:pb-6">
      <div className="mx-auto flex max-w-6xl gap-8 px-4 sm:px-6">

        {/* ── Десктоп: постоянный сайдбар ─────────────────────── */}
        <aside className="hidden w-52 shrink-0 lg:block">
          <Link href="/app" className="display mb-8 block t-xl">
            CRES<span style={{ color: 'var(--color-accent)' }}>KO</span>
          </Link>
          <nav className="flex flex-col gap-1">
            {[...menuItems.slice(0, 1), ...tabs, ...menuItems.slice(1)].map((s) => (
              <Link key={s.href + s.label} href={s.href} className="sidebar-item"
                    // Тот же полный запрос — но только у четырёх разделов
                    // панели, не у всего сайдбара (см. нижнюю панель).
                    prefetch={tabs.some((x) => x.href === s.href) ? true : undefined}
                    onClick={() => setGoing(s.href)}
                    data-active={active(s)}>
                <span aria-hidden className="flex w-5 justify-center">
                  <s.icon size={18} />
                </span>
                {labelOf(t, s.label)}
              </Link>
            ))}
          </nav>
          {/* Тема и язык — две настройки одного рода, поэтому стоят рядом
              и здесь, и в шторке под аватаром. Разносить их по разным
              местам значит заставить искать вторую там, где нашлась первая. */}
          <div className="mt-8 flex flex-col gap-1 border-t pt-4"
               style={{ borderColor: 'var(--color-border)' }}>
            <div className="setting-row">
              <span className="setting-label">{t('theme.aria')}</span>
              <ThemeToggle />
            </div>
            <div className="setting-row">
              <span className="setting-label">{t('app.lang.aria')}</span>
              <LangSwitch />
            </div>
          </div>
        </aside>

        <main className="min-w-0 flex-1">

          {/* ── Верхняя строка: назад, имя экрана, четыре значка ──
              ЗАГОЛОВОК ЭКРАНА ЖИВЁТ ЗДЕСЬ, а не блоком под шапкой
              (решение владельца 19.08.2026: «название и описание экранов
              вверху убери, достаточно что они подписаны в нижнем наве»).

              Блок «крупное имя + описание» занимал сверху каждого экрана
              около ста пикселей и повторял то, что и так подписано
              в нижней панели: человек нажал «Склад» и видит «Склад»
              вторым кеглем плюс строку о том, что это склад. На телефоне
              это первый экран целиком — до содержимого приходилось
              долистывать.

              Что осталось и почему именно так: у ЧЕТЫРЁХ разделов панели
              имени в шапке нет вовсе — панель их называет. У остальных
              (Замовлення, Клієнти, карточки) имя стоит строкой в шапке
              рядом со стрелкой «назад»: их панель НЕ называет, и без
              подписи экран остался бы безымянным — это уже не «лишнее»,
              а потерянное. Описание снято везде.

              ⚠️ Календаря в шапке больше нет: он вёл в «Записи», то есть
              был вторым входом в раздел, который и так лежит в нижней
              панели. На его место встал поиск. */}
          <div className="apphead flex items-center gap-2">
            {heading.back && (
              <Link href={heading.back} aria-label={t('app.chrome.back.aria')}
                    className="apphead-back flex shrink-0 items-center justify-center">
                <IconBack />
              </Link>
            )}

            {/* ── ПОИСК СТРОКОЙ, А НЕ ЗНАЧКОМ ──────────────────────
                Поправка того же дня по отзыву владельца: «поисковая
                строка в хедере пропала». Значок с лупой формально
                открывал тот же поиск, но искать глазами нечего было:
                строка — это ещё и приглашение, а значок молчит.

                Строка занимает всю свободную ширину и вытесняет имя
                экрана: одновременно они на 390px не помещаются, а поиск
                нужен постоянно, тогда как имя экрана подсказывает лишь
                «где я» — и то у экранов, которых не называет панель.
                Поэтому имя показывается только там, где строки нет:
                на внутренних экранах со стрелкой «назад».

                Само поле — не `input`, а КНОПКА в его виде. Печатать
                в шапке, у которой `backdrop-filter` и своя высота,
                значит поднять клавиатуру поверх содержимого и потерять
                выдачу под ней; шторка для этого и существует — она
                держит поле, список и клавиатуру в одном слое. Так же
                устроены телеграм и почта на телефоне. */}
            {heading.back && heading.title && !inNav ? (
              <div className="min-w-0 flex-1">
                <h1 className="apphead-title display truncate">{heading.title}</h1>
              </div>
            ) : null}

            <GlobalSearch modules={modules} perms={perms}
                          compact={Boolean(heading.back && heading.title && !inNav)} />

            <NotifyBell tenantPerms={perms ?? []} />

            {canScan && (
              <Link href="/app/inventory?scan=1" aria-label={t('app.chrome.scan.aria')}
                    className="iconbtn shrink-0">
                <IconScan />
              </Link>
            )}

            <button type="button" onClick={() => setMenu(true)}
                    aria-label={t('app.chrome.avatar.aria')} className="avatarbtn shrink-0">
              {initial || <IconUser size={18} />}
            </button>
          </div>

          {/* Кнопка экрана (`action`) осталась — она часть страницы,
              а не подписи. Без заголовка над ней ей нужна своя строка
              только тогда, когда она есть. */}
          {action && <div className="mb-3 flex justify-end">{action}</div>}

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
                  // ПОЛНЫЙ упреждающий запрос, а не умолчание. По умолчанию
                  // Next для динамического адреса тянет только до ближайшего
                  // `loading.tsx` — то есть заранее приезжает скелетон,
                  // а данные всё равно едут в момент нажатия. Здесь нужен
                  // именно ответ целиком: тогда нажатие не ходит в сеть.
                  // Просят его только ЧЕТЫРЕ вкладки панели — они всегда
                  // на экране и между ними прыгают всю смену. Ставить то же
                  // самое на девять пунктов под аватаром значит греть
                  // на открытии девять страниц, которые открывают раз в день.
                  prefetch
                  onClick={() => setGoing(tab.href)}
                  data-active={active(tab)}>
              {/* 26px — размер из README; было 22. */}
              <span aria-hidden><tab.icon size={26} /></span>
              {labelOf(t, tab.label)}
            </Link>
          ))}
        </nav>
      )}

      {/* ── Под аватаром: остальные разделы, тема, выход ─────── */}
      <Sheet open={menu} onClose={() => setMenu(false)} title={t('app.chrome.menu.title')}>
        <div className="flex flex-col gap-1">
          {menuItems.map((s) => (
            <Link key={s.href + s.label} href={s.href} className="drawer-item"
                  onClick={() => setGoing(s.href)}
                  data-active={active(s)}>
              <span aria-hidden className="flex w-6 justify-center">
                <s.icon size={20} />
              </span>
              {labelOf(t, s.label)}
            </Link>
          ))}
        </div>
        <div className="mt-4 border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
          {/* Тема, язык и размер текста — здесь же, под аватаром: решение
              владельца 15.08.2026 отправило сюда всё, что не разделы.

              Три настройки одного рода («как мне это видно») стоят ОДНИМ
              списком строк «подпись — управление», а не вперемешку
              пилюлями и ползунком: разные раскладки у соседних настроек
              читаются как разные разделы. Вид переключателей минимальный
              по решению владельца 19.08.2026 — разбор в globals.css,
              блок `.seg`. */}
          <div className="flex flex-col gap-1">
            <div className="setting-row">
              <span className="setting-label">{t('theme.aria')}</span>
              <ThemeToggle />
            </div>
            <div className="setting-row">
              <span className="setting-label">{t('app.lang.aria')}</span>
              <LangSwitch />
            </div>
          </div>
          {/* Ползунком, а не тремя кнопками: шаг в 5% кнопками не выберешь. */}
          <div className="mt-1 border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
            <TextSize />
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
