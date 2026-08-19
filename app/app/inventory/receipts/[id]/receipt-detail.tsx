'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import { noteIfImmutable } from '@/lib/security-log'
import type { T } from '@/lib/i18n/translate'
import type { RefItem } from '../../material-form'
import { receiptBadge, receiptStatusLabel } from '../receipts-client'
import { dbErrorText } from '@/lib/errors/db'
import { Sheet } from '@/components/sheet'
import { useConfirm } from '@/components/confirm'
import { IconClose, IconInbox } from '@/components/icons'

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
// текст уходит в общий обезличенный разбор.
//
// Подстроки, по которым разбирается отказ, — текст миграции, а не строка
// интерфейса: в словарь едет только наш ответ.
function humanize(t: T, message: string): string {
  if (message.includes('нет ни одной строки')) {
    return t('inventory.receipt.error.noLines')
  }
  if (message.includes('уже проведена или отменена')) {
    return t('inventory.receipt.error.applied')
  }
  if (message.includes('документ уже применён')) {
    return t('inventory.receipt.error.locked')
  }
  if (message.includes('недостаточно прав')) {
    return t('inventory.error.stockWrite')
  }
  if (message.includes('позиция не найдена')) {
    return t('inventory.error.itemMissing')
  }
  // Незнакомое базе-специфичное сюда не доходит: общий разбор
  // (`lib/errors/db.ts`) не отдаёт человеку сырой текст Postgres.
  return dbErrorText(t, { message })
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
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const confirm = useConfirm()
  const draft = receipt.status === 'draft'
  const editable = draft && canWrite

  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')

  // Обе формы экрана — шторкой снизу, как всюду в кабинете: раздвигающийся
  // блок уводил список строк вниз. Открыта максимум одна.
  const [sheet, setSheet] = useState<'header' | 'line' | null>(null)

  // Строка: ровно один из variant_id / material_id — это check-constraint
  // базы, поэтому в интерфейсе выбор сделан переключателем, а не двумя
  // полями, которые можно заполнить оба.
  const [kind, setKind] = useState<'material' | 'goods'>('material')
  const [itemId, setItemId] = useState('')
  const [qty, setQty] = useState('')
  const [cost, setCost] = useState('')

  const [supplierId, setSupplierId] = useState(receipt.supplierId ?? '')
  const [docNumber, setDocNumber] = useState(receipt.number ?? '')
  const [note, setNote] = useState(receipt.note ?? '')

  const options = kind === 'material' ? materials : variants
  const unit = options.find((o) => o.id === itemId)?.unit ?? ''

  // Цена в строке необязательна, поэтому «итог» может считать не всё.
  // Число оценённых строк показывается рядом с суммой: итог, молча
  // пропустивший половину строк, читается как полный — и врёт.
  const priced = lines.filter((l) => l.unitCost != null)
  const total = priced.reduce((sum, l) => sum + (l.unitCost ?? 0) * l.quantity, 0)

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
    if (error) { setErr(humanize(t, error.message)); return }
    // Шторка НЕ закрывается: приёмку набивают стоя над коробкой, строка
    // за строкой. Сбрасываем всё, кроме вида, — следующая позиция обычно
    // другая, а переключать «засіб/товар» на каждой строке не приходится.
    setItemId(''); setQty(''); setCost('')
    router.refresh()
  }

  async function removeLine(lineId: string) {
    setBusy(lineId); setErr('')
    const { error } = await supabase.from('stock_receipt_lines').delete().eq('id', lineId)
    setBusy(null)
    if (error) {
      // Сторож проведённой накладной (0066/0069) роняет транзакцию, поэтому
      // записать событие изнутри неё нельзя — оно откатилось бы вместе
      // с попыткой. Пишем отсюда, уже снаружи (0085, решение 4).
      void noteIfImmutable(supabase, error.message, 'накладна: рядок')
      setErr(humanize(t, error.message)); return
    }
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
    if (error) {
      void noteIfImmutable(supabase, error.message, 'накладна: шапка')
      setErr(humanize(t, error.message)); return
    }
    setSheet(null)
    router.refresh()
  }

  async function apply() {
    // Подтверждение — шторкой, а не window.confirm: системное окно рисуется
    // чужим стилем, в обёртке выглядит как сбой и не переводится словарём.
    const ok = await confirm({
      title: t('inventory.receipt.apply.confirmTitle'),
      body: t('inventory.receipt.apply.confirmBody'),
      action: t('inventory.receipt.apply.submit'),
    })
    if (!ok) return
    setBusy('apply'); setErr('')
    // Единственный путь: функция в одной транзакции пишет движения по всем
    // строкам и помечает документ проведённым. Обновить остаток напрямую
    // не даст триггер-охранник (CLAUDE.md, правило 5).
    const { error } = await supabase.rpc('apply_stock_receipt', { p_receipt_id: receipt.id })
    setBusy(null)
    if (error) { setErr(humanize(t, error.message)); return }
    router.refresh()
  }

  async function cancelDraft() {
    const ok = await confirm({
      title: t('inventory.receipt.cancel.confirmTitle'),
      body: t('inventory.receipt.cancel.confirmBody'),
      action: t('inventory.receipt.cancel.submit'),
      tone: 'danger',
    })
    if (!ok) return
    setBusy('cancel'); setErr('')
    const { error } = await supabase.from('stock_receipts')
      .update({ status: 'cancelled' }).eq('id', receipt.id)
    setBusy(null)
    if (error) {
      void noteIfImmutable(supabase, error.message, 'накладна: скасування')
      setErr(humanize(t, error.message)); return
    }
    router.refresh()
  }

  // Дата и время — через `t.dateTime`, а не ручной сборкой из частей.
  const fmt = (v: string) => t.dateTime(v, {
    day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="flex flex-col gap-5">
      {/* Ошибка загрузки приходит уже обезличенной (dbErrorText на сервере). */}
      {loadError && (
        <p className="field-error rise">{t('inventory.receipt.linesError')}: {loadError}</p>
      )}
      {err && <p className="field-error rise">{err}</p>}

      {/* ── Шапка документа ──────────────────────────────────────
          Своей навигации у экрана нет: назад ведёт оболочка. Статус
          живёт здесь же, рядом с номером, — это свойство документа,
          а не экрана. */}
      <section className="card rise">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="tabular t-lg">
              {receipt.number
                ? t('inventory.receipt.title.number', { number: receipt.number })
                : t('inventory.receipt.title.noNumber')}
            </p>
            <p className="tabular t-xs mt-0.5 prose-muted">
              {t('inventory.receipt.created', { date: fmt(receipt.createdAt) })}
              {receipt.appliedAt
                ? ` · ${t('inventory.receipt.appliedAt', { date: fmt(receipt.appliedAt) })}`
                : ''}
            </p>
            {receipt.note && <p className="t-md mt-2 prose-muted">{receipt.note}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <span className={receiptBadge(receipt.status)}>
              {receiptStatusLabel(t, receipt.status)}
            </span>
            {editable && (
              <button type="button" className="btn-secondary t-md"
                      onClick={() => setSheet('header')}>
                {t('inventory.receipt.edit')}
              </button>
            )}
          </div>
        </div>
      </section>

      {/* ── Строки ─────────────────────────────────────────────── */}
      <section className="card rise-1 !p-0">
        <div className="flex items-center justify-between gap-3 px-5 pt-5">
          <h2 className="t-lg">{t('inventory.receipt.lines.title')}</h2>
          {total > 0 && (
            <span className="tabular t-md">
              {/* Честный итог: строки без цены в сумму не попали, и это
                  названо, а не спрятано. */}
              {priced.length === lines.length
                ? t('inventory.receipt.lines.total', { sum: t.money(total) })
                : t('inventory.receipt.lines.totalPartial', {
                    sum: t.money(total),
                    n: t.number(priced.length),
                    m: t.number(lines.length),
                  })}
            </span>
          )}
        </div>
        <div className="px-5">
          {lines.length === 0 ? (
            <div className="empty">
              <span className="empty-icon"><IconInbox size={24} /></span>
              <p className="empty-title">{t('inventory.receipt.lines.emptyTitle')}</p>
              <p className="empty-desc">
                {editable
                  ? t('inventory.receipt.lines.empty')
                  : t('inventory.receipt.lines.emptyReadonly')}
              </p>
              {editable && (
                <div className="empty-actions">
                  <button type="button" className="btn-primary"
                          onClick={() => { setSheet('line'); setErr('') }}>
                    {t('inventory.receipt.lines.addFirst')}
                  </button>
                </div>
              )}
            </div>
          ) : lines.map((l) => (
            <div key={l.id} className="row">
              <div className="min-w-0">
                <p className="t-md truncate">{l.title}</p>
                <p className="tabular t-xs mt-0.5 prose-muted">
                  {l.kind === 'material'
                    ? t('inventory.kind.material')
                    : t('inventory.kind.goods')}
                  {l.unitCost != null
                    ? ` · ${t('inventory.receipt.line.cost', {
                      money: t.money(l.unitCost),
                      unit: l.unit || t('inventory.receipt.line.unitFallback'),
                    })}`
                    : ''}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="badge tabular">{t.number(l.quantity)} {l.unit}</span>
                {editable && (
                  <button type="button" className="btn-icon"
                          title={t('inventory.receipt.line.delete.aria')}
                          aria-label={t('inventory.receipt.line.delete.aria')}
                          disabled={busy !== null}
                          onClick={() => void removeLine(l.id)}>
                    <IconClose size={18} />
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Проведение. «Додати рядок» стоит в этом же ряду, но только при
            непустом списке: на пустом та же кнопка уже есть в `.empty`,
            и двух входов в одно действие на экране быть не должно. */}
        <div className="flex flex-wrap items-center gap-2 px-5 pb-5 pt-4">
          {editable ? (
            <>
              {lines.length > 0 && (
                <button type="button" className="btn-secondary"
                        disabled={busy !== null}
                        onClick={() => { setSheet('line'); setErr('') }}>
                  {t('inventory.receipt.add.submit')}
                </button>
              )}
              <button type="button" className="btn-primary"
                      disabled={busy !== null || lines.length === 0}
                      onClick={() => void apply()}>
                {t('inventory.receipt.apply.submit')}
              </button>
              <button type="button" className="btn-danger" disabled={busy !== null}
                      onClick={() => void cancelDraft()}>
                {t('inventory.receipt.cancel.submit')}
              </button>
            </>
          ) : (
            <p className="t-md prose-muted">
              {receipt.status === 'applied'
                ? t('inventory.receipt.readonly.applied')
                : receipt.status === 'cancelled'
                  ? t('inventory.receipt.readonly.cancelled')
                  : t('inventory.receipt.readonly.noRight')}
            </p>
          )}
        </div>
      </section>

      {editable && (
        <p className="field-hint">{t('inventory.receipt.hint')}</p>
      )}

      {/* ── Правка шапки ─────────────────────────────────────────
          Только в черновике: проведённый документ шапку не отдаёт
          на правку, и кнопки открытия у него нет. */}
      <Sheet open={sheet === 'header' && editable} onClose={() => setSheet(null)}
             title={t('inventory.receipt.edit.sheetTitle')}
             footer={
               <button form="receipt-header-form" className="btn-primary w-full"
                       disabled={busy !== null}>
                 {t('common.save')}
               </button>
             }>
        {/* id связывает кнопку футера с формой: футер лежит вне <form>. */}
        <form id="receipt-header-form" onSubmit={saveHeader} className="grid gap-3">
          <div>
            <label className="field-label">{t('inventory.receipt.field.supplier')}</label>
            <select className="select" value={supplierId}
                    onChange={(e) => setSupplierId(e.target.value)}>
              <option value="">{t('inventory.common.notSet')}</option>
              {suppliers.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="field-label">{t('inventory.receipt.field.number')}</label>
            <input className="input" value={docNumber}
                   onChange={(e) => setDocNumber(e.target.value)} />
          </div>
          <div>
            <label className="field-label">{t('inventory.receipt.field.note')}</label>
            <input className="input" value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
          {err && <p className="field-error">{err}</p>}
        </form>
      </Sheet>

      {/* ── Добавление строки ──────────────────────────────────── */}
      <Sheet open={sheet === 'line' && editable} onClose={() => setSheet(null)}
             title={t('inventory.receipt.add.title')}
             footer={
               <button form="receipt-line-form" className="btn-primary w-full"
                       disabled={busy !== null || !itemId || !qty}>
                 {t('inventory.receipt.add.submit')}
               </button>
             }>
        <form id="receipt-line-form" onSubmit={addLine} className="grid gap-3">
          <div className="flex flex-wrap gap-2">
            <button type="button" className={kind === 'material' ? 'chip-active' : 'chip'}
                    onClick={() => { setKind('material'); setItemId('') }}>
              {t('inventory.pick.material')}
            </button>
            <button type="button" className={kind === 'goods' ? 'chip-active' : 'chip'}
                    onClick={() => { setKind('goods'); setItemId('') }}>
              {t('inventory.pick.goods')}
            </button>
          </div>

          <div>
            <label className="field-label">{t('inventory.receipt.add.item.label')}</label>
            <select required className="select" value={itemId}
                    onChange={(e) => setItemId(e.target.value)}>
              <option value="">{t('inventory.common.choose')}</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            {options.length === 0 && (
              <p className="field-hint">
                {kind === 'material'
                  ? t('inventory.receipt.add.noMaterials')
                  : t('inventory.receipt.add.noGoods')}
              </p>
            )}
          </div>

          <div>
            <label className="field-label">
              {unit
                ? t('inventory.receipt.add.qty.labelUnit', { unit })
                : t('inventory.receipt.add.qty.label')}
            </label>
            {/* Залишок товару в базі цілий (offering_variants.stock_qty — int),
                тому дробову кількість тут не приймаємо: вона мовчки округлилась би.
                У витратних засобів залишок numeric — там дроби доречні. */}
            <input required type="number" className="input"
                   min={kind === 'goods' ? '1' : '0.001'}
                   step={kind === 'goods' ? '1' : 'any'}
                   value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>

          <div>
            <label className="field-label">{t('inventory.receipt.add.cost.label')}</label>
            <input type="number" min="0" step="0.01" className="input"
                   placeholder={t('inventory.receipt.add.cost.placeholder')}
                   value={cost} onChange={(e) => setCost(e.target.value)} />
          </div>

          {err && <p className="field-error">{err}</p>}
        </form>
      </Sheet>

      {confirm.element}
    </div>
  )
}
