'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { RefItem } from '../material-form'

// Значения enum stock_receipt_status из 0003_inventory.sql — дословно.
// Четвёртого состояния нет: документ либо готовится, либо уже изменил
// остаток, либо отброшен до проведения.
export const RECEIPT_STATUS_LABEL: Record<string, string> = {
  draft: 'чернетка',
  applied: 'проведено',
  cancelled: 'скасовано',
}

export function receiptBadge(status: string): string {
  switch (status) {
    case 'draft': return 'badge-warn'
    case 'applied': return 'badge-success'
    case 'cancelled': return 'badge'
    default: return 'badge'
  }
}

export type ReceiptRow = {
  id: string
  number: string | null
  status: string
  note: string | null
  supplier: string | null
  createdAt: string
  appliedAt: string | null
  lines: number
}

export function ReceiptsClient({
  tenantId, userId, canWrite, receipts, suppliers, error,
}: {
  tenantId: string
  userId: string
  canWrite: boolean
  receipts: ReceiptRow[]
  suppliers: RefItem[]
  error: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  // Форма раскрывается на странице, а не модалкой: приёмку заводят
  // с телефона стоя над коробкой, и клавиатура перекрывает модальное окно.
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const [supplierId, setSupplierId] = useState('')
  const [docNumber, setDocNumber] = useState('')
  const [note, setNote] = useState('')

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')
    const { data, error: insertError } = await supabase.from('stock_receipts').insert({
      tenant_id: tenantId,
      supplier_id: supplierId || null,
      document_number: docNumber.trim() || null,
      note: note.trim() || null,
      created_by: userId,
      // status не шлём: у документа по умолчанию 'draft', и проводится он
      // только функцией apply_stock_receipt — руками статус не ставят.
    }).select('id').single()
    setBusy(false)
    if (insertError || !data) {
      setErr(insertError?.message ?? 'Не вдалося створити приймання')
      return
    }
    // Пустой документ бесполезен, поэтому сразу уводим на экран строк.
    router.push(`/app/inventory/receipts/${data.id}`)
  }

  const fmt = (s: string) => new Date(s).toLocaleString('uk-UA', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-wrap items-center gap-2">
        <Link href="/app/inventory" className="btn-ghost">← Склад</Link>
        <Link href="/app/inventory/movements" className="btn-ghost">Журнал рухів</Link>
        {canWrite && (
          <button type="button" className="btn-primary ml-auto h-10 t-md"
                  onClick={() => { setOpen(!open); setErr('') }}>
            {open ? 'Згорнути' : '+ Нове приймання'}
          </button>
        )}
      </div>

      {error && <p className="field-error rise">Не вдалося завантажити приймання: {error}</p>}

      {open && canWrite && (
        <form onSubmit={create} className="card rise grid gap-3 sm:grid-cols-2">
          <p className="display t-lg sm:col-span-2">Нове приймання</p>

          <div>
            <label className="field-label">Постачальник</label>
            <select className="select" value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">— не вказано —</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {suppliers.length === 0 && (
              <p className="field-hint">
                Постачальників ще немає — їх заводять у довідниках на складі.
                Приймання можна створити й без нього.
              </p>
            )}
          </div>

          <div>
            <label className="field-label">Номер накладної</label>
            <input className="input" placeholder="з паперу постачальника"
                   value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />
          </div>

          <div className="sm:col-span-2">
            <label className="field-label">Примітка</label>
            <input className="input" placeholder="Коробка від 4 серпня, привіз водій"
                   value={note} onChange={(e) => setNote(e.target.value)} />
            <p className="field-hint">
              Примітка потрапить у кожен рух залишку з цього документа —
              через півроку саме за нею шукають, звідки взявся залишок.
            </p>
          </div>

          {err && <p className="field-error sm:col-span-2">{err}</p>}

          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-primary" disabled={busy}>Створити й додати позиції</button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              Скасувати
            </button>
          </div>
        </form>
      )}

      <section className="card rise-1 !p-0">
        {receipts.length === 0 ? (
          <div className="empty">
            Приймань ще не було. Залишок набирається саме звідси: заведіть
            документ, впишіть, що прийшло, і проведіть його.
            {canWrite && (
              <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
                Створити приймання
              </button>
            )}
          </div>
        ) : receipts.map((r) => (
          <Link key={r.id} href={`/app/inventory/receipts/${r.id}`} className="row px-5">
            <div className="min-w-0">
              <p className="tabular t-md truncate">
                {r.number ? `№${r.number}` : 'Без номера'}
                {r.supplier ? <span className="prose-muted"> · {r.supplier}</span> : null}
              </p>
              <p className="tabular t-xs mt-0.5 prose-muted">
                {fmt(r.createdAt)} · {r.lines === 0 ? 'жодного рядка' : `рядків: ${r.lines}`}
                {r.appliedAt ? ` · проведено ${fmt(r.appliedAt)}` : ''}
              </p>
            </div>
            <span className={receiptBadge(r.status)}>
              {RECEIPT_STATUS_LABEL[r.status] ?? r.status}
            </span>
          </Link>
        ))}
      </section>

      <p className="field-hint">
        Проведене приймання не редагується: воно вже змінило залишок.
        Помилку в ньому гасять зустрічним рухом у журналі, а не правкою
        документа заднім числом.
      </p>
    </div>
  )
}
