'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import type { Key } from '@/lib/i18n/dict'
import type { T } from '@/lib/i18n/translate'
import type { RefItem } from '../material-form'
import { dbErrorText } from '@/lib/errors/db'

// Значения enum stock_receipt_status из 0003_inventory.sql — дословно.
// Четвёртого состояния нет: документ либо готовится, либо уже изменил
// остаток, либо отброшен до проведения.
//
// Само значение (`draft`) не переводится — это ключ, по которому сверяется
// база. Переводится подпись, и связь «значение → ключ словаря» живёт
// в одном месте: её читают и перечень, и карточка документа.
const RECEIPT_STATUS_KEY: Record<string, Key> = {
  draft: 'inventory.receipt.status.draft',
  applied: 'inventory.receipt.status.applied',
  cancelled: 'inventory.receipt.status.cancelled',
}

/** Подпись статуса. Неизвестное значение показываем как есть. */
export function receiptStatusLabel(t: T, status: string): string {
  const key = RECEIPT_STATUS_KEY[status]
  return key ? t(key) : status
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
  const t = useT()
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
      setErr(insertError ? dbErrorText(t, insertError) : t('inventory.receipts.createFailed'))
      return
    }
    // Пустой документ бесполезен, поэтому сразу уводим на экран строк.
    router.push(`/app/inventory/receipts/${data.id}`)
  }

  // Дата и время — через `t.dateTime`, а не ручной сборкой из частей.
  const fmt = (v: string) => t.dateTime(v, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-wrap items-center gap-2">
        <Link href="/app/inventory" className="btn-ghost">← {t('inventory.link.stock')}</Link>
        <Link href="/app/inventory/movements" className="btn-ghost">
          {t('inventory.link.movements')}
        </Link>
        {canWrite && (
          <button type="button" className="btn-primary ml-auto t-md"
                  onClick={() => { setOpen(!open); setErr('') }}>
            {open ? t('inventory.collapse') : t('inventory.receipts.new')}
          </button>
        )}
      </div>

      {/* Текст отказа базы показывается как есть — это её слова, не наши. */}
      {error && (
        <p className="field-error rise">{t('inventory.receipts.loadError')}: {error}</p>
      )}

      {open && canWrite && (
        <form onSubmit={create} className="card rise grid gap-3 sm:grid-cols-2">
          <p className="display t-lg sm:col-span-2">{t('inventory.receipts.form.title')}</p>

          <div>
            <label className="field-label">{t('inventory.receipts.form.supplier.label')}</label>
            <select className="select" value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">{t('inventory.common.notSet')}</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {suppliers.length === 0 && (
              <p className="field-hint">{t('inventory.receipts.form.supplier.hint')}</p>
            )}
          </div>

          <div>
            <label className="field-label">{t('inventory.receipts.form.number.label')}</label>
            <input className="input" placeholder={t('inventory.receipts.form.number.placeholder')}
                   value={docNumber} onChange={(e) => setDocNumber(e.target.value)} />
          </div>

          <div className="sm:col-span-2">
            <label className="field-label">{t('inventory.receipts.form.note.label')}</label>
            <input className="input" placeholder={t('inventory.receipts.form.note.placeholder')}
                   value={note} onChange={(e) => setNote(e.target.value)} />
            <p className="field-hint">{t('inventory.receipts.form.note.hint')}</p>
          </div>

          {err && <p className="field-error sm:col-span-2">{err}</p>}

          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-primary" disabled={busy}>
              {t('inventory.receipts.form.submit')}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      <section className="card rise-1 !p-0">
        {receipts.length === 0 ? (
          <div className="empty">
            {t('inventory.receipts.empty')}
            {canWrite && (
              <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
                {t('inventory.receipts.create')}
              </button>
            )}
          </div>
        ) : receipts.map((r) => (
          <Link key={r.id} href={`/app/inventory/receipts/${r.id}`} className="row px-5">
            <div className="min-w-0">
              <p className="tabular t-md truncate">
                {/* Номер накладной — данные арендатора. */}
                {r.number ? `№${r.number}` : t('inventory.receipts.row.noNumber')}
                {r.supplier ? <span className="prose-muted"> · {r.supplier}</span> : null}
              </p>
              <p className="tabular t-xs mt-0.5 prose-muted">
                {fmt(r.createdAt)} · {r.lines === 0
                  ? t('inventory.receipts.row.noLines')
                  : t('inventory.receipts.row.lines', { n: t.number(r.lines) })}
                {r.appliedAt
                  ? ` · ${t('inventory.receipts.row.applied', { date: fmt(r.appliedAt) })}`
                  : ''}
              </p>
            </div>
            <span className={receiptBadge(r.status)}>
              {receiptStatusLabel(t, r.status)}
            </span>
          </Link>
        ))}
      </section>

      <p className="field-hint">{t('inventory.receipts.hint')}</p>
    </div>
  )
}
