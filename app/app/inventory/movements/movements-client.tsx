'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { enqueue, isNetworkError } from '@/lib/offline/queue'
import { useToast } from '@/components/toast'
import { useT } from '@/lib/i18n/client'
import type { Key } from '@/lib/i18n/dict'
import type { T } from '@/lib/i18n/translate'
import { dbErrorText } from '@/lib/errors/db'

// Значения enum stock_movement_type из 0003_inventory.sql, в том же порядке.
export const MOVEMENT_TYPES: string[] = [
  'receipt', 'sale', 'write_off', 'return', 'adjustment', 'transfer_out', 'transfer_in',
]

// Само значение (`write_off`) не переводится — это ключ, по которому
// сверяется база и который уходит в адрес фильтра. Переводится подпись.
const MOVEMENT_KEY: Record<string, Key> = {
  receipt: 'inventory.movement.type.receipt',
  sale: 'inventory.movement.type.sale',
  write_off: 'inventory.movement.type.write_off',
  return: 'inventory.movement.type.return',
  adjustment: 'inventory.movement.type.adjustment',
  transfer_out: 'inventory.movement.type.transfer_out',
  transfer_in: 'inventory.movement.type.transfer_in',
}

/** Подпись типа движения. Неизвестное значение показываем как есть. */
export function movementLabel(t: T, type: string): string {
  const key = MOVEMENT_KEY[type]
  return key ? t(key) : type
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
const SOURCE_KEY: Record<string, Key> = {
  stock_receipt: 'inventory.movement.source.stock_receipt',
  stock_count: 'inventory.movement.source.stock_count',
  order: 'inventory.movement.source.order',
  booking: 'inventory.movement.source.booking',
  manual: 'inventory.movement.source.manual',
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

// Подстроки, по которым разбирается отказ, — это текст миграции,
// а не строка интерфейса: в словарь едет только наш ответ.
function humanize(t: T, message: string): string {
  if (message.includes('недостаточно прав')) {
    return t('inventory.error.stockWrite')
  }
  if (message.includes('требует авторизованного пользователя')) {
    return t('inventory.error.session')
  }
  if (message.includes('позиция не найдена')) {
    return t('inventory.error.itemMissing')
  }
  if (message.includes('ровно один')) {
    return t('inventory.movements.error.oneTarget')
  }
  // Остаток не может уйти в минус: это check-constraint на самих таблицах,
  // а не проверка в коде, поэтому ловим его по имени ограничения.
  if (message.includes('current_stock_check') || message.includes('stock_nonneg')) {
    return t('inventory.movements.error.negative')
  }
  // Незнакомое базе-специфичное сюда не доходит: общий разбор
  // (`lib/errors/db.ts`) не отдаёт человеку сырой текст Postgres.
  return dbErrorText(t, { message })
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
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const toast = useToast()

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
    const signed = type === 'write_off' ? -amount : amount
    const label = `${type === 'write_off'
      ? t('inventory.movements.action.writeOff')
      : t('inventory.movements.action.return')} · ${
      options.find((o) => o.id === itemId)?.name ?? ''}`

    try {
      const { error: rpcError } = await supabase.rpc('record_stock_movement', {
        p_tenant_id: tenantId,
        p_movement_type: type,
        p_quantity: signed,
        ...(kind === 'goods' ? { p_variant_id: itemId } : { p_material_id: itemId }),
        p_reference_type: 'manual',
        p_note: note.trim(),
        p_idempotency_key: opKey.current,
      })
      if (rpcError) throw new Error(rpcError.message)
    } catch (e) {
      setBusy(false)
      // Пункт ТЗ про офлайн. Склад салона — подвал за железной дверью,
      // и «списать банку» там не должно упираться в одну палку связи.
      // Ключ идемпотентности УЖЕ сгенерирован выше и уходит в очередь
      // тем же самым: если база успела записать движение, а ответ
      // не доехал, досылка ничего не спишет второй раз.
      if (isNetworkError(e)) {
        await enqueue(label, {
          kind: 'stock.movement',
          tenantId,
          movementType: type,
          quantity: signed,
          materialId: kind === 'material' ? itemId : null,
          variantId: kind === 'goods' ? itemId : null,
          note: note.trim() || null,
          idempotencyKey: opKey.current,
          referenceType: 'manual',
        })
        opKey.current = ''
        setItemId(''); setQty(''); setNote('')
        toast.info(t('inventory.offline.saved'), t('inventory.movements.offline.desc'))
        return
      }
      // Ошибка данных в очередь не кладётся: она не отправится никогда,
      // а мастер будет думать, что списание ждёт сети.
      setErr(humanize(t, e instanceof Error ? e.message : String(e)))
      return
    }

    setBusy(false)
    opKey.current = ''
    setItemId(''); setQty(''); setNote('')
    toast.success(t('inventory.movements.recorded'), `${label} · ${t.number(amount)} ${unit}`)
    router.refresh()
  }

  // Дата и время — через `t.dateTime`, а не ручной сборкой из частей.
  const fmt = (v: string) => t.dateTime(v, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-wrap items-center gap-2">
        <Link href="/app/inventory" className="btn-ghost">← {t('inventory.link.stock')}</Link>
        <Link href="/app/inventory/receipts" className="btn-ghost">
          {t('inventory.link.receipts')}
        </Link>
        {canWrite && (
          <button type="button" className="btn-primary ml-auto t-md"
                  onClick={() => { setOpen(!open); setErr('') }}>
            {open ? t('inventory.collapse') : t('inventory.movements.open')}
          </button>
        )}
      </div>

      {/* Текст отказа базы показывается как есть — это её слова, не наши. */}
      {error && (
        <p className="field-error rise">{t('inventory.movements.loadError')}: {error}</p>
      )}

      {open && canWrite && (
        <form onSubmit={submit} className="card rise grid gap-3 sm:grid-cols-2">
          <p className="display t-lg sm:col-span-2">{t('inventory.movements.form.title')}</p>

          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="button" className={type === 'write_off' ? 'chip-active' : 'chip'}
                    onClick={() => setType('write_off')}>
              {t('inventory.movements.action.writeOff')}
            </button>
            <button type="button" className={type === 'return' ? 'chip-active' : 'chip'}
                    onClick={() => setType('return')}>
              {t('inventory.movements.form.return')}
            </button>
          </div>

          <p className="field-hint sm:col-span-2 !mt-0">{t('inventory.movements.form.hint')}</p>

          <div className="flex flex-wrap gap-2 sm:col-span-2">
            <button type="button" className={kind === 'material' ? 'chip-active' : 'chip'}
                    onClick={() => { setKind('material'); setItemId('') }}>
              {t('inventory.pick.material')}
            </button>
            <button type="button" className={kind === 'goods' ? 'chip-active' : 'chip'}
                    onClick={() => { setKind('goods'); setItemId('') }}>
              {t('inventory.pick.goods')}
            </button>
          </div>

          <div className="sm:col-span-2">
            <label className="field-label">{t('inventory.movements.form.item.label')}</label>
            <select required className="select" value={itemId}
                    onChange={(e) => setItemId(e.target.value)}>
              <option value="">{t('inventory.common.choose')}</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
          </div>

          <div>
            <label className="field-label">
              {unit
                ? t('inventory.movements.form.qty.labelUnit', { unit })
                : t('inventory.movements.form.qty.label')}
            </label>
            {/* Вводиться завжди додатне число: знак ставить не людина,
                а тип руху — так помилитися в ньому неможливо. */}
            <input required type="number" className="input"
                   min={kind === 'goods' ? '1' : '0.001'}
                   step={kind === 'goods' ? '1' : 'any'}
                   value={qty} onChange={(e) => setQty(e.target.value)} />
          </div>

          <div>
            <label className="field-label">{t('inventory.movements.form.reason.label')}</label>
            <input required className="input"
                   placeholder={type === 'write_off'
                     ? t('inventory.movements.form.reason.writeOff.placeholder')
                     : t('inventory.movements.form.reason.return.placeholder')}
                   value={note} onChange={(e) => setNote(e.target.value)} />
            <p className="field-hint">{t('inventory.movements.form.reason.hint')}</p>
          </div>

          {err && <p className="field-error sm:col-span-2">{err}</p>}

          <div className="flex gap-2 sm:col-span-2">
            <button className="btn-primary" disabled={busy || !itemId || !qty || !note.trim()}>
              {type === 'write_off'
                ? t('inventory.movements.form.submit.writeOff')
                : t('inventory.movements.form.submit.return')}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      )}

      {/* Фильтр по типу */}
      <div className="rise-1 flex flex-wrap items-center gap-2">
        <button onClick={() => go('all')} className={active === 'all' ? 'chip-active' : 'chip'}>
          {t('inventory.movements.filter.all')}
        </button>
        {/* Параметр назван `type`, а не `t`: `t` — переводчик. */}
        {MOVEMENT_TYPES.map((mvType) => (
          <button key={mvType} onClick={() => go(mvType)}
                  className={active === mvType ? 'chip-active' : 'chip'}>
            {movementLabel(t, mvType)}
          </button>
        ))}
      </div>

      <section className="card rise-2 !p-0">
        {movements.length === 0 ? (
          <div className="empty">
            {active === 'all'
              ? t('inventory.movements.empty.all')
              : t('inventory.movements.empty.type')}
          </div>
        ) : movements.map((mv) => (
          <div key={mv.id} className="row px-5">
            <div className="min-w-0">
              <p className="t-md truncate">{mv.title}</p>
              <p className="tabular t-xs mt-0.5 prose-muted">
                {fmt(mv.createdAt)}
                {' · '}{mv.kind === 'material'
                  ? t('inventory.kind.material')
                  : t('inventory.kind.goods')}
                {mv.referenceType
                  ? ` · ${SOURCE_KEY[mv.referenceType]
                    ? t(SOURCE_KEY[mv.referenceType])
                    : mv.referenceType}`
                  : ''}
              </p>
              {mv.note && <p className="t-xs mt-0.5 truncate prose-muted">{mv.note}</p>}
              {mv.receiptId && (
                <Link href={`/app/inventory/receipts/${mv.receiptId}`}
                      className="t-xs mt-1 inline-block underline">
                  {t('inventory.movements.openReceipt')}
                </Link>
              )}
              {mv.countId && !mv.receiptId && (
                <p className="t-xs mt-0.5 prose-muted">{t('inventory.movements.byCount')}</p>
              )}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <span className="tabular t-md">
                {mv.quantity > 0 ? '+' : ''}{t.number(mv.quantity)} {mv.unit}
              </span>
              <span className={movementBadge(mv.type)}>
                {movementLabel(t, mv.type)}
              </span>
            </div>
          </div>
        ))}
      </section>

      <p className="field-hint">{t('inventory.movements.hint')}</p>

      {movements.length >= 200 && (
        <p className="field-hint">
          {t('inventory.movements.limit', { n: t.number(movements.length) })}
        </p>
      )}
    </div>
  )
}
