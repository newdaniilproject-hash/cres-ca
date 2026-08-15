'use client'

import Link from 'next/link'
import { useEffect, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { codeErrorText, humanAuthError } from '@/lib/auth-errors'
import { nextRoute } from '@/lib/where'
import { AuthShell } from '../auth-shell'
import { CodeInput } from '@/app/m/code-input'
import {
  MailIcon, PasswordInput, PasswordStrength, SuccessScreen, mmss,
} from '@/components/auth-ui'

// Восстановление пароля.
//
// ⚠️ ЧТО ЗДЕСЬ БЫЛО СЛОМАНО (починено 13.08.2026). Экран обещал
// «посилання на пошту» и вёл на /reset, а шаблон Reset password
// в Supabase отдаёт {{ .Token }} — код. Ссылки в письме не было,
// /reset был недостижим, и восстановить пароль было нельзя вовсе.
//
// Теперь поток такой же, как в приложении (/m/login, режим reset):
// почта → код → сразу новый пароль → успех. Человек не уходит
// с экрана ни разу, и это единственный вариант, который работает
// и в приложении, где письмо открывается в другом окне.
const CODE_LENGTH = 6
const RESEND_SECONDS = 60

type Step = 'form' | 'sent' | 'code' | 'newpass' | 'done'

export default function ForgotPage() {
  const supabase = createClient()

  const [step, setStep] = useState<Step>('form')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [codeError, setCodeError] = useState('')
  const [left, setLeft] = useState(0)
  // Куда уходим после смены пароля. Код 'recovery' уже выдал сессию,
  // поэтому членства читаемы и решение принимает lib/where.ts:
  // человек без заведения обязан попасть на его создание, а не
  // в покупательский кабинет, куда вёл прежний жёсткий '/account'.
  const [target, setTarget] = useState('/app')

  useEffect(() => {
    if (left <= 0) return
    const id = setTimeout(() => setLeft((v) => v - 1), 1000)
    return () => clearTimeout(id)
  }, [left])

  const mismatch = confirm.length > 0 && confirm !== password

  async function send(e?: React.FormEvent) {
    e?.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    // redirectTo здесь не задаётся намеренно: в письме код, а не ссылка,
    // и адрес возврата в нём никак не используется.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim())
    setBusy(false)
    if (error) { setError(humanAuthError(error.message)); return }
    setLeft(RESEND_SECONDS)
    setStep('sent')
  }

  async function verify(v: string) {
    if (busy) return
    setBusy(true); setCodeError('')
    // type: 'recovery' — это код из письма «Скидання пароля».
    // С типом 'email' Supabase его не примет.
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(), token: v, type: 'recovery',
    })
    if (error) {
      setBusy(false); setCodeError(codeErrorText(error.message)); setCode('')
      return
    }
    // Код проверен — сессия есть, осталось задать пароль.
    setBusy(false); setPassword(''); setConfirm(''); setStep('newpass')
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    if (busy || password.length < 8 || password !== confirm) return
    setBusy(true); setError('')
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(false)
    if (error) { setError(humanAuthError(error.message)); return }
    setTarget(await nextRoute(supabase, 'web'))
    setStep('done')
  }

  // ── Успех ────────────────────────────────────────────────────
  if (step === 'done') {
    return (
      <AuthShell>
        <SuccessScreen
          title="Пароль змінено"
          subtitle="Ваш пароль успішно оновлено. Тепер можете увійти з новим паролем."
          actionLabel="Продовжити"
          onAction={() => { window.location.href = target }}
        />
      </AuthShell>
    )
  }

  // ── Новый пароль ─────────────────────────────────────────────
  if (step === 'newpass') {
    return (
      <AuthShell title="Новий пароль" subtitle="Придумайте пароль — і одразу увійдемо">
        <form onSubmit={save} className="flex flex-col gap-4">
          <div>
            <label className="field-label" htmlFor="np">Пароль</label>
            <PasswordInput id="np" value={password} onChange={setPassword}
                           autoComplete="new-password" autoFocus />
            <PasswordStrength value={password} />
          </div>
          <div>
            <label className="field-label" htmlFor="np2">Підтвердіть пароль</label>
            <PasswordInput id="np2" value={confirm} onChange={setConfirm}
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

  // ── Код ──────────────────────────────────────────────────────
  if (step === 'code') {
    return (
      <AuthShell title="Код із листа"
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
                  disabled={left > 0 || busy} onClick={() => void send()}>
            Надіслати код повторно
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

  // ── Лист надіслано ───────────────────────────────────────────
  if (step === 'sent') {
    return (
      <AuthShell>
        <div className="auth-result">
          <span className="hero-circle rise" aria-hidden><MailIcon size={36} /></span>
          <h1 className="display rise-1 t-2xl mt-6 text-center">Лист надіслано</h1>
          <p className="rise-2 t-md mt-2 text-center prose-muted" style={{ lineHeight: 1.5 }}>
            Ми надіслали інструкцію для скидання пароля на {email.trim()}
          </p>
          <p className="rise-2 t-sm mt-2 text-center" style={{ color: 'var(--color-faint)' }}>
            Перевірте папку «Вхідні» та «Спам»
          </p>

          <div className="rise-3 auth-result-actions">
            <button type="button" className="btn-primary btn-tall"
                    onClick={() => { setCode(''); setCodeError(''); setStep('code') }}>
              Ввести код із листа
            </button>
            <Link href="/login" className="link-quiet">Повернутися до входу</Link>
          </div>
        </div>
      </AuthShell>
    )
  }

  // ── Пошта ────────────────────────────────────────────────────
  return (
    <AuthShell title="Забули пароль?"
               subtitle="Введіть email, і ми надішлемо інструкцію для скидання пароля">
      <form onSubmit={send} className="flex flex-col gap-4">
        <div>
          <label className="field-label" htmlFor="email">Email</label>
          <input id="email" type="email" required className="input" autoComplete="email"
                 inputMode="email" autoCapitalize="none" spellCheck={false}
                 value={email} onChange={(e) => setEmail(e.target.value)}
                 placeholder="you@example.com" />
        </div>
        {error && <p className="field-error">{error}</p>}
        <button className="btn-primary btn-tall" disabled={busy || email.trim().length < 5}>
          {busy ? 'Надсилаємо…' : 'Надіслати інструкцію'}
        </button>
      </form>

      <p className="t-md mt-6 prose-muted">
        Згадали пароль?{' '}
        <Link href="/login" className="underline underline-offset-2">Увійти</Link>
      </p>
    </AuthShell>
  )
}
