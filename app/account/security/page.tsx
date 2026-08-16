'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'

// Безопасность: смена пароля, смена почты (с подтверждением обоих
// адресов — это включено в Supabase по умолчанию), выход.
export default function SecurityPage() {
  const t = useT()
  const router = useRouter()
  const supabase = createClient()

  const [password, setPassword] = useState('')
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    setBusy('pass'); setMsg(null)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(null)
    // Отказ показывается текстом базы, как есть; из словаря — успех.
    setMsg(error ? { kind: 'err', text: error.message }
                 : { kind: 'ok', text: t('account.security.pass.ok') })
    if (!error) setPassword('')
  }

  async function changeEmail(e: React.FormEvent) {
    e.preventDefault()
    setBusy('email'); setMsg(null)
    const { error } = await supabase.auth.updateUser({ email })
    setBusy(null)
    setMsg(error ? { kind: 'err', text: error.message }
                 : { kind: 'ok', text: t('account.security.email.ok') })
  }

  async function signOut() {
    setBusy('out')
    await supabase.auth.signOut()
    router.push('/'); router.refresh()
  }

  return (
    <main className="mx-auto max-w-sm px-5 py-12">
      <Link href="/account" className="btn-ghost rise -ml-3 mb-6">
        ← {t('account.security.back')}
      </Link>
      <h1 className="display rise t-2xl">{t('account.security.title')}</h1>

      {msg && (
        <p className={`rise t-md mt-4 ${msg.kind === 'err' ? 'field-error !mt-4' : ''}`}
           style={msg.kind === 'ok' ? { color: 'var(--color-success)' } : undefined}>
          {msg.text}
        </p>
      )}

      <form onSubmit={changePassword} className="card rise-1 mt-6 flex flex-col gap-3">
        <label className="field-label !mb-0" htmlFor="np">{t('account.security.pass.label')}</label>
        <input id="np" type="password" required minLength={8} className="input"
               autoComplete="new-password"
               value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn-secondary" disabled={busy === 'pass'}>
          {busy === 'pass' ? t('common.saving') : t('account.security.pass.submit')}
        </button>
      </form>

      <form onSubmit={changeEmail} className="card rise-2 mt-4 flex flex-col gap-3">
        <label className="field-label !mb-0" htmlFor="ne">{t('account.security.email.label')}</label>
        <input id="ne" type="email" required className="input"
               value={email} onChange={(e) => setEmail(e.target.value)} />
        <p className="field-hint !mt-0">{t('account.security.email.hint')}</p>
        <button className="btn-secondary" disabled={busy === 'email'}>
          {busy === 'email' ? t('account.security.email.busy') : t('account.security.email.submit')}
        </button>
      </form>

      <button onClick={signOut} className="btn-danger rise-3 mt-8 w-full" disabled={busy === 'out'}>
        {busy === 'out' ? t('account.security.signOut.busy') : t('account.security.signOut')}
      </button>
    </main>
  )
}
