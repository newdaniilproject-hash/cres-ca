'use client'

import { useMemo, useState } from 'react'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'
import { Sheet } from '@/components/sheet'
import { TechCardsClient, type TechCardsData } from '../techcards/techcards-client'
import {
  IconBox, IconCheck, IconChevronRight, IconClock, IconFilter, IconGrid, IconTag,
} from '@/components/icons'

export type CatalogItem = {
  id: string
  kind: 'product' | 'service'
  status: string
  title: string
  subtitle: string | null
  slug: string
  listed: boolean
  currency: string
  price: number | null
  /** Тільки для послуг; у товару завжди null. */
  durationMinutes: number | null
  variants: number
  cover: string | null
  /** Назва категорії довідника платформи. Не заведена — null. */
  category: string | null
  /**
   * Залишок товару сумою по варіантах з обліком. `null` — величини нема:
   * або це послуга, або облік не ведеться в жодному варіанті. Нуль
   * і «нема обліку» — різні речі, і бейдж «немає» має право з'явитися
   * тільки на першому.
   */
  stock: number | null
  /**
   * Скільки витратників у рецептурі позиції (`variant_materials` по всіх
   * варіантах). `null` — величини нема: це товар, у нього рецептури
   * не буває. Нуль у послуги — НЕ порожнє місце, а факт: коли запис
   * переведуть у «Виконано», зі складу не спишеться нічого.
   */
  materials: number | null
}

// Подписи к состояниям позиции. Само значение (`draft`, `hidden`) —
// служебное значение перечисления и не переводится: по нему сверяется база.
// Переводится ПОДПИСЬ. Неизвестное состояние выводится как есть — новое
// появится в базе раньше, чем в словаре.
const STATUSES = ['draft', 'active', 'hidden', 'archived'] as const
type Status = (typeof STATUSES)[number]
const statusLabel = (t: T, s: string): string =>
  ((STATUSES as readonly string[]).includes(s) ? t(`catalog.status.${s as Status}`) : s)

type Filter = 'all' | 'product' | 'service' | 'draft'

// Порядок списка. Из макета: кнопка «Фільтри» открывает шторку
// сортировки — не второй фильтр, а именно порядок.
//
// Умолчание `recent` — это порядок, в котором список пришёл с сервера
// (`updated_at desc`), а не своя сортировка по дате: даты правки в
// карточке нет вовсе, и сортировать по величине, которой нет на экране,
// нечем. Поэтому `recent` ничего не трогает, а остальные три
// переупорядочивают уже полученное.
const SORTS = ['recent', 'name', 'priceAsc', 'priceDesc'] as const
type Sort = (typeof SORTS)[number]

// Бейдж состояния — один и тот же на карточке и в списке: цвет несёт
// смысл (опубликовано — зелёное, чернетка — жёлтое), и вторая таблица
// соответствий разъехалась бы с первой.
const statusBadge = (s: string) =>
  (s === 'active' ? 'badge-success' : s === 'draft' ? 'badge-warn' : 'badge')

