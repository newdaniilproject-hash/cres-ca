'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { useToast } from '@/components/toast'
import { useT } from '@/lib/i18n/client'

// Выдача и отзыв собственного доступа к данным заведения (0093).
//
// Экран служебный и намеренно неудобный: заведение указывается слагом
// из обращения, причина пишется словами и уходит владельцу письмом,
// срок ограничен тридцатью днями. Выпадающего списка заведений здесь нет
// и не будет — список всех заведений платформы это и есть то, доступ
// к чему ограничивает вся эта механика.

type Grant = {
  id: string
  tenant_id: string
  reason: string
  granted_at: string
  expires_at: string
  revoked_at: string | null
  tenants: { name: string; slug: string } | null
}

export function PlatformAccessClient({ grants }: { grants: Grant[] }) {
  const t = useT()
  const toast = useToast()
  const router = useRouter()

  const [slug, setSlug] = useState('')
  const [reason, setReason] = useState('')
  const [days, setDays] = useState('2')
  const [busy, setBusy] = useState<string | null>(null)

  async function issue() {
    setBusy('issue')
    const res = await fetch('/api/platform/access', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: slug.trim(), reason: reason.trim(), days: Number(days) }),
    })
    setBusy(null)
    const out = await res.json().catch(() => ({}))
    if (!res.ok) {
      // Коды отказа роута — служебные значения, а не текст для человека:
      // подпись к ним живёт в словаре, сам код не переводится никогда.
      const code = typeof out.error === 'string' ? out.error : 'unknown'
      toast.error(t('platform.access.issue.failed'), reasonText(t, code))
      return
    }
    setSlug(''); setReason('')
    toast.success(t('platform.access.issue.done', { tenant: String(out.tenant ?? '') }))
    router.refresh()
  }

  async function revoke(id: string) {
    if (!window.confirm(t('platform.access.revoke.confirm'))) return
    setBusy(id)
    const res = await fetch('/api/platform/access', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ revoke: id }),
    })
    setBusy(null)
    if (!res.ok) { toast.error(t('platform.access.revoke.failed')); return }
    toast.success(t('platform.access.revoke.done'))
    router.refresh()
  }

  const now = Date.now()
  const state = (g: Grant): 'revoked' | 'expired' | 'active' =>
    g.revoked_at ? 'revoked' : (new Date(g.expires_at).getTime() <= now ? 'expired' : 'active')

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-5 p-5">
      <header>
        <h1 className="t-xl">{t('platform.access.title')}</h1>
        <p className="t-sm prose-muted">{t('platform.access.desc')}</p>
      </header>

      <section className="card rise">
        <h2 className="t-lg mb-3">{t('platform.access.issue.title')}</h2>

        <label className="field">
          <span className="field-label">{t('platform.access.field.slug')}</span>
          <input className="input" value={slug} onChange={(e) => setSlug(e.target.value)}
                 autoComplete="off" spellCheck={false} />
          <span className="field-hint">{t('platform.access.field.slug.hint')}</span>
        </label>

        <label className="field">
          <span className="field-label">{t('platform.access.field.reason')}</span>
          <textarea className="input" rows={2} value={reason}
                    onChange={(e) => setReason(e.target.value)} />
          <span className="field-hint">{t('platform.access.field.reason.hint')}</span>
        </label>

        <label className="field">
          <span className="field-label">{t('platform.access.field.days')}</span>
          <input className="input tabular" type="number" min={1} max={30} value={days}
                 onChange={(e) => setDays(e.target.value)} />
          <span className="field-hint">{t('platform.access.field.days.hint')}</span>
        </label>

        <button type="button" className="btn-primary mt-2"
                disabled={busy === 'issue'}
                onClick={() => void issue()}>
          {busy === 'issue' ? t('common.saving') : t('platform.access.issue.cta')}
        </button>
      </section>

      <section className="card rise-1 !p-0">
        <div className="p-5 pb-3">
          <h2 className="t-lg">{t('platform.access.list.title')}</h2>
          <p className="t-sm prose-muted">{t('platform.access.list.desc')}</p>
        </div>

        {grants.length === 0 ? (
          <div className="empty">{t('platform.access.list.empty')}</div>
        ) : grants.map((g) => {
          const s = state(g)
          return (
            <div key={g.id} className="row items-start px-5">
              <div className="min-w-0">
                <p className="t-md truncate">
                  {g.tenants?.name ?? g.tenant_id}
                  {g.tenants?.slug && <span className="prose-muted"> · {g.tenants.slug}</span>}
                </p>
                <p className="t-sm">{g.reason}</p>
                <p className="tabular t-xs prose-muted">
                  {t('platform.access.list.period', {
                    from: t.dateTime(g.granted_at), to: t.dateTime(g.expires_at),
                  })}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <span className={s === 'active' ? 'badge-accent' : 'badge'}>
                  {t(`platform.access.state.${s}`)}
                </span>
                {s === 'active' && (
                  <button type="button" className="btn-secondary t-sm"
                          disabled={busy === g.id}
                          onClick={() => void revoke(g.id)}>
                    {busy === g.id ? t('common.saving') : t('platform.access.revoke.cta')}
                  </button>
                )}
              </div>
            </div>
          )
        })}
      </section>

      <p className="field-hint">{t('platform.access.hint')}</p>
    </main>
  )
}

const CODES = ['no-slug', 'short-reason', 'bad-days', 'no-tenant', 'bad-body'] as const
type Code = (typeof CODES)[number]
const isCode = (c: string): c is Code => (CODES as readonly string[]).includes(c)

function reasonText(t: ReturnType<typeof useT>, code: string): string {
  return isCode(code) ? t(`platform.access.error.${code}`) : code
}
