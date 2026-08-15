'use client'

import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { authErrorText } from '@/lib/auth-errors'

// Вход через Google. Единственный провайдер, который включён в Supabase:
// Apple выключен и ключей нет, поэтому его кнопки в интерфейсе нет
// вовсе (правило 8 — выключено значит удалено).
//
// Словарь ошибок переехал в lib/auth-errors.ts: его импортируют
// и экраны /m, и /auth/finish, и ходить за строкой в кнопку было
// странно. Ре-экспорт оставлен, чтобы старые импорты работали.
export { authErrorText } from '@/lib/auth-errors'

function GoogleMark() {
  return (
    <svg aria-hidden width={18} height={18} viewBox="0 0 18 18">
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.79 2.72v2.26h2.9c1.7-1.57 2.69-3.88 2.69-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.46-.8 5.95-2.18l-2.9-2.26c-.81.54-1.84.86-3.05.86-2.34 0-4.33-1.58-5.04-3.71H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.96 10.71a5.4 5.4 0 0 1 0-3.42V4.96H.96a9 9 0 0 0 0 8.08l3-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.59C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.96l3 2.33C4.67 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  )
}

export function GoogleButton({ next, hint = 'або продовжити з' }: { next: string; hint?: string }) {
  const supabase = createClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  async function signIn() {
    setBusy(true); setError('')
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    })
    // Успех — браузер уже уходит на Google, снимать busy незачем.
    if (error) { setBusy(false); setError(authErrorText(error.message)) }
  }

  return (
    <>
      <div className="t-xs my-5 flex items-center gap-3 prose-muted">
        <span aria-hidden className="divider flex-1" />
        {hint}
        <span aria-hidden className="divider flex-1" />
      </div>

      <button type="button" onClick={signIn} disabled={busy} className="btn-secondary w-full">
        <GoogleMark />
        {busy ? 'Переходимо…' : 'Продовжити з Google'}
      </button>

      {error && <p className="field-error">{error}</p>}
    </>
  )
}
