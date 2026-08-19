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
import { Sheet } from '@/components/sheet'
import { IconInbox } from '@/components/icons'

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

/** Фильтр списка. Задаётся плиткой-счётчиком, как на экране склада. */
type Flag = 'all' | 'draft' | 'applied' | 'cancelled'

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
  // Форма — шторкой снизу, как все формы кабинета. Прежний довод «форма
  // на странице, потому что клавиатура перекрывает модалку» устарел:
  // Sheet порталится в body, держит высоту в dvh и запас под клавиатуру,
  // а кнопка отправки прижата футером и с экрана не уезжает.
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [flag, setFlag] = useState<Flag>('all')

  const [supplierId, setSupplierId] = useState('')
  const [docNumber, setDocNumber] = useState('')
  const [note, setNote] = useState('')

  // ── Счётчики, они же фильтр ──────────────────────────────────────────
  // Тон несёт состояние документа, тем же смыслом, что и бейдж строки:
  // amber — черновик ждёт работы, emerald — проведено, blue — скасовано
  // (это не беда, а отброшенная заготовка; rose кричал бы об ошибке,
  // которой нет). Плитка с нулём не нажимается: фильтр, дающий пустой
  // список, — обещание показать то, чего нет.
  const stats = useMemo(() => {
    const count = (s: string) => receipts.filter((r) => r.status === s).length
    return [
      { key: 'draft', n: count('draft'), label: t('inventory.receipts.metric.draft'), tone: 'amber' },
      { key: 'applied', n: count('applied'), label: t('inventory.receipts.metric.applied'), tone: 'emerald' },
      { key: 'cancelled', n: count('cancelled'), label: t('inventory.receipts.metric.cancelled'), tone: 'blue' },
    ] as const
  }, [receipts, t])

  const shown = flag === 'all' ? receipts : receipts.filter((r) => r.status === flag)

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
      {/* Ошибка загрузки приходит уже обезличенной (dbErrorText на сервере). */}
      {error && (
        <p className="field-error rise">{t('inventory.receipts.loadError')}: {error}</p>
      )}

      {/* ── Счётчики, они же фильтр ────────────────────────────── */}
      <section className="rise grid grid-cols-3 gap-2">
        {stats.map((s) => {
          const on = flag === s.key
          const dead = s.n === 0 && !on
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

      {/* Единственная кнопка создания — над списком. В пустом состоянии
          её нет: там та же кнопка стоит в `.empty-actions`, и две кнопки
          одного действия в двадцати сантиметрах друг от друга — тот самый
          дубляж, из-за которого переделывался склад. */}
      {canWrite && receipts.length > 0 && (
        <button type="button" className="btn-primary self-start"
                onClick={() => { setOpen(true); setErr('') }}>
          {t('inventory.receipts.new')}
        </button>
      )}

      <section className="card rise-1 !p-0">
        {shown.length === 0 ? (
          <div className="empty">
            <span className="empty-icon"><IconInbox size={24} /></span>
            <p className="empty-title">
              {receipts.length === 0
                ? t('inventory.receipts.empty.title')
                : t('inventory.empty.filteredTitle')}
            </p>
            <p className="empty-desc">
              {receipts.length === 0
                ? t('inventory.receipts.empty.desc')
                : t('inventory.empty.filtered')}
            </p>
            {/* Без права на запись кнопки нет вовсе — пустой ряд действий
                оставил бы под текстом висящий отступ. */}
            {(receipts.length > 0 || canWrite) && (
              <div className="empty-actions">
                {receipts.length === 0 ? (
                  <button type="button" className="btn-primary"
                          onClick={() => { setOpen(true); setErr('') }}>
                    {t('inventory.receipts.create')}
                  </button>
                ) : (
                  <button type="button" className="btn-secondary" onClick={() => setFlag('all')}>
                    {t('inventory.filter.reset')}
                  </button>
                )}
              </div>
            )}
          </div>
        ) : shown.map((r) => (
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

      {/* ── Форма нового приймання ─────────────────────────────── */}
      <Sheet open={open && canWrite} onClose={() => setOpen(false)}
             title={t('inventory.receipts.form.title')}
             footer={
               <button form="receipt-form" className="btn-primary w-full" disabled={busy}>
                 {t('inventory.receipts.form.submit')}
               </button>
             }>
        {/* id связывает кнопку футера с формой: футер лежит вне <form>. */}
        <form id="receipt-form" onSubmit={create} className="grid gap-3">
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

          <div>
            <label className="field-label">{t('inventory.receipts.form.note.label')}</label>
            <input className="input" placeholder={t('inventory.receipts.form.note.placeholder')}
                   value={note} onChange={(e) => setNote(e.target.value)} />
            <p className="field-hint">{t('inventory.receipts.form.note.hint')}</p>
          </div>

          {err && <p className="field-error">{err}</p>}
        </form>
      </Sheet>
    </div>
  )
}
