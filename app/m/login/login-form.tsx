'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CodeInput } from '../code-input'
import { nextRoute } from '../where'
import { AppScreen, Field, keepVisible } from '../ui'
import { OAuthButtons } from '../oauth'

const CODE_LENGTH = 8
const RESEND_SECONDS = 60

// Вход. Основной способ — пароль: человек его только что придумал
// при регистрации, и лишний поход в почту на каждый вход раздражает.
// Код на почту остаётся вторым способом — для тех, кто пароль забыл
// или не хочет его набирать на телефоне.
//
// Восстановление пароля — тем же кодом, а не ссылкой: ссылка из письма
// открывается в браузере телефона, а не в приложении, и человек
// оказывается в вебе. Именно на этом уже обожглись.
type Mode = 'password' | 'code' | 'reset'

export function MobileLoginForm() {
  const supabase = useMemo(() => createClient(), [])
  const params = useSearchParams()

  const [mode, setMode] = useState<Mode>('password')
  const [step, setStep] = useState<'form' | 'code' | 'newpass'>('form')

  const [email, setEmail] = useState(params.get('email') ?? '')
  const [password, setPassword] = useState('')
  const [seePass, setSeePass] = useState(false)

  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [left, setLeft] = useState(0)

  const [busy, setBusy] = useState(false)
  // Вход через провайдера возвращается сюда с причиной отказа
  // в адресе: своего состояния у него быть не может — приложение
  // за это время успело перезагрузиться.
  const [error, setError] = useState(params.get('oauth') ?? '')
  const [noAccount, setNoAccount] = useState(false)

  function tick() {
    setLeft(RESEND_SECONDS)
    const id = setInterval(() => {
      setLeft((v) => { if (v <= 1) { clearInterval(id); return 0 } return v - 1 })
    }, 1000)
  }

  // ── Вход паролем ─────────────────────────────────────────────
  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(''); setNoAccount(false)
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(), password,
    })
    if (error) {
      setBusy(false)
      const m = error.message.toLowerCase()
      if (m.includes('email not confirmed')) {
        setError('Пошта ще не підтверджена. Увійдіть кодом — і підтвердимо.')
        return
      }
      setError(m.includes('invalid login')
        ? 'Невірна пошта або пароль'
        : error.message)
      return
    }
    window.location.href = await nextRoute(supabase)
  }

  // ── Код на почту: и вход, и восстановление пароля ────────────
  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault()
    setBusy(true); setError(''); setNoAccount(false)

    // shouldCreateUser: false — вход не должен молча создавать акаунт.
    // Регистрация это отдельное обещание с отдельной формой.
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(), options: { shouldCreateUser: false },
    })
    setBusy(false)
    if (error) {
      if (error.message.toLowerCase().includes('signups not allowed')) {
        setNoAccount(true); return
      }
      setError(error.message); return
    }
    setCode(''); setCodeError(''); tick(); setStep('code')
  }

  async function verify(v: string) {
    setBusy(true); setCodeError('')
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(), token: v, type: 'email',
    })
    if (error) {
      setBusy(false); setCodeError('Код невірний або вже застарів'); setCode(''); return
    }
    // Восстановление пароля: код проверен, сессия есть — осталось
    // задать новый пароль, не выходя из приложения.
    if (mode === 'reset') { setBusy(false); setPassword(''); setStep('newpass'); return }
    window.location.href = await nextRoute(supabase)
  }

  async function saveNewPassword(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.auth.updateUser({ password })
    if (error) { setBusy(false); setError(error.message); return }
    window.location.href = await nextRoute(supabase)
  }

  // ── Новый пароль ─────────────────────────────────────────────
  if (step === 'newpass') {
    return (
      <AppScreen title="Новий пароль" subtitle="Придумайте пароль — і одразу увійдемо">
        <form onSubmit={saveNewPassword} className="flex flex-col gap-5">
          <Field label="Пароль" htmlFor="l-newpass">
            <PasswordInput
              id="l-newpass" value={password} onChange={setPassword}
              see={seePass} onSee={() => setSeePass((v) => !v)} autoComplete="new-password"
            />
            <p className={password.length > 0 && password.length < 8 ? 'field-error' : 'field-hint'}>
              Щонайменше 8 символів
            </p>
          </Field>
          {error && <p className="field-error">{error}</p>}
          <button className="btn-primary flex items-center justify-center"
                  style={{ height: 52, fontSize: 16 }}
                  disabled={busy || password.length < 8}>
            {busy ? 'Зберігаємо…' : 'Зберегти і увійти'}
          </button>
        </form>
      </AppScreen>
    )
  }

  // ── Код ──────────────────────────────────────────────────────
  if (step === 'code') {
    return (
      <AppScreen
        title={mode === 'reset' ? 'Код для відновлення' : 'Введіть код'}
        subtitle={`Надіслали вісім цифр на ${email.trim()}`}
        onBack={() => { setStep('form'); setCode(''); setCodeError('') }}
      >
        <CodeInput
          value={code} disabled={busy} invalid={!!codeError} length={CODE_LENGTH}
          onChange={(v) => {
            setCode(v); setCodeError('')
            if (v.length === CODE_LENGTH) void verify(v)
          }}
        />
        {codeError && <p className="field-error text-center">{codeError}</p>}
        {busy && !codeError && <p className="t-sm mt-3 text-center prose-muted">Перевіряємо…</p>}

        <div className="mt-7 text-center">
          <button type="button" disabled={left > 0 || busy} onClick={() => void sendCode()}
                  className="t-sm underline underline-offset-2"
                  style={{ color: left > 0 ? 'var(--color-faint)' : 'var(--color-accent)',
                           minHeight: 'var(--tap-min)' }}>
            {left > 0 ? `Надіслати ще раз через ${left} с` : 'Надіслати код ще раз'}
          </button>
        </div>
        <p className="t-xs mt-2 text-center" style={{ color: 'var(--color-faint)', lineHeight: 1.5 }}>
          Код діє годину. Якщо листа немає — подивіться в «Спам».
        </p>
      </AppScreen>
    )
  }

  // ── Форма входа ──────────────────────────────────────────────
  const byPassword = mode === 'password'
  return (
    <AppScreen
      title={mode === 'reset' ? 'Відновлення' : 'Вхід'}
      subtitle={
        mode === 'reset' ? 'Надішлемо код — і задасте новий пароль'
          : byPassword ? 'Пошта і пароль' : 'Надішлемо код на пошту'
      }
      backHref="/m"
      onBack={mode === 'password' ? undefined : () => { setMode('password'); setError(''); setNoAccount(false) }}
    >
      <form onSubmit={byPassword ? signIn : sendCode} className="flex flex-col gap-5">
        <Field label="Пошта" htmlFor="l-email">
          <input
            id="l-email" type="email" required autoFocus={!email} autoComplete="email"
            inputMode="email" autoCapitalize="none" spellCheck={false}
            className="input" style={{ height: 52, fontSize: 16 }}
            value={email} onFocus={keepVisible}
            onChange={(e) => { setEmail(e.target.value); setNoAccount(false) }}
            placeholder="you@example.com"
          />
        </Field>

        {byPassword && (
          <Field label="Пароль" htmlFor="l-pass">
            <PasswordInput
              id="l-pass" value={password} onChange={setPassword}
              see={seePass} onSee={() => setSeePass((v) => !v)} autoComplete="current-password"
            />
          </Field>
        )}

        {noAccount && (
          <div className="card-flat" style={{ borderColor: 'var(--color-accent)' }}>
            <p className="t-md">Такої пошти в нас немає</p>
            <p className="t-sm mt-1 prose-muted">Створіть акаунт — це кілька полів.</p>
            <Link href="/m/register" className="btn-primary mt-3 flex items-center justify-center"
                  style={{ height: 48, fontSize: 16 }}>
              Створити акаунт
            </Link>
          </div>
        )}

        {error && <p className="field-error">{error}</p>}

        <button className="btn-primary flex items-center justify-center"
                style={{ height: 52, fontSize: 16 }}
                disabled={busy || email.trim().length < 5 || (byPassword && password.length < 1)}>
          {busy ? 'Хвилинку…' : byPassword ? 'Увійти' : 'Надіслати код'}
        </button>
      </form>

      {/* Провайдеры показываем только на обычном входе: на экране
          восстановления пароля кнопка «Продовжити з Apple» — это
          другой разговор, и человек теряет нить. */}
      {mode !== 'reset' && <OAuthButtons disabled={busy} />}

      <div className="mt-6 flex flex-col items-center gap-3">
        {byPassword ? (
          <>
            <button type="button" onClick={() => { setMode('code'); setError('') }}
                    className="t-sm underline underline-offset-2"
                    style={{ color: 'var(--color-accent)', minHeight: 'var(--tap-min)' }}>
              Увійти кодом з пошти
            </button>
            <button type="button" onClick={() => { setMode('reset'); setError('') }}
                    className="t-sm underline underline-offset-2 prose-muted"
                    style={{ minHeight: 'var(--tap-min)' }}>
              Забули пароль?
            </button>
          </>
        ) : (
          <button type="button" onClick={() => { setMode('password'); setError('') }}
                  className="t-sm underline underline-offset-2"
                  style={{ color: 'var(--color-accent)', minHeight: 'var(--tap-min)' }}>
            Увійти паролем
          </button>
        )}

        <p className="t-sm prose-muted">
          Немає акаунта?{' '}
          <Link href="/m/register" className="underline underline-offset-2">Створити</Link>
        </p>
      </div>
    </AppScreen>
  )
}

