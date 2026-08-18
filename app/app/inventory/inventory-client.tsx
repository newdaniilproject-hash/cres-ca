'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { MaterialForm, type RefItem } from './material-form'
import { ContainerForm, type BatchOption } from './container-form'
import { RefsForm } from './refs-form'
import { Sheet } from '@/components/sheet'
import { enqueue, isNetworkError } from '@/lib/offline/queue'
import { useToast } from '@/components/toast'
import { useT } from '@/lib/i18n/client'
import type { Key } from '@/lib/i18n/dict'
import { EXPIRY_BADGE, type ExpiryState, expiryState } from '@/lib/expiry'
import { Scanner } from '@/components/scanner'
import {
  IconAlert, IconArrows, IconBarcode, IconBeaker, IconBox, IconClipboard,
  IconClock, IconClose, IconDoc, IconInbox, IconLayers, IconList, IconLow, IconQr,
} from '@/components/icons'

type Container = {
  id: string; code: string; status: string; useBy: string | null
  openedAt: string | null; volume: number | null; unit: string | null
  material: string; materialId: string
}
type Material = {
  id: string; name: string; unit: string; stock: number; threshold: number
  cosmetic: boolean; pao: number | null; brand: string | null
  sku: string | null; batch: string | null; expiry: string | null
}
type Variant = {
  id: string; name: string; title: string; stock: number; reserved: number
  threshold: number; unit: string; tracked: boolean
}
type ScanHit = {
  kind: string; title: string; subtitle: string | null; stock_qty: number
  location: string | null; low_stock: boolean
}
type ContainerHit = {
  id: string; material: string; code: string; status: string
  use_by: string | null; days_left: number | null; expired: boolean
}

type Tab = 'all' | 'materials' | 'containers' | 'goods'
/** Состояние, по которому отфильтрован список. Задаётся плиткой-счётчиком. */
type Flag = 'all' | 'soon' | 'expired' | 'low'

// Подпись состояния срока — из словаря, а не из `lib/expiry.ts`.
// Само состояние там и остаётся: пороги (14 и 7 дней) — правило склада,
// одно на экран, письмо и наклейку. Переводится только подпись.
//
// Карта одна на весь раздел (её же читают карточка засоба и контроль
// вскрытия): вторая копия разъехалась бы на первом новом состоянии.
export const EXPIRY_KEY: Record<ExpiryState, Key> = {
  none: 'inventory.expiry.none',
  ok: 'inventory.expiry.ok',
  soon: 'inventory.expiry.soon',
  urgent: 'inventory.expiry.urgent',
  expired: 'inventory.expiry.expired',
}