// ── CRESKO Web: карточка позиции (§4 послуги, §11 каталог) ──────────────
//
// ОДНО тело на обе сетки: у послуги и товара различаются высота фото,
// кегль названия и нижняя строка — всё остальное совпадает, и две копии
// разъехались бы на первой правке (урок М43, «картка учасника»).
//
// Карточка ведёт ТУДА ЖЕ, куда мобильная строка, — на `/app/catalog/<id>`.
// Второго адреса у позиции нет и заводить его незачем.
function WebOfferingCard({ t, item, coverUrl, hasStorefront }: {
  t: T
  item: CatalogItem
  coverUrl: (path: string) => string
  hasStorefront: boolean
}) {
  const isService = item.kind === 'service'
  const price = item.price != null ? t.money(item.price, item.currency) : t('common.noValue')

  return (
    <Link href={`/app/catalog/${item.id}`}
          className="webcard block overflow-hidden"
          style={{ padding: 0, minHeight: 'var(--tap-min)' }}>
      {/* Высоты 132 (послуга) и 150 (товар) — из README дословно.
          Фото приезжает с CDN и меряется по месту: `next/image` здесь
          не нужен, размеров оригинала мы не храним. */}
      <span className="block" style={{ height: isService ? 132 : 150 }}>
        {item.cover ? (
          <img src={coverUrl(item.cover)} alt="" className="h-full w-full object-cover" />
        ) : (
          // Не серый прямоугольник, а плашка со значком: пустой квадрат
          // читается как несостоявшаяся загрузка, то есть как поломка.
          // Значок, а не глиф: «◷ ◫» на части прошивок приезжают
          // квадратами (М31).
          <span className="flex h-full w-full items-center justify-center"
                style={{
                  background: 'var(--web-surface-tint, var(--color-surface-2))',
                  color: 'var(--color-faint)',
                }}>
            {isService ? <IconClock size={26} /> : <IconBox size={26} />}
          </span>
        )}
      </span>

      <span className="block" style={{ padding: 14 }}>
        <span className="flex items-start justify-between gap-2">
          {/* Назва позиції — данные заклада, они не переводятся. */}
          <span className="clamp-2 block min-w-0"
                style={{
                  fontSize: isService ? 15 : 14,
                  fontWeight: 650,
                  color: 'var(--color-text)',
                }}>
            {item.title}
          </span>
          <span className={`${statusBadge(item.status)} shrink-0`}>
            {statusLabel(t, item.status)}
          </span>
        </span>

        {/* Категория — справочник платформы; когда она не выбрана,
            строку занимает подпись позиции. Пустая строка вместо обеих
            не рисуется вовсе: место под неё не резервируется, карточки
            в сетке выравнивает грид. */}
        <span className="mt-1 flex items-center justify-between gap-2">
          <span className="min-w-0 truncate" style={{ fontSize: 12, color: 'var(--color-muted)' }}>
            {item.category ?? item.subtitle ?? ''}
          </span>
          {hasStorefront && !item.listed && (
            <span className="badge shrink-0">{t('catalog.badge.unlisted')}</span>
          )}
        </span>

        <span className="mt-3 flex items-center justify-between gap-2 pt-2.5"
              style={{ borderTop: '1px solid var(--web-border-dash, var(--color-border))' }}>
          {isService ? (
            <>
              {/* Тривалість — тільки коли задана хоч на одному варіанті.
                  Число витратників (рецептура) здесь НЕ рисуется: связь
                  `variant_materials` в список каталога не приходит,
                  а «0 витратників» у послуги с рецептурой — это ложь. */}
              <span className="tabular" style={{ fontSize: 13, color: 'var(--color-muted)' }}>
                {item.durationMinutes != null
                  ? t('catalog.duration', { n: t.number(item.durationMinutes) })
                  : ''}
              </span>
              <span className="tabular"
                    style={{ fontSize: 13, fontWeight: 700, color: 'var(--color-text)' }}>
                {price}
              </span>
            </>
          ) : (
            <>
              <span className="tabular"
                    style={{ fontSize: 16, fontWeight: 800, color: 'var(--color-text)' }}>
                {price}
              </span>
              {/* Остаток есть только там, где его ведут. Ноль — это
                  «немає в наявності», а отсутствие учёта — не величина,
                  и бейджа у неё нет. */}
              {item.stock != null && (
                <span className={item.stock > 0 ? 'badge shrink-0' : 'badge-warn shrink-0'}>
                  {item.stock > 0
                    ? t('catalog.web.stock', { n: t.number(item.stock) })
                    : t('catalog.web.stock.none')}
                </span>
              )}
            </>
          )}
        </span>
      </span>
    </Link>
  )
}

