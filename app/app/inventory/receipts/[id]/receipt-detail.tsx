'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import type { RefItem } from '../../material-form'
import { RECEIPT_STATUS_LABEL, receiptBadge } from '../receipts-client'

export type ReceiptCard = {
  id: string
  number: string | null
  status: string
  note: string | null
  supplierId: string | null
  createdAt: string
  appliedAt: string | null
}

export type ReceiptLine = {
  id: string
  kind: 'material' | 'goods'
  title: string
  unit: string
  quantity: number
  unitCost: number | null
}

export type ItemOption = { id: string; name: string; unit: string }

// База отвечает по-русски и словами разработчика. Продавцу в цеху это
// ничего не объясняет, поэтому известные отказы переводим, а незнакомый
// текст показываем как есть — глотать ошибку хуже, чем показать сырую.
function humanize(message: string): string {
  if (message.includes('нет ни одной строки')) {
    return 'У приймання немає жодного рядка — додайте хоча б одну позицію.'
  }
  if (message.includes('уже проведена или отменена')) {
    return 'Це приймання вже проведено або скасовано. Оновіть сторінку.'
  }
  if (message.includes('документ уже применён')) {
    return 'Документ проведено — правити його заднім числом не можна.'
  }
  if (message.includes('недостаточно прав')) {
    return 'Немає права змінювати склад (stock.write). Попросіть власника магазину видати його.'
  }
  if (message.includes('позиция не найдена')) {
    return 'Позицію не знайдено у цьому магазині — можливо, її видалили.'
  }
  return message
}

