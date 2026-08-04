'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AuthShell } from '../auth-shell'

// Регистрация покупателя: имя, почта, пароль. Телефон попросим тогда,
// когда он реально понадобится — при первом заказе (create_order).
export default function RegisterPage() {
  const router = useRouter()
  const supabase = createClient()
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'confirm' | 'error'>('idle')
  const [error, setError] = useState('')

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState('busy'); setError('')
    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: {
        data: { full_name: name },
        emailRedirectTo: `${location.origin}/auth/callback?next=/account`,
      },
    })
    if (error) { setState('error'); setError(error.message); return }
    if (data.session) { router.push('/account'); router.refresh(); return }
    setState('confirm')
  }

  if (state === 'confirm') {
    return (
      <AuthShell title="Підтвердіть пошту" subtitle={`Надіслали лист на ${email}`}>
        <p className="text-sm prose-muted">
          Відкрийте посилання з листа — і акаунт готовий.
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Реєстрація" subtitle="Замовлення й записи в одному місці">
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="field-label" htmlFor="name">Імʼя</label>
          <input id="name" required className="input" autoComplete="name"
                 value={name} onChange={(e) => setName(e.target.value)} placeholder="Марія" />
        </div>
        <div>
          <label className="field-label" htmlFor="email">Пошта</label>
          <input id="email" type="email" required className="input" autoComplete="email"
                 value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div>
          <label className="field-label" htmlFor="pass">Пароль</label>
          <input id="pass" type="password" required minLength={8} className="input"
                 autoComplete="new-password"
                 value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="field-hint">Щонайменше 8 символів</p>
        </div>

        {state === 'error' && <p className="field-error">{error}</p>}

        <button className="btn-primary" disabled={state === 'busy'}>
          {state === 'busy' ? 'Створюємо…' : 'Створити акаунт'}
        </button>
      </form>

      <p className="mt-6 text-sm prose-muted">
        Вже з нами? <Link href="/login" className="underline underline-offset-2">Увійти</Link>
      </p>
    </AuthShell>
  )
}
