import Link from 'next/link'
import type { Key } from '@/lib/i18n/dict'
import { createClient } from '@/lib/supabase/server'
import { PublicFooter, publicT as t } from '@/components/shell'
import { SUPPORT_EMAIL } from '@/lib/site'
import {
  IconArrowRight, IconBag, IconBolt, IconBox, IconBriefcase, IconCalendar,
  IconCheck, IconDoc, IconGear, IconGrid, IconHome, IconMoney, IconPlay,
  IconScissors, IconShield, IconSupport, IconUser, IconUsers,
} from '@/components/icons'

export const dynamic = 'force-dynamic'

// Заголовок главной задаётся absolute: шаблон «%s — Маркетплейс» из layout
// на первой странице дал бы удвоение названия.
//
// Метаданные тоже из словаря, и это безопасно: `publicT` — чистая функция
// без `cookies()`, объект собирается один раз при сборке. Язык витрины
// закреплён украинским (обоснование — `components/shell.tsx`), поэтому
// в выдаче ничего не меняется, а строки перестают быть захардкоженными.
export const metadata = {
  title: { absolute: t('land.meta.title') },
  description: t('land.meta.desc'),
}

// ── ГЛАВНАЯ. Переписана 18.08.2026 по макету, переданному владельцем ────────
//
// ЧТО ИМЕННО ПОМЕНЯЛОСЬ И ПОЧЕМУ ЭТО НЕ КОСМЕТИКА.
//
// Прежняя главная продавала МАРКЕТПЛЕЙС: первым экраном шёл поиск заведений
// и настоящий список арендаторов из базы. Это честно описывало то, чем
// продукт станет на 9–12 месяце, и не описывало того, что продаётся сейчас.
// Стратегия развернулась 01.08.2026 (CLAUDE.md → «Куда идёт продукт»):
// входим НЕ маркетплейсом, а инструментом для продавца. Витрина как общий
// каталог включается позже, когда в категории наберётся плотность.
//
// Отсюда и раскладка макета: первый экран — снимок кабинета, дальше «одна
// подписка вместо четырёх сервисов», «для кого», «раніше / з CRESKO», три
// шага, цена, вопросы. Поиска по заведениям здесь больше нет — он остался
// страницами `/search` и `/map`, ссылки на них живут в подвале. Показывать
// пустой каталог на первом экране значит продавать плотность, которой пока
// нет, и это первое, что видит человек.
//
// ЧЕГО ЗДЕСЬ НЕТ ИЗ МАКЕТА, И ЭТО НЕ ЗАБЫТО. В макете есть ссылка «Ціни»
// на отдельную страницу тарифов, «Інтеграції», «Центр підтримки» и кнопка
// «Подивитися, як це працює» с видео. Ни тарифов, ни страницы поддержки,
// ни ролика не существует. Поэтому пункты навигации ведут на СЕКЦИИ этой
// же страницы (они есть и работают), поддержка — на живой ящик, а «як це
// працює» прокручивает к трём шагам. Кнопка, ведущая на 404, — это не
// «задел на будущее», а сломанная навигация в самом видном месте сайта
// (CLAUDE.md, правило 8).
//
// ЦЕНА НЕ НАЗВАНА ЧИСЛОМ, и это тоже из макета: блок говорит «фіксована
// підписка, одна сума на місяць». Биллинга нет (CLAUDE.md → «Что НЕ
// решено»), и поставить сюда цифру значит пообещать тариф, которого нельзя
// оплатить. Когда появятся `plans`, сюда придёт число, а не новый блок.

// Пункты верхней навигации — якоря секций этой же страницы.
const NAV: { label: Key; href: string }[] = [
  { label: 'land.nav.features', href: '#features' },
  { label: 'land.nav.audience', href: '#audience' },
  { label: 'land.nav.how', href: '#how' },
  { label: 'land.nav.pricing', href: '#pricing' },
  { label: 'land.nav.faq', href: '#faq' },
]

