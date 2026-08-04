'use client'

import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { MaterialForm, type RefItem } from './material-form'
import { ContainerForm, type BatchOption } from './container-form'
import { RefsForm } from './refs-form'

type Container = {
  id: string; code: string; status: string; useBy: string | null
  openedAt: string | null; volume: number | null; unit: string | null; material: string
}
type Material = {
  id: string; name: string; unit: string; stock: number; threshold: number
  cosmetic: boolean; pao: number | null; brand: string | null
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

// Экран склада. Сканер первым: мастер стоит с банкой в руке.
// Камера — через BarcodeDetector (Chrome/Android из коробки),
// фолбэк — ручной ввод кода. Результат прошлого скана остаётся
// на экране, поле готово к следующему — это цикл, не разовое действие.
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
  const [tab, setTab] = useState<'containers' | 'materials' | 'goods'>('containers')
  // Формы раскрываются прямо на странице, а не модалкой: на телефоне
  // модальное окно перекрывается клавиатурой и поля уезжают из вида.
  const [adding, setAdding] = useState<'material' | 'container' | 'refs' | null>(null)
  const [code, setCode] = useState('')
  const [scan, setScan] = useState<{ item?: ScanHit; container?: ContainerHit; miss?: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  async function lookup(raw: string) {
    const q = raw.trim()
    if (!q) return
    setCode('')
    inputRef.current?.focus()
    const [{ data: cont }, { data: items }] = await Promise.all([
      supabase.rpc('scan_container', { p_tenant_id: tenantId, p_code: q }),
      supabase.rpc('scan_lookup', { p_tenant_id: tenantId, p_code: q }),
    ])
    const c = (cont ?? [])[0] as ContainerHit | undefined
    const i = (items ?? [])[0] as ScanHit | undefined
    setScan(c ? { container: c } : i ? { item: i } : { miss: q })
  }

  async function scanCamera() {
    // BarcodeDetector есть в Chrome на Android — основной телефон мастера.
    type BD = { detect(source: ImageBitmap): Promise<{ rawValue: string }[]> }
    const W = window as unknown as { BarcodeDetector?: new (o?: object) => BD }
    if (!W.BarcodeDetector) {
      alert('Камера-сканер працює у Chrome на Android. Введіть код вручну.')
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
    } catch {
      alert('Не вдалося відкрити камеру — введіть код вручну.')
    }
  }

  async function openContainer(id: string) {
    setBusy(id)
    const { error } = await supabase.from('material_containers')
      .update({ status: 'opened' }).eq('id', id)
    setBusy(null)
    if (error) { alert(error.message); return }
    router.refresh()
    if (scan?.container?.id === id) void lookup(scan.container.code)
  }

  async function finishContainer(id: string, disposed = false) {
    setBusy(id)
    const { error } = await supabase.from('material_containers')
      .update({ status: disposed ? 'disposed' : 'finished' }).eq('id', id)
    setBusy(null)
    if (error) { alert(error.message); return }
    setScan(null)
    router.refresh()
  }

  const fmtDate = (d: string | null) =>
    d ? new Date(d).toLocaleDateString('uk-UA', { day: 'numeric', month: 'short' }) : '—'

  // Смена вкладки закрывает открытую форму: иначе форма банки
  // остаётся висеть над списком товаров и сбивает с толку.
  function switchTab(next: 'containers' | 'materials' | 'goods') {
    setTab(next)
    setAdding(null)
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Сканер */}
      <section className="card rise-1">
        <div className="flex gap-2">
          <input
            ref={inputRef}
            className="input"
            placeholder="Скануйте наліпку або введіть код…"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void lookup(code) } }}
            autoComplete="off"
            inputMode="text"
          />
          <button type="button" onClick={() => void lookup(code)} className="btn-secondary shrink-0">
            Знайти
          </button>
          <button type="button" onClick={() => void scanCamera()} className="btn-primary shrink-0"
                  title="Сканувати камерою">
            ⌗
          </button>
        </div>

        {scan?.container && (
          <div className="card-flat mt-3 flex flex-wrap items-center justify-between gap-3 rise">
            <div>
              <p className="font-medium">{scan.container.material}
                <span className="prose-muted"> · {scan.container.code}</span></p>
              <p className="mt-0.5 text-sm">
                {scan.container.expired
                  ? <span style={{ color: 'var(--color-danger)' }}>Термін сплив {fmtDate(scan.container.use_by)} — не використовувати</span>
                  : scan.container.use_by
                    ? <>Придатна до {fmtDate(scan.container.use_by)} ({scan.container.days_left} дн)</>
                    : 'Запечатана — термін порахується при відкритті'}
              </p>
            </div>
            <div className="flex gap-2">
              {scan.container.status === 'sealed' && (
                <button className="btn-primary h-10" disabled={busy === scan.container.id}
                        onClick={() => void openContainer(scan.container!.id)}>
                  Відкрити банку
                </button>
              )}
              {scan.container.status === 'opened' && (
                <>
                  <button className="btn-secondary h-10" disabled={busy === scan.container.id}
                          onClick={() => void finishContainer(scan.container!.id)}>
                    Закінчилась
                  </button>
                  <button className="btn-danger h-10" disabled={busy === scan.container.id}
                          onClick={() => void finishContainer(scan.container!.id, true)}>
                    Списати
                  </button>
                </>
              )}
            </div>
          </div>
        )}
        {scan?.item && (
          <div className="card-flat mt-3 rise">
            <p className="font-medium">{scan.item.title}
              {scan.item.subtitle ? <span className="prose-muted"> · {scan.item.subtitle}</span> : null}</p>
            <p className="mt-0.5 text-sm prose-muted">
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

      {/* Вкладки */}
      <div className="rise-2 flex flex-wrap items-center gap-2">
        <button onClick={() => switchTab('containers')}
                className={tab === 'containers' ? 'chip-active' : 'chip'}>
          Ємності {containers.length > 0 && `· ${containers.length}`}
        </button>
        <button onClick={() => switchTab('materials')}
                className={tab === 'materials' ? 'chip-active' : 'chip'}>
          Витратні
        </button>
        <button onClick={() => switchTab('goods')}
                className={tab === 'goods' ? 'chip-active' : 'chip'}>
          Товари
        </button>

        <div className="ml-auto flex gap-2">
          {tab === 'containers' && (
            <>
              {containers.length > 0 && (
                <a href="/app/inventory/labels" target="_blank" rel="noreferrer"
                   className="btn-secondary h-9 text-xs">
                  Друк QR-наліпок
                </a>
              )}
              <button type="button" className="btn-primary h-9 text-xs"
                      onClick={() => setAdding(adding === 'container' ? null : 'container')}>
                + Додати
              </button>
            </>
          )}
          {tab === 'materials' && (
            <>
              <button type="button" className="btn-secondary h-9 text-xs"
                      onClick={() => setAdding(adding === 'refs' ? null : 'refs')}>
                Довідники
              </button>
              <button type="button" className="btn-primary h-9 text-xs"
                      onClick={() => setAdding(adding === 'material' ? null : 'material')}>
                + Додати
              </button>
            </>
          )}
          {/* Товар заводится в каталоге вместе с ценой и фото — второй
              формы для того же самого на складе быть не должно. */}
          {tab === 'goods' && (
            <a href="/app/catalog" className="btn-secondary h-9 text-xs">
              Додати в каталозі
            </a>
          )}
        </div>
      </div>

      {tab === 'containers' && adding === 'container' && (
        <ContainerForm
          tenantId={tenantId} userId={userId}
          materials={materials} batches={batches} suppliers={suppliers}
          onDone={() => setAdding(null)}
        />
      )}
      {tab === 'materials' && adding === 'material' && (
        <MaterialForm
          tenantId={tenantId} suppliers={suppliers} locations={locations}
          onDone={() => setAdding(null)}
        />
      )}
      {tab === 'materials' && adding === 'refs' && (
        <RefsForm
          tenantId={tenantId} suppliers={suppliers} locations={locations}
          onDone={() => setAdding(null)}
        />
      )}

      {tab === 'containers' && (
        <section className="card rise !p-0">
          {containers.length === 0 ? (
            <div className="empty">
              Ємностей поки немає. Заведіть банку — і наклейте на неї QR із кодом.
              <button type="button" className="btn-primary"
                      onClick={() => setAdding('container')}>
                Завести банку
              </button>
            </div>
          ) : containers.map((c) => {
            const expired = c.useBy != null && new Date(c.useBy) < new Date()
            const soon = !expired && c.useBy != null
              && new Date(c.useBy).getTime() - Date.now() < 14 * 864e5
            return (
              <div key={c.id} className="row px-5">
                <div className="min-w-0">
                  <p className="truncate font-medium">{c.material}
                    <span className="prose-muted"> · {c.code}</span></p>
                  <p className="mt-0.5 text-xs prose-muted">
                    {c.status === 'sealed' ? 'запечатана'
                      : `відкрита ${fmtDate(c.openedAt)}`}
                    {c.volume ? ` · ${c.volume} ${c.unit ?? ''}` : ''}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {c.useBy && (
                    <span className={expired ? 'badge-danger' : soon ? 'badge-warn' : 'badge'}>
                      до {fmtDate(c.useBy)}
                    </span>
                  )}
                  {c.status === 'sealed' && (
                    <button className="btn-secondary h-9 text-xs" disabled={busy === c.id}
                            onClick={() => void openContainer(c.id)}>
                      Відкрити
                    </button>
                  )}
                </div>
              </div>
            )
          })}
        </section>
      )}

      {tab === 'materials' && (
        <section className="card rise !p-0">
          {materials.length === 0 ? (
            <div className="empty">
              Витратних засобів поки немає
              <button type="button" className="btn-primary"
                      onClick={() => setAdding('material')}>
                Додати засіб
              </button>
            </div>
          ) : materials.map((mt) => (
            <div key={mt.id} className="row px-5">
              <div className="min-w-0">
                <p className="truncate font-medium">{mt.name}</p>
                <p className="mt-0.5 text-xs prose-muted">
                  {mt.brand ? `${mt.brand} · ` : ''}
                  {mt.cosmetic ? `косметика · PAO ${mt.pao ?? '—'} міс` : 'матеріал'}
                </p>
              </div>
              <span className={mt.threshold > 0 && mt.stock <= mt.threshold ? 'badge-warn' : 'badge'}>
                {mt.stock} {mt.unit}
              </span>
            </div>
          ))}
        </section>
      )}

      {tab === 'goods' && (
        <section className="flex flex-col gap-4">
          {totals && totals.units > 0 && (
            <div className="rise grid grid-cols-3 gap-3">
              {[
                ['Одиниць', totals.units.toLocaleString('uk-UA')],
                ['Собівартість', `${totals.cost.toLocaleString('uk-UA')} ₴`],
                ['У продажу', `${totals.retail.toLocaleString('uk-UA')} ₴`],
              ].map(([label, val]) => (
                <div key={label} className="card-flat !p-4 text-center">
                  <p className="display text-lg font-semibold">{val}</p>
                  <p className="mt-0.5 text-xs prose-muted">{label}</p>
                </div>
              ))}
            </div>
          )}
          <div className="card rise-1 !p-0">
            {variants.length === 0 ? (
              <div className="empty">Товарів поки немає</div>
            ) : variants.map((v) => (
              <div key={v.id} className="row px-5">
                <div className="min-w-0">
                  <p className="truncate font-medium">{v.title}
                    <span className="prose-muted"> · {v.name}</span></p>
                  {v.reserved > 0 && (
                    <p className="mt-0.5 text-xs prose-muted">у резерві: {v.reserved}</p>
                  )}
                </div>
                {v.tracked ? (
                  <span className={v.threshold > 0 && v.stock <= v.threshold ? 'badge-warn' : 'badge'}>
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
    </div>
  )
}
