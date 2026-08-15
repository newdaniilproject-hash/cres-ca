'use client'

import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { humanAuthError } from '@/lib/auth-errors'
import { AuthShell } from '../auth-shell'
import { PasswordInput, PasswordStrength, SuccessScreen } from '@/components/auth-ui'

// Смена пароля для того, у кого уже есть сессия.
//
// Основной путь восстановления теперь кодом и целиком живёт в /forgot
// (письмо отдаёт {{ .Token }}, а не ссылку). Этот экран остался
// нужным ровно для одного: человек, попавший сюда с живой сессией —
// например, через /auth/callback?next=/reset у тех, кто получил
// письмо старого образца, — должен иметь возможность задать пароль,
// а не упереться в пустой экран. Без сессии он честно отправляется
// на /forgot, вместо того чтобы показывать форму, которая не сработает.
export default function ResetPage() {
  const supabase = createClient()
  const [ready, setReady] = useState(false)
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      if (!data.session) { window.location.replace('/forgot'); return }
      setReady(true)
    })
    return () => { alive = false }
  }, [supabase])

  const mismatch = confirm.length > 0 && confirm !== password

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (busy || password.length < 8 || password !== confirm) return
    setBusy(true); setError('')
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) { setError(humanAuthError(error.message)); return }
    setDone(true)
  }

  if (done) {
    return (
      <AuthShell>
        <SuccessScreen
          title="Пароль змінено"
          subtitle="Ваш пароль успішно оновлено. Тепер можете увійти з новим паролем."
          actionLabel="Увійти"
          onAction={() => { window.location.href = '/account' }}
        />
      </AuthShell>
    )
  }

  if (!ready) {
    return (
      <AuthShell title="Новий пароль">
        <div className="skeleton" style={{ height: 'var(--h-input)' }} />
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Новий пароль" subtitle="Придумайте пароль — і одразу увійдемо">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="field-label" htmlFor="pass">Пароль</label>
          <PasswordInput id="pass" value={password} onChange={setPassword}
                         autoComplete="new-password" autoFocus />
          <PasswordStrength value={password} />
        </div>
        <div>
          <label className="field-label" htmlFor="pass2">Підтвердіть пароль</label>
          <PasswordInput id="pass2" value={confirm} onChange={setConfirm}
                         autoComplete="new-password" invalid={mismatch} />
          {mismatch && <p className="field-error">Паролі не збігаються</p>}
        </div>
        {error && <p className="field-error">{error}</p>}
        <button className="btn-primary btn-tall"
                disabled={busy || password.length < 8 || password !== confirm}>
          {busy ? 'Зберігаємо…' : 'Зберегти пароль'}
        </button>
      </form>
    </AuthShell>
  )
}