// Полоса из четырёх обещаний под первым экраном.
const STRIP: { icon: (p: { size?: number }) => React.ReactElement; title: Key; text: Key }[] = [
  { icon: IconGrid, title: 'land.strip.one.title', text: 'land.strip.one.text' },
  { icon: IconBolt, title: 'land.strip.routine.title', text: 'land.strip.routine.text' },
  { icon: IconShield, title: 'land.strip.control.title', text: 'land.strip.control.text' },
  { icon: IconSupport, title: 'land.strip.support.title', text: 'land.strip.support.text' },
]

// Сервисы, которые сегодня оплачиваются порознь. Порядок из макета:
// сверху то, за что платят чаще всего.
const MERGE: { icon: (p: { size?: number }) => React.ReactElement; label: Key }[] = [
  { icon: IconGrid, label: 'land.merge.item.storefront' },
  { icon: IconBag, label: 'land.merge.item.orders' },
  { icon: IconBox, label: 'land.merge.item.stock' },
  { icon: IconUsers, label: 'land.merge.item.customers' },
  { icon: IconMoney, label: 'land.merge.item.finance' },
  { icon: IconDoc, label: 'land.merge.item.docs' },
]

// Шесть возможностей. Нумерация — часть оформления карточки, поэтому
// живёт здесь, а не в словаре: «01» одинаково во всех языках.
const FEATURES: { title: Key; text: Key }[] = [
  { title: 'land.features.storefront.title', text: 'land.features.storefront.text' },
  { title: 'land.features.stock.title', text: 'land.features.stock.text' },
  { title: 'land.features.orders.title', text: 'land.features.orders.text' },
  { title: 'land.features.customers.title', text: 'land.features.customers.text' },
  { title: 'land.features.docs.title', text: 'land.features.docs.text' },
  { title: 'land.features.finance.title', text: 'land.features.finance.text' },
]

// Тон значка несёт смысл разделения аудиторий, а не настроение: четыре
// одинаковых кружка читались бы как один блок (см. `.aud-icon` в globals).
const AUDIENCE: {
  icon: (p: { size?: number }) => React.ReactElement
  tone: string; title: Key; text: Key
}[] = [
  { icon: IconScissors, tone: 'violet', title: 'land.audience.beauty.title', text: 'land.audience.beauty.text' },
  { icon: IconBag, tone: 'emerald', title: 'land.audience.shops.title', text: 'land.audience.shops.text' },
  { icon: IconUser, tone: 'amber', title: 'land.audience.masters.title', text: 'land.audience.masters.text' },
  { icon: IconBriefcase, tone: 'blue', title: 'land.audience.small.title', text: 'land.audience.small.text' },
]

const BEFORE: Key[] = [
  'land.compare.before.1', 'land.compare.before.2', 'land.compare.before.3',
  'land.compare.before.4', 'land.compare.before.5', 'land.compare.before.6',
]
const AFTER: Key[] = [
  'land.compare.after.1', 'land.compare.after.2', 'land.compare.after.3',
  'land.compare.after.4', 'land.compare.after.5',
]

const STEPS: { title: Key; text: Key }[] = [
  { title: 'land.steps.register.title', text: 'land.steps.register.text' },
  { title: 'land.steps.setup.title', text: 'land.steps.setup.text' },
  { title: 'land.steps.team.title', text: 'land.steps.team.text' },
]

const PRICE_CHECKS: Key[] = [
  'land.pricing.check.1', 'land.pricing.check.2',
  'land.pricing.check.3', 'land.pricing.check.4',
]

const CONTROL: { icon: (p: { size?: number }) => React.ReactElement; title: Key; text: Key }[] = [
  { icon: IconShield, title: 'land.control.roles.title', text: 'land.control.roles.text' },
  { icon: IconCheck, title: 'land.control.audit.title', text: 'land.control.audit.text' },
  { icon: IconDoc, title: 'land.control.process.title', text: 'land.control.process.text' },
  { icon: IconBox, title: 'land.control.data.title', text: 'land.control.data.text' },
]

