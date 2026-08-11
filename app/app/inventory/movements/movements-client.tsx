'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Значения enum stock_movement_type из 0003_inventory.sql, в том же порядке.
export const MOVEMENT_TYPES: string[] = [
  'receipt', 'sale', 'write_off', 'return', 'adjustment', 'transfer_out', 'transfer_in',
]

export const MOVEMENT_LABEL: Record<string, string> = {
  receipt: 'прихід',
  sale: 'продаж',
  write_off: 'списання',
  return: 'повернення',
  adjustment: 'коригування',
  transfer_out: 'переміщення зі складу',
  transfer_in: 'переміщення на склад',
}

// Цвет по смыслу для продавца: зелёное — остаток вырос, красное — ушёл,
// жёлтое — расхождение, которое кто-то должен объяснить.
function movementBadge(type: string): string {
  switch (type) {
    case 'receipt':
    case 'return':
    case 'transfer_in':
      return 'badge-success'
    case 'sale':
    case 'write_off':
    case 'transfer_out':
      return 'badge-danger'
    case 'adjustment':
      return 'badge-warn'
    default:
      return 'badge'
  }
}

// reference_type пишут функции базы: приёмка, инвентаризация, заказ, запись.
const SOURCE_LABEL: Record<string, string> = {
  stock_receipt: 'з приймання',
  stock_count: 'з інвентаризації',
  order: 'із замовлення',
  booking: 'із запису',
  manual: 'вручну',
}

export type MovementRow = {
  id: string
  type: string
  quantity: number
  unit: string
  title: string
  kind: 'material' | 'goods'
  referenceType: string | null
  receiptId: string | null
  countId: string | null
  note: string | null
  createdAt: string
}

type ItemOption = { id: string; name: string; unit: string }

function humanize(message: string): string {
  if (message.includes('недостаточно прав')) {
    return 'Немає права змінювати склад (stock.write). Попросіть власника магазину видати його.'
  }
  if (message.includes('требует авторизованного пользователя')) {
    return 'Сесія завершилась — увійдіть знову.'
  }
  if (message.includes('позиция не найдена')) {
    return 'Позицію не знайдено у цьому магазині — можливо, її видалили.'
  }
  if (message.includes('ровно один')) {
    return 'У русі має бути або товар, або витратний засіб — не обидва.'
  }
  // Остаток не может уйти в минус: это check-constraint на самих таблицах,
  // а не проверка в коде, поэтому ловим его по имени ограничения.
  if (message.includes('current_stock_check') || message.includes('stock_nonneg')) {
    return 'Списати більше, ніж є на залишку, не можна. Перевірте кількість.'
  }
  return message
}

