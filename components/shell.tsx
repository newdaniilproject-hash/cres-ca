import Link from 'next/link'
import { ThemeToggle } from '@/components/theme'
import { DEFAULT_LANG } from '@/lib/i18n/dict'
import { createT, type T } from '@/lib/i18n/translate'
import { SUPPORT_EMAIL } from '@/lib/site'

// ── ЯЗЫК ВИТРИНЫ ЗАКРЕПЛЁН НА УКРАИНСКОМ. Это решение, а не недоделка ───────
//
// Витрина — единственная часть продукта, которую ИНДЕКСИРУЮТ (`app/robots.ts`
// открывает `/`, `/search`, `/map`, `/t/<slug>`, `app/sitemap.ts` зовёт бота
// именно на них). Каркас локализации выбирает язык кукой, и для кабинета это
// верно; здесь — нет, по причине, уже записанной в `lib/i18n/cookie.ts`:
// один адрес, отдающий три языка по куке, для робота означает адрес со
// случайным содержимым. `hreflang` приделать не к чему, канонический адрес
// у трёх версий один, и в выдачу попадёт тот язык, с которым робот пришёл
// первым. Витрине нужен СЕГМЕНТ адреса (`/uk/t/<slug>`), и он приезжает
// вместе с её переделкой — вместе с `robots.ts`, `sitemap.ts`, `hreflang`,
// ссылками в шапках Instagram и наклейками QR, которые уже напечатаны.
// Это отдельная работа, а не побочный эффект перевода строк.
//
// Поэтому строки уехали в словарь СЕЙЧАС, а язык остался один. Обратный
// порядок («переведём вместе с переделкой») — это ровно тот случай, из-за
// которого захардкоженная строка остаётся навсегда (CLAUDE.md → «Язык»).
//
// ЧТО ЭТО ЗНАЧИТ ДЛЯ ЧЕЛОВЕКА. Выбравший русский в кабинете видит витрину
// по-украински. Переключателя языка на публичных страницах нет и не было
// (`LangSwitch` живёт только в `components/app-shell.tsx`), то есть мы не
// показываем управление, которое ничего не делает, — расхождение видно
// только при переходе кабинет → витрина и читается как «это другой сайт»,
// чем витрина продавца и является.
//
// ЦЕНА. Ноль. `getLang()` зовёт `cookies()` и сделал бы страницу
// динамической — но `/`, `/t/<slug>` и `/map` УЖЕ динамические: они зовут
// `createClient()` (тот тоже читает куки) ради `authed` в этой шапке,
// и объявленный на них `revalidate` не действует. То есть кэш витрины,
// которого требует `docs/PERFORMANCE.md` (правило 7), потерян до нас
// и не этой правкой. Подробности — в отчёте; чинится это разделением
// шапки на кэшируемую и клиентскую часть, а не словарём.
//
// Один переводчик на модуль, а не `createT` в каждом файле: когда появится
// сегмент, менять надо будет одно место. Клиентские компоненты витрины
// (`map-view`, `booking-flow`) зовут `useT()` — публичные страницы не
// обёрнуты `LangProvider`, и контекст отдаёт им тот же `DEFAULT_LANG`.
export const publicT: T = createT(DEFAULT_LANG)