// Поле пароля с глазиком. Отдельным компонентом, потому что оно
// встречается трижды и разъезжаться не должно.
function PasswordInput({
  id, value, onChange, see, onSee, autoComplete,
}: {
  id: string
  value: string
  onChange: (v: string) => void
  see: boolean
  onSee: () => void
  autoComplete: string
}) {
  return (
    <div className="relative">
      <input
        id={id} required minLength={8} autoComplete={autoComplete}
        type={see ? 'text' : 'password'}
        className="input" style={{ height: 52, fontSize: 16, paddingRight: 52 }}
        value={value} onFocus={keepVisible}
        onChange={(e) => onChange(e.target.value)}
      />
      <button
        type="button" onClick={onSee}
        aria-label={see ? 'Сховати пароль' : 'Показати пароль'}
        className="absolute right-0 top-0 flex items-center justify-center"
        style={{ width: 52, height: 52, color: 'var(--color-muted)' }}
      >
        {see ? (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 3l18 18" />
            <path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
            <path d="M9.4 5.2A9.5 9.5 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1" />
            <path d="M6.2 6.8A17 17 0 0 0 2 12s3.6 7 10 7c1.2 0 2.3-.2 3.3-.6" />
          </svg>
        ) : (
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
            <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
            <circle cx="12" cy="12" r="3" />
          </svg>
        )}
      </button>
    </div>
  )
}
