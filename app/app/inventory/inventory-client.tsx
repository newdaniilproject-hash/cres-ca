'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { MaterialForm, type RefItem } from './material-form'
import { ContainerForm, type BatchOption } from './container-form'
import { RefsForm } from './refs-form'
import { Sheet } from '@/components/sheet'
import { PageActions } from '@/components/shell'
import { enqueue, isNetworkError } from '@/lib/offline/queue'
import { useToast } from '@/components/toast'
import { useT } from '@/lib/i18n/client'
import type { Key } from '@/lib/i18n/dict'
import { EXPIRY_BADGE, type ExpiryState, expiryState } from '@/lib/expiry'
import { Scanner } from '@/components/scanner'
import {
  IconAlert, IconBox, IconChart, IconCheck, IconClock, IconDoc, IconExport,
  IconMoney, IconPlus, IconScan,
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
  category: string | null; cost: number | null; location: string | null
}
type Move = { id: string; kind: string; at: string }
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

// Экран склада — экран 1 макета.
//
// Порядок блоков не декоративный: сверху счётчики («что горит»), под ними
// быстрые действия, ниже поиск и список. Мастер приходит сюда с двумя
// вопросами — «что просрочено» и «где эта банка», и оба обязаны решаться
// без прокрутки.
export function InventoryClient({
  tenantId, userId, containers, materials, variants, totals, moves,
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
  /** Последние движения — в правый рельс. */
  moves: Move[]
  suppliers: RefItem[]
  locations: RefItem[]
  batches: BatchOption[]
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const toast = useToast()
  const [tab, setTab] = useState<'all' | 'containers' | 'materials' | 'goods'>('all')
  const [query, setQuery] = useState(initialQuery)
  // Формы раскрываются шторкой снизу, а не блоком на странице: на телефоне
  // раздвигающийся блок уводит список вниз, и мастер теряет место, где был.
  const [adding, setAdding] = useState<'material' | 'container' | 'refs' | null>(null)
  const [code, setCode] = useState('')
  const [scan, setScan] = useState<{ item?: ScanHit; container?: ContainerHit; miss?: string } | null>(null)
  const [scanOpen, setScanOpen] = useState(initialScan)
  const [busy, setBusy] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  // ── Счётчики. Считаются по тем же порогам, что и рассылка, ──
  // иначе экран и письмо разойдутся: тут зелено, а письмо уже пришло.
  //
  // Состав плиток задан макетом: количество, стоимость, низкий остаток,
  // просрочено. «Закінчуються» отсюда убраны не по забывчивости — они
  // живут блоком «Спливає термін» на «Сьогодні», а здесь их место заняла
  // стоимость, которой на складе не было видно нигде.
  const stats = useMemo(() => {
    const items = [
      ...materials.map((m) => expiryState(m.expiry)),
      ...containers.map((c) => expiryState(c.useBy)),
    ]
    // Единицы и стоимость считаются по расходникам И товарам сразу:
    // `stock_value_view` знает только товары, и плитка, собранная
    // из неё одной, показала бы салону, торгующему услугами, ноль
    // при полном складе косметики.
    const matUnits = materials.reduce((a, m) => a + m.stock, 0)
    const matCost = materials.reduce((a, m) => a + m.stock * (m.cost ?? 0), 0)
    return {
      total: materials.length + containers.length + variants.length,
      units: matUnits + (totals?.units ?? 0),
      value: matCost + (totals?.cost ?? 0),
      soon: items.filter((s) => s === 'soon' || s === 'urgent').length,
      expired: items.filter((s) => s === 'expired').length,
      low: materials.filter((m) => m.threshold > 0 && m.stock <= m.threshold).length
        + variants.filter((v) => v.tracked && v.threshold > 0 && v.stock <= v.threshold).length,
    }
  }, [materials, containers, variants, totals])

  // ── Топ категорий по стоимости — в правый рельс ──────────────
  // Доля считается от самой большой категории, а не от суммы: полоса
  // отвечает на «что дороже всего», и при пяти категориях доли от суммы
  // дали бы пять коротких огрызков.
  const topCategories = useMemo(() => {
    const byCat = new Map<string, number>()
    for (const mt of materials) {
      if (!mt.cost) continue
      const key = mt.category ?? ''
      if (!key) continue
      byCat.set(key, (byCat.get(key) ?? 0) + mt.stock * mt.cost)
    }
    const rows = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 4)
    const max = rows[0]?.[1] ?? 1
    const tones = ['blue', 'violet', 'emerald', 'amber'] as const
    return rows.map(([name, value], i) => ({
      name, value, share: Math.round((value / max) * 100), tone: tones[i],
    }))
  }, [materials])

  // Состояние остатка одной строкой: его читают и таблица, и плашка
  // в карточке. Пороговое значение — то же `min_stock_threshold`,
  // по которому уходит письмо «пора замовити».
  const stockState = (stock: number, threshold: number) =>
    stock <= 0 ? 'out'
    : threshold > 0 && stock <= threshold / 2 ? 'critical'
    : threshold > 0 && stock <= threshold ? 'low'
    : 'ok'
  const STOCK_BADGE: Record<string, string> = {
    out: 'badge-danger', critical: 'badge-danger', low: 'badge-warn', ok: 'badge-success',
  }

  const q = query.trim().toLowerCase()
  const match = (...fields: (string | null)[]) =>
    !q || fields.some((f) => f && f.toLowerCase().includes(q))

  const shownMaterials = materials.filter((m) => match(m.name, m.brand, m.sku, m.batch))
  const shownContainers = containers.filter((c) => match(c.code, c.material))
  const shownVariants = variants.filter((v) => match(v.title, v.name))

  // Короткая дата для плотных списков: «20 трав.». Через `t.date`,
  // а не своей сборкой — месяц называется на языке интерфейса.
  const short = (v: string | null | undefined) =>
    t.date(v, { day: 'numeric', month: 'short' })

  async function lookup(raw: string) {
    const s = raw.trim()
    if (!s) return
    setCode('')
    inputRef.current?.focus()
    const [{ data: cont }, { data: items }] = await Promise.all([
      supabase.rpc('scan_container', { p_tenant_id: tenantId, p_code: s }),
      supabase.rpc('scan_lookup', { p_tenant_id: tenantId, p_code: s }),
    ])
    const c = (cont ?? [])[0] as ContainerHit | undefined
    const i = (items ?? [])[0] as ScanHit | undefined
    setScan(c ? { container: c } : i ? { item: i } : { miss: s })
  }

  // Сканер живёт в общем компоненте (`components/scanner.tsx`).
  // Здесь была своя копия на `BarcodeDetector` + `ImageCapture` — обеих
  // возможностей нет в Safari, поэтому на iPhone сканер не работал вовсе,
  // а превью камеры не показывалось ни на одной платформе.
  const [camera, setCamera] = useState(false)

  // ── `?scan=1` ОТКРЫВАЕТ КАМЕРУ, а не режим ручного ввода ──────────────
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
    setScanOpen(true)
    setCamera(true)
    window.history.replaceState(null, '', '/app/inventory')
  }, [sp])


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

  function switchTab(next: 'all' | 'containers' | 'materials' | 'goods') {
    setTab(next)
    setAdding(null)
  }

  const showMaterials = tab === 'all' || tab === 'materials'
  const showContainers = tab === 'all' || tab === 'containers'
  const showGoods = tab === 'all' || tab === 'goods'

  return (
    <>
    {/* Действия экрана — в строку заголовка порталом (см. `PageActions`). */}
    <PageActions>
      <a href="/app/journals/report" target="_blank" rel="noreferrer" className="btn-secondary t-sm">
        <IconExport size={17} /> {t('inventory.rail.report')}
      </a>
      <Link href="/app/inventory/receipts" className="btn-primary t-sm">
        <IconPlus size={17} /> {t('inventory.tab.receipts')}
      </Link>
    </PageActions>

    <div className="flex flex-col gap-5">

      {/* ── Вкладки раздела ──────────────────────────────────────
          В макете это ряд вкладок, но за каждой стоит СВОЙ АДРЕС:
          «Приймання», «Рухи», «Інвентаризації» — отдельные экраны,
          которые обязаны открываться в новой вкладке и ложиться
          в историю. Поэтому ссылки, а не переключатель состояния. */}
      <nav className="tabs rise">
        {([
          ['/app/inventory', 'inventory.tab.overview'],
          ['/app/inventory/receipts', 'inventory.tab.receipts'],
          ['/app/inventory/movements', 'inventory.tab.movements'],
          ['/app/inventory/counts', 'inventory.tab.counts'],
          ['/app/inventory/reorder', 'inventory.tab.reorder'],
          ['/app/inventory/recipes', 'inventory.tab.recipes'],
          ['/app/inventory/barcodes', 'inventory.tab.barcodes'],
        ] as [string, Key][]).map(([href, label]) => (
          <Link key={href} href={href} className="tab" data-active={href === '/app/inventory'}>
            {t(label)}
          </Link>
        ))}
      </nav>

      {/* ── Счётчики ─────────────────────────────────────────────
          Плитки по макету: значок в цветном квадрате, число, подпись,
          пояснение. Тон несёт смысл и не выбирается «для красоты»
          (globals.css, `.stat-tile`): rose — то, что уже сломано,
          amber — то, что сломается, emerald — норма.

          Тон постоянный, а не «серый, пока ноль». Плитка, меняющая
          цвет вместе с числом, заставляет читать её дважды: сначала
          «какого она цвета сегодня», потом само число. Спокойное
          состояние показывает НОЛЬ, а не отсутствие цвета. */}
      <section className="rise-1 grid grid-cols-2 gap-2 xl:grid-cols-4">
        {([
          { v: t.number(stats.units), label: 'inventory.tile.units', note: 'inventory.tile.units.note', tone: 'blue', icon: IconBox },
          { v: t.money(stats.value), label: 'inventory.tile.value', note: 'inventory.tile.value.note', tone: 'emerald', icon: IconMoney },
          { v: t.number(stats.low), label: 'inventory.tile.low', note: 'inventory.tile.low.note', tone: 'amber', icon: IconAlert },
          { v: t.number(stats.expired), label: 'inventory.tile.expired', note: 'inventory.tile.expired.note', tone: 'rose', icon: IconClock },
        ] as { v: string; label: Key; note: Key; tone: string; icon: (p: { size?: number }) => React.ReactElement }[])
          .map((s) => (
          <div key={s.label} className="stat-tile">
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="stat-tile-label">{t(s.label)}</p>
                <p className="stat-tile-value truncate">{s.v}</p>
              </div>
              <span className="stat-tile-icon shrink-0" data-tone={s.tone} aria-hidden>
                <s.icon size={17} />
              </span>
            </div>
            <p className="t-xs" style={{ color: 'var(--color-faint)' }}>{t(s.note)}</p>
          </div>
        ))}
      </section>

      {/* ── Сканер и поиск ───────────────────────────────────── */}
      <section className="card rise-2">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            className="input"
            placeholder={t('inventory.search.placeholder')}
            value={scanOpen ? code : query}
            onChange={(e) => (scanOpen ? setCode(e.target.value) : setQuery(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && scanOpen) { e.preventDefault(); void lookup(code) }
            }}
            autoComplete="off"
            inputMode="text"
          />
          {/* Кнопка камеры стоит в ОБОИХ режимах и всегда на одном месте.
              Пока она пряталась в режиме ввода кода, попасть в камеру
              из режима сканирования было нельзя вовсе. */}
          <button type="button" onClick={() => { setScanOpen(true); setCamera(true) }}
                  className="btn-primary shrink-0"
                  title={t('inventory.scan.camera.aria')} aria-label={t('inventory.scan.camera.aria')}>
            ⌗
          </button>
        </div>

        {scanOpen && (
          // Ручной ввод — запасной путь, а не основной: он нужен, когда
          // наклейка стёрта или камеры нет. Поэтому второй строкой и мельче.
          <div className="mt-2 flex flex-wrap gap-2">
            <button type="button" onClick={() => void lookup(code)} className="btn-secondary shrink-0">
              {t('inventory.search.find')}
            </button>
            <button type="button" onClick={() => { setScanOpen(false); setScan(null); setCode('') }}
                    className="btn-ghost shrink-0">{t('inventory.search.mode')}</button>
          </div>
        )}

        {scan?.container && (
          <div className="card-flat mt-3 flex flex-wrap items-center justify-between gap-3 rise">
            <div>
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
            </div>
            <div className="flex gap-2">
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
          </div>
        )}
        {scan?.item && (
          <div className="card-flat mt-3 rise">
            <p className="t-md">{scan.item.title}
              {scan.item.subtitle ? <span className="prose-muted"> · {scan.item.subtitle}</span> : null}</p>
            <p className="tabular t-md mt-0.5 prose-muted">
              {t('inventory.scan.item.stock', { n: t.number(Number(scan.item.stock_qty)) })}
              {scan.item.location ? ` · ${scan.item.location}` : ''}
              {scan.item.low_stock ? ` · ${t('inventory.scan.item.low')}` : ''}
            </p>
          </div>
        )}
        {scan?.miss && (
          <p className="field-error mt-3">{t('inventory.scan.notFound', { code: scan.miss })}</p>
        )}
      </section>

      {/* ── Вкладки ──────────────────────────────────────────── */}
      <div className="rise-2 flex flex-wrap items-center gap-2">
        {([
          ['all', t('inventory.tab.all')],
          ['materials', t('inventory.tab.materials')],
          ['containers', `${t('inventory.tab.containers')}${containers.length ? ` · ${t.number(containers.length)}` : ''}`],
          ['goods', t('inventory.tab.goods')],
        ] as const).map(([key, label]) => (
          <button key={key} onClick={() => switchTab(key)}
                  className={tab === key ? 'chip-active' : 'chip'}>
            {label}
          </button>
        ))}

        <div className="ml-auto flex gap-2">
          {(tab === 'all' || tab === 'materials') && (
            <>
              <button type="button" className="btn-secondary t-sm"
                      onClick={() => setAdding(adding === 'refs' ? null : 'refs')}>
                {t('inventory.action.refs')}
              </button>
              <button type="button" className="btn-primary t-sm"
                      onClick={() => setAdding(adding === 'material' ? null : 'material')}>
                {t('inventory.action.addMaterial')}
              </button>
            </>
          )}
          {tab === 'containers' && (
            <>
              {containers.length > 0 && (
                <a href="/app/inventory/labels" target="_blank" rel="noreferrer"
                   className="btn-secondary t-sm">
                  {t('inventory.action.printLabels')}
                </a>
              )}
              <button type="button" className="btn-primary t-sm"
                      onClick={() => setAdding(adding === 'container' ? null : 'container')}>
                {t('inventory.action.addContainer')}
              </button>
            </>
          )}
          {/* Товар заводится в каталоге вместе с ценой и фото — второй
              формы для того же самого на складе быть не должно. */}
          {tab === 'goods' && (
            <a href="/app/catalog" className="btn-secondary t-sm">
              {t('inventory.action.addInCatalog')}
            </a>
          )}
        </div>
      </div>

      {/* ── Расходники: таблица на столе ──────────────────────────
          Разметки две — таблица и карточки, — но ДАННЫЕ одни:
          обе рисуются из `shownMaterials` и обе зовут `expiryState`
          и `stockState`. Разъехаться может только оформление, и это
          видно глазами; расходятся обычно расчёты, а их копии здесь нет.

          Почему не одна разметка на оба размера: таблица на 390px
          либо режется, либо превращается в семь строк на позицию,
          и мастер со сканером в руке листает её вдвое дольше. */}
      {showMaterials && shownMaterials.length > 0 && (
        <div className="tablewrap rise hidden lg:block">
          <table className="table">
            <thead>
              <tr>
                <th>{t('inventory.col.item')}</th>
                <th>{t('inventory.col.category')}</th>
                <th className="num-col">{t('inventory.col.stock')}</th>
                <th>{t('inventory.col.unit')}</th>
                {/* Место хранения прячется до 1536px: восемь колонок туда
                    не влезают, а из восьми оно самое необязательное —
                    у большинства заведений склад один. Прокрутка вбок
                    остаётся, но лезть в неё за «Статусом» больше не надо. */}
                <th className="hidden 2xl:table-cell">{t('inventory.col.place')}</th>
                <th className="num-col">{t('inventory.col.cost')}</th>
                <th className="num-col">{t('inventory.col.sum')}</th>
                <th>{t('inventory.col.status')}</th>
              </tr>
            </thead>
            <tbody>
              {shownMaterials.map((mt) => {
                const state = stockState(mt.stock, mt.threshold)
                const exp = expiryState(mt.expiry)
                return (
                  <tr key={mt.id}>
                    <td>
                      <Link href={`/app/inventory/materials/${mt.id}`} className="flex items-center gap-3">
                        <span className="cell-thumb" aria-hidden><IconBox size={16} /></span>
                        <span className="min-w-0">
                          {/* Название, бренд и объём — данные арендатора. */}
                          <span className="block truncate" style={{ fontWeight: 600 }}>{mt.name}</span>
                          <span className="block truncate t-xs" style={{ color: 'var(--color-faint)' }}>
                            {[mt.brand, mt.sku].filter(Boolean).join(' · ')}
                          </span>
                          {mt.expiry && exp !== 'ok' && (
                            <span className={`mt-1 inline-block ${EXPIRY_BADGE[exp]}`}>
                              {t(EXPIRY_KEY[exp])}
                            </span>
                          )}
                        </span>
                      </Link>
                    </td>
                    <td>{mt.category ? <span className="badge-accent">{mt.category}</span> : '—'}</td>
                    <td className="num-col" style={{
                      color: state === 'ok' ? 'var(--color-text)' : 'var(--color-danger)',
                      fontWeight: 600,
                    }}>{t.number(mt.stock)}</td>
                    <td style={{ color: 'var(--color-muted)' }}>{mt.unit}</td>
                    <td className="hidden 2xl:table-cell" style={{ color: 'var(--color-muted)' }}>
                      {mt.location ?? '—'}
                    </td>
                    <td className="num-col">{mt.cost != null ? t.money(mt.cost) : '—'}</td>
                    <td className="num-col">{mt.cost != null ? t.money(mt.cost * mt.stock) : '—'}</td>
                    <td>
                      <span className={STOCK_BADGE[state]}>
                        {t(`inventory.status.${state}` as Key)}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          <div className="pager">
            <span className="tabular">
              {t('inventory.shown', {
                n: t.number(shownMaterials.length), total: t.number(materials.length),
              })}
            </span>
          </div>
        </div>
      )}

      {/* ── Расходники: карточки на телефоне ──────────────────── */}
      {/* На столе карточки прячутся только когда есть таблица. Пустое
          состояние (и кнопка «завести перший засіб») обязано быть видно
          на любом размере — иначе на большом экране пустой склад выглядит
          как сломанный экран. */}
      {showMaterials && (
        <section className={`card rise !p-0 ${shownMaterials.length > 0 ? 'lg:hidden' : ''}`}>
          {shownMaterials.length === 0 ? (
            <div className="empty">
              {materials.length === 0
                ? t('inventory.materials.empty')
                : t('inventory.search.empty')}
              {materials.length === 0 && (
                <button type="button" className="btn-primary"
                        onClick={() => setAdding('material')}>
                  {t('inventory.materials.add')}
                </button>
              )}
            </div>
          ) : shownMaterials.map((mt) => {
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
                  {mt.expiry && (
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
        </section>
      )}

      {/* ── Ёмкости ──────────────────────────────────────────── */}
      {showContainers && (
        <section className="card rise !p-0">
          {shownContainers.length === 0 ? (
            <div className="empty">
              {containers.length === 0
                ? t('inventory.containers.empty')
                : t('inventory.containers.searchEmpty')}
              {containers.length === 0 && (
                <button type="button" className="btn-primary"
                        onClick={() => setAdding('container')}>
                  {t('inventory.containers.add')}
                </button>
              )}
            </div>
          ) : shownContainers.map((c) => {
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
        </section>
      )}

      {/* ── Товары ───────────────────────────────────────────── */}
      {showGoods && variants.length > 0 && (
        <section className="flex flex-col gap-4">
          {totals && totals.units > 0 && (
            <div className="rise grid grid-cols-3 gap-3">
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
          <div className="card rise-1 !p-0">
            {shownVariants.length === 0 ? (
              <div className="empty">{t('inventory.goods.searchEmpty')}</div>
            ) : shownVariants.map((v) => (
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

      {/* ── Остальные экраны раздела ─────────────────────────── */}
      <div className="rise-3 flex flex-wrap gap-2">
        <Link href="/app/inventory/reorder" className="btn-ghost t-sm">{t('inventory.links.reorder')}</Link>
        <Link href="/app/inventory/recipes" className="btn-ghost t-sm">{t('inventory.links.recipes')}</Link>
        <Link href="/app/inventory/barcodes" className="btn-ghost t-sm">{t('inventory.links.barcodes')}</Link>
        <Link href="/app/documents" className="btn-ghost t-sm">{t('inventory.links.documents')}</Link>
      </div>

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
      <Scanner open={camera} onClose={() => setCamera(false)}
               onResult={(v) => { setCode(v); void lookup(v) }} />

    </div>

    {/* ── Правый рельс ─────────────────────────────────────────
        Соседний элемент содержимого, а не вложенный в него: сетка
        `.workarea` разводит их по колонкам сама (globals.css).
        На экранах уже 1280 рельс просто становится нижним блоком —
        отдельной разметки под это не нужно. */}
    <aside className="rail rise-2">
      <div className="rail-card">
        <p className="rail-title">{t('inventory.rail.quick')}</p>
        <button type="button" className="rail-action"
                onClick={() => { setScanOpen(true); setCamera(true) }}>
          <span className="rail-action-icon"><IconScan size={16} /></span>
          {t('inventory.quick.scan')}
        </button>
        {/* У каждого действия свой значок. Один значок на шесть строк
            превращает список в шесть одинаковых пунктов, и глаз
            перестаёт его сканировать — читает подписи подряд. */}
        {([
          ['/app/inventory/receipts', 'inventory.tab.receipts', IconExport],
          ['/app/inventory/counts', 'inventory.tab.counts', IconCheck],
          ['/app/inventory/reorder', 'inventory.tab.reorder', IconAlert],
          ['/app/inventory/recipes', 'inventory.tab.recipes', IconDoc],
          ['/app/inventory/barcodes', 'inventory.tab.barcodes', IconScan],
        ] as [string, Key, (p: { size?: number }) => React.ReactElement][]).map(([href, label, Icon]) => (
          <Link key={href} href={href} className="rail-action">
            <span className="rail-action-icon"><Icon size={16} /></span>
            {t(label)}
          </Link>
        ))}
        <button type="button" className="rail-action" onClick={() => setAdding('material')}>
          <span className="rail-action-icon"><IconPlus size={16} /></span>
          {t('inventory.action.addMaterial')}
        </button>
      </div>

      <div className="rail-card">
        <p className="rail-title">{t('inventory.rail.moves')}</p>
        {moves.length === 0 ? (
          <p className="t-sm prose-muted">{t('inventory.rail.moves.empty')}</p>
        ) : moves.map((mv) => (
          <Link key={mv.id} href="/app/inventory/movements" className="rail-row">
            {/* Вид движения — значение перечисления `stock_movement_type`,
                переводится подпись. Приход зелёный, расход красный:
                это единственное, что от строки нужно боковым зрением. */}
            <span style={{
              color: mv.kind === 'receipt' || mv.kind === 'return' || mv.kind === 'transfer_in'
                ? 'var(--color-success)' : 'var(--color-danger)',
            }}>
              {t(`inventory.move.${mv.kind}` as Key)}
            </span>
            <span className="tabular" style={{ color: 'var(--color-faint)' }}>
              {t.dateTime(mv.at, { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
            </span>
          </Link>
        ))}
      </div>

      <div className="rail-card">
        <p className="rail-title">{t('inventory.rail.top')}</p>
        {topCategories.length === 0 ? (
          <p className="t-sm prose-muted">{t('inventory.rail.top.empty')}</p>
        ) : topCategories.map((c) => (
          <div key={c.name} className="mt-1.5">
            <div className="rail-row !py-0.5">
              {/* Название категории — данные арендатора. */}
              <span className="truncate">{c.name}</span>
              <span className="tabular shrink-0">{t.money(c.value)}</span>
            </div>
            <div className="rail-bar">
              <span data-tone={c.tone} style={{ width: `${c.share}%` }} />
            </div>
          </div>
        ))}
        <Link href="/app/finance" className="rail-action mt-2">
          <span className="rail-action-icon"><IconChart size={16} /></span>
          {t('home.finance.all')}
        </Link>
      </div>
    </aside>
    </>
  )
}
