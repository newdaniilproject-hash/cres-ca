'use client'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  authErrorText, codeErrorText, humanAuthError, lockoutSeconds, lockoutText,
} from '@/lib/auth-errors'
import { AuthShell } from '../auth-shell'
import { GoogleButton } from '../google-button'
import { CodeInput } from '@/app/m/code-input'
import {
  BlockedScreen, MailIcon, PasswordInput, SuccessScreen, mmss,
} from '@/components/auth-ui'

// Вход: пароль ИЛИ код на почту — двумя вкладками.
//
// ⚠️ ЧТО ЗДЕСЬ БЫЛО СЛОМАНО (починено 13.08.2026). Вкладка называлась
// «Посилання на пошту», экран после отправки обещал «Надіслали посилання»,
// а шаблон Magic link в Supabase отдаёт {{ .Token }} — код. Ссылки
// в письме не было НИ ОДНОЙ, и этот путь входа был мёртв целиком.
// Теперь вкладка «Код на пошту» и экран ввода кода — ровно то, что
// действительно приходит человеку. Образец потока — /m/login,
// где так было с самого начала и работало.
const CODE_LENGTH = 6
const RESEND_SECONDS = 60

type Mode = 'code' | 'password'
type Step = 'form' | 'code' | 'done' | 'blocked'

