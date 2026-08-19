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
import { dbErrorText } from '@/lib/errors/db'
import type { Key } from '@/lib/i18n/dict'
import { EXPIRY_BADGE, type ExpiryState, expiryState } from '@/lib/expiry'
import { Scanner } from '@/components/scanner'
import {
  IconAlert, IconArrows, IconBarcode, IconBeaker, IconBox, IconCheck,
  IconClipboard, IconClock, IconClose, IconBag, IconDoc, IconInbox,
  IconLayers, IconList, IconLow, IconQr, IconScan,
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
  /** Фото засоба (0111). Пусто — рисуем значок, а не серый прямоугольник. */
  imagePath: string | null
}
type Variant = {
  id: string; name: string; title: string; stock: number; reserved: number
  threshold: number; unit: string; tracked: boolean
  /** Позиция каталога — по ней строка ведёт в карточку товара. */
  offeringId: string
}
type ScanHit = {
  kind: string; id: string; title: string; subtitle: string | null
  stock_qty: number; location: string | null; low_stock: boolean
  /** У варианта — карточка каталога; у засоба null (0117). */
  offering_id: string | null
}
type ContainerHit = {
  id: string; material: string; code: string; status: string
  use_by: string | null; days_left: number | null; expired: boolean
}

type Tab = 'all' | 'materials' | 'containers' | 'goods'
/** Состояние, по которому отфильтрован список. Задаётся плиткой-счётчиком. */
type Flag = 'all' | 'ok' | 'soon' | 'expired'

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
// ⚠️ ПОИСКА НА ЭТОМ ЭКРАНЕ БОЛЬШЕ НЕТ (решение владельца 19.08.2026:
// «пусть в хедере будет один единый поиск по всему... а на самих экранах
// поля поиска не будет»). Поле уехало не «обратно в шапку»: в шапке
// теперь ОДИН поиск на весь кабинет — по расходникам, каталогу, клиентам
// и заказам сразу (`components/global-search.tsx`). Своё поле искало
// только по складу, то есть требовало сначала угадать раздел. Фильтры
// состояния («Дійсні», «Закінчуються», «Прострочені») остались здесь:
// это не поиск, а вопрос «что горит» — он про этот экран и только про
// него. Не возвращать поле «заодно»: два поиска в одном продукте
// расходятся правилами в первый же месяц.
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
// ── ПРАВКА 18.08.2026 ПО ПРОТОТИПУ CRESKO ───────────────────────────────────
//
// Владелец передал кликабельный прототип: «самый близкий визуал что я хотел,
// от него плясать будем». Что он изменил в этом экране:
//
//   • СЧЁТЧИКИ БЕЗ ЗНАЧКОВ. Крупное цветное число и мелкая подпись
//     (`.metric`): четыре плитки со значками съедали треть первого экрана;
//   • «ШВИДКІ ДІЇ» — ряд цветных плиток, уезжающий вбок. Это вход
//     в операции склада, и в прототипе он стоит сразу под счётчиками;
//   • СПИСОК — ОТДЕЛЬНЫЕ КАРТОЧКИ с миниатюрой слева (`.list-card`),
//     а не одна карточка с разделителями. У строки три уровня текста
//     плюс метка состояния, и в сплошном списке они слипаются.
//
// Почему разделы уехали ВНИЗ, а не остались плитками сверху. Приёмка,
// справочники и документы — работа администратора за столом, а не мастера
// у кресла (это же записано в CLAUDE.md про офлайн: приёмка намеренно
// оставлена вне очереди). Держать их первым экраном значит отдавать
// первый экран тому, кто заходит сюда раз в неделю.
export function InventoryClient({
  tenantId, userId, containers, materials, variants, totals,
  suppliers, locations, batches, initialScan,
}: {
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
  const photoUrl = (p: string) => supabase.storage.from('media').getPublicUrl(p).data.publicUrl
  const router = useRouter()
  const toast = useToast()
  const [tab, setTab] = useState<Tab>('all')
  const [flag, setFlag] = useState<Flag>('all')
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
  // Набор счётчиков — из README: Позицій · Дійсні · Закінч. · Прострочені.
  // «Дійсні» (а не «Мало на складі», как было) закрывает ряд по одной оси —
  // СРОК ГОДНОСТИ: сколько всего, сколько в порядке, сколько на исходе,
  // сколько просрочено, и четыре числа складываются в общее. Прежний
  // «Мало» мерил другую величину — остаток, — и в ряду из четырёх читался
  // как часть той же суммы, хотя ею не был.
  const stats = useMemo(() => {
    const items = [
      ...materials.map((m) => expiryState(m.expiry)),
      ...containers.map((c) => expiryState(c.useBy)),
    ]
    return {
      total: materials.length + containers.length + variants.length,
      ok: items.filter((s) => s === 'ok').length,
      soon: items.filter((s) => s === 'soon' || s === 'urgent').length,
      expired: items.filter((s) => s === 'expired').length,
    }
  }, [materials, containers, variants])

  // Условие плитки. Собрано ОДНОЙ функцией на все три списка: развести её
  // по спискам значит завести три определения слова «прострочено».
  //
  // У ёмкости нет порога остатка, у товара нет срока — поэтому «Мало»
  // не показывает ёмкостей, а «Прострочені» не показывает товаров.
  // Это не пробел, а честный ответ: такого состояния у них не бывает.
  const passFlag = (state: ExpiryState) =>
    flag === 'all' ? true
      : flag === 'ok' ? state === 'ok'
        : flag === 'soon' ? (state === 'soon' || state === 'urgent')
          : state === 'expired'

  // ⚠️ ПРОБЛЕМНЫЕ ПОЗИЦИИ ВВЕРХ — требование README: «Проблемні позиції
  // сортуються вгору (expired → soon → ok)». Без этого просроченная банка
  // лежит там, куда её положил алфавит, и экран, который существует ради
  // ответа «що горить», прячет ответ в середину списка.
  const RANK: Record<ExpiryState, number> = {
    expired: 0, urgent: 1, soon: 2, ok: 3, none: 4,
  }
  const byProblem = <T,>(items: T[], state: (x: T) => ExpiryState) =>
    [...items].sort((a, b) => RANK[state(a)] - RANK[state(b)])

  const shownMaterials = byProblem(
    materials.filter((m) => passFlag(expiryState(m.expiry))),
    (m) => expiryState(m.expiry))
  const shownContainers = byProblem(
    containers.filter((c) => passFlag(expiryState(c.useBy))),
    (c) => expiryState(c.useBy))
  // У товара срока годности нет вовсе, поэтому он виден только без фильтра
  // состояния — «прострочених товарів» не бывает, и показывать их под этим
  // фильтром значило бы соврать о причине попадания в список.
  const shownVariants = flag === 'all' ? variants : []

  const showMaterials = tab === 'all' || tab === 'materials'
  const showContainers = tab === 'all' || tab === 'containers'
  const showGoods = tab === 'all' || tab === 'goods'

  const visible =
    (showMaterials ? shownMaterials.length : 0)
    + (showContainers ? shownContainers.length : 0)
    + (showGoods ? shownVariants.length : 0)
  const filtered = flag !== 'all'
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
    const [contRes, itemsRes] = await Promise.all([
      supabase.rpc('scan_container', { p_tenant_id: tenantId, p_code: s }),
      supabase.rpc('scan_lookup', { p_tenant_id: tenantId, p_code: s }),
    ])
    // Отказ базы — не «код не найдено». Раньше error игнорировался, и
    // пропавшая сеть или отобранное право выглядели как незнакомый код.
    if (contRes.error && itemsRes.error) {
      toast.error(t('inventory.scan.lookupError'), dbErrorText(t, contRes.error))
      return
    }
    const c = (contRes.data ?? [])[0] as ContainerHit | undefined
    const i = (itemsRes.data ?? [])[0] as ScanHit | undefined
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
      // Отказ базы — обезличенной подписью, не сырым текстом Postgres (М25).
      toast.error(t('inventory.container.saveError'), dbErrorText(t, e))
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
  // ── Вкладки — ОДИН список на обе раскладки ───────────────────────────
  // На телефоне они чипы, на lg — .wtab с чертой. Имена и порядок живут
  // здесь один раз: два списка разъехались бы на первой новой вкладке.
  const tabItems = [
    ['all', t('inventory.tab.all')],
    ['materials', t('inventory.tab.materials')],
    ['containers', `${t('inventory.tab.containers')}${containers.length ? ` · ${t.number(containers.length)}` : ''}`],
    ['goods', t('inventory.tab.goods')],
  ] as const

  // Колонки таблицы CRESKO Web (экран «Склад»): единственное место,
  // где размеры задаются строкой, — так велит .wtable (грид задаёт экран).
  const WGRID = '2.4fr 1.2fr .7fr .5fr 1.1fr 1fr 40px'

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

      {/* ── CRESKO Web: хедер экрана (только lg) ─────────────────
          Слева имя экрана тем же ключом, что и вкладка браузера;
          справа «Приймання» — ЕДИНСТВЕННАЯ синяя кнопка кабинета
          (README: btn-blue живёт только тут и в модалке приймання).
          `?new=1` открывает форму нового документа сразу — тем же
          приёмом, каким `?scan=1` открывает камеру здесь. */}
      <div className="hidden items-center justify-between lg:flex">
        <h1 className="webh1">{t('app.screen.inventory.title')}</h1>
        <Link href="/app/inventory/receipts?new=1" className="btn-blue">
          {t('app.screen.inventory.receipts.title')}
        </Link>
      </div>

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
                  {/* Скан обязан вести к действию, а не быть справкой:
                      засіб — на карточку, товар — в каталог (0117 даёт
                      offering_id). Тупик «прочитал и закрой» владелец
                      прочитал как «сканер не работает». */}
                  <Link className="btn-secondary mt-2 inline-flex"
                        href={scan.item.kind === 'material'
                          ? `/app/inventory/materials/${scan.item.id}`
                          : `/app/catalog/${scan.item.offering_id ?? ''}`}>
                    {t('inventory.scan.item.open')}
                  </Link>
                </>
              )}
              {scan.miss && (
                <>
                  <p className="field-error">{t('inventory.scan.notFound', { code: scan.miss })}</p>
                  {/* Незнакомый заводской штрихкод — это чаще всего ещё
                      не привязанный код засоба. Выход — экран привязки
                      с уже подставленным кодом, а не тупик. */}
                  <Link className="btn-secondary mt-2 inline-flex"
                        href={`/app/inventory/barcodes?code=${encodeURIComponent(scan.miss)}`}>
                    {t('inventory.scan.bind')}
                  </Link>
                </>
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

      {/* ── Вкладки ──────────────────────────────────────────────
          Одной строкой с горизонтальной прокруткой. Перенос на вторую
          строку смешивал бы их с тем, что стоит рядом, — ровно так
          «+ Засіб» оказывался под «Товари» и читался как фильтр. */}
      <div className="scroll-x rise-1 -mx-4 flex gap-2 px-4 pb-1 lg:hidden sm:mx-0 sm:px-0">
        {tabItems.map(([key, label]) => (
          <button key={key} onClick={() => switchTab(key)}
                  className={`${tab === key ? 'chip-active' : 'chip'} shrink-0`}>
            {label}
          </button>
        ))}
      </div>

      {/* ── CRESKO Web: метрики (только lg) ──────────────────────
          Те же четыре числа и тот же клик-фильтр, что у мобильного
          ряда ниже, — но в виде .wmetric с иконкой-плашкой (README).
          Подписи длинные: на вебе плитке есть где дышать, и «Закінч.»
          выглядело бы обрезком. Активный фильтр — рамка акцентом:
          у .wmetric нет своего активного состояния, а заливать плитку
          кобальтом значит спорить с единственной синей кнопкой выше. */}
      <section className="hidden gap-4 rise-1 lg:grid lg:grid-cols-4">
        {([
          { key: 'all', n: stats.total, label: t('inventory.stats.total'), tone: 'blue', icon: IconLayers },
          { key: 'ok', n: stats.ok, label: t('inventory.stats.ok'), tone: 'emerald', icon: IconCheck },
          { key: 'soon', n: stats.soon, label: t('inventory.stats.soon'), tone: 'amber', icon: IconClock },
          { key: 'expired', n: stats.expired, label: t('inventory.stats.expired'), tone: 'rose', icon: IconAlert },
        ] as const).map((s) => {
          const on = flag === s.key
          const dead = s.key !== 'all' && s.n === 0
          return (
            <button key={s.key} type="button" disabled={dead} aria-pressed={on}
                    onClick={() => setFlag(on ? 'all' : s.key)}
                    className="wmetric text-left"
                    style={{
                      cursor: dead ? 'default' : 'pointer',
                      borderColor: on ? 'var(--color-accent)' : undefined,
                    }}>
              <span className="min-w-0">
                <span className="wmetric-label block">{s.label}</span>
                <span className="wmetric-value tabular block">{t.number(s.n)}</span>
              </span>
              <span className="wmetric-icon" data-tone={s.tone}><s.icon size={19} /></span>
            </button>
          )
        })}
      </section>

      {/* ── CRESKO Web: вкладки чертой (только lg) ───────────────
          Тот же tabItems и тот же switchTab, что и у чипов, —
          отличается только вид. */}
      <div className="wtabs hidden lg:flex">
        {tabItems.map(([key, label]) => (
          <button key={key} type="button" onClick={() => switchTab(key)}
                  className="wtab" data-active={tab === key}>
            {label}
          </button>
        ))}
      </div>

      {/* ── Счётчики, они же фильтр ──────────────────────────────
          По прототипу: крупное ЦВЕТНОЕ число и мелкая подпись, без
          значка. Четыре плитки со значками съедали треть первого
          экрана, а число и так читается мгновенно.

          Тон несёт смысл и не выбирается «для красоты»: rose — то,
          что уже сломано, amber — то, что сломается, emerald — норма.
          Тон постоянный, а не «серый, пока ноль»: плитка, меняющая
          цвет вместе с числом, заставляет читать её дважды.

          Нажатие переключает фильтр, повторное — снимает. Плитка
          с нулём не нажимается: фильтр, дающий пустой список, —
          это обещание показать то, чего нет. */}
      <section className="rise-1 grid grid-cols-4 gap-2 lg:hidden">
        {([
          // Подписи КОРОТКИЕ и своими ключами. Четыре плитки в ряд на 390px
          // дают около 86px на плитку, и «Мало на складі» переносится на две
          // строки — плитка становится выше соседних, и ровный ряд ломается
          // об одну подпись. Длинные названия остаются там, где место есть:
          // на снимаемой метке фильтра под счётчиками.
          { key: 'all', n: stats.total, label: t('inventory.stats.short.total'), tone: 'blue' },
          { key: 'ok', n: stats.ok, label: t('inventory.stats.short.ok'), tone: 'emerald' },
          { key: 'soon', n: stats.soon, label: t('inventory.stats.short.soon'), tone: 'amber' },
          { key: 'expired', n: stats.expired, label: t('inventory.stats.short.expired'), tone: 'rose' },
        ] as const).map((s) => {
          const on = flag === s.key
          const dead = s.key !== 'all' && s.n === 0
          return (
            <button key={s.key} type="button" disabled={dead} aria-pressed={on}
                    data-tone={s.tone}
                    onClick={() => setFlag(on ? 'all' : s.key)}
                    className="metric"
                    style={{ cursor: dead ? 'default' : 'pointer' }}>
              <span className="metric-value">{t.number(s.n)}</span>
              <span className="metric-label">{s.label}</span>
            </button>
          )
        })}
      </section>

      {/* ── Швидкі дії ───────────────────────────────────────────
          README: ЧЕТЫРЕ В РЯД, иконка-плашка 32px + подпись 10px.
          Была уезжающая вбок лента — на 375px четвёртая плитка
          оставалась за краем, и «Інвентаризація» существовала только
          для того, кто догадался потянуть ряд пальцем.

          Тона по README: Надходження — success, Списання — warning
          (приход и расход разного знака), остальные нейтральные. */}
      {/* На lg «Швидкі дії» скрыты: приймання уже в хедере экрана,
          сканер — в шапке кабинета, а место этого блока в хендоффе
          занимает правая рейка (отдельная работа). Дубли действий
          на десктопе — тот же грех, за который переделывался телефон. */}
      <section className="rise-2 lg:hidden">
        <p className="eyebrow mb-2">{t('inventory.quick.title')}</p>
        <div className="quick-row">
          <button type="button" className="quick-tile" onClick={() => setCamera(true)}>
            <span className="quick-tile-icon" data-tone="blue"><IconScan size={18} /></span>
            {t('inventory.quick.scan')}
          </button>
          <Link href="/app/inventory/receipts" className="quick-tile">
            <span className="quick-tile-icon" data-tone="emerald"><IconInbox size={18} /></span>
            {t('inventory.quick.receipts')}
          </Link>
          <Link href="/app/inventory/movements" className="quick-tile">
            <span className="quick-tile-icon" data-tone="amber"><IconArrows size={18} /></span>
            {t('inventory.quick.movements')}
          </Link>
          <Link href="/app/inventory/counts" className="quick-tile">
            <span className="quick-tile-icon" data-tone="violet"><IconClipboard size={18} /></span>
            {t('inventory.quick.counts')}
          </Link>
        </div>
      </section>

      {/* ── Что сейчас отфильтровано ─────────────────────────────
          Без этой метки укороченный список выглядит как пропавшие
          данные: человек выбрал «Прострочені» три экрана назад и уже
          не помнит об этом. Крестик снимает фильтр здесь же.

          Строки поиска среди этих меток больше нет: поиск стал общим
          и живёт в шапке, а фильтр состояния — свойство этого экрана. */}
      {filtered && (
        <div className="rise-2 flex flex-wrap items-center gap-2">
          {/* Стиль НЕ `chip-active`, хотя напрашивался. Сплошной кобальт
              здесь уже занят выбранной вкладкой, и две одинаковые синие
              пилюли в двух строках подряд означали бы разное: «я на этой
              вкладке» и «наложен фильтр, нажми чтобы снять». Поэтому
              снимаемый фильтр — обводка и акцентный ТЕКСТ, а не заливка
              (`--color-accent-ink` против `--color-accent`, см. CLAUDE.md
              про два токена акцента). */}
          <button type="button" className="chip" onClick={() => setFlag('all')}
                  style={{ borderColor: 'var(--color-accent)', color: 'var(--color-accent-ink)' }}>
            {t(flag === 'ok' ? 'inventory.stats.ok'
              : flag === 'soon' ? 'inventory.stats.soon'
                : 'inventory.stats.expired')}
            <IconClose size={14} className="ml-1.5" />
          </button>
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
              {emptyTenant ? t('inventory.empty.title') : t('inventory.empty.filteredTitle')}
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
                        onClick={() => setFlag('all')}>
                  {t('inventory.filter.reset')}
                </button>
              )}
            </div>
          </div>
        </section>
      ) : (
        <>
        {/* Мобильный список карточек — как был; на lg вместо него таблица
            ниже. Обёртка повторяет gap родителя, чтобы зазоры секций
            не изменились ни на пиксель. */}
        <div className="flex flex-col gap-5 lg:hidden">
          {/* ── Расходники ──────────────────────────────────────── */}
          {showMaterials && shownMaterials.length > 0 && (
            <section className="rise">
              {/* Надзаголовок только на вкладке «Всі»: на своей вкладке
                  он повторял бы её же имя двумя строками ниже. */}
              {tab === 'all' && <p className="eyebrow mb-2">{t('inventory.tab.materials')}</p>}
              {/* Карточки с зазором, а не одна карточка с разделителями:
                  у строки миниатюра, два уровня текста и метка состояния —
                  в сплошном списке они слипаются (прототип, `.list-card`). */}
              <div className="flex flex-col gap-2">
                {shownMaterials.map((mt) => {
                  const state = expiryState(mt.expiry)
                  const low = mt.threshold > 0 && mt.stock <= mt.threshold
                  return (
                    <Link key={mt.id} href={`/app/inventory/materials/${mt.id}`}
                          className="list-card">
                      {/* Фото засоба (0111). Нет фото — значок, а не серый
                          прямоугольник: пустая рамка читается как «картинка
                          не загрузилась», то есть как поломка. */}
                      <span className="list-card-thumb">
                        {mt.imagePath
                          // eslint-disable-next-line @next/next/no-img-element
                          ? <img src={photoUrl(mt.imagePath)} alt=""
                                 style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                          : <IconBox size={22} />}
                      </span>
                      <span className="min-w-0 flex-1">
                        {/* Название, бренд и номер партии — данные арендатора. */}
                        <span className="t-md clamp-2 block">{mt.name}</span>
                        <span className="t-xs mt-0.5 block truncate" style={{ color: 'var(--color-faint)' }}>
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
                          <span className={`mt-1.5 inline-block ${EXPIRY_BADGE[state]}`}>
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
              <div className="flex flex-col gap-2">
                {shownContainers.map((c) => {
                  const state = expiryState(c.useBy)
                  return (
                    <div key={c.id} className="list-card">
                      {/* Ёмкость — это банка с QR-наклейкой, поэтому QR
                          в миниатюре: он же нарисован на самой банке. */}
                      <span className="list-card-thumb"><IconQr size={22} /></span>
                      <Link href={`/app/inventory/materials/${c.materialId}/pao`}
                            className="min-w-0 flex-1">
                        <span className="t-md block truncate">{c.material}
                          <span style={{ color: 'var(--color-faint)' }}> · {c.code}</span></span>
                        <span className="tabular t-xs mt-0.5 block" style={{ color: 'var(--color-faint)' }}>
                          {c.status === 'sealed'
                            ? t('inventory.container.sealed')
                            : t('inventory.container.openedAt', { date: short(c.openedAt) })}
                          {c.volume ? ` · ${t.number(c.volume)} ${c.unit ?? ''}` : ''}
                        </span>
                        {c.useBy && (
                          <span className={`tabular mt-1.5 inline-block ${EXPIRY_BADGE[state]}`}>
                            {t('inventory.container.until', { date: short(c.useBy) })}
                          </span>
                        )}
                      </Link>
                      {c.status === 'sealed' && (
                        <button className="btn-secondary t-sm shrink-0" disabled={busy === c.id}
                                onClick={() => void openContainer(c.id, c.code)}>
                          {t('inventory.container.openShort')}
                        </button>
                      )}
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
              <div className="flex flex-col gap-2">
                {/* Строка товара ВЕДЁТ в карточку каталога. До 19.08.2026
                    товар был единственным элементом склада без входа:
                    выглядел как расходник и ёмкость, но не открывался.
                    Элемент, который выглядит нажимаемым и не нажимается,
                    человек читает как поломку, а не как «сюда нельзя». */}
                {shownVariants.map((v) => (
                  <Link key={v.id} href={`/app/catalog/${v.offeringId}`} className="list-card">
                    <span className="list-card-thumb"><IconBag size={22} /></span>
                    <div className="min-w-0 flex-1">
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
                  </Link>
                ))}
              </div>
            </section>
          )}
        </div>

        {/* ── CRESKO Web: таблица склада (только lg) ─────────────
            То же отфильтрованное множество, что и карточки выше:
            shownMaterials / shownContainers / shownVariants плюс те же
            show*-флаги вкладок — второй логики фильтрации здесь нет,
            поэтому пустая таблица возможна только там, где пуст
            и мобильный список (а это состояние перехватывает ternary).

            Колонки хендоффа «Категорія» и «Місце» здесь заменены:
            категории и места зберігання в пропсах списка НЕТ (их не
            выбирает страница), а колонка из одних прочерков — мёртвый
            вес. Вместо них — вид записи (полезен на вкладке «Всі»)
            и термін придатності: обе колонки живут на реальных данных. */}
        <section className="hidden rise lg:block">
          <div className="wtable">
            <div className="wtable-head" style={{ gridTemplateColumns: WGRID }}>
              <span>{t('inventory.web.table.item')}</span>
              <span>{t('inventory.web.table.kind')}</span>
              <span>{t('inventory.web.table.stock')}</span>
              <span>{t('inventory.material.row.unit')}</span>
              <span>{t('inventory.web.table.expiry')}</span>
              <span>{t('inventory.material.row.status')}</span>
              <span aria-hidden />
            </div>

            {/* Расходники. Залишок краснеет просроченным и желтеет на
                исходе срока или ниже порога — тем же условием, каким
                мобильная карточка выбирает badge-warn. */}
            {showMaterials && shownMaterials.map((mt) => {
              const state = expiryState(mt.expiry)
              const low = mt.threshold > 0 && mt.stock <= mt.threshold
              return (
                <Link key={`m-${mt.id}`} href={`/app/inventory/materials/${mt.id}`}
                      className="wtable-row" style={{ gridTemplateColumns: WGRID }}>
                  <span className="min-w-0">
                    {/* Название и бренд — данные арендатора. */}
                    <span className="block truncate font-semibold" style={{ color: 'var(--color-text)' }}>
                      {mt.name}
                    </span>
                    {(mt.brand || mt.sku) && (
                      <span className="block truncate" style={{ color: 'var(--color-faint)' }}>
                        {[mt.brand, mt.sku].filter(Boolean).join(' · ')}
                      </span>
                    )}
                  </span>
                  <span>{t('inventory.web.kind.material')}</span>
                  <span className="tabular"
                        style={state === 'expired'
                          ? { color: 'var(--color-danger)' }
                          : (low || state === 'soon' || state === 'urgent')
                            ? { color: 'var(--tone-amber)' }
                            : undefined}>
                    {t.number(mt.stock)}
                  </span>
                  <span>{mt.unit}</span>
                  <span className="tabular">{mt.expiry ? short(mt.expiry) : '—'}</span>
                  <span>
                    {state !== 'none'
                      ? <span className={EXPIRY_BADGE[state]}>{t(EXPIRY_KEY[state])}</span>
                      : '—'}
                  </span>
                  <span aria-hidden className="text-right" style={{ color: 'var(--color-faint)' }}>›</span>
                </Link>
              )
            })}

            {/* Ёмкости — тем же гридом: залишок = обʼєм, термін = use_by.
                Строка ведёт туда же, куда мобильная карточка, — в контроль
                вскрытия засоба. */}
            {showContainers && shownContainers.map((c) => {
              const state = expiryState(c.useBy)
              return (
                <Link key={`c-${c.id}`} href={`/app/inventory/materials/${c.materialId}/pao`}
                      className="wtable-row" style={{ gridTemplateColumns: WGRID }}>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold" style={{ color: 'var(--color-text)' }}>
                      {c.material}
                    </span>
                    <span className="block truncate" style={{ color: 'var(--color-faint)' }}>
                      {c.code}
                      {c.openedAt ? ` · ${t('inventory.container.openedAt', { date: short(c.openedAt) })}` : ''}
                    </span>
                  </span>
                  <span>{t('inventory.web.kind.container')}</span>
                  <span className="tabular"
                        style={state === 'expired' ? { color: 'var(--color-danger)' } : undefined}>
                    {c.volume != null ? t.number(c.volume) : '—'}
                  </span>
                  <span>{c.unit ?? '—'}</span>
                  <span className="tabular">{c.useBy ? short(c.useBy) : '—'}</span>
                  <span>
                    {c.useBy
                      ? <span className={EXPIRY_BADGE[state]}>{t(EXPIRY_KEY[state])}</span>
                      : c.status === 'sealed'
                        ? <span className="badge">{t('inventory.container.sealed')}</span>
                        : '—'}
                  </span>
                  <span aria-hidden className="text-right" style={{ color: 'var(--color-faint)' }}>›</span>
                </Link>
              )
            })}

            {/* Товары. Срока годности у них нет — в колонке термін честный
                прочерк, статус говорит только про остаток. */}
            {showGoods && shownVariants.map((v) => {
              const low = v.tracked && v.threshold > 0 && v.stock <= v.threshold
              return (
                <Link key={`v-${v.id}`} href={`/app/catalog/${v.offeringId}`}
                      className="wtable-row" style={{ gridTemplateColumns: WGRID }}>
                  <span className="min-w-0">
                    <span className="block truncate font-semibold" style={{ color: 'var(--color-text)' }}>
                      {v.title}
                    </span>
                    <span className="block truncate" style={{ color: 'var(--color-faint)' }}>
                      {v.name}
                      {v.reserved > 0 ? ` · ${t('inventory.goods.reserved', { n: t.number(v.reserved) })}` : ''}
                    </span>
                  </span>
                  <span>{t('inventory.web.kind.good')}</span>
                  <span className="tabular"
                        style={low ? { color: 'var(--tone-amber)' } : undefined}>
                    {v.tracked ? t.number(v.stock) : '—'}
                  </span>
                  <span>{v.unit}</span>
                  <span>—</span>
                  <span>
                    {!v.tracked
                      ? <span className="badge">{t('inventory.goods.untracked')}</span>
                      : low
                        ? <span className="badge-warn">{t('inventory.stats.short.low')}</span>
                        : '—'}
                  </span>
                  <span aria-hidden className="text-right" style={{ color: 'var(--color-faint)' }}>›</span>
                </Link>
              )
            })}

            <div className="wtable-foot">
              <span className="tabular">{t('inventory.web.table.total', { n: t.number(visible) })}</span>
              {/* Денежные итоги — только на вкладке товаров, как и мобильные
                  плитки: посреди смешанного списка они перебивали бы метрики. */}
              {tab === 'goods' && totals && totals.units > 0 && (
                <span className="tabular">
                  {t('inventory.goods.cost')}: {t.money(totals.cost)}
                  {' · '}
                  {t('inventory.goods.retail')}: {t.money(totals.retail)}
                </span>
              )}
            </div>
          </div>
        </section>
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
