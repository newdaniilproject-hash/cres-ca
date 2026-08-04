'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export type MaterialCodes = {
  id: string
  name: string
  unit: string
  category: string | null
  codes: string[]
}

// База отвечает кодами Postgres — переводим известные, незнакомое
// показываем как есть.
function humanize(message: string, code?: string): string {
  if (code === '23505') {
    return 'Цей штрихкод уже закріплений — за цим засобом або за іншим. Один код може вказувати лише на одну позицію.'
  }
  if (code === '23503') {
    return 'Засіб видалили — оновіть сторінку.'
  }
  if (message.includes('row-level security') || message.includes('policy')) {
    return 'Немає права змінювати склад (stock.write). Попросіть власника магазину видати його.'
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
    if (insertError) { setErr(humanize(insertError.message, insertError.code)); return }
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
    if (deleteError) { setErr(humanize(deleteError.message, deleteError.code)); return }
    router.refresh()
  }

  // Заводской код читается камерой прямо с упаковки — перепечатывать
  // тринадцать цифр с коробки руками мастер не будет.
  async function scanCamera() {
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
      alert('Не вдалося відкрити камеру — введіть код вручну.')
    }
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-wrap items-center gap-2">
        <Link href="/app/inventory" className="btn-ghost">← Склад</Link>
      </div>

      {error && <p className="field-error rise">Не вдалося завантажити засоби: {error}</p>}
      {loadError && <p className="field-error rise">Не вдалося завантажити штрихкоди: {loadError}</p>}
      {err && <p className="field-error rise">{err}</p>}

      <section className="card rise">
        <p className="eyebrow">Два різні коди</p>
        <p className="t-md mt-2 prose-muted">
          <strong>Заводський штрихкод</strong> уже надрукований на упаковці —
          його не друкують, його зчитують. Одному засобу можна прописати
          кілька: на коробці й на банці всередині коди різні, а засіб той самий.
          <br />
          <strong>Свій QR</strong> ми друкуємо тільки на розлив — на банку,
          у якій вже немає заводської етикетки. Він живе окремо, у наліпках ємностей.
        </p>
      </section>

      <input className="input rise-1" placeholder="Пошук за назвою або кодом…"
             value={query} onChange={(e) => setQuery(e.target.value)} />

      <section className="card rise-2 !p-0">
        {shown.length === 0 ? (
          <div className="empty">
            {materials.length === 0
              ? 'Витратних засобів ще немає — заведіть їх на складі, і тоді прив’яжете коди.'
              : 'За цим запитом нічого не знайшлося.'}
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
                      ? 'кодів немає — сканер його не знайде'
                      : `кодів: ${mt.codes.length}`}
                  </p>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <span className={`tabular ${mt.codes.length === 0 ? 'badge' : 'badge-success'}`}>
                    {mt.codes.length}
                  </span>
                  <button type="button" className="btn-icon" onClick={() => toggle(mt.id)}
                          title={open ? 'Згорнути' : 'Показати коди'}>
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
                            <button type="button" className="btn-icon" title="Відв’язати код"
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
                      <label className="field-label !mb-0">Новий штрихкод з упаковки</label>
                      <div className="flex gap-2">
                        <input className="input" placeholder="4820000000000"
                               value={code} onChange={(e) => setCode(e.target.value)}
                               autoComplete="off" inputMode="text" />
                        <button type="button" className="btn-secondary shrink-0"
                                onClick={() => void scanCamera()}>
                          Сканувати камерою
                        </button>
                      </div>
                      <div>
                        <button className="btn-primary"
                                disabled={busy !== null || !code.trim()}>
                          Прив’язати код
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
        <p className="field-hint">
          Немає права змінювати склад, тому коди доступні лише для перегляду.
        </p>
      )}

      <p className="field-hint">
        Один код — один засіб: та сама цифра не може вказувати на дві позиції,
        інакше сканер не знав би, що показати. Якщо код «уже закріплений» —
        його вже прив’язали до чогось іншого.
      </p>
    </div>
  )
}
