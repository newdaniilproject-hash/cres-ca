'use client'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { codeErrorText, humanAuthError } from '@/lib/auth-errors'
import { nextRoute } from '@/lib/where'
import { guardSignIn } from '@/lib/ratelimit/guard'
import { AuthShell } from '../auth-shell'
import { useT } from '@/lib/i18n/client'
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
// Сам /reset удалён 19.08.2026 (правило 8): попасть на него было нечем.
//
// Теперь поток такой же, как в приложении (/m/login, режим reset):
// почта → код → сразу новый пароль → успех. Человек не уходит
// с экрана ни разу, и это единственный вариант, который работает
// и в приложении, где письмо открывается в другом окне.
const CODE_LENGTH = 6
const RESEND_SECONDS = 60

type Step = 'form' | 'sent' | 'code' | 'newpass' | 'done'

function ForgotInner() {
  const t = useT()
  const supabase = createClient()

  // Почта приходит из адреса (`/forgot?email=…`) — её несут «Забули?»
  // на входе и карточка «пошта вже зареєстрована» на регистрации.
  // Предзаполняем, а не подставляем молча: человек видит и правит поле.
  const params = useSearchParams()

  const [step, setStep] = useState<Step>('form')
  const [email, setEmail] = useState(params.get('email') ?? '')
  // Куда уходим после смены пароля. Считается в момент успеха:
  // сессия после verifyOtp уже есть, и членства читаемы.
  const [target, setTarget] = useState('/app')
  const [code, setCode] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [codeError, setCodeError] = useState('')
  const [left, setLeft] = useState(0)

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
    // Восстановление считается тем же пределом, что и вход (5 за 15 хвилин
    // с адреса): каждая отправка — это письмо от нашего имени, и это самая
    // дешёвая для чужого скрипта кнопка на всём сайте. Кнопка «надіслати
    // ще раз» зовёт эту же функцию, так что отдельного заслона ей не нужно.
    const gate = await guardSignIn()
    if (!gate.ok) { setBusy(false); setError(gate.message); return }
    // redirectTo здесь не задаётся намеренно: в письме код, а не ссылка,
    // и адрес возврата в нём никак не используется.
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim())
    setBusy(false)
    if (error) { setError(humanAuthError(t, error.message)); return }
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
      setBusy(false); setCodeError(codeErrorText(t, error.message)); setCode('')
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
    if (error) { setBusy(false); setError(humanAuthError(t, error.message)); return }
    // Сессия после verifyOtp уже есть — «Увійти» человеку не нужно.
    // Куда вести, решает lib/where.ts: владелец салона обязан попасть
    // в /app, а не в покупательский /account, куда экран вёл раньше.
    // 'web' обязателен: умолчание у nextRoute — поверхность приложения.
    setTarget(await nextRoute(supabase, 'web'))
    setBusy(false)
    setStep('done')
  }

  // ── Успех ────────────────────────────────────────────────────
  // Кнопка «До кабінету», а не «Увійти»: вход уже состоялся, обещать
  // его второй раз значит врать. И уходим сами через пару секунд —
  // тем же приёмом Redirect, что на входе и регистрации.
  if (step === 'done') {
    return (
      <AuthShell>
        <SuccessScreen
          title={t('auth.done.password.title')}
          subtitle={t('auth.done.password.descSession')}
          actionLabel={t('auth.done.password.go')}
          onAction={() => { window.location.href = target }}
        />
        <Redirect to={target} />
      </AuthShell>
    )
  }

  // ── Новый пароль ─────────────────────────────────────────────
  if (step === 'newpass') {
    return (
      <AuthShell title={t('auth.newpass.title')} subtitle={t('auth.newpass.subtitle')}>
        <form onSubmit={save} className="flex flex-col gap-4">
          <div>
            <label className="field-label" htmlFor="np">{t('auth.field.password')}</label>
            <PasswordInput id="np" value={password} onChange={setPassword}
                           autoComplete="new-password" autoFocus />
            <PasswordStrength value={password} />
          </div>
          <div>
            <label className="field-label" htmlFor="np2">{t('auth.field.confirmPassword')}</label>
            <PasswordInput id="np2" value={confirm} onChange={setConfirm}
                           autoComplete="new-password" invalid={mismatch} />
            {mismatch && <p className="field-error">{t('auth.field.mismatch')}</p>}
          </div>

          {error && <p className="field-error">{error}</p>}

          <button className="btn-primary btn-tall"
                  disabled={busy || password.length < 8 || password !== confirm}>
            {busy ? t('common.saving') : t('auth.newpass.submit')}
          </button>
        </form>
      </AuthShell>
    )
  }

  // ── Код ──────────────────────────────────────────────────────
  if (step === 'code') {
    return (
      <AuthShell title={t('auth.forgot.code.title')}
                 subtitle={t('auth.code.sentTo', { email: email.trim(), n: CODE_LENGTH })}>
        <CodeInput
          value={code} disabled={busy} invalid={!!codeError} length={CODE_LENGTH}
          onChange={(v) => {
            setCode(v); setCodeError('')
            if (v.length === CODE_LENGTH) void verify(v)
          }}
        />

        {codeError && <p className="field-error text-center">{codeError}</p>}
        {busy && !codeError && (
          <p className="t-sm mt-3 text-center prose-muted">{t('auth.code.checking')}</p>
        )}

        <p className="code-countdown">
          {left > 0
            ? t('auth.code.resendIn', { time: mmss(left) })
            : t('auth.code.resendReady')}
        </p>

        <div className="auth-result-actions">
          <button type="button" className="btn-primary btn-tall"
                  disabled={busy || code.length !== CODE_LENGTH}
                  onClick={() => void verify(code)}>
            {busy ? t('auth.code.checking') : t('auth.code.submit')}
          </button>
          <button type="button" className="link-quiet link-accent"
                  disabled={left > 0 || busy} onClick={() => void send()}>
            {t('auth.code.resend')}
          </button>
        </div>

        <div className="note note-row">
          <span style={{ color: 'var(--color-muted)' }}><MailIcon size={20} /></span>
          <span>{t('auth.code.noMail')}</span>
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
          <h1 className="display rise-1 t-2xl mt-6 text-center">{t('auth.forgot.sent.title')}</h1>
          <p className="rise-2 t-md mt-2 text-center prose-muted" style={{ lineHeight: 1.5 }}>
            {t('auth.forgot.sent.desc', { email: email.trim() })}
          </p>
          <p className="rise-2 t-sm mt-2 text-center" style={{ color: 'var(--color-faint)' }}>
            {t('auth.forgot.sent.hint')}
          </p>

          <div className="rise-3 auth-result-actions">
            <button type="button" className="btn-primary btn-tall"
                    onClick={() => { setCode(''); setCodeError(''); setStep('code') }}>
              {t('auth.forgot.sent.enterCode')}
            </button>
            <Link href="/login" className="link-quiet">{t('auth.forgot.sent.backToLogin')}</Link>
          </div>
        </div>
      </AuthShell>
    )
  }

  // ── Пошта ────────────────────────────────────────────────────
  return (
    <AuthShell title={t('auth.forgot.title')} subtitle={t('auth.forgot.subtitle')}>
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
          {busy ? t('auth.forgot.busy') : t('auth.forgot.submit')}
        </button>
      </form>

      <p className="t-md mt-6 prose-muted">
        {t('auth.forgot.remembered')}{' '}
        <Link href="/login" className="underline underline-offset-2">
          {t('auth.forgot.login')}
        </Link>
      </p>
    </AuthShell>
  )
}

// Экран успеха живёт пару секунд и уходит сам — тот же приём, что на
// входе и регистрации. Отдельным компонентом, чтобы эффект не висел
// на всём экране восстановления и не срабатывал раньше времени.
function Redirect({ to }: { to: string }) {
  useEffect(() => {
    const id = setTimeout(() => { window.location.href = to }, 2000)
    return () => clearTimeout(id)
  }, [to])
  return null
}

export default function ForgotPage() {
  // useSearchParams требует границы Suspense, иначе прод-сборка Next
  // падает на пререндере. В этом проекте уже ловилось — см. /login.
  return <Suspense><ForgotInner /></Suspense>
}
