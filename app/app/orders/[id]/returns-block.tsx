'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { useT } from '@/lib/i18n/client'

export type ReturnableItem = {
  id: string; title: string; variant: string | null
  price: number; qty: number; returned: number
}
export type ReturnDoc = {
  id: string; number: number; reason: string; total: number
  note: string | null; createdAt: string
  items: { id: string; title: string; variant: string | null; qty: number }[]
}

// ── Возвраты по заказу ─────────────────────────────────────────────────────
//
// Возврат заводится ОТ ЗАКАЗА и наследует его состав — так записано
// в правилах домена, и это не оформление, а суть: возврат «просто товара»
// не с чем сверить, а возврат позиции заказа ограничен тем, что продано.
//
// Экран не считает ничего сам. Сколько ещё можно вернуть, он ЗНАЕТ из
// базы (`returned` приходит с сервера), а окончательную проверку делает
// `create_return`: два человека, открывшие карточку одновременно, увидят
// одинаковые остатки, и второй получит отказ от базы, а не тихо заведёт
// на склад лишнее.
//
// Денег платформа не возвращает и не обещает: она фиксирует факт и правит
// учёт — товар ложится на склад журналом, доход гасится встречным расходом.
// Это сказано на самом экране, иначе продавец решит, что нажатие вернуло
// деньги покупателю.
export function ReturnsBlock({
  tenantId, orderId, canWrite, items, returns,
}: {
  tenantId: string
  orderId: string
  canWrite: boolean
  items: ReturnableItem[]
  returns: ReturnDoc[]
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [qty, setQty] = useState<Record<string, number>>({})
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  const left = (i: ReturnableItem) => i.qty - i.returned
  const returnable = items.filter((i) => left(i) > 0)
  const picked = Object.entries(qty).filter(([, n]) => n > 0)
  const sum = picked.reduce((acc, [id, n]) => {
    const it = items.find((x) => x.id === id)
    return acc + (it ? it.price * n : 0)
  }, 0)

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('create_return', {
      p_tenant_id: tenantId,
      p_order_id: orderId,
      p_reason: reason,
      p_lines: picked.map(([id, n]) => ({ order_item_id: id, quantity: n })),
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setOpen(false); setReason(''); setQty({})
    router.refresh()
  }

  if (returns.length === 0 && (!canWrite || returnable.length === 0)) return null

  return (
    <section className="card rise-4 mt-6">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <h2 className="t-lg">{t('returns.title')}</h2>
        {canWrite && returnable.length > 0 && (
          <button className="btn-secondary t-sm" onClick={() => setOpen(true)}>
            {t('returns.create')}
          </button>
        )}
      </div>

      {err && <p className="field-error rise">{err}</p>}

      {returns.length === 0 ? (
        <p className="t-sm prose-muted">{t('returns.empty')}</p>
      ) : (
        <div className="flex flex-col gap-3">
          {returns.map((r) => (
            <div key={r.id} className="card-flat">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <p className="t-md">{t('returns.number', { n: r.number })}</p>
                <span className="tabular t-md">{t.money(r.total)}</span>
              </div>
              <p className="t-xs prose-muted">
                {t.dateTime(r.createdAt)} · {r.reason}
              </p>
              <ul className="t-sm mt-2 flex flex-col gap-1">
                {r.items.map((i) => (
                  <li key={i.id} className="prose-muted">
                    {i.title}{i.variant ? ` · ${i.variant}` : ''} × {t.number(i.qty)}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <Sheet open={open} onClose={() => setOpen(false)} title={t('returns.sheet.title')}>
        <form className="grid gap-3" onSubmit={submit}>
          <p className="field-hint">{t('returns.sheet.hint')}</p>

          <div className="card !p-0">
            {returnable.map((i) => (
              <div key={i.id} className="row px-4">
                <div className="min-w-0">
                  <p className="t-md truncate">{i.title}</p>
                  <p className="tabular t-xs prose-muted">
                    {i.variant ? `${i.variant} · ` : ''}
                    {t('returns.left', { n: left(i) })}
                  </p>
                </div>
                <input type="number" className="input tabular w-24 shrink-0"
                       min={0} max={left(i)} step={1}
                       value={qty[i.id] ?? 0}
                       onChange={(e) => setQty({
                         ...qty,
                         [i.id]: Math.max(0, Math.min(left(i), Number(e.target.value) || 0)),
                       })} />
              </div>
            ))}
          </div>

          <div>
            <label className="field-label">{t('returns.reason.label')}</label>
            <textarea required className="textarea" rows={2} value={reason}
                      placeholder={t('returns.reason.placeholder')}
                      onChange={(e) => setReason(e.target.value)} />
            <p className="field-hint">{t('returns.reason.hint')}</p>
          </div>

          <p className="tabular t-md text-right">
            {t('returns.sum', { sum: t.money(sum) })}
          </p>

          <button className="btn-primary"
                  disabled={busy || picked.length === 0 || !reason.trim()}>
            {t('returns.submit')}
          </button>
          <p className="field-hint">{t('returns.moneyHint')}</p>
        </form>
      </Sheet>
    </section>
  )
}
