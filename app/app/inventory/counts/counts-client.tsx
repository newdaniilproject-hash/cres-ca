'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { useToast } from '@/components/toast'

// Значения enum stock_count_status из 0003_inventory.sql — дословно.
// Четвёртого состояния нет: документ либо считается, либо уже изменил
// остаток корректировками, либо отброшен.
export const COUNT_STATUS_LABEL: Record<string, string> = {
  counting: 'триває перерахунок',
  applied: 'проведено',
  cancelled: 'скасовано',
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
export function qty(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000)
}

// База отвечает по-русски и словами разработчика. Мастеру у полки это ничего
// не объясняет, поэтому известные отказы переводим, а незнакомый текст
// показываем как есть — проглотить ошибку хуже, чем показать сырую.
export function humanizeCount(message: string): string {
  if (message.includes('не идёт пересчёт') || message.includes('не идет пересчёт')) {
    return 'Цю інвентаризацію вже проведено або скасовано. Оновіть сторінку.'
  }
  if (message.includes('документ уже применён')) {
    return 'Документ проведено — правити його заднім числом не можна.'
  }
  if (message.includes('не найдена')) {
    return 'Документ інвентаризації не знайдено — можливо, його видалили.'
  }
  if (message.includes('нечего пересчитывать')) {
    return 'Не обрано жодної позиції — перераховувати нічого.'
  }
  if (message.includes('недостаточно прав')) {
    return 'Немає права змінювати склад (stock.write). Попросіть власника магазину видати його.'
  }
  if (message.includes('требует авторизованного пользователя')) {
    return 'Сесія завершилась — увійдіть знову.'
  }
  if (message.includes('позиция не найдена')) {
    return 'Позицію не знайдено у цьому магазині — можливо, її видалили.'
  }
  if (message.includes('stock_nonneg') || message.includes('current_stock')) {
    return 'Після коригування залишок пішов би в мінус. Перевірте введені числа.'
  }
  if (message.includes('stock_count_lines_qty_nonneg')) {
    return 'Залишок не буває відʼємним — перевірте введене число.'
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
      setErr(rpcError ? humanizeCount(rpcError.message) : 'Не вдалося почати перерахунок')
      return
    }
    // Пустой документ бесполезен — сразу уводим туда, где вписывают факт.
    toast.success('Перерахунок почато', `Позицій у документі: ${totalPicked}`)
    router.push(`/app/inventory/counts/${row.id}`)
  }

  const fmt = (s: string) => new Date(s).toLocaleString('uk-UA', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })

  const nothingToCount = variants.length === 0 && materials.length === 0

  return (
    <div className="flex flex-col gap-5">

      {/* ── Счётчики: что не закрыто ─────────────────────────── */}
      <section className="rise-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { n: stats.counting, label: 'Триває', warn: stats.counting > 0, danger: false },
          { n: stats.open, label: 'Не порахованих', warn: stats.open > 0, danger: false },
          { n: stats.mismatches, label: 'Розбіжностей', warn: false, danger: stats.mismatches > 0 },
          { n: stats.applied, label: 'Проведено', warn: false, danger: false },
        ].map((s) => (
          <div key={s.label} className="card-flat !p-3 text-center">
            <p className="tabular t-xl"
               style={s.danger ? { color: 'var(--color-danger)' }
                 : s.warn ? { color: 'var(--color-warn)' } : undefined}>
              {s.n}
            </p>
            <p className="t-xs mt-0.5" style={{ color: 'var(--color-faint)' }}>{s.label}</p>
          </div>
        ))}
      </section>

      {canWrite && !nothingToCount && (
        <div className="rise-1 flex flex-wrap gap-2">
          <button type="button" className="btn-primary"
                  onClick={() => { setOpen(true); setErr('') }}>
            + Почати перерахунок
          </button>
          {materials.length > 0 && (
            <button type="button" className="btn-secondary"
                    onClick={() => {
                      setKind('materials')
                      setPickedM(materials.map((m) => m.id))
                      setPickedV([])
                      setOpen(true); setErr('')
                    }}>
              Усі засоби ({materials.length})
            </button>
          )}
        </div>
      )}

      {error && <p className="field-error rise">Не вдалося завантажити інвентаризації: {error}</p>}

      {/* ── Список документов ────────────────────────────────── */}
      <section className="card rise-2 !p-0">
        {counts.length === 0 ? (
          <div className="empty">
            Інвентаризацій ще не було. Перерахунок — єдиний спосіб узгодити
            залишок із полицею: розбіжність база проведе коригуванням, а не
            тихою правкою числа.
          </div>
        ) : counts.map((c) => (
          <Link key={c.id} href={`/app/inventory/counts/${c.id}`} className="row px-5">
            <div className="min-w-0">
              <p className="tabular t-md truncate">
                Перерахунок від {fmt(c.startedAt)}
              </p>
              <p className="tabular t-xs mt-0.5 prose-muted">
                {c.total === 0 ? 'жодної позиції' : `позицій: ${c.total}`}
                {c.materials > 0 ? ` (засобів ${c.materials})` : ''}
                {c.status === 'counting' && c.total > 0
                  ? ` · заповнено ${c.filled}`
                  : ''}
                {c.appliedAt ? ` · проведено ${fmt(c.appliedAt)}` : ''}
              </p>
              {c.note && <p className="t-xs mt-0.5 truncate prose-muted">{c.note}</p>}
            </div>
            <div className="flex shrink-0 items-center gap-2">
              {c.mismatches > 0 && (
                <span className="badge-warn tabular">розбіжностей {c.mismatches}</span>
              )}
              <span className={countBadge(c.status)}>
                {COUNT_STATUS_LABEL[c.status] ?? c.status}
              </span>
            </div>
          </Link>
        ))}
      </section>

      {nothingToCount && (
        <p className="field-hint">
          Поки немає жодного засобу і жодного товару з обліком залишку —
          перераховувати нічого. Засоби заводяться на складі, товари —
          в каталозі; послуги залишку не мають.
        </p>
      )}

      <p className="field-hint">
        Проведений перерахунок не редагується: розбіжності вже стали рухами
        «коригування» в журналі. Помилку виправляють наступною інвентаризацією,
        а не правкою документа заднім числом.
      </p>

      {/* ── Выбор позиций ────────────────────────────────────── */}
      <Sheet
        open={open && canWrite}
        onClose={() => setOpen(false)}
        title="Що перераховуємо"
        footer={
          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="btn-primary"
                    disabled={busy || totalPicked === 0}
                    onClick={() => void start()}>
              {busy ? 'Готуємо документ…' : `Почати перерахунок (${totalPicked})`}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              Скасувати
            </button>
          </div>
        }
      >
        <div className="flex flex-col gap-3">
          <p className="field-hint !mt-0">
            База сама запише поточний залишок кожної позиції як «очікується».
            Далі ви проходите по полицях і вписуєте факт — залишок від цього
            ще не змінюється.
          </p>

          {/* Расходники и товары — разные списки, но один документ:
              база принимает оба массива за один вызов. */}
          <div className="flex flex-wrap gap-2">
            <button type="button"
                    className={kind === 'materials' ? 'chip-active' : 'chip'}
                    onClick={() => setKind('materials')}>
              Засоби {materials.length > 0 ? `· ${materials.length}` : ''}
              {pickedM.length > 0 ? ` (обрано ${pickedM.length})` : ''}
            </button>
            <button type="button"
                    className={kind === 'variants' ? 'chip-active' : 'chip'}
                    onClick={() => setKind('variants')}>
              Товари {variants.length > 0 ? `· ${variants.length}` : ''}
              {pickedV.length > 0 ? ` (обрано ${pickedV.length})` : ''}
            </button>
          </div>

          <input className="input" placeholder="Пошук позиції…"
                 value={query} onChange={(e) => setQuery(e.target.value)} />

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" className="chip"
                    onClick={() => setPicked(shown.map((v) => v.id))}>
              Обрати всі{query.trim() ? ' знайдені' : ''}
            </button>
            <button type="button" className="chip" onClick={() => setPicked([])}>
              Зняти вибір
            </button>
            <span className="badge-accent tabular ml-auto">обрано: {totalPicked}</span>
          </div>

          <div className="card-flat !p-0 px-5">
            {pool.length === 0 ? (
              <div className="empty">
                {kind === 'materials'
                  ? 'Засобів ще немає — заведіть їх на складі.'
                  : 'Товарів з обліком залишку немає — послуги залишку не мають.'}
              </div>
            ) : shown.length === 0 ? (
              <div className="empty">Нічого не знайшлося за цим запитом</div>
            ) : shown.map((v) => (
              <label key={v.id} className="row cursor-pointer">
                <div className="min-w-0">
                  <p className="t-md truncate">{v.title}</p>
                  <p className="tabular t-xs mt-0.5 prose-muted">
                    зараз в базі: {qty(v.stock)} {v.unit}
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