export function ReceiptDetail({
  receipt, lines, materials, variants, suppliers, canWrite, loadError,
}: {
  receipt: ReceiptCard
  lines: ReceiptLine[]
  materials: ItemOption[]
  variants: ItemOption[]
  suppliers: RefItem[]
  canWrite: boolean
  loadError: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const draft = receipt.status === 'draft'
  const editable = draft && canWrite

  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')

  // Строка: ровно один из variant_id / material_id — это check-constraint
  // базы, поэтому в интерфейсе выбор сделан переключателем, а не двумя
  // полями, которые можно заполнить оба.
  const [kind, setKind] = useState<'material' | 'goods'>('material')
  const [itemId, setItemId] = useState('')
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState('')

  const [editHeader, setEditHeader] = useState(false)
  const [supplierId, setSupplierId] = useState(receipt.supplierId ?? '')
  const [docNumber, setDocNumber] = useState(receipt.number ?? '')
  const [note, setNote] = useState(receipt.note ?? '')

  const options = kind === 'material' ? materials : variants
  const unit = options.find((o) => o.id === itemId)?.unit ?? ''

  const total = lines.reduce(
    (sum, l) => sum + (l.unitCost != null ? l.unitCost * l.quantity : 0), 0,
  )

  async function addLine(e: React.FormEvent) {
    e.preventDefault()
    setBusy('add'); setErr('')
    const { error } = await supabase.from('stock_receipt_lines').insert({
      receipt_id: receipt.id,
      variant_id: kind === 'goods' ? itemId : null,
      material_id: kind === 'material' ? itemId : null,
      quantity: Number(qty),
      unit_cost: cost.trim() ? Number(cost) : null,
    })
    setBusy(null)
    if (error) { setErr(humanize(error.message)); return }
    // Следующая позиция обычно другая, а цена — своя: сбрасываем всё,
    // кроме вида, чтобы не переключать его на каждой строке коробки.
    setItemId(''); setQty(''); setCost('')
    router.refresh()
  }

  async function removeLine(lineId: string) {
    setBusy(lineId); setErr('')
    const { error } = await supabase.from('stock_receipt_lines').delete().eq('id', lineId)
    setBusy(null)
    if (error) { setErr(humanize(error.message)); return }
    router.refresh()
  }

  async function saveHeader(e: React.FormEvent) {
    e.preventDefault()
    setBusy('header'); setErr('')
    const { error } = await supabase.from('stock_receipts').update({
      supplier_id: supplierId || null,
      document_number: docNumber.trim() || null,
      note: note.trim() || null,
    }).eq('id', receipt.id)
    setBusy(null)
    if (error) { setErr(humanize(error.message)); return }
    setEditHeader(false)
    router.refresh()
  }

  async function apply() {
    if (!confirm('Провести приймання? Залишок зміниться, і документ стане незмінним.')) return
    setBusy('apply'); setErr('')
    // Единственный путь: функция в одной транзакции пишет движения по всем
    // строкам и помечает документ проведённым. Обновить остаток напрямую
    // не даст триггер-охранник (CLAUDE.md, правило 5).
    const { error } = await supabase.rpc('apply_stock_receipt', { p_receipt_id: receipt.id })
    setBusy(null)
    if (error) { setErr(humanize(error.message)); return }
    router.refresh()
  }

  async function cancelDraft() {
    if (!confirm('Скасувати чернетку? Залишок вона не змінить, документ лишиться в списку.')) return
    setBusy('cancel'); setErr('')
    const { error } = await supabase.from('stock_receipts')
      .update({ status: 'cancelled' }).eq('id', receipt.id)
    setBusy(null)
    if (error) { setErr(humanize(error.message)); return }
    router.refresh()
  }

  const fmt = (s: string) => new Date(s).toLocaleString('uk-UA', {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-wrap items-center gap-2">
        <Link href="/app/inventory/receipts" className="btn-ghost">← Усі приймання</Link>
        <Link href="/app/inventory" className="btn-ghost">Склад</Link>
        <span className={`${receiptBadge(receipt.status)} ml-auto`}>
          {RECEIPT_STATUS_LABEL[receipt.status] ?? receipt.status}
        </span>
      </div>

      {loadError && <p className="field-error rise">Рядки не завантажились: {loadError}</p>}
      {err && <p className="field-error rise">{err}</p>}

      {/* Шапка документа */}
      <section className="card rise-1">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="tabular t-lg">
              {receipt.number ? `Накладна №${receipt.number}` : 'Без номера накладної'}
            </p>
            <p className="tabular t-xs mt-0.5 prose-muted">
              створено {fmt(receipt.createdAt)}
              {receipt.appliedAt ? ` · проведено ${fmt(receipt.appliedAt)}` : ''}
            </p>
            {receipt.note && <p className="t-md mt-2 prose-muted">{receipt.note}</p>}
          </div>
          {editable && (
            <button type="button" className="btn-secondary h-10 t-md"
                    onClick={() => setEditHeader(!editHeader)}>
              {editHeader ? 'Згорнути' : 'Змінити'}
            </button>
          )}
        </div>

        {editable && editHeader && (
          <form onSubmit={saveHeader} className="mt-4 grid gap-3 sm:grid-cols-2">
            <div>
              <label className="field-label">Постачальник</label>
              <select className="select" value={supplierId}
                      onChange={(e) => setSupplierId(e.target.value)}>
                <option value="">— не вказано —</option>
                {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="field-label">Номер накладної</label>
              <input className="input" value={docNumber}
                     onChange={(e) => setDocNumber(e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <label className="field-label">Примітка</label>
              <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
            </div>
            <div className="flex gap-2 sm:col-span-2">
              <button className="btn-primary" disabled={busy !== null}>Зберегти</button>
              <button type="button" className="btn-ghost" onClick={() => setEditHeader(false)}>
                Скасувати
              </button>
            </div>
          </form>
        )}
      </section>

      {/* Добавление строки — только в черновике */}
      {editable && (
        <form onSubmit={addLine} className="card rise-2 grid gap-3 sm:grid-cols-2">
          <p className="display t-lg sm:col-span-2">Що прийшло</p>

          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="button" className={kind === 'material' ? 'chip-active' : 'chip'}
                    onClick={() => { setKind('material'); setItemId('') }}>
              Витратний засіб
            </button>
            <button type="button" className={kind === 'goods' ? 'chip-active' : 'chip'}
                    onClick={() => { setKind('goods'); setItemId('') }}>
              Товар
            </button>
          </div>

          <div className="sm:col-span-2">
            <label className="field-label">Позиція</label>
            <select required className="select" value={itemId}
                    onChange={(e) => setItemId(e.target.value)}>
              <option value="">— оберіть —</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            {options.length === 0 && (
              <p className="field-hint">
                {kind === 'material'
                  ? 'Витратних засобів ще немає — заведіть їх на складі.'
                  : 'Товарів з обліком залишку ще немає — заведіть їх у каталозі.'}
              </p>
            )}
          </div>

          <div>
            <label className="field-label">Кількість{unit ? `, ${unit}` : ''}</label>
            {/* Залишок товару в базі цілий (offering_variants.stock_qty — int),
                тому дробову кількість тут не приймаємо: вона мовчки округлилась би.
                У витратних засобів залишок numeric — там дроби доречні. */}
            <input required type="number" className="input"
                   min={kind === 'goods' ? '1' : '0.001'}
                   step={kind === 'goods' ? '1' : 'any'}
                   value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>

          <div>
            <label className="field-label">Ціна за одиницю, ₴</label>
            <input type="number" min="0" step="0.01" className="input" placeholder="не обовʼязково"
                   value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>

          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-primary" disabled={busy !== null || !itemId || !qty}>
              Додати рядок
            </button>
          </div>
        </form>
      )}

      {/* Строки */}
      <section className="card rise-3 !p-0">
        <div className="flex items-center justify-between gap-3 px-5 pt-5">
          <h2 className="t-lg">Рядки</h2>
          {total > 0 && (
            <span className="tabular t-md">
              на суму {total.toLocaleString('uk-UA')} ₴
            </span>
          )}
        </div>
        <div className="px-5">
          {lines.length === 0 ? (
            <div className="empty">
              Порожнє приймання провести не можна — база відмовить.
              Додайте хоча б один рядок.
            </div>
          ) : lines.map((l) => (
            <div key={l.id} className="row">
              <div className="min-w-0">
                <p className="t-md truncate">{l.title}</p>
                <p className="tabular t-xs mt-0.5 prose-muted">
                  {l.kind === 'material' ? 'витратний засіб' : 'товар'}
                  {l.unitCost != null ? ` · ${l.unitCost.toLocaleString('uk-UA')} ₴ за ${l.unit || 'од.'}` : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="badge tabular">{l.quantity} {l.unit}</span>
                {editable && (
                  <button type="button" className="btn-icon" title="Видалити рядок"
                          disabled={busy !== null}
                          onClick={() => void removeLine(l.id)}>
                    ✕
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Проведение */}
        <div className="flex flex-wrap items-center gap-2 px-5 pb-5 pt-4">
          {editable ? (
            <>
              <button type="button" className="btn-primary"
                      disabled={busy !== null || lines.length === 0}
                      onClick={() => void apply()}>
                Провести приймання
              </button>
              <button type="button" className="btn-danger" disabled={busy !== null}
                      onClick={() => void cancelDraft()}>
                Скасувати чернетку
              </button>
            </>
          ) : (
            <p className="t-md prose-muted">
              {receipt.status === 'applied'
                ? 'Документ проведено — залишок уже змінено, і правити його не можна. Помилку гасять зустрічним рухом у журналі.'
                : receipt.status === 'cancelled'
                  ? 'Приймання скасовано до проведення — на залишок воно не вплинуло.'
                  : 'Немає права змінювати склад, тому документ доступний лише для перегляду.'}
            </p>
          )}
        </div>
      </section>

      {editable && (
        <p className="field-hint">
          Проведення — необоротна дія: кожен рядок стане рухом «прихід»
          і збільшить залишок однією транзакцією. Після цього документ
          закривається на правки назавжди.
        </p>
      )}
    </div>
  )
}
