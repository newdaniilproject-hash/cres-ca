'use client'

import Link from 'next/link'
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'

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

// Значения периода уезжают в адрес (`?period=30d`) и разбираются
// на сервере — они служебные и не переводятся. Переводится подпись.
const PERIODS = ['month', 'prev', '30d'] as const
type Period = (typeof PERIODS)[number]

// Своих `money` и `day` больше нет.
//
// `money` подставляла «₴» руками: символ ставит Intl (`t.money`), иначе
// вторая валюта встанет не с той стороны в английской локали.
//
// `T00:00:00` в дате дописывается намеренно и остаётся: `occurred_on` —
// день без времени, и голая строка «2026-08-16» разбирается как
// UTC-полночь, то есть западнее Гринвича показывалась бы предыдущим днём.
const DAY_OPTS: Intl.DateTimeFormatOptions = {
  day: 'numeric', month: 'long', year: 'numeric',
}
const day = (t: T, s: string) => t.date(`${s}T00:00:00`, DAY_OPTS)

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
  const t = useT()
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
    // Заготовка нотатки — текст ДЛЯ ЧЕЛОВЕКА: он видит её в поле и правит
    // до сохранения. Две развилки — две строки целиком, а не общая плюс
    // хвост. Сама нотатка записи (`r.note`) — данные, она не переводится.
    setNote(r.note
      ? t('finance.reverse.noteWith', { date: day(t, r.occurredOn), note: r.note })
      : t('finance.reverse.note', { date: day(t, r.occurredOn) }))
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
        {PERIODS.map((p: Period) => (
          <button key={p}
                  className={period === p ? 'chip-active' : 'chip'}
                  onClick={() => router.push(`/app/finance?period=${p}`)}>
            {t(`finance.period.${p}`)}
          </button>
        ))}
        <span className="tabular t-xs prose-muted">{day(t, from)} — {day(t, to)}</span>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <div className="card rise-1">
          <p className="t-xs prose-muted">{t('finance.total.income')}</p>
          <p className="tabular t-3xl mt-1"
             style={{ color: 'var(--color-success)' }}>{t.money(income)}</p>
        </div>
        <div className="card rise-2">
          <p className="t-xs prose-muted">{t('finance.total.expense')}</p>
          <p className="tabular t-3xl mt-1"
             style={{ color: 'var(--color-danger)' }}>{t.money(expense)}</p>
        </div>
        <div className="card rise-3">
          <p className="t-xs prose-muted">{t('finance.total.balance')}</p>
          <p className="tabular t-3xl mt-1"
             style={{ color: balance < 0 ? 'var(--color-danger)' : 'var(--color-accent)' }}>
            {t.money(balance)}
          </p>
        </div>
      </div>

      {/* Тексты отказов базы подставляются как есть; из словаря — рамка. */}
      {error && <p className="field-error rise">{t('finance.error.load', { message: error })}</p>}
      {err && <p className="field-error rise">{err}</p>}

      {/* Новая запись */}
      {canWrite && (
        <form ref={formRef} onSubmit={addRecord} className="card rise-2 grid gap-3 sm:grid-cols-4">
          <div className="sm:col-span-4 flex flex-wrap gap-2">
            <button type="button" onClick={() => { setKind('expense'); setCategoryId('') }}
                    className={kind === 'expense' ? 'chip-active' : 'chip'}>
              {t('finance.form.expense')}
            </button>
            <button type="button" onClick={() => { setKind('income'); setCategoryId('') }}
                    className={kind === 'income' ? 'chip-active' : 'chip'}>
              {t('finance.form.income')}
            </button>
          </div>

          <div>
            <label className="field-label" htmlFor="fin-amount">
              {t('finance.form.amount.label')}
            </label>
            <input id="fin-amount" required type="number" step="0.01" min="0.01"
                   className="input" value={amount}
                   onChange={(e) => setAmount(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="fin-date">{t('finance.form.date.label')}</label>
            <input id="fin-date" required type="date" className="input" value={date}
                   onChange={(e) => setDate(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="fin-category">
              {t('finance.form.category.label')}
            </label>
            <select id="fin-category" className="select" value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">{t('finance.form.category.none')}</option>
              {formCategories.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="field-label" htmlFor="fin-note">{t('finance.form.note.label')}</label>
            <input id="fin-note" className="input" value={note}
                   placeholder={t('finance.form.note.placeholder')}
                   onChange={(e) => setNote(e.target.value)} />
          </div>

          <button className="btn-primary sm:col-span-4 sm:justify-self-start"
                  disabled={busy === 'record'}>
            {kind === 'income' ? t('finance.form.submit.income') : t('finance.form.submit.expense')}
          </button>
        </form>
      )}

      {/* Журнал */}
      <section className="card rise-3 !p-0">
        {records.length === 0 ? (
          <div className="empty">{t('finance.empty')}</div>
        ) : records.map((r) => {
          const category = r.categoryId ? catById.get(r.categoryId) : undefined
          return (
            <div key={r.id} className="row flex-wrap px-5">
              <div className="min-w-0">
                <p className="t-md flex flex-wrap items-center gap-2">
                  <span>{category?.name ?? (r.note ? r.note : t('finance.form.category.none'))}</span>
                  {/* Автозапись триггера orders_income_record: продавец
                      не вносил её руками, и это должно быть видно. */}
                  {r.orderId && (
                    <span className="badge-accent">{t('finance.record.fromOrder')}</span>
                  )}
                </p>
                <p className="tabular t-xs mt-0.5 prose-muted">
                  {day(t, r.occurredOn)}
                  {category && r.note ? ` · ${r.note}` : ''}
                  {r.orderId && (
                    <>
                      {' · '}
                      <Link href={`/app/orders/${r.orderId}`} className="underline">
                        {r.orderNumber !== null
                          ? t('finance.record.orderNumber', { number: r.orderNumber })
                          : t('finance.record.orderLink')}
                      </Link>
                    </>
                  )}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className="tabular t-md"
                      style={{ color: r.kind === 'income' ? 'var(--color-success)' : 'var(--color-danger)' }}>
                  {r.kind === 'income' ? '+' : '−'}{t.money(r.amount)}
                </span>
                {canWrite && (
                  <>
                    <button className="btn-ghost t-sm"
                            onClick={() => startEdit(r)}>{t('finance.record.editNote')}</button>
                    <button className="btn-ghost t-sm"
                            onClick={() => startReverse(r)}>{t('finance.record.reverse')}</button>
                  </>
                )}
              </div>

              {editing === r.id && (
                <div className="card-flat grid w-full gap-3 sm:grid-cols-3">
                  <div className="sm:col-span-2">
                    <label className="field-label">{t('finance.form.note.label')}</label>
                    <input className="input" value={editNote}
                           onChange={(e) => setEditNote(e.target.value)} />
                  </div>
                  <div>
                    <label className="field-label">{t('finance.form.category.label')}</label>
                    <select className="select" value={editCategory}
                            onChange={(e) => setEditCategory(e.target.value)}>
                      <option value="">{t('finance.form.category.none')}</option>
                      {categories.filter((c) => c.kind === r.kind).map((c) => (
                        <option key={c.id} value={c.id}>
                          {/* Название категории — данные заведения, оно
                              не переводится; переводится только пометка. */}
                          {c.isActive
                            ? c.name
                            : t('finance.category.hiddenOption', { name: c.name })}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="sm:col-span-3 flex gap-2">
                    <button className="btn-primary t-md" disabled={busy === r.id}
                            onClick={() => void saveEdit(r.id)}>{t('common.save')}</button>
                    <button className="btn-secondary t-md"
                            onClick={() => setEditing(null)}>{t('common.cancel')}</button>
                    <span className="t-xs self-center prose-muted">
                      {t('finance.record.edit.hint')}
                    </span>
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </section>

      <p className="field-hint">{t('finance.hint')}</p>

      {/* Справочник категорий */}
      <section className="card rise-4">
        <h2 className="t-lg mb-3">{t('finance.categories.title')}</h2>
        {categories.length === 0 ? (
          <div className="empty !py-6">{t('finance.categories.empty')}</div>
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
                    {c.isActive ? t('finance.categories.hide') : t('finance.categories.restore')}
                  </button>
                )}
              </span>
            ))}
          </div>
        )}

        {canWrite && (
          <form onSubmit={addCategory} className="mt-4 flex flex-wrap items-end gap-2">
            <div className="min-w-40 flex-1">
              <label className="field-label" htmlFor="cat-name">
                {t('finance.categories.new.label')}
              </label>
              <input id="cat-name" required className="input" value={catName}
                     placeholder={t('finance.categories.new.placeholder')}
                     onChange={(e) => setCatName(e.target.value)} />
            </div>
            <select className="select w-40" value={catKind}
                    onChange={(e) => setCatKind(e.target.value === 'income' ? 'income' : 'expense')}>
              <option value="expense">{t('finance.categories.kind.expense')}</option>
              <option value="income">{t('finance.categories.kind.income')}</option>
            </select>
            <button className="btn-secondary shrink-0"
                    disabled={!catName.trim() || busy === 'category'}>
              {t('finance.categories.add')}
            </button>
          </form>
        )}
      </section>
    </div>
  )
}