// Список позиций. Фильтр — по виду и по «чернеткам»: продавец возвращается
// сюда именно за недоделанным, а не за поиском по всему каталогу.
export function CatalogClient({
  items, error, canWrite, hasStorefront = false, tech = null,
}: {
  items: CatalogItem[]
  error: string | null
  /** Есть ли `catalog.write`. Считает сервер — см. `page.tsx`. */
  canWrite: boolean
  /**
   * Данные вкладки «Техкарти» — или `null`, если у человека нет модуля
   * `compliance` либо права `compliance.read`. Тогда вкладки нет вовсе:
   * решают обе оси, и решают они на сервере (см. `page.tsx`).
   *
   * Экран техкарт рисуется ТЕМ ЖЕ компонентом, что и на `/app/techcards`,
   * а не своей копией списка: две копии одного списка разъезжаются на
   * первой правке, и правило «один источник правды» здесь ровно про это.
   */
  tech?: TechCardsData | null
  /**
   * Модуль `storefront` — вторая ось, не право. Список позиций сам
   * принадлежит модулю `catalog`, но пара строк в нём говорит о витрине:
   * зачем заводить позицию («вітрина нічого не показує») и отметка
   * «поза каталогом» — про общий каталог маркетплейса. Заведению без
   * витрины оба утверждения обещают публичную страницу, которой нет.
   */
  hasStorefront?: boolean
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('recent')
  const [sortOpen, setSortOpen] = useState(false)
  // Что показывает экран: позиции каталога или техкарты. ТОЛЬКО ТЕЛЕФОН —
  // переключатель и обе ветки под ним `lg:hidden`, а десктопная раскладка
  // рисуется всегда и этим состоянием не управляется. Причина: у веб-кабинета
  // «Техкарти» — свой пункт сайдбара со своим видом (карточка §6, визард §7),
  // и второй вход в него внутри «Послуг» был бы двумя дверями в одну комнату.
  // Заодно это снимает вопрос «а что покажет широкий экран, если переключить
  // на узком и повернуть телефон»: он покажет каталог, как и до правки.
  const [tab, setTab] = useState<'offerings' | 'tech'>('offerings')

  const shown = useMemo(() => {
    const list = items.filter((i) => {
      if (filter === 'draft' && i.status !== 'draft') return false
      if ((filter === 'product' || filter === 'service') && i.kind !== filter) return false
      return true
    })
    if (sort === 'recent') return list
    // Позиция без цены уезжает в конец при ЛЮБОМ направлении: «немає ціни»
    // — это не «нуль», и поставить её первой в порядке «від меншої»
    // значило бы соврать о самой дешёвой позиции каталога.
    const byPrice = (dir: 1 | -1) => (a: CatalogItem, b: CatalogItem) => {
      if (a.price == null || b.price == null) return (a.price == null ? 1 : 0) - (b.price == null ? 1 : 0)
      return (a.price - b.price) * dir
    }
    // Сравнение имён — `localeCompare` по языку интерфейса, а не по кодам
    // символов: иначе «Ялинка» встанет перед «Їжак», а «Є» уедет в хвост
    // за латиницу.
    return [...list].sort(
      sort === 'name'
        ? (a, b) => a.title.localeCompare(b.title, t.lang)
        : byPrice(sort === 'priceAsc' ? 1 : -1),
    )
  }, [items, filter, sort, t])

  const counts = useMemo(() => ({
    product: items.filter((i) => i.kind === 'product').length,
    service: items.filter((i) => i.kind === 'service').length,
    active: items.filter((i) => i.status === 'active').length,
    draft: items.filter((i) => i.status === 'draft').length,
    // «Без матеріалів» — послуги с ПУСТОЙ рецептурой. Именно `=== 0`,
    // а не «нет величины»: у товара рецептуры не бывает вовсе (`null`),
    // и считать его недоделанной услугой нельзя.
    noMaterials: items.filter((i) => i.materials === 0).length,
  }), [items])

  const cover = (path: string) => supabase.storage.from('media').getPublicUrl(path).data.publicUrl

  // Сетки веб-версии: §4 — послуги по три в ряд, §11 — товари по четыре.
  // Делим уже ОТФИЛЬТРОВАННЫЙ список, а не исходный: фильтр «Чернетки»
  // должен резать обе сетки, иначе он режет только половину экрана.
  const shownServices = shown.filter((i) => i.kind === 'service')
  const shownProducts = shown.filter((i) => i.kind === 'product')

  // Вкладки веб-версии и чипы телефона — один и тот же фильтр и одни
  // и те же числа; отличается только вид.
  const tabItems: [Filter, string, number][] = [
    ['all', t('catalog.filter.all'), items.length],
    ['product', t('catalog.filter.products'), counts.product],
    ['service', t('catalog.filter.services'), counts.service],
    ['draft', t('catalog.filter.drafts'), counts.draft],
  ]

  // Подпись выбранного вида — из ТОГО ЖЕ списка, что рисует вкладки
  // и строки шторки: вторая таблица соответствий «значение → подпись»
  // разошлась бы с первой молча.
  const filterLabel = tabItems.find(([key]) => key === filter)?.[1] ?? ''

  return (
    <div className="flex flex-col gap-5">
      {/* ── CRESKO Web: хедер экрана (только lg) ─────────────────
          Слева имя экрана тем же ключом, которым его называет панель
          и вкладка браузера; справа — то же единственное действие,
          что и на телефоне. На телефоне кнопка «Додати» стоит в ряду
          фильтров, здесь — в правом углу хедера: действие одно,
          разметка разная. */}
      <div className="hidden items-center justify-between lg:flex">
        <h1 className="webh1">{t('app.screen.catalog.title')}</h1>
        {canWrite && (
          <Link href="/app/catalog/new" className="btn-primary">{t('catalog.add')}</Link>
        )}
      </div>

      {/* ── CRESKO Web: метрики (только lg) ──────────────────────
          Те же четыре числа, что и в мобильном ряду ниже, в виде
          .wmetric с иконкой-плашкой. Плитки не нажимаются: фильтр
          живёт во вкладках, и второй орган управления с тем же
          действием — это два входа в одно место.

          Тон несёт смысл: emerald — опубликованное, violet — послуги
          (акцент этого раздела), blue — нейтральные счётчики. */}
      {items.length > 0 && (
        <section className="rise hidden gap-4 lg:grid lg:grid-cols-4">
          {([
            { key: 'total', n: items.length, label: t('catalog.stats.total'), tone: 'blue', icon: IconGrid },
            { key: 'active', n: counts.active, label: t('catalog.stats.active'), tone: 'emerald', icon: IconCheck },
            { key: 'service', n: counts.service, label: t('catalog.stats.services'), tone: 'violet', icon: IconClock },
            { key: 'product', n: counts.product, label: t('catalog.stats.products'), tone: 'blue', icon: IconBox },
          ] as const).map((s) => (
            <div key={s.key} className="wmetric">
              <span className="min-w-0">
                <span className="wmetric-label block">{s.label}</span>
                <span className="wmetric-value tabular block">{t.number(s.n)}</span>
              </span>
              <span className="wmetric-icon" data-tone={s.tone}><s.icon size={19} /></span>
            </div>
          ))}
        </section>
      )}

      {/* ── CRESKO Web: вкладки чертой (только lg) ───────────────
          Тот же `setFilter`, что и у чипов. Счётчик у вкладки —
          там же, где у чипа: он отвечает на «а есть ли там что-то»
          до нажатия. */}
      <div className="wtabs hidden lg:flex">
        {tabItems.map(([key, label, n]) => (
          <button key={key} type="button" onClick={() => setFilter(key)}
                  className="wtab" data-active={filter === key}
                  style={{ minHeight: 'var(--tap-min)' }}>
            {label}{n > 0 ? ` · ${t.number(n)}` : ''}
          </button>
        ))}
      </div>

      {/* ── Переключатель «Послуги · Техкарти» (телефон) ─────────
          Из макета дословно: два чипа над содержимым экрана. До
          19.08.2026 техкарты открывались только набором адреса —
          входящих ссылок из кабинета не было ни одной.

          Ряд ОДИН, а не второй сверху над прежними четырьмя чипами
          («Усі · Товари · Послуги · Чернетки»): два ряда пилюль подряд
          и есть то, на что жалуется владелец. Вид и «чернетки» переехали
          в шторку «Фільтри» — туда, где уже жил порядок списка. Разбор
          решения — у самой шторки ниже.

          Чипы, а не `.seg`: `.seg` — вид НАСТРОЙКИ (тема, язык, размер
          текста), её трогают раз в жизни, и высота дорожки 32px меньше
          зоны нажатия. Здесь переключают содержимое экрана по десять раз
          за смену. */}
      {tech && (
        <div className="rise flex items-center gap-2 lg:hidden">
          <button type="button" onClick={() => setTab('offerings')}
                  aria-pressed={tab === 'offerings'}
                  className={tab === 'offerings' ? 'chip-active' : 'chip'}>
            {t('app.screen.catalog.title')}
          </button>
          <button type="button" onClick={() => setTab('tech')}
                  aria-pressed={tab === 'tech'}
                  className={tab === 'tech' ? 'chip-active' : 'chip'}>
            {t('app.screen.techcards.title')}
          </button>
        </div>
      )}

      {/* ── Техкарти ─────────────────────────────────────────────
          ТОТ ЖЕ компонент, что и на `/app/techcards`, со своими
          счётчиками, кнопкой «Нова техкарта», списком карт, историей
          версий и выпуском следующей. Копии списка здесь нет намеренно:
          состав вкладки обязан меняться вместе с самим экраном, а не
          через неделю после него.

          Веб-раскладка внутри него вся `hidden lg:*`, а обёртка —
          `lg:hidden`: на широком экране не появится ни она, ни он. */}
      {tech && tab === 'tech' && (
        <div className="lg:hidden">
          <TechCardsClient {...tech} />
        </div>
      )}

      {/* ── Счётчики ─────────────────────────────────────────────
          Все четыре — РЕАЛЬНЫЕ величины. По прототипу здесь стоял ещё
          рейтинг и число «в акції», но акций и промокодов в продукте нет
          (модуль `marketing` пуст, CLAUDE.md), а рейтинг заведения —
          витринная величина и её место в разделе «Магазин», а не здесь.
          Плитка с придуманным числом хуже отсутствующей: она обещает
          функцию, которой нет.

          ПЛИТКА «ПОЗИЦІЙ» СНЯТА 19.08.2026 и заменена на «Без матеріалів»
          из макета. Две причины, обе про одно и то же число. Первая:
          «позицій» — это «послуги» плюс «товари», то есть третье число,
          выводимое из двух соседних в том же ряду. Вторая: то же самое
          число уже стоит в шторке «Фільтри» строкой «Усі · N», и там оно
          ещё и НАЖИМАЕТСЯ, а здесь просто лежит.

          Что встало на его место, — величина, которой в ряду не было
          вовсе, хотя данные для неё приезжают: послуги с пустой
          рецептурой. Она отвечает на вопрос учёта: со склада не спишется
          ничего, когда такую запись переведут в «Виконано». Для салона
          это и есть смысл раздела. */}
      {items.length > 0 && tab === 'offerings' && (
        <section className="rise grid grid-cols-4 gap-2 lg:hidden">
          <div className="metric" data-tone="emerald">
            <span className="metric-value">{t.number(counts.active)}</span>
            <span className="metric-label">{t('catalog.stats.active')}</span>
          </div>
          <div className="metric">
            <span className="metric-value">{t.number(counts.noMaterials)}</span>
            <span className="metric-label">{t('catalog.stats.noMaterials')}</span>
          </div>
          <div className="metric">
            <span className="metric-value">{t.number(counts.service)}</span>
            <span className="metric-label">{t('catalog.stats.services')}</span>
          </div>
          <div className="metric">
            <span className="metric-value">{t.number(counts.product)}</span>
            <span className="metric-label">{t('catalog.stats.products')}</span>
          </div>
        </section>
      )}

      {/* ── Состояние списка + «Фільтри» (телефон) ───────────────
          Ряд чипов «Усі · Товари · Послуги · Чернетки» отсюда УБРАН
          и переехал в шторку, а строка слева теперь называет ОБА
          выбора — вид и порядок: «Усі · Спочатку нові». Причина
          названа владельцем прямо: элементов на экране слишком много,
          а два ряда пилюль подряд (новый переключатель плюс прежние
          фильтры) — это ровно тот случай.

          Что от этого не потерялось: чипы были ЕДИНСТВЕННЫМ местом,
          где видно число позиций каждого вида, и числа уехали вместе
          с ними в шторку — рядом с той же подписью. Что потерялось:
          вид больше не переключается одним нажатием, а двумя. Это цена,
          и она заплачена сознательно — фильтр по виду на экране, где
          каталог салона это два десятка услуг, трогают редко, а место
          он занимал постоянно.

          Поля поиска рядом нет и не будет: поиск в кабинете один
          и живёт в шапке (CLAUDE.md → «Мобильная версия»), а поле
          на экране требует сначала угадать раздел.

          Кнопка «Додати» из этого ряда УБРАНА и переехала вниз, под
          список, как в макете. Два входа в одно действие — та же ошибка,
          что разбиралась на складе (М31); здесь она была бы ещё и на
          расстоянии экрана друг от друга. */}
      {tab === 'offerings' && (
        <div className="flex items-center justify-between gap-2 lg:hidden">
          <span className="t-sm truncate" style={{ color: 'var(--color-muted)' }}>
            {filterLabel} · {t(`catalog.sort.${sort}`)}
          </span>
          <button type="button" onClick={() => setSortOpen(true)}
                  className="btn-secondary t-sm flex shrink-0 items-center gap-2">
            <IconFilter size={16} />
            {t('catalog.filters')}
          </button>
        </div>
      )}

      {error && (
        <p className={`field-error rise ${tab === 'tech' ? 'hidden lg:block' : ''}`}>{error}</p>
      )}

      {shown.length === 0 ? (
        // Пустой список каталога на телефоне не показывается, пока открыты
        // техкарты: «за цим фільтром нічого немає» под списком техкарт
        // относилось бы к тому, чего на экране нет. На широком экране
        // вкладок не существует, и блок остаётся как был.
        <div className={`card rise-1 ${tab === 'tech' ? 'hidden lg:block' : ''}`}>
          <div className="empty">
            {items.length === 0 ? (
              // Пустой каталог без права записи — не задача этого человека:
              // предлагать ему «завести первую позицию» значит послать
              // за кнопкой, которой у него нет.
              canWrite ? (
                <>
                  {/* Две развилки — две отдельные строки словаря целиком,
                      а не общее начало плюс хвост: в другом языке
                      предложение строится иначе, и склейка из кусков
                      даёт неграмотную фразу. */}
                  <p>{hasStorefront
                    ? t('catalog.empty.write.storefront')
                    : t('catalog.empty.write.plain')}</p>
                  <Link href="/app/catalog/new" className="btn-primary">
                    {t('catalog.empty.add')}
                  </Link>
                </>
              ) : (
                <p>{t('catalog.empty.readonly')}</p>
              )
            ) : (
              <p>{t('catalog.empty.filter')}</p>
            )}
          </div>
        </div>
      ) : (
        <>
        {/* ── CRESKO Web: сетки карточек (только lg) ─────────────
            Двумя сетками, а не одной: у послуги и товара разные ряды
            по README (§4 — три в ряд, §11 — четыре), и перемешать их
            в одну сетку значит выбрать одну ширину карточки для обоих
            и потерять обе. Заголовок ряда — та же подпись, что и у
            вкладки фильтра: два имени одной величины расходятся.

            Ряд, в котором после фильтра ничего не осталось, не рисуется
            вовсе — пустой заголовок сообщал бы о разделе, которого
            на экране нет. */}
        <div className="hidden flex-col gap-6 lg:flex">
          {shownServices.length > 0 && (
            <section>
              <h2 className="webh2 mb-3">
                {t('catalog.filter.services')} · {t.number(shownServices.length)}
              </h2>
              <div className="grid grid-cols-3" style={{ gap: 18 }}>
                {shownServices.map((i) => (
                  <WebOfferingCard key={i.id} t={t} item={i} coverUrl={cover}
                                   hasStorefront={hasStorefront} />
                ))}
              </div>
            </section>
          )}
          {shownProducts.length > 0 && (
            <section>
              <h2 className="webh2 mb-3">
                {t('catalog.filter.products')} · {t.number(shownProducts.length)}
              </h2>
              <div className="grid grid-cols-4" style={{ gap: 18 }}>
                {shownProducts.map((i) => (
                  <WebOfferingCard key={i.id} t={t} item={i} coverUrl={cover}
                                   hasStorefront={hasStorefront} />
                ))}
              </div>
            </section>
          )}
        </div>

        {/* ── Карточка позиции на телефоне (хендофф CRESKO, раздел E) ──
            Один столбец карточек, а не сетка 2×N: у позиции есть строка
            метрик и строка витратників вдобавок к бейджу, и в узкой
            колонке сетки 390px они переносятся и делают половину карточек
            выше другой половины. Список ровный — карточки ровные (М31/М32).

            Состав из README дословно: фото 56 (радиус 12) → назва 14/650 →
            строка метрик со значками 13 (часы + тривалість `muted`,
            цінник + ціна `text`/650) → «Витратники: N» 12 `muted` со
            значком куба → бейдж состояния + шеврон.

            ЦЕНА ПЕРЕЕХАЛА ВЛЕВО, в строку метрик, и это не косметика:
            в прежней раскладке она стояла отдельным столбцом справа,
            то есть длинное имя позиции отжимало её к краю и рядом с ней
            оказывался бейдж состояния — два несвязанных числа-слова
            в одной точке. В макете справа стоит ровно один указатель
            («тут есть ещё»), а всё, что описывает позицию, читается
            одной колонкой сверху вниз. */}
        <div className={`flex-col gap-2 lg:hidden ${tab === 'tech' ? 'hidden' : 'flex'}`}>
          {shown.map((i) => (
            <Link key={i.id} href={`/app/catalog/${i.id}`} className="list-card !items-start">
              {i.cover ? (
                // next/image здесь не нужен: это миниатюра с CDN,
                // размеры оригинала мы не храним.
                <img src={cover(i.cover)} alt="" className="list-card-thumb object-cover"
                     style={{ width: 56, height: 56 }} />
              ) : (
                // Значок, не символ: текстовые глифы вроде «◷ ◫» на части
                // телефонов рисуются квадратами (М31 — та же грабля,
                // уже пойманная на складе).
                <span className="list-card-thumb" style={{ width: 56, height: 56 }}>
                  {i.kind === 'service' ? <IconClock size={22} /> : <IconBox size={22} />}
                </span>
              )}

              <span className="min-w-0 flex-1">
                {/* Название и бейдж состояния — ОДНОЙ строкой, как в макете.
                    Бейдж не вынесен в отдельный правый столбец намеренно:
                    украинское «опубліковано» вдвое длиннее макетного
                    «Активна», и своим столбцом он сжимал бы строку метрик
                    до переноса — «60 хв» и цена уезжали бы на разные
                    строки на КАЖДОЙ карточке. */}
                <span className="flex items-start justify-between gap-2">
                  <span className="clamp-2 min-w-0"
                        style={{ fontSize: 14, fontWeight: 650, color: 'var(--color-text)' }}>
                    {i.title}
                  </span>
                  <span className={`${statusBadge(i.status)} shrink-0`}>
                    {statusLabel(t, i.status)}
                  </span>
                </span>

                <span className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1"
                      style={{ fontSize: 13 }}>
                  {/* Тривалість — тільки в послуг, і тільки коли задана.
                      Формат «60 хв», а не «1 год»: варіанти рідко переходять
                      годинну позначку, а секунди читача не цікавлять. */}
                  {i.durationMinutes != null && (
                    <span className="tabular flex items-center gap-1"
                          style={{ color: 'var(--color-muted)' }}>
                      <IconClock size={13} />
                      {t('catalog.duration', { n: t.number(i.durationMinutes) })}
                    </span>
                  )}
                  <span className="tabular flex items-center gap-1"
                        style={{ fontWeight: 650, color: 'var(--color-text)' }}>
                    <IconTag size={13} />
                    {/* Символ валюты ставит Intl (`t.money`), а не мы:
                        ручная подстановка «₴» ломается на второй валюте
                        и ставит символ не с той стороны в английской. */}
                    {i.price != null ? t.money(i.price, i.currency) : t('common.noValue')}
                  </span>
                </span>

                {/* Витратники — только у послуги: у товара рецептуры не
                    бывает вовсе. Ноль ПОКАЗЫВАЕТСЯ, а не прячется: это
                    и есть ответ на вопрос, спишется ли что-нибудь со
                    склада, когда запись переведут в «Виконано». */}
                {i.materials != null && (
                  <span className="tabular mt-1 flex items-center gap-1"
                        style={{ fontSize: 12, color: 'var(--color-muted)' }}>
                    <IconBox size={13} />
                    {t('catalog.materials', { n: t.number(i.materials) })}
                  </span>
                )}

                {/* Отметки, которых в макете нет, потому что в прототипе
                    нет и самих величин: число вариантов и «поза каталогом».
                    Стоят ПОД метриками, а не в углу с бейджем состояния:
                    в углу помещается ровно одна плашка, и вторая
                    выталкивала бы первую на следующую строку. */}
                {(i.variants > 1 || (hasStorefront && !i.listed)) && (
                  <span className="mt-1.5 flex flex-wrap items-center gap-1.5">
                    {i.variants > 1 && (
                      <span className="badge">{t.plural('catalog.variants.count', i.variants)}</span>
                    )}
                    {hasStorefront && !i.listed && (
                      <span className="badge">{t('catalog.badge.unlisted')}</span>
                    )}
                  </span>
                )}
              </span>

              {/* Шеврон — указатель, а не кнопка: нажимается вся карточка.
                  Стоит по центру строки, потому что говорит о карточке
                  целиком, а не о верхней её строке. */}
              <span aria-hidden className="shrink-0 self-center"
                    style={{ color: 'var(--color-faint)' }}>
                <IconChevronRight size={18} />
              </span>
            </Link>
          ))}
        </div>
        </>
      )}

      {/* Главная кнопка — ПОД СПИСКОМ, в потоке, а не плавающая.
          Из макета дословно, и это осознанно не FAB: плавающая кнопка
          накрывает последнюю карточку списка, а над ней уже висит
          нижняя панель разделов — два плавающих слоя на одном экране
          дерутся за один и тот же угол экрана.

          На lg она не рисуется: там та же единственная кнопка живёт
          в правом углу веб-хедера выше. */}
      {canWrite && shown.length > 0 && tab === 'offerings' && (
        <Link href="/app/catalog/new" className="btn-primary lg:hidden">
          {t('catalog.add.cta')}
        </Link>
      )}

      {/* Подпись про публикацию — про позиции каталога. Под списком
          техкарт у неё нет предмета: у карты нет публикации вовсе,
          она чинна, пока не выпущена следующая, и своё правило она
          говорит сама (`techcards.footer`). */}
      <p className={`field-hint ${tab === 'tech' ? 'hidden lg:block' : ''}`}>
        {t('catalog.hint.published')}
      </p>

      {/* Шторка «Фільтри»: ДВА выбора, и оба списком вариантов, а не
          набором переключателей — и вид, и порядок бывают ровно одни,
          а два выбранных сразу это состояние, которого не бывает.

          Здесь же теперь живёт вид позиции («Усі · Товари · Послуги ·
          Чернетки»), уехавший из ряда чипов: у шторки уже была кнопка
          на экране, и второй орган управления рядом с ней означал бы,
          что «Фільтри» фильтруют не всё, что на экране названо фильтром.
          Числа при видах сохранены — до нажатия видно, есть ли там
          что-нибудь.

          Выбор закрывает шторку: подтверждать нечего, результат виден
          в списке за ней, а «выбрал и ничего не произошло» человек
          читает как поломку. Менять оба выбора сразу — редкий случай,
          и он стоит второго открытия. */}
      <Sheet open={sortOpen} onClose={() => setSortOpen(false)} title={t('catalog.filters')}>
        <div className="flex flex-col gap-4">
          <div>
            <p className="field-label">{t('catalog.filter.title')}</p>
            <div className="flex flex-col gap-1">
              {tabItems.map(([key, label, n]) => (
                <button key={key} type="button"
                        onClick={() => { setFilter(key); setSortOpen(false) }}
                        className="flex items-center justify-between gap-3 text-left"
                        style={{
                          minHeight: 'var(--tap-min)',
                          padding: '0 12px',
                          borderRadius: 'var(--radius-control)',
                          fontSize: 14,
                          fontWeight: filter === key ? 650 : 500,
                          background: filter === key ? 'var(--color-accent-soft)' : undefined,
                          color: filter === key ? 'var(--color-accent-ink)' : 'var(--color-text)',
                        }}>
                  <span className="min-w-0 truncate">{label}</span>
                  <span className="flex shrink-0 items-center gap-2">
                    {n > 0 && (
                      <span className="tabular" style={{ color: 'var(--color-muted)' }}>
                        {t.number(n)}
                      </span>
                    )}
                    {filter === key && <IconCheck size={18} />}
                  </span>
                </button>
              ))}
            </div>
          </div>

          <div>
            <p className="field-label">{t('catalog.sort.title')}</p>
            <div className="flex flex-col gap-1">
              {SORTS.map((s) => (
                <button key={s} type="button"
                        onClick={() => { setSort(s); setSortOpen(false) }}
                        className="flex items-center justify-between gap-3 text-left"
                        style={{
                          minHeight: 'var(--tap-min)',
                          padding: '0 12px',
                          borderRadius: 'var(--radius-control)',
                          fontSize: 14,
                          fontWeight: sort === s ? 650 : 500,
                          background: sort === s ? 'var(--color-accent-soft)' : undefined,
                          color: sort === s ? 'var(--color-accent-ink)' : 'var(--color-text)',
                        }}>
                  {t(`catalog.sort.${s}`)}
                  {sort === s && <IconCheck size={18} />}
                </button>
              ))}
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  )
}