function LoginInner() {
  const params = useSearchParams()
  // next приходит из адреса — принимаем только внутренний путь,
  // иначе ссылка вида /login?next=https://… уводит человека с площадки.
  const rawNext = params.get('next')
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/account'
  const returned = params.get('error')
  const supabase = createClient()

  const [mode, setMode] = useState<Mode>('password')
  const [step, setStep] = useState<Step>('form')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(returned ? authErrorText(returned) : '')
  const [noAccount, setNoAccount] = useState(false)
  const [left, setLeft] = useState(0)
  const [lockWait, setLockWait] = useState('')

  useEffect(() => {
    if (left <= 0) return
    const id = setTimeout(() => setLeft((v) => v - 1), 1000)
    return () => clearTimeout(id)
  }, [left])

  // Часть провайдеров возвращает отказ якорем — на сервер он не попадает,
  // но переживает редирект /auth/callback → /login и виден отсюда.
  useEffect(() => {
    const hash = window.location.hash
    if (!hash.includes('error')) return
    const h = new URLSearchParams(hash.slice(1))
    const raw = h.get('error_description') ?? h.get('error')
    if (!raw) return
    setError(authErrorText(raw))
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [])

  // Перебор попыток — отдельный экран, а не строка под полем.
  // Возвращает true, если это действительно блокировка.
  function catchLockout(message: string, status?: number): boolean {
    const sec = lockoutSeconds(message, status)
    if (sec === null) return false
    setLockWait(lockoutText(sec))
    setStep('blocked')
    return true
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(''); setNoAccount(false)

    if (mode === 'code') {
      // shouldCreateUser: false — вход не должен молча создавать акаунт.
      // Регистрация это отдельное обещание с отдельной формой.
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(), options: { shouldCreateUser: false },
      })
      setBusy(false)
      if (error) {
        if (catchLockout(error.message, error.status)) return
        if (error.message.toLowerCase().includes('signups not allowed')) { setNoAccount(true); return }
        setError(humanAuthError(error.message))
        return
      }
      setCode(''); setCodeError(''); setLeft(RESEND_SECONDS); setStep('code')
      return
    }

    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(), password,
    })
    setBusy(false)
    if (error) {
      if (catchLockout(error.message, error.status)) return
      setError(humanAuthError(error.message))
      return
    }
    setStep('done')
  }

  async function verify(v: string) {
    if (busy) return
    setBusy(true); setCodeError('')
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(), token: v, type: 'email',
    })
    if (error) {
      setBusy(false); setCodeError(codeErrorText(error.message)); setCode('')
      return
    }
    setBusy(false)
    setStep('done')
  }

  async function resend() {
    if (left > 0 || busy) return
    setBusy(true); setCodeError('')
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(), options: { shouldCreateUser: false },
    })
    setBusy(false)
    if (error) { setCodeError(humanAuthError(error.message)); return }
    setLeft(RESEND_SECONDS)
  }

  // ── Вход выполнен ────────────────────────────────────────────
  // Переход полной навигацией, а не router.push: серверная проверка
  // сессии на следующей странице должна увидеть свежие куки.
  if (step === 'done') {
    return (
      <AuthShell>
        <SuccessScreen
          title="Вхід успішний!"
          subtitle="Раді вас бачити! Перехід у ваш кабінет…"
          actionLabel="Продовжити"
          onAction={() => { window.location.href = next }}
        />
        <Redirect to={next} />
      </AuthShell>
    )
  }

  // ── Блокировка ───────────────────────────────────────────────
  if (step === 'blocked') {
    return (
      <AuthShell>
        <BlockedScreen
          waitText={lockWait}
          onReset={() => { window.location.href = '/forgot' }}
          onBack={() => { setStep('form'); setError(''); setPassword('') }}
        />
      </AuthShell>
    )
  }

  // ── Код ──────────────────────────────────────────────────────
  if (step === 'code') {
    return (
      <AuthShell title="Підтвердження входу"
                 subtitle={`Ми надіслали 6-значний код на ${email.trim()}`}>
        <CodeInput
          value={code} disabled={busy} invalid={!!codeError} length={CODE_LENGTH}
          onChange={(v) => {
            setCode(v); setCodeError('')
            if (v.length === CODE_LENGTH) void verify(v)
          }}
        />

        {codeError && <p className="field-error text-center">{codeError}</p>}
        {busy && !codeError && <p className="t-sm mt-3 text-center prose-muted">Перевіряємо…</p>}

        <p className="code-countdown">
          {left > 0 ? `Повторно надіслати код через ${mmss(left)}` : 'Код можна надіслати повторно'}
        </p>

        <div className="auth-result-actions">
          <button type="button" className="btn-primary btn-tall"
                  disabled={busy || code.length !== CODE_LENGTH}
                  onClick={() => void verify(code)}>
            {busy ? 'Перевіряємо…' : 'Підтвердити'}
          </button>
          <button type="button" className="link-quiet link-accent"
                  disabled={left > 0 || busy} onClick={() => void resend()}>
            Надіслати код повторно
          </button>
          <button type="button" className="link-quiet"
                  onClick={() => { setStep('form'); setCode(''); setCodeError('') }}>
            Змінити пошту
          </button>
        </div>

        <div className="note note-row">
          <span style={{ color: 'var(--color-muted)' }}><MailIcon size={20} /></span>
          <span>
            Не отримали лист? Перевірте папку «Вхідні» та «Спам».
            Або повторіть через хвилину.
          </span>
        </div>
      </AuthShell>
    )
  }

  // ── Форма ────────────────────────────────────────────────────
  const byPassword = mode === 'password'
  return (
    <AuthShell title="Вхід" subtitle="Раді бачити знову">
      <div className="mb-6 flex gap-2">
        <button type="button" onClick={() => { setMode('password'); setError('') }}
                className={byPassword ? 'chip-active' : 'chip'}>Пароль</button>
        <button type="button" onClick={() => { setMode('code'); setError('') }}
                className={byPassword ? 'chip' : 'chip-active'}>Код на пошту</button>
      </div>

      <form onSubmit={submit} className="flex flex-col gap-4">
        <div>
          <label className="field-label" htmlFor="email">Email</label>
          <input id="email" type="email" required autoComplete="email" className="input"
                 inputMode="email" autoCapitalize="none" spellCheck={false}
                 value={email}
                 onChange={(e) => { setEmail(e.target.value); setNoAccount(false) }}
                 placeholder="you@example.com" />
        </div>

        {byPassword && (
          <div>
            <div className="flex items-baseline justify-between">
              <label className="field-label" htmlFor="pass">Пароль</label>
              <Link href="/forgot" className="t-xs underline underline-offset-2 prose-muted">
                Забули?
              </Link>
            </div>
            <PasswordInput id="pass" value={password} onChange={setPassword}
                           autoComplete="current-password" />
          </div>
        )}

        {noAccount && (
          <div className="card-flat" style={{ borderColor: 'var(--color-accent)' }}>
            <p className="t-md">Такої пошти в нас немає</p>
            <p className="t-sm mt-1 prose-muted">Створіть акаунт — це кілька полів.</p>
            <Link href="/register" className="btn-primary btn-tall mt-3">Створити акаунт</Link>
          </div>
        )}

        {error && <p className="field-error">{error}</p>}

        <button className="btn-primary btn-tall"
                disabled={busy || email.trim().length < 5 || (byPassword && password.length < 1)}>
          {busy ? 'Хвилинку…' : byPassword ? 'Увійти' : 'Надіслати код'}
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

// Экран успеха живёт секунду и уходит сам. Отдельным компонентом,
// чтобы эффект не висел на всём экране входа и не срабатывал
// раньше времени.
function Redirect({ to }: { to: string }) {
  useEffect(() => {
    const id = setTimeout(() => { window.location.href = to }, 1100)
    return () => clearTimeout(id)
  }, [to])
  return null
}

export default function LoginPage() {
  // useSearchParams требует границы Suspense, иначе прод-сборка Next
  // падает на пререндере. В этом проекте уже ловилось.
  return <Suspense><LoginInner /></Suspense>
}