const FAQ: { q: Key; a: Key }[] = [
  { q: 'land.faq.commission.q', a: 'land.faq.commission.a' },
  { q: 'land.faq.money.q', a: 'land.faq.money.a' },
  { q: 'land.faq.data.q', a: 'land.faq.data.a' },
  { q: 'land.faq.start.q', a: 'land.faq.start.a' },
  { q: 'land.faq.journals.q', a: 'land.faq.journals.a' },
]

export default async function Home() {
  // Единственный поход в базу на всю страницу — узнать, вошёл ли человек.
  // Вошедшему нет смысла показывать «Увійти» и «Реєстрація»: он приходит
  // сюда за кабинетом.
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  const authed = !!user

  return (
    <>
      {/* ── Шапка ──────────────────────────────────────────────── */}
      <header className="land-header">
        <div className="land-header-inner">
          <Link href="/" className="land-brand">
            {t('public.chrome.brand')}<span aria-hidden className="land-brand-dot" />
          </Link>

          <nav className="land-nav">
            {NAV.map((n) => (
              <a key={n.href} href={n.href} className="land-navlink">{t(n.label)}</a>
            ))}
          </nav>

          <div className="flex items-center gap-2">
            {authed ? (
              <Link href="/app" className="btn-primary t-sm">{t('public.chrome.account')}</Link>
            ) : (
              <>
                <Link href="/login" className="btn-ghost t-sm">{t('land.nav.signIn')}</Link>
                <Link href="/register" className="btn-secondary t-sm hidden sm:inline-flex">
                  {t('land.nav.signUp')}
                </Link>
                <Link href="/register/seller" className="btn-primary t-sm">
                  {t('land.nav.start')}
                </Link>
              </>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1240px] px-4 sm:px-6">

        {/* ── Первый экран ─────────────────────────────────────── */}
        <section className="land-hero">
          <div>
            <p className="eyebrow rise">{t('land.hero.eyebrow')}</p>
            {/* Заголовок разрезан на две части не по словам, а по ОФОРМЛЕНИЮ:
                вторая половина набрана акцентом. Один ключ здесь невозможен —
                `t()` отдаёт строку, а не разметку. Ключей два, и оба названы
                так, чтобы переводчик видел, что это одна фраза. */}
            <h1 className="land-h1 rise mt-3">
              {t('land.hero.title')} <em>{t('land.hero.title.accent')}</em>
            </h1>
            <p className="land-lead rise-1 mt-5">{t('land.hero.lead')}</p>

            <div className="rise-2 mt-7 flex flex-wrap items-center gap-3">
              <Link href="/register/seller" className="btn-primary">
                {t('land.hero.start')}
              </Link>
              {/* Ролика нет, поэтому кнопка честно прокручивает к трём шагам —
                  то есть к ответу на свой же вопрос. */}
              <a href="#how" className="btn-secondary">
                <IconPlay /> {t('land.hero.how')}
              </a>
            </div>

            <p className="land-note rise-2 mt-5">
              <IconShield size={17} /> {t('land.hero.note')}
            </p>
          </div>

          {/* ── Снимок кабинета ────────────────────────────────
              Это НЕ скриншот и не данные: строки придуманы и живут
              только здесь, поэтому они такой же интерфейс, как всё
              остальное, и уезжают в словарь. Числа внутри — часть
              рисунка, а не значения: подставлять их через `t.number`
              не во что, реальной величины за ними нет. */}
          <div className="shot rise-3" aria-hidden>
            <div className="shot-body">
              <div className="shot-nav">
                <p className="land-brand mb-3 px-2" style={{ fontSize: 15 }}>
                  {t('public.chrome.brand')}
                </p>
                {([
                  ['app.nav.today', IconHome, true],
                  ['app.nav.inventory', IconBox, false],
                  ['app.nav.bookings', IconCalendar, false],
                  ['app.nav.orders', IconBag, false],
                  ['app.nav.customers', IconUsers, false],
                  ['app.nav.finance', IconMoney, false],
                  ['app.nav.journals', IconCheck, false],
                  ['app.nav.documents', IconDoc, false],
                  ['app.nav.settings', IconGear, false],
                ] as [Key, (p: { size?: number }) => React.ReactElement, boolean][])
                  .map(([label, Icon, active]) => (
                    <span key={label} className="shot-navitem" data-active={active}>
                      <Icon size={13} /> {t(label)}
                    </span>
                  ))}
              </div>

              <div className="shot-main">
                <p className="t-md mb-3" style={{ fontWeight: 650 }}>{t('land.shot.title')}</p>

                <div className="grid grid-cols-3 gap-2">
                  <div className="shot-tile">
                    <span className="shot-tile-num">248</span>
                    <span className="shot-line"><span className="shot-dot" />{t('land.shot.tile.items')}</span>
                    <span style={{ fontSize: 10, color: 'var(--color-faint)' }}>
                      {t('land.shot.tile.items.note')}
                    </span>
                  </div>
                  <div className="shot-tile">
                    <span className="shot-tile-num">18</span>
                    <span className="shot-line"><span className="shot-dot" data-tone="amber" />{t('land.shot.tile.ending')}</span>
                    <span style={{ fontSize: 10, color: 'var(--color-faint)' }}>
                      {t('land.shot.tile.ending.note')}
                    </span>
                  </div>
                  <div className="shot-tile">
                    <span className="shot-tile-num">32</span>
                    <span className="shot-line"><span className="shot-dot" data-tone="rose" />{t('land.shot.tile.pao')}</span>
                    <span style={{ fontSize: 10, color: 'var(--color-faint)' }}>
                      {t('land.shot.tile.pao.note')}
                    </span>
                  </div>
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div className="shot-panel">
                    <p className="t-sm mb-1" style={{ fontWeight: 650 }}>{t('land.shot.events')}</p>
                    {([
                      ['land.shot.event.order', 'land.shot.event.order.note', '10:32'],
                      ['land.shot.event.expiry', 'land.shot.event.expiry.note', '09:15'],
                      ['land.shot.event.journal', 'land.shot.event.journal.note', '—'],
                    ] as [Key, Key, string][]).map(([title, note, time]) => (
                      <div key={title} className="shot-row">
                        <span className="min-w-0">
                          <span style={{ color: 'var(--color-text)' }}>{t(title)}</span>
                          <br />
                          <span style={{ color: 'var(--color-faint)' }}>{t(note)}</span>
                        </span>
                        <span className="tabular shrink-0" style={{ color: 'var(--color-faint)' }}>{time}</span>
                      </div>
                    ))}
                  </div>

                  <div className="shot-panel">
                    <p className="t-sm" style={{ fontWeight: 650 }}>{t('land.shot.calendar')}</p>
                    <p className="mb-1" style={{ fontSize: 10, color: 'var(--color-faint)' }}>
                      {t('land.shot.calendar.date')}
                    </p>
                    {[['10:00', 'Манікюр', 'Олена'], ['12:00', 'Педикюр', 'Марія'], ['14:00', 'Корекція брів', 'Ірина']]
                      .map(([time, what, who]) => (
                        <div key={time} className="shot-row">
                          <span className="tabular" style={{ color: 'var(--color-accent-ink)' }}>{time}</span>
                          <span className="min-w-0 flex-1 truncate px-2" style={{ color: 'var(--color-text)' }}>{what}</span>
                          <span style={{ color: 'var(--color-faint)' }}>{who}</span>
                        </div>
                      ))}
                    <p className="mt-1" style={{ fontSize: 10, color: 'var(--color-accent-ink)' }}>
                      {t('land.shot.calendar.all')}
                    </p>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </section>

        {/* ── Четыре обещания ──────────────────────────────────── */}
        <section className="land-strip divider">
          {STRIP.map((s) => (
            <div key={s.title} className="land-strip-cell">
              <span className="land-strip-icon"><s.icon size={20} /></span>
              <span>
                <span className="t-md block" style={{ fontWeight: 650 }}>{t(s.title)}</span>
                <span className="t-sm prose-muted">{t(s.text)}</span>
              </span>
            </div>
          ))}
        </section>

        {/* ── Одна подписка вместо четырёх + шесть возможностей ─── */}
        <section id="features" className="grid gap-8 pt-14 lg:grid-cols-[minmax(0,0.85fr)_minmax(0,1.15fr)]">
          <div className="card">
            <p className="eyebrow">{t('land.merge.eyebrow')}</p>
            <h2 className="display t-2xl mt-2">{t('land.merge.title')}</h2>
            <p className="t-sm mt-3 prose-muted">{t('land.merge.text')}</p>

            <div className="mt-5 flex flex-col gap-1.5">
              {MERGE.map((m) => (
                <span key={m.label} className="merge-row">
                  <span className="flex items-center gap-2.5">
                    <span style={{ color: 'var(--color-faint)' }}><m.icon size={17} /></span>
                    {t(m.label)}
                  </span>
                  <span className="merge-plus" aria-hidden>+</span>
                </span>
              ))}
              {/* Знак равенства слева от имени: строка читается как итог
                  столбика выше, а не как ещё один его пункт. */}
              <span className="merge-sum mt-1.5">
                <span className="flex items-center gap-2.5">
                  <span aria-hidden style={{ opacity: 0.75 }}>=</span>
                  {t('public.chrome.brand')}
                </span>
              </span>
            </div>

            <p className="t-xs mt-4 prose-muted">{t('land.merge.foot')}</p>
          </div>

          <div>
            <p className="eyebrow">{t('land.features.eyebrow')}</p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {FEATURES.map((f, i) => (
                <article key={f.title} className="num-card">
                  <span className="num-badge">{String(i + 1).padStart(2, '0')}</span>
                  <h3 className="t-md" style={{ fontWeight: 650 }}>{t(f.title)}</h3>
                  <p className="t-sm prose-muted">{t(f.text)}</p>
                </article>
              ))}
            </div>
          </div>
        </section>

        {/* ── Для кого ─────────────────────────────────────────── */}
        <section id="audience" className="pt-14">
          <p className="eyebrow">{t('land.audience.eyebrow')}</p>
          <p className="t-md mt-2 max-w-2xl prose-muted">{t('land.audience.lead')}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {AUDIENCE.map((a) => (
              <article key={a.title} className="aud-card">
                <span className="aud-icon" data-tone={a.tone}><a.icon size={22} /></span>
                <h3 className="t-md" style={{ fontWeight: 650 }}>{t(a.title)}</h3>
                <p className="t-sm prose-muted">{t(a.text)}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ── Раніше / З CRESKO ────────────────────────────────── */}
        <section className="pt-14">
          <div className="compare">
            <div>
              <p className="eyebrow mb-4">{t('land.compare.eyebrow')}</p>
              <span className="compare-tag">{t('land.compare.before')}</span>
              <div className="mt-3 flex flex-col gap-2.5">
                {BEFORE.map((k) => (
                  <span key={k} className="compare-item">
                    <span className="compare-mark" aria-hidden>✕</span>{t(k)}
                  </span>
                ))}
              </div>
            </div>
            <div>
              <span className="compare-tag" data-good="true">{t('land.compare.after')}</span>
              <div className="mt-3 flex flex-col gap-2.5">
                {AFTER.map((k) => (
                  <span key={k} className="compare-item">
                    <span className="compare-mark" data-good="true" aria-hidden>✓</span>{t(k)}
                  </span>
                ))}
              </div>
              <p className="t-md mt-6" style={{ fontWeight: 650 }}>{t('land.compare.caption')}</p>
            </div>
          </div>
        </section>

        {/* ── Три шага и цена ──────────────────────────────────── */}
        <section id="how" className="grid gap-10 pt-14 lg:grid-cols-2">
          <div>
            <p className="eyebrow">{t('land.steps.eyebrow')}</p>
            <div className="mt-5 flex flex-col gap-6">
              {STEPS.map((s, i) => (
                <div key={s.title} className="step">
                  <span className="step-num">{String(i + 1).padStart(2, '0')}</span>
                  <h3 className="t-md mt-1" style={{ fontWeight: 650 }}>{t(s.title)}</h3>
                  <p className="t-sm prose-muted">{t(s.text)}</p>
                </div>
              ))}
            </div>
          </div>

          <div id="pricing">
            <p className="eyebrow">{t('land.pricing.eyebrow')}</p>
            <h2 className="display t-2xl mt-2">{t('land.pricing.title')}</h2>
            <p className="display t-2xl" style={{ color: 'var(--color-accent-ink)' }}>
              {t('land.pricing.accent')}
            </p>
            <p className="t-sm mt-3 prose-muted">{t('land.pricing.text')}</p>

            <div className="mt-5 flex flex-col gap-2.5">
              {PRICE_CHECKS.map((k) => (
                <span key={k} className="price-check">
                  <span className="price-check-mark" aria-hidden>✓</span>{t(k)}
                </span>
              ))}
            </div>

            <div className="mt-6 flex flex-wrap gap-3">
              <Link href="/register/seller" className="btn-primary">
                {t('land.pricing.start')} <IconArrowRight />
              </Link>
              {/* Тарифов нет, узнать свой можно только у нас — значит ссылка
                  на почту, а не на страницу тарифов, которой не существует. */}
              <a href={`mailto:${SUPPORT_EMAIL}`} className="btn-secondary">
                {t('land.pricing.ask')}
              </a>
            </div>
          </div>
        </section>

        {/* ── Вы всегда знаете, что происходит ─────────────────── */}
        <section className="pt-14">
          <p className="eyebrow">{t('land.control.eyebrow')}</p>
          <div className="mt-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {CONTROL.map((c) => (
              <article key={c.title} className="feature-card">
                <span className="feature-icon"><c.icon size={18} /></span>
                <h3 className="t-md" style={{ fontWeight: 650 }}>{t(c.title)}</h3>
                <p className="t-sm prose-muted">{t(c.text)}</p>
              </article>
            ))}
          </div>
        </section>

        {/* ── Вопросы ──────────────────────────────────────────── */}
        <section id="faq" className="grid gap-8 pt-14 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
          <div>
            <p className="eyebrow mb-3">{t('land.faq.eyebrow')}</p>
            {FAQ.map((f) => (
              <details key={f.q} className="faq-item">
                <summary>{t(f.q)}</summary>
                <p>{t(f.a)}</p>
              </details>
            ))}
          </div>

          <aside className="card-flat h-fit">
            <p className="t-md" style={{ fontWeight: 650 }}>{t('land.faq.more.title')}</p>
            <p className="t-sm mt-1 prose-muted">{t('land.faq.more.text')}</p>
            <a href={`mailto:${SUPPORT_EMAIL}`} className="btn-secondary mt-4 t-sm">
              {t('land.faq.more.cta')}
            </a>
          </aside>
        </section>

        {/* ── Финальный призыв ─────────────────────────────────── */}
        <section className="pt-14">
          <div className="cta-band">
            <h2>{t('land.cta.title')}</h2>
            <p className="t-sm" style={{ opacity: 0.88 }}>{t('land.cta.text')}</p>
            <div className="flex flex-col items-start gap-3">
              <Link href="/register/seller" className="btn-on-accent">
                {t('land.cta.button')} <IconArrowRight />
              </Link>
              <p className="t-xs" style={{ opacity: 0.82 }}>{t('land.cta.note')}</p>
            </div>
          </div>
        </section>
      </main>

      <PublicFooter />
    </>
  )
}
