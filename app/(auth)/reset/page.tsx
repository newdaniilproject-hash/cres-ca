'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AuthShell } from '../auth-shell'

// Сюда человек попадает из письма восстановления: сессия уже есть,
// осталось задать новый пароль.
export default function ResetPage() {
  const router = useRouter()
  const supabase = createClient()
  const [password, setPassword] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle')
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState('busy')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setState('error'); setError(error.message); return }
    router.push('/account'); router.refresh()
  }

  return (
    <AuthShell title="Новий пароль">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="field-label" htmlFor="pass">Придумайте пароль</label>
          <input id="pass" type="password" required minLength={8} className="input"
                 autoComplete="new-password"
                 value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="field-hint">Щонайменше 8 символів</p>
        </div>
        {state === 'error' && <p className="field-error">{error}</p>}
        <button className="btn-primary" disabled={state === 'busy'}>
          {state === 'busy' ? 'Зберігаємо…' : 'Зберегти і увійти'}
        </button>
      </form>
    </AuthShell>
  )
}
