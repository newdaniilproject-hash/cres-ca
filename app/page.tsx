import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { PublicHeader, PublicFooter } from '@/components/shell'

export const revalidate = 120

// Заголовок главной задаётся absolute: шаблон «%s — Маркетплейс» из layout
// на первой странице дал бы удвоение названия.
export const metadata = {
  title: { absolute: 'Маркетплейс товарів і послуг — майстри, салони, локальні бренди' },
  description:
    'Одна підписка замість чотирьох сервісів: вітрина, замовлення, склад із термінами придатності та журнали для перевірок. Знайдіть майстра або товар поруч із вами.',
}

// Главная. Раскладка взята из первой крес-ки: первый экран из двух
// колонок с наклонённым макетом кабинета, полоса фактов, ниши,
// возможности, четыре шага, вопросы-ответы, финальный призыв.
//
// Что изменено против первой версии: она продавала CRM мастеру,
// эта продаёт легальность и простоту продавцу — и не забывает
// покупателя. Поэтому сразу под первым экраном живёт поиск
// и настоящий список заведений из базы, а не картинка.
const NICHES = [
  'Манікюр', 'Брейди', 'Барбер', 'Масаж', 'Косметологія',
  'Одяг', 'Автозапчастини', 'Ремонт', 'Хендмейд',
]

const FEATURES: { icon: string; title: string; text: string }[] = [
  {
    icon: '◫',
    title: 'Вітрина як власний сайт',
    text: 'Своя адреса, фото, ціни й кнопка запису. Посилання кладеться в шапку Instagram — і працює замість сайту.',
  },
  {
    icon: '▦',
    title: 'Склад із термінами',
    text: 'Партії, ємності, дата відкриття і PAO. Термін рахує система, а не пам’ять майстра. Попередження — за 14 і 7 днів.',
  },
  {
    icon: '✓',
    title: 'Санітарні журнали',
    text: 'Дезрозчини, прибирання, стерилізація. Запис не редагується і не видаляється — це те, що перевіряючий вважає доказом.',
  },
  {
    icon: '❑',
    title: 'Технологічні карти',
    text: 'Регламент обробки з версіями. Затверджену карту змінити не можна — тільки випустити наступну.',
  },
  {
    icon: '◷',
    title: 'Запис і замовлення',
    text: 'Слоти майстрів без подвійних записів, замовлення з резервом товару, нагадування клієнту за добу й за дві години.',
  },
  {
    icon: '₴',
    title: 'Гроші й доступи',
    text: 'Доходи, витрати, звіти. Кожен співробітник бачить лише те, що йому дозволено, — аж до режиму інспектора.',
  },
]

const STEPS: { title: string; text: string }[] = [
  {
    title: 'Реєстрація',
    text: 'Пошта й пароль, далі назва закладу, місто та спеціальність. Дві хвилини.',
  },
  {
    title: 'Заводимо склад разом',
    text: 'Не «вставте ключ і розбирайтесь»: засоби, партії й ємності заводимо з вами на дзвінку.',
  },
  {
    title: 'Друкуємо наклейки',
    text: 'QR на кожну ємність, аркуш A4 по 24 наклейки. Далі майстер працює сканером, а не блокнотом.',
  },
  {
    title: 'Звіт для перевірки',
    text: 'Реєстр, журнали й терміни одним документом — в один клік, у будь-який момент.',
  },
]

