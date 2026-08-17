'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { useT } from '@/lib/i18n/client'

// Кнопка «Оцінити» на выполненном заказе/записи покупателя.
//
// Живёт в `/account`, а не в кабинете продавца: отзыв оставляет покупатель,
// и это его собственная страница. Единственная защита рейтинга — «отзыв
// только от того, у кого есть выполненный заказ или запись» (0104), и здесь
// эта проверка видна дважды: кнопка показывается только на позициях
// со статусом `completed`, а окончательное слово всё равно за базой —
// `create_review` сверяет авторство и статус сама, кнопка лишь не предлагает
// того, что база и так отклонит.
export function ReviewButton({
  tenantId, kind, sourceId, title, already,
}: {
  tenantId: string
  kind: 'order' | 'booking'
  sourceId: string
  title: string
  /** Уже оставлен ли отзыв на этот источник — известно заранее, без второго клика. */
  already: boolean
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()
  const [open, setOpen] = useState(false)
  const [rating, setRating] = useState(0)
  const [text, setText] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')

  if (already) {
    return <span className="badge-success t-xs">{t('account.review.done')}</span>
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setErr('')
    const { error } = await supabase.rpc('create_review', {
      p_tenant_id: tenantId, p_kind: kind, p_source_id: sourceId,
      p_rating: rating, p_text: text.trim() || null,
    })
    setBusy(false)
    if (error) { setErr(error.message); return }
    setOpen(false)
    router.refresh()
  }

  return (
    <>
      <button className="btn-ghost t-xs" onClick={() => setOpen(true)}>
        {t('account.review.leave')}
      </button>
      <Sheet open={open} onClose={() => setOpen(false)} title={t('account.review.sheet.title')}>
        <form className="grid gap-3" onSubmit={submit}>
          <p className="t-sm prose-muted">{title}</p>

          {err && <p className="field-error">{err}</p>}

          {/* Пять звёзд, а не select: оценка ставится одним касанием
              и видна целиком без открытия списка. */}
          <div className="flex gap-1" role="radiogroup" aria-label={t('account.review.rating')}>
            {[1, 2, 3, 4, 5].map((n) => (
              <button key={n} type="button" role="radio" aria-checked={rating === n}
                      className="btn-icon t-2xl"
                      style={{ color: n <= rating ? 'var(--color-warn)' : 'var(--color-faint)' }}
                      onClick={() => setRating(n)}>
                ★
              </button>
            ))}
          </div>

          <div>
            <label className="field-label">{t('account.review.text.label')}</label>
            <textarea className="textarea" rows={3} value={text}
                      placeholder={t('account.review.text.placeholder')}
                      onChange={(e) => setText(e.target.value)} />
          </div>

          <button className="btn-primary" disabled={busy || rating === 0}>
            {t('account.review.submit')}
          </button>
          <p className="field-hint">{t('account.review.immutableHint')}</p>
        </form>
      </Sheet>
    </>
  )
}
