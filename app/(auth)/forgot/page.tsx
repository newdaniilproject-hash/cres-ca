'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AuthShell } from '../auth-shell'

export default function ForgotPage() {
  const supabase = createClient()
  const [email, setEmail] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'error'>('idle')
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState('busy')
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: `${location.origin}/auth/callback?next=/reset`,
    })
    if (error) { setState('error'); setError(error.message); return }
    setState('sent')
  }

  if (state === 'sent') {
    return (
      <AuthShell title="Лист надіслано" subtitle={`Посилання для зміни пароля — на ${email}`}>
        <p className="t-md prose-muted">Не прийшов? Перевірте «Спам».</p>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Відновлення пароля" subtitle="Надішлемо посилання на пошту">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="field-label" htmlFor="email">Пошта</label>
          <input id="email" type="email" required className="input" autoComplete="email"
                 value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        {state === 'error' && <p className="field-error">{error}</p>}
        <button className="btn-primary" disabled={state === 'busy'}>
          {state === 'busy' ? 'Надсилаємо…' : 'Надіслати'}
        </button>
      </form>
    </AuthShell>
  )
}
