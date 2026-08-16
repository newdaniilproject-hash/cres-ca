'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'

export type MaterialCodes = {
  id: string
  name: string
  unit: string
  category: string | null
  codes: string[]
}

// База отвечает кодами Postgres — переводим известные, незнакомое
// показываем как есть. Подстроки, по которым разбирается отказ, — это
// текст базы, а не строка интерфейса: в словарь едет только ответ.
function humanize(t: T, message: string, code?: string): string {
  if (code === '23505') {
    return t('inventory.barcodes.error.duplicate')
  }
  if (code === '23503') {
    return t('inventory.barcodes.error.missing')
  }
  if (message.includes('row-level security') || message.includes('policy')) {
    return t('inventory.error.stockWrite')
  }
  return message
}

export function BarcodesClient({
  tenantId, materials, canWrite, error, loadError,
}: {
  tenantId: string
  materials: MaterialCodes[]
  canWrite: boolean
  error: string
  loadError: string
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  const [query, setQuery] = useState('')
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')
  // Поле ввода одно на экран: оно относится к раскрытому засобу, и второго
  // раскрытого одновременно быть не может.
  const [code, setCode] = useState('')

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q
      ? materials.filter((mt) => mt.name.toLowerCase().includes(q)
        || mt.codes.some((c) => c.toLowerCase().includes(q)))
      : materials
  }, [materials, query])

  function toggle(id: string) {
    setOpenId(openId === id ? null : id)
    setCode(''); setErr('')
  }

  async function add(e: React.FormEvent, materialId: string) {
    e.preventDefault()
    const value = code.trim()
    if (!value) return
    setBusy(materialId); setErr('')
    const { error: insertError } = await supabase.from('material_barcodes').insert({
      material_id: materialId,
      barcode: value,
      // tenant_id в таблице отдельной колонкой: по нему стоит уникальность
      // (tenant_id, barcode) и по нему же RLS решает, чей это код.
      tenant_id: tenantId,
    })
    setBusy(null)
    if (insertError) { setErr(humanize(t, insertError.message, insertError.code)); return }
    setCode('')
    router.refresh()
  }

  async function remove(materialId: string, barcode: string) {
    setBusy(materialId + barcode); setErr('')
    const { error: deleteError } = await supabase.from('material_barcodes')
      .delete()
      .eq('material_id', materialId)
      .eq('barcode', barcode)
    setBusy(null)
    if (deleteError) { setErr(humanize(t, deleteError.message, deleteError.code)); return }
    router.refresh()
  }

  // Заводской код читается камерой прямо с упаковки — перепечатывать
  // тринадцать цифр с коробки руками мастер не будет.
  async function scanCamera() {
    type BD = { detect(source: ImageBitmap): Promise<{ rawValue: string }[]> }
    const W = window as unknown as { BarcodeDetector?: new (o?: object) => BD }
    if (!W.BarcodeDetector) {
      alert(t('inventory.barcodes.camera.unavailable'))
      return
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment' },
      })
      const track = stream.getVideoTracks()[0]
      const capture = new ImageCapture(track)
      // Форматы упаковки, а не наши QR: на коробке косметики это EAN,
      // на импортной — UPC, на внутренней наклейке производителя — Code 128.
      const detector = new W.BarcodeDetector({
        formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39'],
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
      if (found) setCode(found)
    } catch {
      alert(t('inventory.barcodes.camera.failed'))
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-wrap items-center gap-2">
        <Link href="/app/inventory" className="btn-ghost">← {t('inventory.link.stock')}</Link>
      </div>

      {/* Текст отказа базы показывается как есть — это её слова, не наши. */}
      {error && (
        <p className="field-error rise">{t('inventory.barcodes.materialsError')}: {error}</p>
      )}
      {loadError && (
        <p className="field-error rise">{t('inventory.barcodes.codesError')}: {loadError}</p>
      )}
      {err && <p className="field-error rise">{err}</p>}

      <section className="card rise">
        <p className="eyebrow">{t('inventory.barcodes.about.eyebrow')}</p>
        <p className="t-md mt-2 prose-muted">
          <strong>{t('inventory.barcodes.about.factory.title')}</strong>{' '}
          {t('inventory.barcodes.about.factory.desc')}
          <br />
          <strong>{t('inventory.barcodes.about.own.title')}</strong>{' '}
          {t('inventory.barcodes.about.own.desc')}
        </p>
      </section>

      <input className="input rise-1" placeholder={t('inventory.barcodes.search.placeholder')}
             value={query} onChange={(e) => setQuery(e.target.value)} />

      <section className="card rise-2 !p-0">
        {shown.length === 0 ? (
          <div className="empty">
            {materials.length === 0
              ? t('inventory.barcodes.empty.noMaterials')
              : t('inventory.barcodes.empty.search')}
          </div>
        ) : shown.map((mt) => {
          const open = openId === mt.id
          return (
            <div key={mt.id} className="px-5">
              <div className="row">
                <button type="button" className="min-w-0 flex-1 text-left"
                        onClick={() => toggle(mt.id)}>
                  <p className="t-md truncate">{mt.name}</p>
                  <p className="tabular t-xs mt-0.5 prose-muted">
                    {mt.category ? `${mt.category} · ` : ''}
                    {mt.codes.length === 0
                      ? t('inventory.barcodes.noCodes')
                      : t('inventory.barcodes.count', { n: t.number(mt.codes.length) })}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`tabular ${mt.codes.length === 0 ? 'badge' : 'badge-success'}`}>
                    {t.number(mt.codes.length)}
                  </span>
                  <button type="button" className="btn-icon" onClick={() => toggle(mt.id)}
                          title={open ? t('inventory.collapse') : t('inventory.barcodes.expand')}>
                    {open ? '−' : '+'}
                  </button>
                </div>
              </div>

              {open && (
                <div className="pb-5">
                  {mt.codes.length > 0 && (
                    <div className="card-flat !p-0 px-4">
                      {mt.codes.map((c) => (
                        <div key={c} className="row">
                          <p className="tabular t-md min-w-0 truncate">{c}</p>
                          {canWrite && (
                            <button type="button" className="btn-icon"
                                    title={t('inventory.barcodes.unlink.aria')}
                                    aria-label={t('inventory.barcodes.unlink.aria')}
                                    disabled={busy !== null}
                                    onClick={() => void remove(mt.id, c)}>
                              ✕
                            </button>
                          )}
                        </div>
                      ))}
                    </div>
                  )}

                  {canWrite && (
                    <form onSubmit={(e) => void add(e, mt.id)} className="mt-3 flex flex-col gap-2">
                      <label className="field-label !mb-0">{t('inventory.barcodes.new.label')}</label>
                      <div className="flex gap-2">
                        <input className="input" placeholder={t('inventory.barcodes.new.placeholder')}
                               value={code} onChange={(e) => setCode(e.target.value)}
                               autoComplete="off" inputMode="text" />
                        <button type="button" className="btn-secondary shrink-0"
                                onClick={() => void scanCamera()}>
                          {t('inventory.barcodes.scan')}
                        </button>
                      </div>
                      <div>
                        <button className="btn-primary"
                                disabled={busy !== null || !code.trim()}>
                          {t('inventory.barcodes.submit')}
                        </button>
                      </div>
                    </form>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </section>

      {!canWrite && (
        <p className="field-hint">{t('inventory.barcodes.readonly')}</p>
      )}

      <p className="field-hint">{t('inventory.barcodes.hint')}</p>
    </div>
  )
}
