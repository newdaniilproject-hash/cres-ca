import Link from 'next/link'
import type { Key } from '@/lib/i18n/dict'
import { createClient } from '@/lib/supabase/server'
import { PublicHeader, PublicFooter, publicT as t } from '@/components/shell'

export const revalidate = 120

// Заголовок главной задаётся absolute: шаблон «%s — Маркетплейс» из layout
// на первой странице дал бы удвоение названия.
//
// Метаданные тоже из словаря, и это безопасно: `publicT` — чистая функция
// без `cookies()`, объект собирается один раз при сборке. Язык витрины
// закреплён украинским (обоснование — `components/shell.tsx`), поэтому
// в выдаче ничего не меняется, а строки перестают быть захардкоженными.
export const metadata = {
  title: { absolute: t('public.home.meta.title') },
  description: t('public.home.meta.desc'),
}

// Главная. Раскладка взята из первой крес-ки: первый экран из двух
// колонок с наклонённым макетом кабинета, полоса фактов, ниши,
// возможности, четыре шага, вопросы-ответы, финальный призыв.
//
// Что изменено против первой версии: она продавала CRM мастеру,
// эта продаёт легальность и простоту продавцу — и не забывает
// покупателя. Поэтому сразу под первым экраном живёт поиск
// и настоящий список заведений из базы, а не картинка.
// Ниши. НЕ переводятся и в словарь не уезжают — это справочник
// специальностей (CLAUDE.md → «Локализация»: названия специальностей
// переводятся данными). Здесь они вдобавок работают ПОИСКОВЫМ ЗАПРОСОМ
// (`/search?q=`), а поисковый вектор арендатора собран по-украински
// триггером `tenants_search_refresh`: переведённая подпись, уехавшая
// в `q`, не нашла бы ничего.
//
// ⚠ Долг, не решаемый переводом: этот список — вторая копия справочника
// `specialities`. Правильное место для него — та же анонимная точка, что
// отдаёт города (`active_cities`), а не массив в разметке главной.
const NICHES = [
  'Манікюр', 'Брейди', 'Барбер', 'Масаж', 'Косметологія',
  'Одяг', 'Автозапчастини', 'Ремонт', 'Хендмейд',
]

// Блоки-списки держат КЛЮЧИ, а не текст. Тип `Key` здесь не украшение:
// опечатка в имени ключа не соберётся `tsc --noEmit`, то есть ловится
// заданием «Збірка» до слияния, а не пустым местом на главной.
const FEATURES: { icon: string; title: Key; text: Key }[] = [
  { icon: '◫', title: 'public.home.features.storefront.title', text: 'public.home.features.storefront.text' },
  { icon: '▦', title: 'public.home.features.stock.title', text: 'public.home.features.stock.text' },
  { icon: '✓', title: 'public.home.features.journals.title', text: 'public.home.features.journals.text' },
  { icon: '❑', title: 'public.home.features.techcards.title', text: 'public.home.features.techcards.text' },
  { icon: '◷', title: 'public.home.features.bookings.title', text: 'public.home.features.bookings.text' },
  { icon: '₴', title: 'public.home.features.money.title', text: 'public.home.features.money.text' },
]

const STEPS: { title: Key; text: Key }[] = [
  { title: 'public.home.steps.register.title', text: 'public.home.steps.register.text' },
  { title: 'public.home.steps.stock.title', text: 'public.home.steps.stock.text' },
  { title: 'public.home.steps.labels.title', text: 'public.home.steps.labels.text' },
  { title: 'public.home.steps.report.title', text: 'public.home.steps.report.text' },
]

const FAQ: { q: Key; a: Key }[] = [
  { q: 'public.home.faq.commission.q', a: 'public.home.faq.commission.a' },
  { q: 'public.home.faq.money.q', a: 'public.home.faq.money.a' },
  { q: 'public.home.faq.shop.q', a: 'public.home.faq.shop.a' },
  { q: 'public.home.faq.data.q', a: 'public.home.faq.data.a' },
  { q: 'public.home.faq.journals.q', a: 'public.home.faq.journals.a' },
]

