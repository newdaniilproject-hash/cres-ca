'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { useToast } from '@/components/toast'
import { useT } from '@/lib/i18n/client'
import type { Key } from '@/lib/i18n/dict'
import type { T } from '@/lib/i18n/translate'

// Значения enum stock_count_status из 0003_inventory.sql — дословно.
// Четвёртого состояния нет: документ либо считается, либо уже изменил
// остаток корректировками, либо отброшен.
//
// Само значение (`applied`) не переводится — это ключ, по которому
// сверяется база. Переводится подпись к нему, и связь «значение → ключ
// словаря» живёт ровно здесь, одна на список и на карточку документа.
const COUNT_STATUS_KEY: Record<string, Key> = {
  counting: 'inventory.count.status.counting',
  applied: 'inventory.count.status.applied',
  cancelled: 'inventory.count.status.cancelled',
}

/** Подпись статуса. Неизвестное значение показываем как есть. */
export function countStatusLabel(t: T, status: string): string {
  const key = COUNT_STATUS_KEY[status]
  return key ? t(key) : status
}

export function countBadge(status: string): string {
  switch (status) {
    case 'counting': return 'badge-warn'
    case 'applied': return 'badge-success'
    case 'cancelled': return 'badge'
    default: return 'badge'
  }
}

// Число на экране склада — это остаток, а остаток у расходника дробный:
// «0.5 л» и «500 г» одинаково законны. Показываем ровно столько знаков,
// сколько есть, но не больше трёх: хвост 0.30000000000000004 — это
// двоичная дробь, а не данные.
//
// Формат — через `t.number`, а не своей сборкой: разделитель дробной
// части у языков разный, и «0.5» в украинской локали пишется «0,5».
export function qty(t: T, n: number): string {
  return t.number(n, { maximumFractionDigits: 3 })
}

// База отвечает по-русски и словами разработчика. Мастеру у полки это ничего
// не объясняет, поэтому известные отказы переводим, а незнакомый текст
// показываем как есть — проглотить ошибку хуже, чем показать сырую.
//
// Подстроки, по которым разбирается отказ, В СЛОВАРЬ НЕ ЕДУТ: это текст
// миграции, и переписать его здесь значит завести второй источник правды.
// Переводится только наш ответ.
export function humanizeCount(t: T, message: string): string {
  if (message.includes('не идёт пересчёт') || message.includes('не идет пересчёт')) {
    return t('inventory.count.error.notCounting')
  }
  if (message.includes('документ уже применён')) {
    return t('inventory.count.error.locked')
  }
  if (message.includes('не найдена')) {
    return t('inventory.count.error.missing')
  }
  if (message.includes('нечего пересчитывать')) {
    return t('inventory.count.error.nothing')
  }
  if (message.includes('недостаточно прав')) {
    return t('inventory.error.stockWrite')
  }
  if (message.includes('требует авторизованного пользователя')) {
    return t('inventory.error.session')
  }
  if (message.includes('позиция не найдена')) {
    return t('inventory.error.itemMissing')
  }
  if (message.includes('stock_nonneg') || message.includes('current_stock')) {
    return t('inventory.count.error.negativeStock')
  }
  if (message.includes('stock_count_lines_qty_nonneg')) {
    return t('inventory.count.error.negativeQty')
  }
  return message
}

export type CountRow = {
  id: string
  status: string
  note: string | null
  startedAt: string
  appliedAt: string | null
  total: number
  filled: number
  mismatches: number
  materials: number
}

export type PickOption = {
  id: string
  title: string
  unit: string
  stock: number
  category?: string
}

