'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

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
  if (message.includes('недостаточно прав')) {
    return 'Немає права змінювати склад (stock.write). Попросіть власника магазину видати його.'
  }
  if (message.includes('требует авторизованного пользователя')) {
    return 'Сесія завершилась — увійдіть знову.'
  }
  if (message.includes('позиция не найдена')) {
    return 'Позицію не знайдено у цьому магазині — можливо, її видалили.'
  }
  if (message.includes('stock_nonneg')) {
    return 'Після коригування залишок пішов би в мінус. Перевірте введені числа.'
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
}

type VariantOption = { id: string; title: string; unit: string; stock: number }

export function CountsClient({
  tenantId, canWrite, counts, variants, error,
}: {
  tenantId: string
  canWrite: boolean
  counts: CountRow[]
  variants: VariantOption[]
  error: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  // Форма раскрывается прямо на странице, а не модалкой: пересчёт начинают
  // с телефона у полки, и клавиатура перекрывает модальное окно.
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const [query, setQuery] = useState('')
  const [picked, setPicked] = useState<string[]>([])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? variants.filter((v) => v.title.toLowerCase().includes(q)) : variants
  }, [variants, query])

  function toggle(id: string) {
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]))
  }

  async function start(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')
    // Снимок остатка в expected_qty снимает база в этой же транзакции.
    // Если снимать его на клиенте, сравнение уехало бы: между открытием
    // экрана и началом пересчёта остаток могла подвинуть продажа.
    const { data, error: rpcError } = await supabase.rpc('start_stock_count', {
      p_tenant_id: tenantId,
      p_variant_ids: picked,
    })
    setBusy(false)
    const row = data as { id?: string } | null
    if (rpcError || !row?.id) {
      setErr(rpcError ? humanizeCount(rpcError.message) : 'Не вдалося почати перерахунок')
      return
    }
    // Пустой документ бесполезен — сразу уводим туда, где вписывают факт.
    router.push(`/app/inventory/counts/${row.id}`)
  }

  const fmt = (s: string) => new Date(s).toLocaleString('uk-UA', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  })

  return (
    <div className="flex flex-col gap-5">
      <div className="rise flex flex-wrap items-center gap-2">
        <Link href="/app/inventory" className="btn-ghost">← Склад</Link>
        {canWrite && variants.length > 0 && (
          <button type="button" className="btn-primary ml-auto t-md"
                  onClick={() => { setOpen(!open); setErr('') }}>
            {open ? 'Згорнути' : '+ Почати перерахунок'}
          </button>
        )}
      </div>

      {error && <p className="field-error rise">Не вдалося завантажити інвентаризації: {error}</p>}

      {open && canWrite && (
        <form onSubmit={start} className="card rise flex flex-col gap-3">
          <p className="display t-lg">Що перераховуємо</p>
          <p className="field-hint !mt-0">
            База сама запише поточний залишок кожної позиції як «очікується».
            Далі ви проходите по полицях і вписуєте факт — залишок від цього
            ще не змінюється.
          </p>

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
            <span className="badge-accent tabular ml-auto">обрано: {picked.length}</span>
          </div>

          <div className="card-flat !p-0 max-h-80 overflow-y-auto px-5">
            {shown.length === 0 ? (
              <div className="empty">Нічого не знайшлося за цим запитом</div>
            ) : shown.map((v) => (
              <label key={v.id} className="row cursor-pointer">
                <div className="min-w-0">
                  <p className="t-md truncate">{v.title}</p>
                  <p className="tabular t-xs mt-0.5 prose-muted">
                    зараз в базі: {v.stock} {v.unit}
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

          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={busy || picked.length === 0}>
              Почати перерахунок
            </button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              Скасувати
            </button>
          </div>
        </form>
      )}

      <section className="card rise-1 !p-0">
        {counts.length === 0 ? (
          <div className="empty">
            Інвентаризацій ще не було. Перерахунок — єдиний спосіб узгодити
            залишок із полицею: розбіжність база проведе коригуванням, а не
            тихою правкою числа.
            {canWrite && variants.length > 0 && (
              <button type="button" className="btn-primary" onClick={() => setOpen(true)}>
                Почати перерахунок
              </button>
            )}
          </div>
        ) : counts.map((c) => (
          <Link key={c.id} href={`/app/inventory/counts/${c.id}`} className="row px-5">
            <div className="min-w-0">
              <p className="tabular t-md truncate">
                Перерахунок від {fmt(c.startedAt)}
              </p>
              <p className="tabular t-xs mt-0.5 prose-muted">
                {c.total === 0 ? 'жодної позиції' : `позицій: ${c.total}`}
                {c.status === 'counting' && c.total > 0
                  ? ` · заповнено ${c.filled}`
                  : ''}
                {c.appliedAt ? ` · проведено ${fmt(c.appliedAt)}` : ''}
              </p>
              {c.note && <p className="t-xs mt-0.5 truncate prose-muted">{c.note}</p>}
            </div>
            <span className={countBadge(c.status)}>
              {COUNT_STATUS_LABEL[c.status] ?? c.status}
            </span>
          </Link>
        ))}
      </section>

      {variants.length === 0 && (
        <p className="field-hint">
          Поки немає жодного товару з обліком залишку — перераховувати нічого.
          Товари заводяться в каталозі, послуги залишку не мають.
        </p>
      )}

      <p className="field-hint">
        Проведений перерахунок не редагується: розбіжності вже стали рухами
        «коригування» в журналі. Помилку виправляють наступною інвентаризацією,
        а не правкою документа заднім числом.
      </p>
    </div>
  )
}
