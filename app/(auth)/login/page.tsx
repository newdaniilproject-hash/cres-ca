'use client'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AuthShell } from '../auth-shell'
import { GoogleButton, authErrorText } from '../google-button'

// Вход: пароль ИЛИ одноразовая ссылка — двумя вкладками.
// Ссылка первой: людям «из инстаграма» пароль не нужен вовсе.
function LoginInner() {
  const router = useRouter()
  const params = useSearchParams()
  // next приходит из адреса — принимаем только внутренний путь,
  // иначе ссылка вида /login?next=https://… уводит человека с площадки.
  const rawNext = params.get('next')
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/account'
  const returned = params.get('error')
  const supabase = createClient()

  const [mode, setMode] = useState<'link' | 'password'>('link')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [state, setState] = useState<'idle' | 'busy' | 'sent' | 'error'>(returned ? 'error' : 'idle')
  const [error, setError] = useState(returned ? authErrorText(returned) : '')

  // Часть провайдеров возвращает отказ якорем — на сервер он не попадает,
  // но переживает редирект /auth/callback → /login и виден отсюда.
  useEffect(() => {
    const hash = window.location.hash
    if (!hash.includes('error')) return
    const h = new URLSearchParams(hash.slice(1))
    const raw = h.get('error_description') ?? h.get('error')
    if (!raw) return
    setState('error')
    setError(authErrorText(raw))
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [])

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setState('busy'); setError('')
    if (mode === 'link') {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${location.origin}/auth/callback?next=${encodeURIComponent(next)}` },
      })
      if (error) { setState('error'); setError(error.message); return }
      setState('sent')
    } else {
      const { error } = await supabase.auth.signInWithPassword({ email, password })
      if (error) {
        setState('error')
        setError(error.message === 'Invalid login credentials'
          ? 'Невірна пошта або пароль' : error.message)
        return
      }
      router.push(next); router.refresh()
    }
  }

  if (state === 'sent') {
    return (
      <AuthShell title="Перевірте пошту" subtitle={`Надіслали посилання для входу на ${email}`}>
        <p className="t-md prose-muted">
          Лист не прийшов? Перевірте «Спам» або{' '}
          <button className="underline underline-offset-2" onClick={() => setState('idle')}>
            спробуйте ще раз
          </button>.
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Вхід" subtitle="Раді бачити знову">
      <div className="mb-6 flex gap-2">
        <button type="button" onClick={() => setMode('link')}
                className={mode === 'link' ? 'chip-active' : 'chip'}>Посилання на пошту</button>
        <button type="button" onClick={() => setMode('password')}
                className={mode === 'password' ? 'chip-active' : 'chip'}>Пароль</button>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="field-label" htmlFor="email">Пошта</label>
          <input id="email" type="email" required autoComplete="email" className="input"
                 value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>

        {mode === 'password' && (
          <div>
            <div className="flex items-baseline justify-between">
              <label className="field-label" htmlFor="pass">Пароль</label>
              <Link href="/forgot" className="t-xs underline underline-offset-2 prose-muted">
                Забули?
              </Link>
            </div>
            <input id="pass" type="password" required autoComplete="current-password" className="input"
                   value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
        )}

        {state === 'error' && <p className="field-error">{error}</p>}

        <button className="btn-primary" disabled={state === 'busy'}>
          {state === 'busy' ? 'Хвилинку…' : mode === 'link' ? 'Надіслати посилання' : 'Увійти'}
        </button>
      </form>

      <GoogleButton next={next} />

      <p className="t-md mt-6 prose-muted">
        Немає акаунта?{' '}
        <Link href="/register" className="underline underline-offset-2">Зареєструватися</Link>
        {' · '}
        <Link href="/register/seller" className="underline underline-offset-2">Я підприємець</Link>
      </p>
    </AuthShell>
  )
}

export default function LoginPage() {
  return <Suspense><LoginInner /></Suspense>
}