// Журнал движений. Строки только читаются: записи в stock_movements
// делают функции базы, прямой insert для приложения сознательно закрыт.
export function MovementsClient({
  tenantId, canWrite, movements, materials, variants, active, error,
}: {
  tenantId: string
  canWrite: boolean
  movements: MovementRow[]
  materials: ItemOption[]
  variants: ItemOption[]
  active: string
  error: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const [type, setType] = useState<'write_off' | 'return'>('write_off')
  const [kind, setKind] = useState<'material' | 'goods'>('material')
  const [itemId, setItemId] = useState('')
  const [qty, setQty] = useState('')
  const [note, setNote] = useState('')

  // Ключ идемпотентности живёт до успеха: двойное нажатие по кнопке
  // (обычное дело на телефоне) не спишет остаток дважды, а неудачная
  // попытка ничего не вставила — тот же ключ можно переиспользовать.
  const opKey = useRef('')

  const options = kind === 'material' ? materials : variants
  const unit = options.find((o) => o.id === itemId)?.unit ?? ''

  function go(next: string) {
    router.push(next === 'all'
      ? '/app/inventory/movements'
      : `/app/inventory/movements?type=${next}`)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')
    if (!opKey.current) opKey.current = crypto.randomUUID()

    // ЗНАК. База проверяет его check'ом по типу движения: 'write_off'
    // обязан быть отрицательным, 'return' — положительным. Функция просто
    // прибавляет это число к остатку, поэтому знак ставим здесь и явно.
    const amount = Math.abs(Number(qty))
    const { error: rpcError } = await supabase.rpc('record_stock_movement', {
      p_tenant_id: tenantId,
      p_movement_type: type,
      p_quantity: type === 'write_off' ? -amount : amount,
      ...(kind === 'goods' ? { p_variant_id: itemId } : { p_material_id: itemId }),
      p_reference_type: 'manual',
      p_note: note.trim(),
      p_idempotency_key: opKey.current,
    })
    setBusy(false)
    if (rpcError) { setErr(humanize(rpcError.message)); return }
    opKey.current = ''
    setItemId(''); setQty(''); setNote('')
    router.refresh()
  }

  const fmt = (s: string) => new Date(s).toLocaleString('uk-UA', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-wrap items-center gap-2">
        <Link href="/app/inventory" className="btn-ghost">← Склад</Link>
        <Link href="/app/inventory/receipts" className="btn-ghost">Приймання</Link>
        {canWrite && (
          <button type="button" className="btn-primary ml-auto t-md"
                  onClick={() => { setOpen(!open); setErr('') }}>
            {open ? 'Згорнути' : 'Списати або повернути'}
          </button>
        )}
      </div>

      {error && <p className="field-error rise">Не вдалося завантажити журнал: {error}</p>}

      {open && canWrite && (
        <form onSubmit={submit} className="card rise grid gap-3 sm:grid-cols-2">
          <p className="display t-lg sm:col-span-2">Ручний рух</p>

          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="button" className={type === 'write_off' ? 'chip-active' : 'chip'}
                    onClick={() => setType('write_off')}>
              Списання
            </button>
            <button type="button" className={type === 'return' ? 'chip-active' : 'chip'}
                    onClick={() => setType('return')}>
              Повернення на склад
            </button>
          </div>

          <p className="field-hint sm:col-span-2 !mt-0">
            Руками доступні лише ці два рухи. Продаж списує залишок сам —
            у момент завершення замовлення чи запису, а розбіжності після
            перерахунку проводить інвентаризація. Ставити такі рухи вручну
            означало б порахувати те саме двічі.
          </p>

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
          </div>

          <div>
            <label className="field-label">Кількість{unit ? `, ${unit}` : ''}</label>
            {/* Вводиться завжди додатне число: знак ставить не людина,
                а тип руху — так помилитися в ньому неможливо. */}
            <input required type="number" className="input"
                   min={kind === 'goods' ? '1' : '0.001'}
                   step={kind === 'goods' ? '1' : 'any'}
                   value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>

          <div>
            <label className="field-label">Причина</label>
            <input required className="input"
                   placeholder={type === 'write_off' ? 'Розбилась банка' : 'Клієнт повернув товар'}
                   value={note} onChange={(e) => setNote(e.target.value)} />
            <p className="field-hint">
              Обовʼязково. Списання без причини через півроку не пояснить
              ні бухгалтер, ні перевірка.
            </p>
          </div>

          {err && <p className="field-error sm:col-span-2">{err}</p>}

          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-primary" disabled={busy || !itemId || !qty || !note.trim()}>
              {type === 'write_off' ? 'Списати' : 'Повернути на склад'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              Скасувати
            </button>
          </div>
        </form>
      )}

      {/* Фильтр по типу */}
      <div className="rise-1 flex flex-wrap items-center gap-2">
        <button onClick={() => go('all')} className={active === 'all' ? 'chip-active' : 'chip'}>
          Усі
        </button>
        {MOVEMENT_TYPES.map((t) => (
          <button key={t} onClick={() => go(t)} className={active === t ? 'chip-active' : 'chip'}>
            {MOVEMENT_LABEL[t]}
          </button>
        ))}
      </div>

      <section className="card rise-2 !p-0">
        {movements.length === 0 ? (
          <div className="empty">
            {active === 'all'
              ? 'Рухів ще не було. Перший зʼявиться, щойно ви проведете приймання — саме з нього набирається залишок.'
              : 'Рухів цього типу ще не було.'}
          </div>
        ) : movements.map((mv) => (
          <div key={mv.id} className="row px-5">
            <div className="min-w-0">
              <p className="t-md truncate">{mv.title}</p>
              <p className="tabular t-xs mt-0.5 prose-muted">
                {fmt(mv.createdAt)}
                {' · '}{mv.kind === 'material' ? 'витратний засіб' : 'товар'}
                {mv.referenceType
                  ? ` · ${SOURCE_LABEL[mv.referenceType] ?? mv.referenceType}`
                  : ''}
              </p>
              {mv.note && <p className="t-xs mt-0.5 truncate prose-muted">{mv.note}</p>}
              {mv.receiptId && (
                <Link href={`/app/inventory/receipts/${mv.receiptId}`}
                      className="t-xs mt-1 inline-block underline">
                  відкрити документ приймання
                </Link>
              )}
              {mv.countId && !mv.receiptId && (
                <p className="t-xs mt-0.5 prose-muted">за документом інвентаризації</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="tabular t-md">
                {mv.quantity > 0 ? '+' : ''}{mv.quantity} {mv.unit}
              </span>
              <span className={movementBadge(mv.type)}>
                {MOVEMENT_LABEL[mv.type] ?? mv.type}
              </span>
            </div>
          </div>
        ))}
      </section>

      <p className="field-hint">
        Рядок журналу не редагується і не видаляється — ні вами, ні нами:
        це джерело правди про залишок, а не нотатник. Помилковий рух гасять
        зустрічним (списали зайве — проведіть повернення на ту саму кількість),
        і в історії лишаються обидва. Саме тому «залишок» і «журнал» тут
        не можуть розійтися.
      </p>

      {movements.length >= 200 && (
        <p className="field-hint">
          Показано останні 200 рухів. Оберіть тип, щоб побачити глибше.
        </p>
      )}
    </div>
  )
}
