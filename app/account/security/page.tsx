'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// Безопасность: смена пароля, смена почты (с подтверждением обоих
// адресов — это включено в Supabase по умолчанию), выход.
export default function SecurityPage() {
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
    setMsg(error ? { kind: 'err', text: error.message }
                 : { kind: 'ok', text: 'Пароль змінено' })
    if (!error) setPassword('')
  }

  async function changeEmail(e: React.FormEvent) {
    e.preventDefault()
    setBusy('email'); setMsg(null)
    const { error } = await supabase.auth.updateUser({ email })
    setBusy(null)
    setMsg(error ? { kind: 'err', text: error.message }
                 : { kind: 'ok', text: 'Підтвердіть зміну листами на стару і нову адреси' })
  }

  async function signOut() {
    setBusy('out')
    await supabase.auth.signOut()
    router.push('/'); router.refresh()
  }

  return (
    <main className="mx-auto max-w-sm px-5 py-12">
      <Link href="/account" className="btn-ghost rise -ml-3 mb-6">← Кабінет</Link>
      <h1 className="display rise text-2xl font-semibold tracking-tight">Безпека</h1>

      {msg && (
        <p className={`rise mt-4 text-sm ${msg.kind === 'err' ? 'field-error !mt-4' : ''}`}
           style={msg.kind === 'ok' ? { color: 'var(--color-success)' } : undefined}>
          {msg.text}
        </p>
      )}

      <form onSubmit={changePassword} className="card rise-1 mt-6 flex flex-col gap-3">
        <label className="field-label !mb-0" htmlFor="np">Новий пароль</label>
        <input id="np" type="password" required minLength={8} className="input"
               autoComplete="new-password"
               value={password} onChange={(e) => setPassword(e.target.value)} />
        <button className="btn-secondary" disabled={busy === 'pass'}>
          {busy === 'pass' ? 'Зберігаємо…' : 'Змінити пароль'}
        </button>
      </form>

      <form onSubmit={changeEmail} className="card rise-2 mt-4 flex flex-col gap-3">
        <label className="field-label !mb-0" htmlFor="ne">Нова пошта</label>
        <input id="ne" type="email" required className="input"
               value={email} onChange={(e) => setEmail(e.target.value)} />
        <p className="field-hint !mt-0">
          Для захисту зміну підтверджують і стара, і нова адреси
        </p>
        <button className="btn-secondary" disabled={busy === 'email'}>
          {busy === 'email' ? 'Надсилаємо…' : 'Змінити пошту'}
        </button>
      </form>

      <button onClick={signOut} className="btn-danger rise-3 mt-8 w-full" disabled={busy === 'out'}>
        {busy === 'out' ? 'Виходимо…' : 'Вийти з акаунта'}
      </button>
    </main>
  )
}
