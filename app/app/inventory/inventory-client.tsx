'use client'

import { useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { MaterialForm, type RefItem } from './material-form'
import { ContainerForm, type BatchOption } from './container-form'
import { RefsForm } from './refs-form'
import { Sheet } from '@/components/sheet'
import { enqueue, isNetworkError } from '@/lib/offline/queue'
import { useToast } from '@/components/toast'
import { EXPIRY_BADGE, EXPIRY_LABEL, expiryState, fmtShort } from '@/lib/expiry'

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

// Экран склада — экран 1 макета.
//
// Порядок блоков не декоративный: сверху счётчики («что горит»), под ними
// быстрые действия, ниже поиск и список. Мастер приходит сюда с двумя
// вопросами — «что просрочено» и «где эта банка», и оба обязаны решаться
// без прокрутки.
export function InventoryClient({
  tenantId, userId, containers, materials, variants, totals,
  suppliers, locations, batches,
}: {
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
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const toast = useToast()
  const [tab, setTab] = useState<'all' | 'containers' | 'materials' | 'goods'>('all')
  const [query, setQuery] = useState('')
  // Формы раскрываются шторкой снизу, а не блоком на странице: на телефоне
  // раздвигающийся блок уводит список вниз, и мастер теряет место, где был.
  const [adding, setAdding] = useState<'material' | 'container' | 'refs' | null>(null)
  const [code, setCode] = useState('')
  const [scan, setScan] = useState<{ item?: ScanHit; container?: ContainerHit; miss?: string } | null>(null)
  const [scanOpen, setScanOpen] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)
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

  const shownMaterials = materials.filter((m) => match(m.name, m.brand, m.sku, m.batch))
  const shownContainers = containers.filter((c) => match(c.code, c.material))
  const shownVariants = variants.filter((v) => match(v.title, v.name))

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

  async function scanCamera() {
    // BarcodeDetector есть в Chrome на Android — основной телефон мастера.
    type BD = { detect(source: ImageBitmap): Promise<{ rawValue: string }[]> }
    const W = window as unknown as { BarcodeDetector?: new (o?: object) => BD }
    if (!W.BarcodeDetector) {
      toast.warn('Камера-сканер недоступний',
        'Працює у Chrome на Android. Введіть код вручну — поле поруч.')
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      const track = stream.getVideoTracks()[0]
      const capture = new ImageCapture(track)
      const detector = new W.BarcodeDetector({
        formats: ['qr_code', 'ean_13', 'code_128'],
      })
      const deadline = Date.now() + 15000
      let found: string | null = null
      while (!found && Date.now() < deadline) {
        const frame = await capture.grabFrame()
        const codes = await detector.detect(frame)
        if (codes.length > 0) found = codes[0].rawValue
        await new Promise((r) => setTimeout(r, 180))
      }
      track.stop()
      if (found) await lookup(found)
      else toast.info('Код не зчитано', 'Спробуйте ще раз або введіть вручну.')
    } catch {
      toast.error('Камера не відкрилась', 'Введіть код вручну — поле поруч.')
    }
  }

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
        toast.info('Збережено офлайн', 'Надішлеться само, щойно зʼявиться мережа.')
        return true
      }
      toast.error('Не вдалося зберегти', e instanceof Error ? e.message : String(e))
      return false
    }
    setBusy(null)
    return true
  }

  async function openContainer(id: string, containerCode: string) {
    const ok = await setContainerStatus(id, containerCode, 'opened', 'Відкрити банку')
    if (!ok) return
    toast.success('Банку відкрито', 'Термін придатності перераховано за PAO.')
    router.refresh()
    if (scan?.container?.id === id) void lookup(scan.container.code)
  }

  async function finishContainer(id: string, containerCode: string, disposed = false) {
    const ok = await setContainerStatus(
      id, containerCode,
      disposed ? 'disposed' : 'finished',
      disposed ? 'Списати ємність' : 'Ємність закінчилась',
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
    <div className="flex flex-col gap-5">

      {/* ── Счётчики ─────────────────────────────────────────── */}
      <section className="rise-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { n: stats.total, label: 'Усі позиції', cls: '' },
          { n: stats.soon, label: 'Закінчуються', cls: stats.soon > 0 ? 'badge-warn' : '' },
          { n: stats.expired, label: 'Прострочені', cls: stats.expired > 0 ? 'badge-danger' : '' },
          { n: stats.low, label: 'Мало на складі', cls: stats.low > 0 ? 'badge-warn' : '' },
        ].map((s) => (
          <div key={s.label} className="card-flat !p-3 text-center">
            <p className={`tabular t-xl ${s.cls ? '' : ''}`}
               style={s.cls === 'badge-danger' ? { color: 'var(--color-danger)' }
                 : s.cls === 'badge-warn' ? { color: 'var(--color-warn)' } : undefined}>
              {s.n}
            </p>
            <p className="t-xs mt-0.5" style={{ color: 'var(--color-faint)' }}>{s.label}</p>
          </div>
        ))}
      </section>

      {/* ── Быстрые действия ─────────────────────────────────── */}
      <section className="rise-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <button type="button" onClick={() => { setScanOpen(true); setTimeout(() => inputRef.current?.focus(), 50) }}
                className="card-link !p-3 text-center" style={{ minHeight: 'var(--tap-min)' }}>
          <span aria-hidden className="t-xl block">⌗</span>
          <span className="t-sm mt-1 block">Сканувати</span>
        </button>
        <Link href="/app/inventory/receipts" className="card-link !p-3 text-center"
              style={{ minHeight: 'var(--tap-min)' }}>
          <span aria-hidden className="t-xl block">⬓</span>
          <span className="t-sm mt-1 block">Надходження</span>
        </Link>
        <Link href="/app/inventory/movements" className="card-link !p-3 text-center"
              style={{ minHeight: 'var(--tap-min)' }}>
          <span aria-hidden className="t-xl block">⇅</span>
          <span className="t-sm mt-1 block">Рухи</span>
        </Link>
        <Link href="/app/inventory/counts" className="card-link !p-3 text-center"
              style={{ minHeight: 'var(--tap-min)' }}>
          <span aria-hidden className="t-xl block">☰</span>
          <span className="t-sm mt-1 block">Інвентаризація</span>
        </Link>
      </section>

      {/* ── Сканер и поиск ───────────────────────────────────── */}
      <section className="card rise-2">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            className="input"
            placeholder="Пошук у складі або код наліпки…"
            value={scanOpen ? code : query}
            onChange={(e) => (scanOpen ? setCode(e.target.value) : setQuery(e.target.value))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && scanOpen) { e.preventDefault(); void lookup(code) }
            }}
            autoComplete="off"
            inputMode="text"
          />
          {scanOpen ? (
            <>
              <button type="button" onClick={() => void lookup(code)} className="btn-secondary shrink-0">
                Знайти
              </button>
              <button type="button" onClick={() => { setScanOpen(false); setScan(null); setCode('') }}
                      className="btn-ghost shrink-0">Пошук</button>
            </>
          ) : (
            <button type="button" onClick={() => void scanCamera()} className="btn-primary shrink-0"
                    title="Сканувати камерою" aria-label="Сканувати камерою">
              ⌗
            </button>
          )}
        </div>

        {scan?.container && (
          <div className="card-flat mt-3 flex flex-wrap items-center justify-between gap-3 rise">
            <div>
              <p className="t-md">{scan.container.material}
                <span className="prose-muted"> · {scan.container.code}</span></p>
              <p className="tabular t-md mt-0.5">
                {scan.container.expired
                  ? <span style={{ color: 'var(--color-danger)' }}>Термін сплив {fmtShort(scan.container.use_by)} — не використовувати</span>
                  : scan.container.use_by
                    ? <>Придатна до {fmtShort(scan.container.use_by)} ({scan.container.days_left} дн)</>
                    : 'Запечатана — термін порахується при відкритті'}
              </p>
            </div>
            <div className="flex gap-2">
              {scan.container.status === 'sealed' && (
                <button className="btn-primary" disabled={busy === scan.container.id}
                        onClick={() => void openContainer(scan.container!.id, scan.container!.code)}>
                  Відкрити банку
                </button>
              )}
              {scan.container.status === 'opened' && (
                <>
                  <button className="btn-secondary" disabled={busy === scan.container.id}
                          onClick={() => void finishContainer(scan.container!.id, scan.container!.code)}>
                    Закінчилась
                  </button>
                  <button className="btn-danger" disabled={busy === scan.container.id}
                          onClick={() => void finishContainer(scan.container!.id, scan.container!.code, true)}>
                    Списати
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
              Залишок: {Number(scan.item.stock_qty)}
              {scan.item.location ? ` · ${scan.item.location}` : ''}
              {scan.item.low_stock ? ' · мало!' : ''}
            </p>
          </div>
        )}
        {scan?.miss && (
          <p className="field-error mt-3">Код «{scan.miss}» не знайдено</p>
        )}
      </section>

      {/* ── Вкладки ──────────────────────────────────────────── */}
      <div className="rise-2 flex flex-wrap items-center gap-2">
        {([
          ['all', 'Всі'],
          ['materials', 'Розхідники'],
          ['containers', `Ємності${containers.length ? ` · ${containers.length}` : ''}`],
          ['goods', 'Товари'],
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
                Довідники
              </button>
              <button type="button" className="btn-primary t-sm"
                      onClick={() => setAdding(adding === 'material' ? null : 'material')}>
                + Засіб
              </button>
            </>
          )}
          {tab === 'containers' && (
            <>
              {containers.length > 0 && (
                <a href="/app/inventory/labels" target="_blank" rel="noreferrer"
                   className="btn-secondary t-sm">
                  Друк QR-наліпок
                </a>
              )}
              <button type="button" className="btn-primary t-sm"
                      onClick={() => setAdding(adding === 'container' ? null : 'container')}>
                + Банка
              </button>
            </>
          )}
          {/* Товар заводится в каталоге вместе с ценой и фото — второй
              формы для того же самого на складе быть не должно. */}
          {tab === 'goods' && (
            <a href="/app/catalog" className="btn-secondary t-sm">
              Додати в каталозі
            </a>
          )}
        </div>
      </div>

      {/* ── Расходники: карточки с партией и статусом ─────────── */}
      {showMaterials && (
        <section className="card rise !p-0">
          {shownMaterials.length === 0 ? (
            <div className="empty">
              {materials.length === 0
                ? 'Витратних засобів поки немає'
                : 'За цим запитом нічого не знайшлося'}
              {materials.length === 0 && (
                <button type="button" className="btn-primary"
                        onClick={() => setAdding('material')}>
                  Додати засіб
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
                  <span className="t-md block truncate">{mt.name}</span>
                  <span className="t-xs block truncate" style={{ color: 'var(--color-faint)' }}>
                    {[
                      mt.brand,
                      mt.batch ? `Партія: ${mt.batch}` : null,
                      mt.expiry ? `до ${fmtShort(mt.expiry)}` : null,
                      mt.cosmetic ? `PAO ${mt.pao ?? '—'} міс` : null,
                    ].filter(Boolean).join(' · ')}
                  </span>
                  {mt.expiry && (
                    <span className={`mt-1 inline-block ${EXPIRY_BADGE[state]}`}>
                      {EXPIRY_LABEL[state]}
                    </span>
                  )}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  <span className={`tabular ${low ? 'badge-warn' : 'badge'}`}>
                    {mt.stock} {mt.unit}
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
                ? 'Ємностей поки немає. Заведіть банку — і наклейте на неї QR із кодом.'
                : 'За цим запитом ємностей немає'}
              {containers.length === 0 && (
                <button type="button" className="btn-primary"
                        onClick={() => setAdding('container')}>
                  Завести банку
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
                    {c.status === 'sealed' ? 'запечатана' : `відкрита ${fmtShort(c.openedAt)}`}
                    {c.volume ? ` · ${c.volume} ${c.unit ?? ''}` : ''}
                  </span>
                </Link>
                <span className="flex shrink-0 items-center gap-2">
                  {c.useBy && (
                    <span className={`tabular ${EXPIRY_BADGE[state]}`}>
                      до {fmtShort(c.useBy)}
                    </span>
                  )}
                  {c.status === 'sealed' && (
                    <button className="btn-secondary t-sm" disabled={busy === c.id}
                            onClick={() => void openContainer(c.id, c.code)}>
                      Відкрити
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
                ['Одиниць', totals.units.toLocaleString('uk-UA')],
                ['Собівартість', `${totals.cost.toLocaleString('uk-UA')} ₴`],
                ['У продажу', `${totals.retail.toLocaleString('uk-UA')} ₴`],
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
              <div className="empty">За цим запитом товарів немає</div>
            ) : shownVariants.map((v) => (
              <div key={v.id} className="row px-5">
                <div className="min-w-0">
                  <p className="t-md truncate">{v.title}
                    <span className="prose-muted"> · {v.name}</span></p>
                  {v.reserved > 0 && (
                    <p className="tabular t-xs mt-0.5 prose-muted">у резерві: {v.reserved}</p>
                  )}
                </div>
                {v.tracked ? (
                  <span className={`tabular ${v.threshold > 0 && v.stock <= v.threshold ? 'badge-warn' : 'badge'}`}>
                    {v.stock} {v.unit}
                  </span>
                ) : (
                  <span className="badge">без обліку</span>
                )}
              </div>
            ))}
          </div>
        </section>
      )}

      {/* ── Остальные экраны раздела ─────────────────────────── */}
      <div className="rise-3 flex flex-wrap gap-2">
        <Link href="/app/inventory/reorder" className="btn-ghost t-sm">Пора замовити</Link>
        <Link href="/app/inventory/recipes" className="btn-ghost t-sm">Рецептура</Link>
        <Link href="/app/inventory/barcodes" className="btn-ghost t-sm">Штрихкоди</Link>
        <Link href="/app/documents" className="btn-ghost t-sm">Усі документи</Link>
      </div>

      {/* ── Формы заведения ──────────────────────────────────── */}
      <Sheet
        open={adding === 'container'}
        onClose={() => setAdding(null)}
        title="Нова банка або партія"
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
        title="Новий витратний засіб"
      >
        <MaterialForm
          tenantId={tenantId} suppliers={suppliers} locations={locations}
          onDone={() => setAdding(null)}
        />
      </Sheet>

      <Sheet
        open={adding === 'refs'}
        onClose={() => setAdding(null)}
        title="Довідники"
      >
        <RefsForm
          tenantId={tenantId} suppliers={suppliers} locations={locations}
          onDone={() => setAdding(null)}
        />
      </Sheet>
    </div>
  )
}