// Публичная шапка. Ссылок мало сознательно: поиск — главный вход.
//
// Здесь был второй хром — «родной», для обёртки Capacitor: он прятал
// переключатель темы и ссылки на сайт, чтобы приложение не выдавало
// в себе сайт в рамке. Переключал их атрибут `data-native`. Обёртки
// больше нет (CLAUDE.md → «Мобильная версия»), поэтому остался один
// хром — вебовый, а классы `.web-only` / `.native-only` удалены
// по правилу 8 вместе с механизмом, который их различал.
export function PublicHeader({ authed }: { authed: boolean }) {
  const t = publicT
  return (
    <header className="topbar">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        {/* Словесный знак — в словаре, а не в разметке: имя как бренд ещё
            не утверждено (CLAUDE.md → «Что НЕ решено»), и когда оно поменяется
            или получит латинское начертание для английской версии, менять
            придётся одну строку словаря, а не шапку и три юридических
            документа. Переводчик его не переводит — он его ПИШЕТ на своём
            языке, как имя пишут на своём языке. */}
        <Link href="/" className="display t-xl">
          {t('public.chrome.brand')}<span style={{ color: 'var(--color-gold)' }}>.</span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link href="/map" className="btn-ghost">{t('public.chrome.map')}</Link>
          <Link href="/search" className="btn-ghost hidden sm:inline-flex">
            {t('public.chrome.search')}
          </Link>
          <ThemeToggle className="hidden sm:inline-flex" />
          {authed ? (
            <Link href="/account" className="btn-secondary">{t('public.chrome.account')}</Link>
          ) : (
            <>
              <Link href="/login" className="btn-ghost">{t('public.chrome.signIn')}</Link>
              {/* Регистрация покупателя нужна отдельной ссылкой: без неё
                  единственный вход в неё — со страницы логина, то есть
                  на клик глубже, чем регистрация продавца. */}
              <Link href="/register" className="btn-ghost hidden sm:inline-flex">
                {t('public.chrome.signUp')}
              </Link>
              <Link href="/register/seller" className="btn-primary hidden sm:inline-flex">
                {t('public.chrome.forBusiness')}
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}

// Подвал сайта. Четыре колонки по макету 18.08.2026 плюс нижняя строка
// со знаком, кнопками входа и годом.
//
// ПОЧЕМУ ЗДЕСЬ НЕТ ПОЛОВИНЫ ССЫЛОК МАКЕТА. В макете под «Продуктом»
// стоят «Інтеграції», под «Підтримкою» — «Центр підтримки», под «Для
// бізнесу» — четыре отдельные посадочные страницы. Ни одной из них
// не существует. Ссылка в подвал на несуществующий раздел — это не
// «задел», а 404 на самом видном месте сайта (CLAUDE.md, правило 8:
// выключено — значит удалено).
//
// Поэтому колонки сохранены, а адреса ведут туда, где ответ ЕСТЬ:
// «Продукт» и «Для бізнесу» — на секции главной, «Підтримка» — на
// живой ящик из `SUPPORT_EMAIL`, «Юридичне» — на четыре настоящие
// страницы. Когда появятся посадочные, меняется адрес, а не подвал.
//
// Юридические ссылки обязаны быть видны с любой страницы: этого
// требуют и Meta при верификации бизнеса, и обе магазинные проверки.
export function PublicFooter() {
  const t = publicT
  const col = (head: string, items: [string, string][]) => (
    <div>
      <p className="footer-head mb-3">{head}</p>
      {items.map(([label, href]) => (
        <Link key={href + label} href={href} className="footer-link">{label}</Link>
      ))}
    </div>
  )

  return (
    <footer className="site-footer">
      <div className="mx-auto max-w-[1240px] px-4 py-12 sm:px-6">
        <div className="footer-grid">
          <div className="max-w-xs">
            <p className="land-brand mb-3">
              {t('public.chrome.brand')}<span aria-hidden className="land-brand-dot" />
            </p>
            <p className="t-sm prose-muted">{t('public.footer.about')}</p>
            <div className="mt-5 flex gap-2">
              {/* Профилей в соцсетях у бренда ещё нет, поэтому значков-ссылок
                  здесь тоже нет: кружок, ведущий в никуда, хуже пустого места.
                  Вместо них — карта и поиск, две страницы, которые работают. */}
              <Link href="/map" className="social" aria-label={t('public.chrome.map')}>◎</Link>
              <Link href="/search" className="social" aria-label={t('public.chrome.search')}>⌕</Link>
            </div>
          </div>

          {col(t('public.footer.product'), [
            [t('land.nav.features'), '/#features'],
            [t('land.nav.pricing'), '/#pricing'],
            [t('land.nav.how'), '/#how'],
            [t('land.nav.faq'), '/#faq'],
          ])}

          {col(t('public.footer.business'), [
            [t('public.footer.forMasters'), '/#audience'],
            [t('public.footer.forSalons'), '/#audience'],
            [t('public.footer.forShops'), '/#audience'],
            [t('public.footer.forEntrepreneurs'), '/#audience'],
          ])}

          {col(t('public.footer.support'), [
            [t('public.footer.contacts'), `mailto:${SUPPORT_EMAIL}`],
            [t('public.chrome.map'), '/map'],
          ])}

          {col(t('public.footer.legal'), [
            [t('public.footer.privacy'), '/privacy'],
            [t('public.footer.dataDelete'), '/privacy/delete'],
            [t('public.footer.terms'), '/terms'],
            [t('public.footer.cookies'), '/cookies'],
          ])}
        </div>

        <div className="divider mt-10 flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
          {/* Год подставляется строкой, а не `t.number`: разделитель разрядов
              превратил бы 2026 в «2 026». Это номер, а не количество. */}
          <p className="t-sm prose-muted">
            {t('public.footer.rights', { year: String(new Date().getFullYear()) })}
          </p>
          <div className="flex gap-2">
            <Link href="/login" className="btn-secondary t-sm">{t('public.footer.signIn')}</Link>
            <Link href="/register/seller" className="btn-primary t-sm">
              {t('public.footer.openBusiness')}
            </Link>
          </div>
        </div>
      </div>
    </footer>
  )
}

// Кабинет переехал в отдельный клиентский файл: у него появились
// шторка разделов и нижние табы раздела — состояние, которого
// серверному компоненту иметь нельзя. Ре-экспорт сохраняет все
// существующие импорты `from '@/components/shell'`.
export { AppShell, PageActions } from './app-shell'