// ── Экран склада ────────────────────────────────────────────────────────────
//
// Переборка 18.08.2026. Отзыв владельца о прежней версии дословно:
// «много дубляжа и не нужного». Дубляж был не на глаз, а буквальный —
// одно и то же действие лежало на экране по два и по три раза:
//
//   поиск   — строка в шапке оболочки (`?q=`) И своё поле на странице;
//   сканер  — значок в шапке (`?scan=1`), плитка «Сканувати» И синяя
//             кнопка рядом со вторым полем. Три входа в одну камеру;
//   пусто   — «Розхідники» и «Ємності» рисовали КАЖДЫЙ свою карточку
//             пустого состояния, и на новом заведении экран состоял
//             из двух почти одинаковых карточек во весь рост;
//   разделы — четыре плитками сверху, четыре тусклыми ссылками внизу
//             (под нижней панелью, то есть наполовину недоступными)
//             и «Довідники» отдельной кнопкой в ряду фильтров.
//
// Ряд фильтров при этом смешивал три разных вещи в один список кружков:
// фильтры («Всі», «Розхідники»), переход в шторку («Довідники») и
// создание («+ Засіб»). На 390px он переносился на две строки, и «+ Засіб»
// вставал под «Товари» — читалось как ещё один фильтр.
//
// ── ЧТО ТЕПЕРЬ И ПОЧЕМУ ─────────────────────────────────────────────────────
//
// Порядок сверху вниз отвечает на вопросы мастера в том порядке, в каком
// он их задаёт: «що я щойно відсканував» → «що горить» → «покажи це» →
// список. Всё остальное — ниже списка.
//
//   1. Результат сканирования. Появляется ТОЛЬКО после скана, первым,
//      с кнопками действия («Вдкрити банку»). Это ответ на вопрос,
//      с которым человек подошёл к экрану с банкой в руке.
//   2. Счётчики. Они же ФИЛЬТР, и это главная содержательная правка:
//      раньше «Прострочені: 3» было мёртвым числом — экран сообщал беду
//      и не давал способа её увидеть. Теперь нажатие на плитку оставляет
//      в списке ровно эти три позиции.
//   3. Вкладки по виду записи — одной строкой, с горизонтальной
//      прокруткой вместо переноса.
//   4. Список. Одно пустое состояние на весь экран, а не по одному
//      на секцию.
//   5. «Ще у складі» — ВСЕ остальные экраны раздела одной картой,
//      внизу и в одном месте.
//
// Единственный поиск — в шапке оболочки, единственный сканер — там же.
// Активный запрос показывается на экране отдельной меткой с крестиком:
// без неё отфильтрованный список выглядит как потерянные данные, а снять
// фильтр можно было бы только через шапку.
//
// Почему разделы уехали ВНИЗ, а не остались плитками сверху. Приёмка,
// справочники и документы — работа администратора за столом, а не мастера
// у кресла (это же записано в CLAUDE.md про офлайн: приёмка намеренно
// оставлена вне очереди). Держать их первым экраном значит отдавать
// первый экран тому, кто заходит сюда раз в неделю.
export function InventoryClient({
  tenantId, userId, containers, materials, variants, totals,
  suppliers, locations, batches, initialQuery, initialScan,
}: {
  /** Пришло из строки поиска в шапке (?q=). */
  initialQuery: string
  /** Пришло с кнопки сканера в шапке (?scan=1). */
  initialScan: boolean
  tenantId: string
  userId: string
  containers: Container[]
  materials: Material[]
  variants: Variant[]
  totals: { units: number; cost: number; retail: number } | null
  suppliers: RefItem[]
  locations: RefItem[]
  batches: BatchOption[]
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('all')
  const [flag, setFlag] = useState<Flag>('all')
  const [query, setQuery] = useState(initialQuery)
  // Формы раскрываются шторкой снизу, а не блоком на странице: на телефоне
  // раздвигающийся блок уводит список вниз, и мастер теряет место, где был.
  const [adding, setAdding] = useState<'material' | 'container' | 'refs' | null>(null)
  const [manual, setManual] = useState(false)
  const [code, setCode] = useState('')
  const [scan, setScan] = useState<{ item?: ScanHit; container?: ContainerHit; miss?: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [camera, setCamera] = useState(initialScan)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Счётчики. Считаются по тем же порогам, что и рассылка, ──
  // иначе экран и письмо разойдутся: тут зелено, а письмо уже пришло.
  const stats = useMemo(() => {
    const items = [
      ...materials.map((m) => expiryState(m.expiry)),
      ...containers.map((c) => expiryState(c.useBy)),
    ]
    return {
      total: materials.length + containers.length + variants.length,
      soon: items.filter((s) => s === 'soon' || s === 'urgent').length,
      expired: items.filter((s) => s === 'expired').length,
      low: materials.filter((m) => m.threshold > 0 && m.stock <= m.threshold).length,
    }
  }, [materials, containers, variants])

  const q = query.trim().toLowerCase()
  const match = (...fields: (string | null)[]) =>
    !q || fields.some((f) => f && f.toLowerCase().includes(q))

  // Условие плитки. Собрано ОДНОЙ функцией на все три списка: развести её
  // по спискам значит завести три определения слова «прострочено».
  //
  // У ёмкости нет порога остатка, у товара нет срока — поэтому «Мало»
  // не показывает ёмкостей, а «Прострочені» не показывает товаров.
  // Это не пробел, а честный ответ: такого состояния у них не бывает.
  const passFlag = (state: ExpiryState, low: boolean) =>
    flag === 'all' ? true
      : flag === 'soon' ? (state === 'soon' || state === 'urgent')
        : flag === 'expired' ? state === 'expired'
          : low

  const shownMaterials = materials.filter((m) =>
    match(m.name, m.brand, m.sku, m.batch)
    && passFlag(expiryState(m.expiry), m.threshold > 0 && m.stock <= m.threshold))
  const shownContainers = containers.filter((c) =>
    match(c.code, c.material) && passFlag(expiryState(c.useBy), false))
  const shownVariants = variants.filter((v) =>
    match(v.title, v.name)
    && passFlag('none', v.threshold > 0 && v.stock <= v.threshold))

  const showMaterials = tab === 'all' || tab === 'materials'
  const showContainers = tab === 'all' || tab === 'containers'
  const showGoods = tab === 'all' || tab === 'goods'

  const visible =
    (showMaterials ? shownMaterials.length : 0)
    + (showContainers ? shownContainers.length : 0)
    + (showGoods ? shownVariants.length : 0)
  const filtered = q !== '' || flag !== 'all'
  const emptyTenant = stats.total === 0

  // Короткая дата для плотных списков: «20 трав.». Через `t.date`,
  // а не своей сборкой — месяц называется на языке интерфейса.
  const short = (v: string | null | undefined) =>
    t.date(v, { day: 'numeric', month: 'short' })

  async function lookup(raw: string) {
    const s = raw.trim()
    if (!s) return
    setManual(false)
    setCode('')
    const [{ data: cont }, { data: items }] = await Promise.all([
      supabase.rpc('scan_container', { p_tenant_id: tenantId, p_code: s }),
      supabase.rpc('scan_lookup', { p_tenant_id: tenantId, p_code: s }),
    ])
    const c = (cont ?? [])[0] as ContainerHit | undefined
    const i = (items ?? [])[0] as ScanHit | undefined
    setScan(c ? { container: c } : i ? { item: i } : { miss: s })
  }

  // ── `?scan=1` ОТКРЫВАЕТ КАМЕРУ ────────────────────────────────────────
  //
  // Значок сканера в шапке ведёт сюда адресом `?scan=1`. До 18.08.2026 этот
  // признак лишь переключал строку в режим кода — камера не открывалась, а
  // кнопка камеры в этом режиме вообще не рисовалась. Человек нажимал значок
  // сканера и не видел НИЧЕГО: ни камеры, ни причины. Ровно это владелец
  // и сообщил как «сканер не отвечает» — и починка самого сканера (М27)
  // тут ничего не меняла, потому что до сканера дело не доходило.
  //
  // Признак снимается из адреса СРАЗУ: иначе повторное нажатие значка ведёт
  // на тот же адрес, компонент не перемонтируется, и второй раз камера
  // не откроется. `history.replaceState` вместо `router.replace` —
  // не хочется гонять серверный рендер ради очистки параметра.
  const sp = useSearchParams()
  useEffect(() => {
    if (sp.get('scan') !== '1') return
    setCamera(true)
    window.history.replaceState(null, '', '/app/inventory')
  }, [sp])

  // Строка поиска живёт в шапке и приходит адресом. Пока состояние
  // заводилось только начальным значением, второй запрос подряд с той же
  // страницы список не менял: адрес обновлялся, а `query` оставался прежним.
  useEffect(() => { setQuery(initialQuery) }, [initialQuery])

  // Курсор в поле ручного ввода — после того, как шторка отрисовалась.
  useEffect(() => {
    if (!manual) return
    const id = setTimeout(() => inputRef.current?.focus(), 60)
    return () => clearTimeout(id)
  }, [manual])

  // Смена статуса ёмкости — то самое действие, которое мастер делает
  // с банкой в руке в подвале без сети. Ошибка сети не роняет действие:
  // оно ложится в офлайн-очередь и уходит само при появлении связи
  // (пункт ТЗ про офлайн). Ошибка данных — честно показывается: класть
  // её в очередь бессмысленно, она не отправится никогда.
  async function setContainerStatus(
    id: string, containerCode: string,
    status: 'opened' | 'finished' | 'disposed',
    label: string,
  ) {
    setBusy(id)
    try {
      const { error } = await supabase.from('material_containers')
        .update({ status }).eq('id', id)
      if (error) throw new Error(error.message)
    } catch (e) {
      setBusy(null)
      if (isNetworkError(e)) {
        await enqueue(`${label} · ${containerCode}`, { kind: 'container.status', containerId: id, status })
        toast.info(t('inventory.offline.saved'), t('inventory.offline.desc'))
        return true
      }
      toast.error(t('inventory.container.saveError'), e instanceof Error ? e.message : String(e))
      return false
    }
    setBusy(null)
    return true
  }

  async function openContainer(id: string, containerCode: string) {
    const ok = await setContainerStatus(id, containerCode, 'opened', t('inventory.container.open'))
    if (!ok) return
    toast.success(t('inventory.container.opened.title'), t('inventory.container.opened.desc'))
    router.refresh()
    if (scan?.container?.id === id) void lookup(scan.container.code)
  }

  async function finishContainer(id: string, containerCode: string, disposed = false) {
    const ok = await setContainerStatus(
      id, containerCode,
      disposed ? 'disposed' : 'finished',
      disposed ? t('inventory.queue.dispose') : t('inventory.queue.finish'),
    )
    if (!ok) return
    setScan(null)
    router.refresh()
  }

  function switchTab(next: Tab) {
    setTab(next)
    setAdding(null)
  }

  // ── Главное действие экрана ──────────────────────────────────────────
  //
  // Одна плавающая кнопка вместо прежнего куста кнопок в ряду фильтров.
  // Подпись меняется вместе со вкладкой и всегда называет РЕЗУЛЬТАТ:
  // безымянный «+», меняющий смысл под вкладкой, читать нельзя.
  //
  // Товар заводится в каталоге вместе с ценой и фото — второй формы
  // для того же самого на складе быть не должно, поэтому здесь ссылка.
  const fab: { label: string; href?: string; onClick?: () => void } = tab === 'goods'
    ? { href: '/app/catalog', label: t('inventory.action.addInCatalog') }
    : tab === 'containers'
      ? { onClick: () => setAdding('container'), label: t('inventory.action.addContainer') }
      : { onClick: () => setAdding('material'), label: t('inventory.action.addMaterial') }

  // ── Остальные экраны раздела ─────────────────────────────────────────
  // Порядок — по частоте, а не по алфавиту. Печать наклеек показывается
  // только когда есть что печатать: пустой список печати — это лист
  // бумаги, потраченный впустую.
  const more: { href: string; label: string; icon: typeof IconBox; blank?: boolean }[] = [
    { href: '/app/inventory/receipts', label: t('inventory.quick.receipts'), icon: IconInbox },
    { href: '/app/inventory/movements', label: t('inventory.quick.movements'), icon: IconArrows },
    { href: '/app/inventory/counts', label: t('inventory.quick.counts'), icon: IconClipboard },
    { href: '/app/inventory/reorder', label: t('inventory.links.reorder'), icon: IconLow },
    ...(containers.length > 0
      ? [{ href: '/app/inventory/labels', label: t('inventory.action.printLabels'), icon: IconQr, blank: true }]
      : []),
    { href: '/app/documents', label: t('inventory.links.documents'), icon: IconDoc },
    { href: '/app/inventory/recipes', label: t('inventory.links.recipes'), icon: IconBeaker },
    { href: '/app/inventory/barcodes', label: t('inventory.links.barcodes'), icon: IconBarcode },
  ]

  return (
    <div className="flex flex-col gap-5">

      {/* ── Результат сканирования ───────────────────────────────
          Первым блоком и только после скана. Крестик обязателен:
          без него панель висит до перезагрузки и мешает списку. */}
      {scan && (
        <section className="card rise" style={{ borderColor: 'var(--color-accent)' }}>
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              {scan.container && (
                <>
                  {/* Название засоба и код наліпки — данные арендатора. */}
                  <p className="t-md">{scan.container.material}
                    <span className="prose-muted"> · {scan.container.code}</span></p>
                  <p className="tabular t-md mt-0.5">
                    {scan.container.expired
                      ? <span style={{ color: 'var(--color-danger)' }}>
                          {t('inventory.container.expired', { date: short(scan.container.use_by) })}
                        </span>
                      : scan.container.use_by
                        ? t('inventory.container.useBy', {
                            date: short(scan.container.use_by),
                            days: t.plural('inventory.days', scan.container.days_left ?? 0),
                          })
                        : t('inventory.container.sealedHint')}
                  </p>
                </>
              )}
              {scan.item && (
                <>
                  <p className="t-md">{scan.item.title}
                    {scan.item.subtitle ? <span className="prose-muted"> · {scan.item.subtitle}</span> : null}</p>
                  <p className="tabular t-md mt-0.5 prose-muted">
                    {t('inventory.scan.item.stock', { n: t.number(Number(scan.item.stock_qty)) })}
                    {scan.item.location ? ` · ${scan.item.location}` : ''}
                    {scan.item.low_stock ? ` · ${t('inventory.scan.item.low')}` : ''}
                  </p>
                </>
              )}
              {scan.miss && (
                <p className="field-error">{t('inventory.scan.notFound', { code: scan.miss })}</p>
              )}
            </div>
            <button type="button" onClick={() => setScan(null)}
                    aria-label={t('inventory.scan.close')}
                    className="btn-icon shrink-0" style={{ color: 'var(--color-faint)' }}>
              <IconClose size={18} />
            </button>
          </div>

          {scan.container && (
            <div className="mt-3 flex flex-wrap gap-2">
              {scan.container.status === 'sealed' && (
                <button className="btn-primary" disabled={busy === scan.container.id}
                        onClick={() => void openContainer(scan.container!.id, scan.container!.code)}>
                  {t('inventory.container.open')}
                </button>
              )}
              {scan.container.status === 'opened' && (
                <>
                  <button className="btn-secondary" disabled={busy === scan.container.id}
                          onClick={() => void finishContainer(scan.container!.id, scan.container!.code)}>
                    {t('inventory.container.finished')}
                  </button>
                  <button className="btn-danger" disabled={busy === scan.container.id}
                          onClick={() => void finishContainer(scan.container!.id, scan.container!.code, true)}>
                    {t('inventory.container.dispose')}
                  </button>
                </>
              )}
            </div>
          )}
        </section>
      )}

      {/* ── Счётчики, они же фильтр ──────────────────────────────
          Плитки по макету: значок в цветном квадрате, число, подпись.
          Тон несёт смысл и не выбирается «для красоты» (globals.css,
          `.stat-tile`): rose — то, что уже сломано, amber — то, что
          сломается, emerald — норма.

          Тон постоянный, а не «серый, пока ноль». Плитка, меняющая
          цвет вместе с числом, заставляет читать её дважды: сначала
          «какого она цвета сегодня», потом само число. Спокойное
          состояние показывает НОЛЬ, а не отсутствие цвета.

          Нажатие переключает фильтр, повторное — снимает. Плитка
          с нулём не нажимается: фильтр, дающий пустой список, — это
          обещание показать то, чего нет. */}
      <section className="rise-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {([
          { key: 'all', n: stats.total, label: t('inventory.stats.total'), tone: 'blue', Icon: IconLayers },
          { key: 'soon', n: stats.soon, label: t('inventory.stats.soon'), tone: 'amber', Icon: IconClock },
          { key: 'expired', n: stats.expired, label: t('inventory.stats.expired'), tone: 'rose', Icon: IconAlert },
          { key: 'low', n: stats.low, label: t('inventory.stats.low'), tone: 'emerald', Icon: IconLow },
        ] as const).map((s) => {
          const on = flag === s.key
          const dead = s.key !== 'all' && s.n === 0
          return (
            <button
              key={s.key}
              type="button"
              disabled={dead}
              aria-pressed={on}
              onClick={() => setFlag(on ? 'all' : s.key)}
              className="stat-tile text-left"
              style={{
                borderColor: on ? 'var(--color-accent)' : undefined,
                boxShadow: on ? '0 0 0 3px var(--color-accent-soft)' : undefined,
                // Ноль НЕ гасится ни прозрачностью, ни цветом. Спокойное
                // состояние — это «ноль просрочених», и читаться оно должно
                // так же уверенно, как тревожное; блёклая плитка заставляет
                // сначала разбирать её вид, а потом уже число. Нажатие
                // при этом не делает ничего: фильтр на ноль — обещание
                // показать то, чего нет.
                cursor: dead ? 'default' : 'pointer',
              }}
            >
              <span className="stat-tile-icon" data-tone={s.tone}><s.Icon size={17} /></span>
              <span className="block">
                <span className="stat-tile-value block">{t.number(s.n)}</span>
                <span className="stat-tile-label block">{s.label}</span>
              </span>
            </button>
          )
        })}
      </section>

      {/* ── Вкладки ──────────────────────────────────────────────
          Одной строкой с горизонтальной прокруткой. Перенос на вторую
          строку смешивал бы их с тем, что стоит рядом, — ровно так
          «+ Засіб» оказывался под «Товари» и читался как фильтр. */}
      <div className="scroll-x rise-2 -mx-4 flex gap-2 px-4 pb-1 sm:mx-0 sm:px-0">
        {([
          ['all', t('inventory.tab.all')],
          ['materials', t('inventory.tab.materials')],
          ['containers', `${t('inventory.tab.containers')}${containers.length ? ` · ${t.number(containers.length)}` : ''}`],
          ['goods', t('inventory.tab.goods')],
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => switchTab(key)}
                  className={`${tab === key ? 'chip-active' : 'chip'} shrink-0`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Что сейчас отфильтровано ─────────────────────────────
          Поиск живёт в шапке оболочки, и без этой метки укороченный
          список выглядит как пропавшие данные. Крестик снимает
          фильтр здесь же — идти за этим в шапку человек не догадается. */}
      {filtered && (
        <div className="rise-2 flex flex-wrap items-center gap-2">
          {/* Стиль НЕ `chip-active`, хотя напрашивался. Сплошной кобальт
              здесь уже занят выбранной вкладкой, и две одинаковые синие
              пилюли в двух строках подряд означали бы разное: «я на этой
              вкладке» и «наложен фильтр, нажми чтобы снять». Поэтому
              снимаемый фильтр — обводка и акцентный ТЕКСТ, а не заливка
              (`--color-accent-ink` против `--color-accent`, см. CLAUDE.md
              про два токена акцента). */}
          {q !== '' && (
            <button type="button" className="chip" onClick={() => setQuery('')}
                    style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent-ink)' }}>
              {t('inventory.filter.query', { q: query.trim() })}
              <IconClose size={14} className="ml-1.5" />
            </button>
          )}
          {flag !== 'all' && (
            <button type="button" className="chip" onClick={() => setFlag('all')}
                    style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent-ink)' }}>
              {t(flag === 'soon' ? 'inventory.stats.soon'
                : flag === 'expired' ? 'inventory.stats.expired'
                  : 'inventory.stats.low')}
              <IconClose size={14} className="ml-1.5" />
            </button>
          )}
        </div>
      )}

      {/* ── Пусто: ОДНО состояние на экран ───────────────────────
          Раньше «Розхідники» и «Ємності» рисовали каждое своё, и на
          новом заведении экран состоял из двух одинаковых карточек. */}
      {visible === 0 ? (
        <section className="card rise">
          <div className="empty">
            <span className="empty-icon"><IconBox size={24} /></span>
            <p className="empty-title">
              {emptyTenant ? t('inventory.empty.title') : t('inventory.search.empty')}
            </p>
            <p className="empty-desc">
              {emptyTenant ? t('inventory.empty.desc') : t('inventory.empty.filtered')}
            </p>
            <div className="empty-actions">
              {emptyTenant ? (
                <button type="button" className="btn-primary" onClick={() => setAdding('material')}>
                  {t('inventory.materials.add')}
                </button>
              ) : (
                <button type="button" className="btn-secondary"
                        onClick={() => { setQuery(''); setFlag('all') }}>
                  {t('inventory.filter.reset')}
                </button>
              )}
            </div>
          </div>
        </section>
      ) : (
        <>
          {/* ── Расходники ──────────────────────────────────────── */}
          {showMaterials && shownMaterials.length > 0 && (
            <section className="rise">
              {/* Надзаголовок только на вкладке «Всі»: на своей вкладке
                  он повторял бы её же имя двумя строками ниже. */}
              {tab === 'all' && <p className="eyebrow mb-2">{t('inventory.tab.materials')}</p>}
              <div className="card !p-0">
                {shownMaterials.map((mt) => {
                  const state = expiryState(mt.expiry)
                  const low = mt.threshold > 0 && mt.stock <= mt.threshold
                  return (
                    <Link key={mt.id} href={`/app/inventory/materials/${mt.id}`}
                          className="row px-5" style={{ minHeight: 'var(--tap-min)' }}>
                      <span className="min-w-0">
                        {/* Название, бренд и номер партии — данные арендатора. */}
                        <span className="t-md block truncate">{mt.name}</span>
                        <span className="t-xs block truncate" style={{ color: 'var(--color-faint)' }}>
                          {[
                            mt.brand,
                            mt.batch ? t('inventory.materials.batch', { number: mt.batch }) : null,
                            mt.expiry ? t('inventory.materials.until', { date: short(mt.expiry) }) : null,
                            mt.cosmetic ? t('inventory.materials.pao', { n: mt.pao != null ? t.number(mt.pao) : '—' }) : null,
                          ].filter(Boolean).join(' · ')}
                        </span>
                        {/* Метка состояния — ТОЛЬКО когда есть что сказать.
                            Зелёное «Дійсний» на каждой здоровой строке — это
                            шум в чистом виде: список из двадцати засобів
                            превращался в список из двадцати зелёных плашек,
                            и на их фоне красная переставала выделяться.
                            Срок и так напечатан строкой выше. */}
                        {state !== 'none' && state !== 'ok' && (
                          <span className={`mt-1 inline-block ${EXPIRY_BADGE[state]}`}>
                            {t(EXPIRY_KEY[state])}
                          </span>
                        )}
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span className={`tabular ${low ? 'badge-warn' : 'badge'}`}>
                          {t.number(mt.stock)} {mt.unit}
                        </span>
                        <span aria-hidden style={{ color: 'var(--color-faint)' }}>›</span>
                      </span>
                    </Link>
                  )
                })}
              </div>
            </section>
          )}

          {/* ── Ёмкости ─────────────────────────────────────────── */}
          {showContainers && shownContainers.length > 0 && (
            <section className="rise">
              {tab === 'all' && <p className="eyebrow mb-2">{t('inventory.tab.containers')}</p>}
              <div className="card !p-0">
                {shownContainers.map((c) => {
                  const state = expiryState(c.useBy)
                  return (
                    <div key={c.id} className="row px-5">
                      <Link href={`/app/inventory/materials/${c.materialId}/pao`}
                            className="min-w-0 flex-1" style={{ minHeight: 'var(--tap-min)' }}>
                        <span className="t-md block truncate">{c.material}
                          <span style={{ color: 'var(--color-faint)' }}> · {c.code}</span></span>
                        <span className="tabular t-xs mt-0.5 block" style={{ color: 'var(--color-faint)' }}>
                          {c.status === 'sealed'
                            ? t('inventory.container.sealed')
                            : t('inventory.container.openedAt', { date: short(c.openedAt) })}
                          {c.volume ? ` · ${t.number(c.volume)} ${c.unit ?? ''}` : ''}
                        </span>
                      </Link>
                      <span className="flex shrink-0 items-center gap-2">
                        {c.useBy && (
                          <span className={`tabular ${EXPIRY_BADGE[state]}`}>
                            {t('inventory.container.until', { date: short(c.useBy) })}
                          </span>
                        )}
                        {c.status === 'sealed' && (
                          <button className="btn-secondary t-sm" disabled={busy === c.id}
                                  onClick={() => void openContainer(c.id, c.code)}>
                            {t('inventory.container.openShort')}
                          </button>
                        )}
                      </span>
                    </div>
                  )
                })}
              </div>
            </section>
          )}

          {/* ── Товары ──────────────────────────────────────────── */}
          {showGoods && shownVariants.length > 0 && (
            <section className="rise flex flex-col gap-3">
              {tab === 'all' && <p className="eyebrow">{t('inventory.tab.goods')}</p>}
              {/* Итоги — только на своей вкладке: на «Всі» три денежных
                  плитки посреди списка перебивают счётчики сверху. */}
              {tab === 'goods' && totals && totals.units > 0 && (
                <div className="grid grid-cols-3 gap-3">
                  {[
                    [t('inventory.goods.units'), t.number(totals.units)],
                    [t('inventory.goods.cost'), t.money(totals.cost)],
                    [t('inventory.goods.retail'), t.money(totals.retail)],
                  ].map(([label, val]) => (
                    <div key={label} className="card-flat !p-4 text-center">
                      <p className="tabular t-xl">{val}</p>
                      <p className="t-xs mt-0.5 prose-muted">{label}</p>
                    </div>
                  ))}
                </div>
              )}
              <div className="card !p-0">
                {shownVariants.map((v) => (
                  <div key={v.id} className="row px-5">
                    <div className="min-w-0">
                      <p className="t-md truncate">{v.title}
                        <span className="prose-muted"> · {v.name}</span></p>
                      {v.reserved > 0 && (
                        <p className="tabular t-xs mt-0.5 prose-muted">
                          {t('inventory.goods.reserved', { n: t.number(v.reserved) })}
                        </p>
                      )}
                    </div>
                    {v.tracked ? (
                      <span className={`tabular ${v.threshold > 0 && v.stock <= v.threshold ? 'badge-warn' : 'badge'}`}>
                        {t.number(v.stock)} {v.unit}
                      </span>
                    ) : (
                      <span className="badge">{t('inventory.goods.untracked')}</span>
                    )}
                  </div>
                ))}
              </div>
            </section>
          )}
        </>
      )}

      {/* ── Ще у складі ──────────────────────────────────────────
          Все остальные экраны раздела одним списком и в одном месте.
          Раньше половина стояла плитками сверху, половина — тусклыми
          ссылками в самом низу, где их накрывала нижняя панель. */}
      <section className="rise-3">
        <p className="eyebrow mb-2">{t('inventory.more.title')}</p>
        <div className="card !p-0">
          {more.map((it) => (
            <Link key={it.href + it.label} href={it.href} className="row px-5"
                  style={{ minHeight: 'var(--tap-min)' }}
                  {...(it.blank ? { target: '_blank', rel: 'noreferrer' } : {})}>
              <span className="flex min-w-0 items-center gap-3">
                <span className="list-anchor"><it.icon size={17} /></span>
                <span className="t-md truncate">{it.label}</span>
              </span>
              <span aria-hidden style={{ color: 'var(--color-faint)' }}>›</span>
            </Link>
          ))}
          {/* Справочники — шторка, а не экран, поэтому кнопкой. Раньше
              стояли кружком в ряду фильтров и читались как фильтр. */}
          <button type="button" onClick={() => setAdding('refs')}
                  className="row w-full px-5 text-left" style={{ minHeight: 'var(--tap-min)' }}>
            <span className="flex min-w-0 items-center gap-3">
              <span className="list-anchor"><IconList size={17} /></span>
              <span className="t-md truncate">{t('inventory.action.refs')}</span>
            </span>
            <span aria-hidden style={{ color: 'var(--color-faint)' }}>›</span>
          </button>
        </div>
      </section>

      {/* ── Главное действие ─────────────────────────────────────
          `.fab-wide`, а не круглый плюс: «+ Банка» и «+ Засіб» —
          разные действия, и значком их не различить. */}
      {/* На пустом заведении плавающей кнопки НЕТ: там же, в карточке
          пустого состояния, уже стоит «Додати засіб», и это то же самое
          действие. Две кнопки одного действия в двадцати сантиметрах
          друг от друга — ровно тот дубляж, из-за которого экран
          и переделывался. */}
      {!(visible === 0 && emptyTenant) && (
        fab.href
          ? <Link href={fab.href} className="fab-wide">{fab.label}</Link>
          : <button type="button" className="fab-wide" onClick={fab.onClick}>{fab.label}</button>
      )}

      {/* ── Формы заведения ──────────────────────────────────── */}
      <Sheet
        open={adding === 'container'}
        onClose={() => setAdding(null)}
        title={t('inventory.sheet.container')}
      >
        <ContainerForm
          tenantId={tenantId} userId={userId}
          materials={materials} batches={batches} suppliers={suppliers}
          onDone={() => setAdding(null)}
        />
      </Sheet>

      <Sheet
        open={adding === 'material'}
        onClose={() => setAdding(null)}
        title={t('inventory.sheet.material')}
      >
        <MaterialForm
          tenantId={tenantId} suppliers={suppliers} locations={locations}
          onDone={() => setAdding(null)}
        />
      </Sheet>

      <Sheet
        open={adding === 'refs'}
        onClose={() => setAdding(null)}
        title={t('inventory.sheet.refs')}
      >
        <RefsForm
          tenantId={tenantId} suppliers={suppliers} locations={locations}
          onDone={() => setAdding(null)}
        />
      </Sheet>

      {/* ── Ручной ввод кода ─────────────────────────────────────
          Запасной путь для стёртой наклейки и отказавшей камеры.
          Шторкой, а не полем на странице: постоянное поле ввода кода
          рядом со строкой поиска в шапке и было главным дубляжом,
          из-за которого экран читался как две разные формы поиска. */}
      <Sheet open={manual} onClose={() => { setManual(false); setCode('') }}
             title={t('inventory.manual.title')}>
        <div className="flex flex-col gap-3">
          <p className="t-sm prose-muted">{t('inventory.manual.hint')}</p>
          <input
            ref={inputRef}
            className="input"
            placeholder={t('inventory.manual.placeholder')}
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void lookup(code) } }}
            autoComplete="off"
            aria-label={t('inventory.manual.title')}
          />
          <button type="button" className="btn-primary" disabled={!code.trim()}
                  onClick={() => void lookup(code)}>
            {t('inventory.search.find')}
          </button>
        </div>
      </Sheet>

      <Scanner open={camera} onClose={() => setCamera(false)}
               onManual={() => setManual(true)}
               onResult={(v) => { setCode(v); void lookup(v) }} />

    </div>
  )
}