const FAQ: { q: string; a: string }[] = [
  {
    q: 'Ви берете відсоток із замовлень?',
    a: 'Ні за замовлення, які ви привели самі — через своє посилання, Instagram чи «сарафан». Комісія можлива тільки за клієнтів, яких привела платформа, і ви бачите кожне таке замовлення в розшифровці рахунку.',
  },
  {
    q: 'Гроші покупця проходять через вас?',
    a: 'Ні. Платформа не є платіжним посередником: оплату ви приймаєте самі — накладеним платежем, «Контролем оплати» Нової Пошти або власним еквайрингом. Це свідоме рішення, а не технічне обмеження.',
  },
  {
    q: 'Чи підходить це не салону, а магазину?',
    a: 'Так. Товари й послуги в системі — одна модель, різниця лише у поданні. Модулі вмикаються окремо: якщо ви взяли тільки склад, ви побачите тільки склад.',
  },
  {
    q: 'Що з даними клієнтів, якщо я піду?',
    a: 'База клієнтів — ваша власність, з вивантаженням у будь-який момент. Це записано в умовах, а не залишено на добру волю.',
  },
  {
    q: 'Навіщо мені журнали, якщо перевірок ще не було?',
    a: 'Штраф Держпродспоживслужби вимірюється десятками тисяч гривень, а журнали за минулі місяці заднім числом не заводяться. Система веде їх щодня — саме тому, що заповнювати їх напередодні перевірки вже пізно.',
  },
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
            <p className="eyebrow rise">Для українських підприємців</p>
            <h1 className="display rise mt-3 t-5xl">
              Одна підписка замість
              <span style={{ color: 'var(--color-accent)' }}> чотирьох сервісів</span>
            </h1>
            <p className="rise-1 t-lg mt-5 max-w-xl leading-relaxed prose-muted">
              Вітрина, замовлення, склад із термінами придатності та журнали
              для перевірок — в одному кабінеті. Без комісії за замовлення,
              які ви привели самі. Ніколи.
            </p>
            <div className="rise-2 mt-7 flex flex-wrap items-center gap-3">
              <Link href="/register/seller" className="btn-primary">Почати безкоштовно</Link>
              <Link href="/search" className="btn-secondary">Подивитися заклади</Link>
            </div>
            <p className="rise-2 t-sm mt-4 prose-muted">
              Заводимо склад разом на дзвінку — це частина роботи, а не платна опція.
            </p>
          </div>

          <div className="mock-wrap rise-3" aria-hidden>
            <div className="mock">
              <div className="mock-bar">
                <span className="mock-dot" style={{ background: '#ff5f57' }} />
                <span className="mock-dot" style={{ background: '#ffbd2e' }} />
                <span className="mock-dot" style={{ background: '#28c840' }} />
                <span className="t-xs ml-2 prose-muted">Склад · Ємності</span>
              </div>
              <div className="mock-row">
                <div>
                  <p className="t-md">Кондиціонер, банка №A-104</p>
                  <p className="t-xs mt-0.5 prose-muted">Відкрито 12.07 · PAO 12M</p>
                </div>
                <span className="badge-success tabular">до 12.07.27</span>
              </div>
              <div className="mock-row">
                <div>
                  <p className="t-md">Дезрозчин 2%, дозатор D-07</p>
                  <p className="t-xs mt-0.5 prose-muted">Приготовано сьогодні, 09:40</p>
                </div>
                <span className="badge-warn tabular">7 днів</span>
              </div>
              <div className="mock-row">
                <div>
                  <p className="t-md">Канекалон, партія 240715</p>
                  <p className="t-xs mt-0.5 prose-muted">Постачальник · Висновок СЕС</p>
                </div>
                <span className="badge tabular">18 уп.</span>
              </div>
              <div className="mock-row">
                <div>
                  <p className="t-md">Журнал стерилізації</p>
                  <p className="t-xs mt-0.5 prose-muted">Сухожар 180° · 60 хв · індикатор ОК</p>
                </div>
                <span className="badge-accent">сьогодні</span>
              </div>
            </div>
          </div>
        </section>

        {/* ── Полоса фактов ─────────────────────────────────────── */}
        <section className="proof rise">
          <div className="proof-cell">
            <p className="display t-2xl tabular">0%</p>
            <p className="t-sm prose-muted">комісії за ваші власні замовлення</p>
          </div>
          <div className="proof-cell">
            <p className="display t-2xl tabular">№65</p>
            <p className="t-sm prose-muted">Технічний регламент КМУ — журнали й терміни</p>
          </div>
          <div className="proof-cell">
            <p className="display t-2xl tabular">14/7</p>
            <p className="t-sm prose-muted">днів попередження про кінець терміну</p>
          </div>
          <div className="proof-cell">
            <p className="display t-2xl">QR</p>
            <p className="t-sm prose-muted">наклейка на кожну ємність і сканер у телефоні</p>
          </div>
        </section>

        {/* ── Покупателю: поиск и живые заведения ───────────────── */}
        <section className="pt-16">
          <h2 className="display t-3xl">Шукаєте майстра або товар?</h2>
          <form action="/search" className="rise relative mt-6 max-w-2xl">
            <span aria-hidden className="pointer-events-none absolute left-5 top-1/2 -translate-y-1/2 t-xl"
                  style={{ color: 'var(--color-faint)' }}>⌕</span>
            <input
              name="q"
              className="search-hero"
              placeholder="Манікюр, брейди, пальто, назва закладу…"
              autoComplete="off"
            />
          </form>

          <div className="rise-1 mt-5 flex flex-wrap items-center gap-2">
            <Link href="/search?kind=service" className="chip">Послуги</Link>
            <Link href="/search?kind=product" className="chip">Товари</Link>
            <Link href="/map" className="chip">На мапі ↗</Link>
            {(cities ?? []).slice(0, 4).map((c: { city: string }) => (
              <Link key={c.city} href={`/search?city=${encodeURIComponent(c.city)}`} className="chip">
                {c.city}
              </Link>
            ))}
          </div>

          <div className="mt-10 mb-5 flex items-end justify-between">
            <h3 className="display t-2xl">Заклади</h3>
            <Link href="/map" className="btn-ghost">Показати на мапі</Link>
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
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0">
                      <p className="t-lg truncate">{s.name}</p>
                      <p className="t-sm mt-0.5 truncate prose-muted">
                        {s.tagline ?? (s.kind === 'services' ? 'Послуги' : 'Товари')}
                        {s.city ? ` · ${s.city}` : ''}
                      </p>
                    </div>
                    <span className="badge-accent shrink-0">
                      {s.kind === 'services' ? 'запис' : s.kind === 'both' ? 'все' : 'магазин'}
                    </span>
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <div className="empty card">
              <p className="display t-lg" style={{ color: 'var(--color-text)' }}>
                Перші заклади вже готуються до відкриття
              </p>
              <p>Ми відкриваємо платформу поступово — спочатку майстри та салони.</p>
            </div>
          )}
        </section>

        {/* ── Ниши ──────────────────────────────────────────────── */}
        <section className="pt-16">
          <p className="eyebrow">Ніша не обмежена</p>
          <div className="mt-4 flex flex-wrap gap-2">
            {NICHES.map((n) => (
              <Link key={n} href={`/search?q=${encodeURIComponent(n)}`} className="chip">{n}</Link>
            ))}
          </div>
        </section>

        {/* ── Возможности ───────────────────────────────────────── */}
        <section className="pt-16">
          <h2 className="display t-3xl">Що всередині</h2>
          <p className="t-md mt-3 max-w-2xl leading-relaxed prose-muted">
            Сьогодні продавець збирає це з чотирьох сервісів. Тут воно одне,
            з єдиною базою клієнтів і єдиним рахунком.
          </p>
          <div className="mt-7 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {FEATURES.map((f) => (
              <div key={f.title} className="feature-card">
                <span className="feature-icon" aria-hidden>{f.icon}</span>
                <p className="t-lg mt-1">{f.title}</p>
                <p className="t-sm leading-relaxed prose-muted">{f.text}</p>
              </div>
            ))}
          </div>
        </section>

        {/* ── Четыре шага ───────────────────────────────────────── */}
        <section className="pt-16">
          <h2 className="display t-3xl">Як почати</h2>
          <div className="mt-7 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {STEPS.map((s, i) => (
              <div key={s.title} className="step">
                <span className="step-num tabular" aria-hidden>{i + 1}</span>
                <p className="t-lg mt-1">{s.title}</p>
                <p className="t-sm leading-relaxed prose-muted">{s.text}</p>
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
                <p className="eyebrow">Скільки це коштує</p>
                <h2 className="display mt-3 t-2xl">Фіксована підписка за інструмент</h2>
                <p className="t-md mt-3 max-w-lg leading-relaxed prose-muted">
                  Одна сума на місяць за весь кабінет, скільки б майстрів у вас
                  не працювало. Нуль відсотків із замовлень, які ви привели самі.
                  Впровадження — окремо й один раз: заводимо склад, друкуємо
                  наклейки, навчаємо майстрів.
                </p>
              </div>
              <Link href="/register/seller" className="btn-primary">Дізнатися умови</Link>
            </div>
          </div>
        </section>

        {/* ── Вопросы ───────────────────────────────────────────── */}
        <section className="pt-16">
          <h2 className="display t-3xl">Питання, які ставлять першими</h2>
          <div className="mt-6">
            {FAQ.map((f) => (
              <details key={f.q} className="faq-item">
                <summary>{f.q}</summary>
                <p>{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* ── Финальный призыв ──────────────────────────────────── */}
        <section className="pt-16">
          <div className="card flex flex-col items-center gap-5 py-12 text-center">
            <h2 className="display t-3xl">Спробуйте на своєму складі</h2>
            <p className="t-md max-w-xl leading-relaxed prose-muted">
              Реєстрація безкоштовна, картка не потрібна. Побачите свій кабінет
              і вирішите, чи це те, чого бракувало.
            </p>
            <Link href="/register/seller" className="btn-primary">Створити кабінет</Link>
          </div>
        </section>
      </main>

      <PublicFooter />
    </>
  )
}
