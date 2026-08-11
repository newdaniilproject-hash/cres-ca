'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export type FinanceKind = 'income' | 'expense'

export type FinanceRecord = {
  id: string
  kind: FinanceKind
  amount: number
  note: string | null
  occurredOn: string
  categoryId: string | null
  orderId: string | null
  orderNumber: number | null
}

export type FinanceCategory = {
  id: string
  kind: FinanceKind
  name: string
  isActive: boolean
}

const PERIODS: { key: string; label: string }[] = [
  { key: 'month', label: 'Цей місяць' },
  { key: 'prev', label: 'Минулий місяць' },
  { key: '30d', label: '30 днів' },
]

const money = (n: number) => `${n.toLocaleString('uk-UA', { maximumFractionDigits: 2 })} ₴`

const day = (s: string) =>
  new Date(`${s}T00:00:00`).toLocaleDateString('uk-UA', {
    day: 'numeric', month: 'long', year: 'numeric',
  })

export function FinanceClient({
  tenantId, userId, canWrite, period, from, to, today,
  income, expense, records, categories, error,
}: {
  tenantId: string
  userId: string
  canWrite: boolean
  period: string
  from: string
  to: string
  today: string
  income: number
  expense: number
  records: FinanceRecord[]
  categories: FinanceCategory[]
  error: string
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const formRef = useRef<HTMLFormElement>(null)

  const [busy, setBusy] = useState<string | null>(null)
  const [err, setErr] = useState('')

  // Форма записи
  const [kind, setKind] = useState<FinanceKind>('expense')
  const [amount, setAmount] = useState('')
  const [categoryId, setCategoryId] = useState('')
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')

  // Правка существующей записи: только то, что разрешает finance_records_guard.
  const [editing, setEditing] = useState<string | null>(null)
  const [editNote, setEditNote] = useState('')
  const [editCategory, setEditCategory] = useState('')

  // Справочник категорий
  const [catName, setCatName] = useState('')
  const [catKind, setCatKind] = useState<FinanceKind>('expense')

  const catById = useMemo(
    () => new Map(categories.map((c) => [c.id, c])),
    [categories],
  )

  async function addRecord(e: React.FormEvent) {
    e.preventDefault()
    setBusy('record'); setErr('')
    const { error: insertError } = await supabase.from('finance_records').insert({
      tenant_id: tenantId,
      kind,
      amount: Number(amount.replace(',', '.')),
      category_id: categoryId || null,
      occurred_on: date,
      note: note.trim() || null,
      created_by: userId,
    })
    setBusy(null)
    if (insertError) { setErr(insertError.message); return }
    setAmount(''); setNote(''); setCategoryId('')
    router.refresh()
  }

  // Вместо удаления — встречная запись. Сумма та же, вид противоположный:
  // после неё период сходится к нулю по ошибочной паре, а обе строки
  // остаются в журнале. Категорию не переносим — она привязана к виду.
  function startReverse(r: FinanceRecord) {
    setKind(r.kind === 'income' ? 'expense' : 'income')
    setAmount(String(r.amount))
    setCategoryId('')
    setDate(today)
    setNote(`сторнування запису від ${day(r.occurredOn)}${r.note ? `: ${r.note}` : ''}`)
    setErr('')
    formRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
  }

  function startEdit(r: FinanceRecord) {
    setEditing(r.id)
    setEditNote(r.note ?? '')
    setEditCategory(r.categoryId ?? '')
    setErr('')
  }

  async function saveEdit(id: string) {
    setBusy(id); setErr('')
    const { error: updateError } = await supabase.from('finance_records')
      .update({ note: editNote.trim() || null, category_id: editCategory || null })
      .eq('id', id)
    setBusy(null)
    if (updateError) { setErr(updateError.message); return }
    setEditing(null)
    router.refresh()
  }

  async function addCategory(e: React.FormEvent) {
    e.preventDefault()
    setBusy('category'); setErr('')
    const { error: insertError } = await supabase.from('finance_categories').insert({
      tenant_id: tenantId, kind: catKind, name: catName.trim(),
    })
    setBusy(null)
    if (insertError) { setErr(insertError.message); return }
    setCatName(''); router.refresh()
  }

  async function toggleCategory(c: FinanceCategory) {
    setBusy(c.id); setErr('')
    const { error: updateError } = await supabase.from('finance_categories')
      .update({ is_active: !c.isActive }).eq('id', c.id)
    setBusy(null)
    if (updateError) { setErr(updateError.message); return }
    router.refresh()
  }

  const formCategories = categories.filter((c) => c.kind === kind && c.isActive)
  const balance = income - expense

  return (
    <div className="flex flex-col gap-5">
      {/* Период и итоги */}
      <div className="rise flex flex-wrap items-center gap-2">
        {PERIODS.map((p) => (
          <button key={p.key}
                  className={period === p.key ? 'chip-active' : 'chip'}
                  onClick={() => router.push(`/app/finance?period=${p.key}`)}>
            {p.label}
          </button>
        ))}
        <span className="tabular t-xs prose-muted">{day(from)} — {day(to)}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card rise-1">
          <p className="t-xs prose-muted">Доходи</p>
          <p className="tabular t-3xl mt-1"
             style={{ color: 'var(--color-success)' }}>{money(income)}</p>
        </div>
        <div className="card rise-2">
          <p className="t-xs prose-muted">Витрати</p>
          <p className="tabular t-3xl mt-1"
             style={{ color: 'var(--color-danger)' }}>{money(expense)}</p>
        </div>
        <div className="card rise-3">
          <p className="t-xs prose-muted">Різниця</p>
          <p className="tabular t-3xl mt-1"
             style={{ color: balance < 0 ? 'var(--color-danger)' : 'var(--color-accent)' }}>
            {money(balance)}
          </p>
        </div>
      </div>

      {error && <p className="field-error rise">Не всі дані завантажились: {error}</p>}
      {err && <p className="field-error rise">{err}</p>}

      {/* Новая запись */}
      {canWrite && (
        <form ref={formRef} onSubmit={addRecord} className="card rise-2 grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => { setKind('expense'); setCategoryId('') }}
                    className={kind === 'expense' ? 'chip-active' : 'chip'}>Витрата</button>
            <button type="button" onClick={() => { setKind('income'); setCategoryId('') }}
                    className={kind === 'income' ? 'chip-active' : 'chip'}>Дохід</button>
          </div>

          <div>
            <label className="field-label" htmlFor="fin-amount">Сума, ₴</label>
            <input id="fin-amount" required type="number" step="0.01" min="0.01"
                   className="input" value={amount}
                   onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="fin-date">Дата</label>
            <input id="fin-date" required type="date" className="input" value={date}
                   onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="fin-category">Категорія</label>
            <select id="fin-category" className="select" value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">без категорії</option>
              {formCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="fin-note">Нотатка</label>
            <input id="fin-note" className="input" value={note}
                   placeholder="За що саме"
                   onChange={(e) => setNote(e.target.value)} />
          </div>

          <button className="btn-primary sm:col-span-4 sm:justify-self-start"
                  disabled={busy === 'record'}>
            Записати {kind === 'income' ? 'дохід' : 'витрату'}
          </button>
        </form>
      )}

      {/* Журнал */}
      <section className="card rise-3 !p-0">
        {records.length === 0 ? (
          <div className="empty">
            За цей період рухів грошей немає. Доходи від оплачених замовлень
            зʼявляються тут самі, витрати вносите ви.
          </div>
        ) : records.map((r) => {
          const category = r.categoryId ? catById.get(r.categoryId) : undefined
          return (
            <div key={r.id} className="row flex-wrap px-5">
              <div className="min-w-0">
                <p className="t-md flex flex-wrap items-center gap-2">
                  <span>{category?.name ?? (r.note ? r.note : 'без категорії')}</span>
                  {/* Автозапись триггера orders_income_record: продавец
                      не вносил её руками, и это должно быть видно. */}
                  {r.orderId && (
                    <span className="badge-accent">із замовлення</span>
                  )}
                </p>
                <p className="tabular t-xs mt-0.5 prose-muted">
                  {day(r.occurredOn)}
                  {category && r.note ? ` · ${r.note}` : ''}
                  {r.orderId && (
                    <>
                      {' · '}
                      <Link href={`/app/orders/${r.orderId}`} className="underline">
                        {r.orderNumber !== null ? `замовлення №${r.orderNumber}` : 'до замовлення'}
                      </Link>
                    </>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="tabular t-md"
                      style={{ color: r.kind === 'income' ? 'var(--color-success)' : 'var(--color-danger)' }}>
                  {r.kind === 'income' ? '+' : '−'}{money(r.amount)}
                </span>
                {canWrite && (
                  <>
                    <button className="btn-ghost t-sm"
                            onClick={() => startEdit(r)}>Нотатка</button>
                    <button className="btn-ghost t-sm"
                            onClick={() => startReverse(r)}>Зворотний запис</button>
                  </>
                )}
              </div>

              {editing === r.id && (
                <div className="card-flat grid w-full gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <label className="field-label">Нотатка</label>
                    <input className="input" value={editNote}
                           onChange={(e) => setEditNote(e.target.value)} />
                  </div>
                  <div>
                    <label className="field-label">Категорія</label>
                    <select className="select" value={editCategory}
                            onChange={(e) => setEditCategory(e.target.value)}>
                      <option value="">без категорії</option>
                      {categories.filter((c) => c.kind === r.kind).map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}{c.isActive ? '' : ' (прихована)'}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-3 flex gap-2">
                    <button className="btn-primary t-md" disabled={busy === r.id}
                            onClick={() => void saveEdit(r.id)}>Зберегти</button>
                    <button className="btn-secondary t-md"
                            onClick={() => setEditing(null)}>Скасувати</button>
                    <span className="t-xs self-center prose-muted">
                      Сума й вид залишаться незмінними — база їх не віддасть.
                    </span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </section>

      <p className="field-hint">
        Журнал грошей незмінний. Суму й вид запису неможливо ані виправити,
        ані видалити — так це працює в бухгалтерії й так це зроблено в базі.
        Помилковий запис гаситься зустрічним: кнопка «Зворотний запис» готує
        його за вас. Правити можна лише нотатку й категорію.
      </p>

      {/* Справочник категорий */}
      <section className="card rise-4">
        <h2 className="t-lg mb-3">Категорії</h2>
        {categories.length === 0 ? (
          <div className="empty !py-6">
            Категорій ще немає. Вони потрібні тільки вам — щоб через рік
            бачити, куди пішли гроші.
          </div>
        ) : (
          <div className="flex flex-wrap gap-2">
            {categories.map((c) => (
              <span key={c.id}
                    className={c.isActive
                      ? (c.kind === 'income' ? 'badge-success' : 'badge-warn')
                      : 'badge'}>
                {c.name}
                {canWrite && (
                  <button className="underline" disabled={busy === c.id}
                          onClick={() => void toggleCategory(c)}>
                    {c.isActive ? 'сховати' : 'повернути'}
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {canWrite && (
          <form onSubmit={addCategory} className="mt-4 flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1">
              <label className="field-label" htmlFor="cat-name">Нова категорія</label>
              <input id="cat-name" required className="input" value={catName}
                     placeholder="Оренда, матеріали, реклама…"
                     onChange={(e) => setCatName(e.target.value)} />
            </div>
            <select className="select w-40" value={catKind}
                    onChange={(e) => setCatKind(e.target.value === 'income' ? 'income' : 'expense')}>
              <option value="expense">витрата</option>
              <option value="income">дохід</option>
            </select>
            <button className="btn-secondary shrink-0"
                    disabled={!catName.trim() || busy === 'category'}>
              Додати
            </button>
          </form>
        )}
      </section>
    </div>
  )
}