export function CountsClient({
  tenantId, canWrite, counts, variants, materials, error,
}: {
  tenantId: string
  canWrite: boolean
  counts: CountRow[]
  variants: PickOption[]
  materials: PickOption[]
  error: string
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const toast = useToast()

  // Форма открывается шторкой снизу — как и все формы склада. Раскрывающийся
  // блок посреди страницы уводит список вниз, и мастер теряет место, где был.
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [query, setQuery] = useState('')
  // Расходники первыми и по умолчанию: у салона склад — это они, товаров
  // может не быть вовсе. Раньше экран показывал только товары, и мастер
  // видел пустой список при полных полках.
  const [kind, setKind] = useState<'materials' | 'variants'>(
    materials.length > 0 ? 'materials' : 'variants',
  )
  const [pickedM, setPickedM] = useState<string[]>([])
  const [pickedV, setPickedV] = useState<string[]>([])

  const pool = kind === 'materials' ? materials : variants
  const picked = kind === 'materials' ? pickedM : pickedV
  const setPicked = kind === 'materials' ? setPickedM : setPickedV
  const totalPicked = pickedM.length + pickedV.length

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q
      ? pool.filter((v) => v.title.toLowerCase().includes(q)
        || (v.category ?? '').toLowerCase().includes(q))
      : pool
  }, [pool, query])

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }

  const stats = useMemo(() => ({
    counting: counts.filter((c) => c.status === 'counting').length,
    applied: counts.filter((c) => c.status === 'applied').length,
    open: counts.filter((c) => c.status === 'counting')
      .reduce((s, c) => s + (c.total - c.filled), 0),
    mismatches: counts.filter((c) => c.status === 'counting')
      .reduce((s, c) => s + c.mismatches, 0),
  }), [counts])

  async function start() {
    setBusy(true); setErr('')
    // Снимок остатка в expected_qty снимает база в этой же транзакции.
    // Если снимать его на клиенте, сравнение уехало бы: между открытием
    // экрана и началом пересчёта остаток могла подвинуть продажа.
    //
    // Пустой массив отправляем как null: функция считает переданные
    // массивы вместе, и `{}` от null для неё не отличается — но null
    // честнее описывает «этого вида позиций в документе нет».
    const { data, error: rpcError } = await supabase.rpc('start_stock_count', {
      p_tenant_id: tenantId,
      p_variant_ids: pickedV.length > 0 ? pickedV : null,
      p_material_ids: pickedM.length > 0 ? pickedM : null,
    })
    setBusy(false)
    const row = data as { id?: string } | null
    if (rpcError || !row?.id) {
      setErr(rpcError ? humanizeCount(t, rpcError.message) : t('inventory.counts.startFailed'))
      return
    }
    // Пустой документ бесполезен — сразу уводим туда, где вписывают факт.
    toast.success(t('inventory.counts.started.title'),
      t('inventory.counts.started.desc', { n: t.number(totalPicked) }))
    router.push(`/app/inventory/counts/${row.id}`)
  }

  // Дата и время — через `t.dateTime`, а не ручной сборкой из частей.
  const fmt = (v: string) => t.dateTime(v, {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })

  const nothingToCount = variants.length === 0 && materials.length === 0

  return (
    <div className="flex flex-col gap-5">

      {/* ── Счётчики: что не закрыто ─────────────────────────── */}
      <section className="rise-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { n: stats.counting, label: t('inventory.counts.stats.counting'), warn: stats.counting > 0, danger: false },
          { n: stats.open, label: t('inventory.counts.stats.open'), warn: stats.open > 0, danger: false },
          { n: stats.mismatches, label: t('inventory.counts.stats.mismatches'), warn: false, danger: stats.mismatches > 0 },
          { n: stats.applied, label: t('inventory.counts.stats.applied'), warn: false, danger: false },
        ].map((s) => (
          <div key={s.label} className="card-flat !p-3 text-center">
            <p className="tabular t-xl"
               style={s.danger ? { color: 'var(--color-danger)' }
                 : s.warn ? { color: 'var(--color-warn)' } : undefined}>
              {t.number(s.n)}
            </p>
            <p className="t-xs mt-0.5" style={{ color: 'var(--color-faint)' }}>{s.label}</p>
          </div>
        ))}
      </section>

      {canWrite && !nothingToCount && (
        <div className="rise-1 flex flex-wrap gap-2">
          <button type="button" className="btn-primary"
                  onClick={() => { setOpen(true); setErr('') }}>
            {t('inventory.counts.start')}
          </button>
          {materials.length > 0 && (
            <button type="button" className="btn-secondary"
                    onClick={() => {
                      setKind('materials')
                      setPickedM(materials.map((m) => m.id))
                      setPickedV([])
                      setOpen(true); setErr('')
                    }}>
              {t('inventory.counts.allMaterials', { n: t.number(materials.length) })}
            </button>
          )}
        </div>
      )}

      {/* Текст отказа базы показывается как есть — это её слова, не наши. */}
      {error && (
        <p className="field-error rise">{t('inventory.counts.loadError')}: {error}</p>
      )}

      {/* ── Список документов ────────────────────────────────── */}
      <section className="card rise-2 !p-0">
        {counts.length === 0 ? (
          <div className="empty">{t('inventory.counts.empty')}</div>
        ) : counts.map((c) => (
          <Link key={c.id} href={`/app/inventory/counts/${c.id}`} className="row px-5">
            <div className="min-w-0">
              <p className="tabular t-md truncate">
                {t('inventory.counts.row.title', { date: fmt(c.startedAt) })}
              </p>
              <p className="tabular t-xs mt-0.5 prose-muted">
                {c.total === 0
                  ? t('inventory.counts.row.noLines')
                  : t('inventory.counts.row.lines', { n: t.number(c.total) })}
                {c.materials > 0
                  ? ` ${t('inventory.counts.row.materials', { n: t.number(c.materials) })}`
                  : ''}
                {c.status === 'counting' && c.total > 0
                  ? ` · ${t('inventory.counts.row.filled', { n: t.number(c.filled) })}`
                  : ''}
                {c.appliedAt
                  ? ` · ${t('inventory.counts.row.applied', { date: fmt(c.appliedAt) })}`
                  : ''}
              </p>
              {c.note && <p className="t-xs mt-0.5 truncate prose-muted">{c.note}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {c.mismatches > 0 && (
                <span className="badge-warn tabular">
                  {t('inventory.counts.row.mismatches', { n: t.number(c.mismatches) })}
                </span>
              )}
              <span className={countBadge(c.status)}>
                {countStatusLabel(t, c.status)}
              </span>
            </div>
          </Link>
        ))}
      </section>

      {nothingToCount && (
        <p className="field-hint">{t('inventory.counts.nothingToCount')}</p>
      )}

      <p className="field-hint">{t('inventory.counts.hint')}</p>

      {/* ── Выбор позиций ────────────────────────────────────── */}
      <Sheet
        open={open && canWrite}
        onClose={() => setOpen(false)}
        title={t('inventory.counts.sheet.title')}
        footer={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary"
                    disabled={busy || totalPicked === 0}
                    onClick={() => void start()}>
              {busy
                ? t('inventory.counts.sheet.busy')
                : t('inventory.counts.sheet.submit', { n: t.number(totalPicked) })}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="field-hint !mt-0">{t('inventory.counts.sheet.hint')}</p>

          {/* Расходники и товары — разные списки, но один документ:
              база принимает оба массива за один вызов. */}
          <div className="flex flex-wrap gap-2">
            <button type="button"
                    className={kind === 'materials' ? 'chip-active' : 'chip'}
                    onClick={() => setKind('materials')}>
              {t('inventory.counts.pick.materials')}
              {materials.length > 0 ? ` · ${t.number(materials.length)}` : ''}
              {pickedM.length > 0
                ? ` ${t('inventory.counts.pick.chosen', { n: t.number(pickedM.length) })}`
                : ''}
            </button>
            <button type="button"
                    className={kind === 'variants' ? 'chip-active' : 'chip'}
                    onClick={() => setKind('variants')}>
              {t('inventory.counts.pick.goods')}
              {variants.length > 0 ? ` · ${t.number(variants.length)}` : ''}
              {pickedV.length > 0
                ? ` ${t('inventory.counts.pick.chosen', { n: t.number(pickedV.length) })}`
                : ''}
            </button>
          </div>

          <input className="input" placeholder={t('inventory.counts.pick.search')}
                 value={query} onChange={(e) => setQuery(e.target.value)} />

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="chip"
                    onClick={() => setPicked(shown.map((v) => v.id))}>
              {query.trim()
                ? t('inventory.counts.pick.selectAllFound')
                : t('inventory.counts.pick.selectAll')}
            </button>
            <button type="button" className="chip" onClick={() => setPicked([])}>
              {t('inventory.counts.pick.clear')}
            </button>
            <span className="badge-accent tabular ml-auto">
              {t('inventory.counts.pick.total', { n: t.number(totalPicked) })}
            </span>
          </div>

          <div className="card-flat !p-0 px-5">
            {pool.length === 0 ? (
              <div className="empty">
                {kind === 'materials'
                  ? t('inventory.counts.pick.noMaterials')
                  : t('inventory.counts.pick.noGoods')}
              </div>
            ) : shown.length === 0 ? (
              <div className="empty">{t('inventory.counts.pick.searchEmpty')}</div>
            ) : shown.map((v) => (
              <label key={v.id} className="row cursor-pointer">
                <div className="min-w-0">
                  <p className="t-md truncate">{v.title}</p>
                  <p className="tabular t-xs mt-0.5 prose-muted">
                    {t('inventory.counts.pick.stock', { qty: qty(t, v.stock), unit: v.unit })}
                    {v.category ? ` · ${v.category}` : ''}
                  </p>
                </div>
                {/* Тап-зона — вся строка: галочку в 16px пальцем не поймать. */}
                <input type="checkbox" className="shrink-0"
                       checked={picked.includes(v.id)}
                       onChange={() => toggle(v.id)} />
              </label>
            ))}
          </div>

          {err && <p className="field-error">{err}</p>}
        </div>
      </Sheet>
    </div>
  )
}