export default async function Home() {
  const supabase = await createClient()
  const [{ data: { user } }, { data: cities }, { data: shops }] = await Promise.all([
    supabase.auth.getUser(),
    supabase.rpc('active_cities'),
    supabase
      .from('tenants')
      .select('slug, name, tagline, city, kind, logo_path, cover_path')
      .eq('status', 'active')
      .eq('storefront_enabled', true)
      .order('activated_at', { ascending: false, nullsFirst: false })
      .limit(9),
  ])

  return (
    <>
      <PublicHeader authed={!!user} />

      <main className="mx-auto max-w-6xl px-4 sm:px-6">
        {/* ── Первый экран: две колонки ─────────────────────────── */}
        <section className="hero-split pt-12 pb-14 sm:pt-16">
          <div>
            <p className="eyebrow rise">{t('public.home.hero.eyebrow')}</p>
            {/* Заголовок разрезан на две строки не по словам, а по ОФОРМЛЕНИЮ:
                вторая половина набрана акцентным цветом. Один ключ здесь
                невозможен — `t()` отдаёт строку, а не разметку. Ключей два,
                и оба названы так, чтобы переводчик видел, что это одна фраза. */}
            <h1 className="display rise mt-3 t-5xl">
              {t('public.home.hero.title')}
              <span style={{ color: 'var(--color-accent)' }}>
                {' '}{t('public.home.hero.title.accent')}
              </span>
            </h1>
            <p className="rise-1 t-lg mt-5 max-w-xl leading-relaxed prose-muted">
              {t('public.home.hero.desc')}
            </p>
            <div className="rise-2 mt-7 flex flex-wrap items-center gap-3">
              <Link href="/register/seller" className="btn-primary">
                {t('public.home.hero.start')}
              </Link>
              <Link href="/search" className="btn-secondary">
                {t('public.home.hero.browse')}
              </Link>
            </div>
            <p className="rise-2 t-sm mt-4 prose-muted">{t('public.home.hero.note')}</p>
          </div>

          {/* Рисунок кабинета. Это НЕ данные и не скриншот: строки придуманы
              и живут только здесь, поэтому они интерфейс и уезжают в словарь
              вместе с остальным. Даты и числа внутри — часть рисунка, а не
              значения: подставлять их через `t.date` не во что, реальной
              даты у них нет. */}
          <div className="mock-wrap rise-3" aria-hidden>
            <div className="mock">
              <div className="mock-bar">
                <span className="mock-dot" style={{ background: '#ff5f57' }} />
                <span className="mock-dot" style={{ background: '#ffbd2e' }} />
                <span className="mock-dot" style={{ background: '#28c840' }} />
                <span className="t-xs ml-2 prose-muted">{t('public.home.mock.bar')}</span>
              </div>
              <div className="mock-row">
                <div>
                  <p className="t-md">{t('public.home.mock.jar.title')}</p>
                  <p className="t-xs mt-0.5 prose-muted">{t('public.home.mock.jar.desc')}</p>
                </div>
                <span className="badge-success tabular">{t('public.home.mock.jar.badge')}</span>
              </div>
              <div className="mock-row">
                <div>
                  <p className="t-md">{t('public.home.mock.solution.title')}</p>
                  <p className="t-xs mt-0.5 prose-muted">{t('public.home.mock.solution.desc')}</p>
                </div>
                <span className="badge-warn tabular">{t('public.home.mock.solution.badge')}</span>
              </div>
              <div className="mock-row">
                <div>
                  <p className="t-md">{t('public.home.mock.batch.title')}</p>
                  <p className="t-xs mt-0.5 prose-muted">{t('public.home.mock.batch.desc')}</p>
                </div>
                <span className="badge tabular">{t('public.home.mock.batch.badge')}</span>
              </div>
              <div className="mock-row">
                <div>
                  <p className="t-md">{t('public.home.mock.sterile.title')}</p>
                  <p className="t-xs mt-0.5 prose-muted">{t('public.home.mock.sterile.desc')}</p>
                </div>
                <span className="badge-accent">{t('public.home.mock.sterile.badge')}</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Полоса фактов ─────────────────────────────────────── */}
        {/* Крупные значения (0%, №65, 14/7, QR) оставлены разметкой: это
            числа и обозначения, одинаковые во всех трёх языках. Через
            `t.percent(0)` «0%» превратилось бы в «0 %» с неразрывным
            пробелом — Intl прав, а макет нет. Переводятся подписи. */}
        <section className="proof rise">
          <div className="proof-cell">
            <p className="display t-2xl tabular">0%</p>
            <p className="t-sm prose-muted">{t('public.home.proof.commission')}</p>
          </div>
          <div className="proof-cell">
            <p className="display t-2xl tabular">№65</p>
            <p className="t-sm prose-muted">{t('public.home.proof.reg')}</p>
          </div>
          <div className="proof-cell">
            <p className="display t-2xl tabular">14/7</p>
            <p className="t-sm prose-muted">{t('public.home.proof.warn')}</p>
          </div>
          <div className="proof-cell">
            <p className="display t-2xl">QR</p>
            <p className="t-sm prose-muted">{t('public.home.proof.qr')}</p>
          </div>
        </section>

        {/* ── Покупателю: поиск и живые заведения ───────────────── */}
        <section className="pt-16">
          <h2 className="display t-3xl">{t('public.home.buyer.title')}</h2>
          <form action="/search" className="rise relative mt-6 max-w-2xl">
            <span aria-hidden className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 t-xl"
                  style={{ color: 'var(--color-faint)' }}>⌕</span>
            <input
              name="q"
              className="search-hero"
              placeholder={t('public.home.buyer.search.placeholder')}
              autoComplete="off"
            />
          </form>

          <div className="rise-1 mt-5 flex flex-wrap items-center gap-2">
            <Link href="/search?kind=service" className="chip">
              {t('public.home.buyer.services')}
            </Link>
            <Link href="/search?kind=product" className="chip">
              {t('public.home.buyer.products')}
            </Link>
            <Link href="/map" className="chip">{t('public.home.buyer.map')}</Link>
            {(cities ?? []).slice(0, 4).map((c: { city: string }) => (
              <Link key={c.city} href={`/search?city=${encodeURIComponent(c.city)}`} className="chip">
                {c.city}
              </Link>
            ))}
          </div>

          <div className="mt-10 mb-5 flex items-end justify-between">
            <h3 className="display t-2xl">{t('public.home.shops.title')}</h3>
            <Link href="/map" className="btn-ghost">{t('public.home.shops.map')}</Link>
          </div>

          {shops && shops.length > 0 ? (
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {shops.map((s, i) => (
                <Link key={s.slug} href={`/t/${s.slug}`}
                      className={`card-link rise-${Math.min(i % 3 + 1, 4)}`}>
                  <div className="mb-3 flex h-28 items-center justify-center overflow-hidden"
                       style={{ borderRadius: 'var(--radius-control)', background: 'var(--color-surface-2)' }}>
                    <span className="display t-3xl" style={{ color: 'var(--color-faint)' }}>
                      {s.name.slice(0, 1)}
                    </span>
                  </div>
                  {/* Имя заведения, его подзаголовок и город — ДАННЫЕ
                      продавца, они не переводятся. Переводится запасная
                      подпись, когда своей у заведения нет, и бейдж:
                      `services`/`both` — служебные значения, подпись к ним
                      живёт в словаре. */}
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="t-lg truncate">{s.name}</p>
                      <p className="t-sm mt-0.5 truncate prose-muted">
                        {s.tagline ?? (s.kind === 'services'
                          ? t('public.home.shops.kind.services')
                          : t('public.home.shops.kind.products'))}
                        {s.city ? ` · ${s.city}` : ''}
                      </p>
                    </div>
                    <span className="badge-accent shrink-0">
                      {s.kind === 'services' ? t('public.home.shops.badge.services')
                        : s.kind === 'both' ? t('public.home.shops.badge.both')
                        : t('public.home.shops.badge.product')}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty card">
              <p className="display t-lg" style={{ color: 'var(--color-text)' }}>
                {t('public.home.shops.empty.title')}
              </p>
              <p>{t('public.home.shops.empty.desc')}</p>
            </div>
          )}
        </section>

        {/* ── Ниши ──────────────────────────────────────────────── */}
        <section className="pt-16">
          <p className="eyebrow">{t('public.home.niches.eyebrow')}</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {NICHES.map((n) => (
              <Link key={n} href={`/search?q=${encodeURIComponent(n)}`} className="chip">{n}</Link>
            ))}
          </div>
        </section>

        {/* ── Возможности ───────────────────────────────────────── */}
        <section className="pt-16">
          <h2 className="display t-3xl">{t('public.home.features.title')}</h2>
          <p className="t-md mt-3 max-w-2xl leading-relaxed prose-muted">
            {t('public.home.features.desc')}
          </p>
          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="feature-card">
                <span className="feature-icon" aria-hidden>{f.icon}</span>
                <p className="t-lg mt-1">{t(f.title)}</p>
                <p className="t-sm leading-relaxed prose-muted">{t(f.text)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Четыре шага ───────────────────────────────────────── */}
        <section className="pt-16">
          <h2 className="display t-3xl">{t('public.home.steps.title')}</h2>
          <div className="mt-7 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <div key={s.title} className="step">
                <span className="step-num tabular" aria-hidden>{t.number(i + 1)}</span>
                <p className="t-lg mt-1">{t(s.title)}</p>
                <p className="t-sm leading-relaxed prose-muted">{t(s.text)}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Цена ──────────────────────────────────────────────── */}
        <section className="pt-16">
          <div className="card overflow-hidden !p-0">
            <div className="grid items-center gap-6 p-8 sm:grid-cols-[1fr_auto] sm:p-10"
                 style={{ background: 'linear-gradient(120deg, var(--color-accent-soft), transparent 60%)' }}>
              <div>
                <p className="eyebrow">{t('public.home.price.eyebrow')}</p>
                <h2 className="display mt-3 t-2xl">{t('public.home.price.title')}</h2>
                <p className="t-md mt-3 max-w-lg leading-relaxed prose-muted">
                  {t('public.home.price.desc')}
                </p>
              </div>
              <Link href="/register/seller" className="btn-primary">
                {t('public.home.price.cta')}
              </Link>
            </div>
          </div>
        </section>

        {/* ── Вопросы ───────────────────────────────────────────── */}
        <section className="pt-16">
          <h2 className="display t-3xl">{t('public.home.faq.title')}</h2>
          <div className="mt-6">
            {FAQ.map((f) => (
              <details key={f.q} className="faq-item">
                <summary>{t(f.q)}</summary>
                <p>{t(f.a)}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── Финальный призыв ──────────────────────────────────── */}
        <section className="pt-16">
          <div className="card flex flex-col items-center gap-5 py-12 text-center">
            <h2 className="display t-3xl">{t('public.home.final.title')}</h2>
            <p className="t-md max-w-xl leading-relaxed prose-muted">
              {t('public.home.final.desc')}
            </p>
            <Link href="/register/seller" className="btn-primary">
              {t('public.home.final.cta')}
            </Link>
          </div>
        </section>
      </main>

      <PublicFooter />
    </>
  )
}
