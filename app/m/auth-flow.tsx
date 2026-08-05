'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { nextRoute } from './where'

const CODE_LENGTH = 6
const RESEND_SECONDS = 60

// Вход и регистрация в приложении — один и тот же экран с кодом.
// Пароля нет намеренно: продавцу «из инстаграма» он не нужен, а на телефоне
// это лишний экран и лишний повод не дойти до конца.
//
// ГРАБЛИ, уже собранные на старой креске — не повторять:
//  1. НЕ проверять data.user.identities.length === 0: Supabase скрывает
//     существование аккаунта, и проверка даёт ложные срабатывания.
//  2. После verifyOtp — window.location, а не router.push: клиенту нужен
//     полный перезапуск, иначе он живёт со старой сессией.
//  3. У экрана кода своя ошибка: ошибка ввода не должна выглядеть как
//     ошибка отправки письма.
export function MobileAuthFlow({ mode }: { mode: 'login' | 'register' }) {
  const supabase = useMemo(() => createClient(), [])

  const [step, setStep] = useState<'email' | 'code'>('email')
  const [email, setEmail] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [codeError, setCodeError] = useState('')
  // Пришёл регистрироваться, а акаунт уже есть — экран кода превращается
  // во вход, и мы говорим об этом прямо.
  const [existing, setExisting] = useState(false)
  const [left, setLeft] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (left <= 0) return
    const t = setTimeout(() => setLeft(left - 1), 1000)
    return () => clearTimeout(t)
  }, [left])

  // Как только показали экран кода — фокус в поле, чтобы клавиатура
  // поднялась сама и iOS предложил код из письма.
  useEffect(() => {
    if (step === 'code') setTimeout(() => codeRef.current?.focus(), 60)
  }, [step])

  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault()
    setBusy(true); setError(''); setExisting(false)
    const addr = email.trim()

    // Регистрация и вход — разные обещания, и человек должен понимать,
    // что с ним произошло. Supabase сам по себе молчит: с shouldCreateUser
    // он и создаст нового, и впустит существующего, ничего не сказав.
    //
    // Поэтому сначала пробуем войти БЕЗ создания. Прошло — значит акаунт
    // уже есть, и код, который только что ушёл, — код для входа; так и
    // говорим. Не прошло с «signups not allowed» — почты нет, создаём.
    // Письмо в обоих случаях уходит ровно одно.
    if (mode === 'register') {
      const probe = await supabase.auth.signInWithOtp({
        email: addr, options: { shouldCreateUser: false },
      })
      if (!probe.error) {
        setBusy(false); setExisting(true)
        setCode(''); setCodeError(''); setLeft(RESEND_SECONDS); setStep('code')
        return
      }
      if (!probe.error.message.toLowerCase().includes('signups not allowed')) {
        setBusy(false); setError(probe.error.message); return
      }
    }

    const { error } = await supabase.auth.signInWithOtp({
      email: addr,
      options: { shouldCreateUser: mode === 'register' },
    })
    setBusy(false)
    if (error) {
      setError(
        error.message.toLowerCase().includes('signups not allowed')
          ? 'Такої пошти ще немає. Створіть акаунт.'
          : error.message,
      )
      return
    }
    setCode(''); setCodeError(''); setLeft(RESEND_SECONDS); setStep('code')
  }

  async function verify(value: string) {
    setBusy(true); setCodeError('')
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: value,
      type: 'email',
    })
    if (error) {
      setBusy(false)
      setCodeError('Код невірний або вже застарів')
      setCode('')
      codeRef.current?.focus()
      return
    }
    window.location.href = await nextRoute(supabase)
  }

  function onCodeChange(raw: string) {
    const digits = raw.replace(/\D/g, '').slice(0, CODE_LENGTH)
    setCode(digits)
    setCodeError('')
    if (digits.length === CODE_LENGTH) verify(digits)
  }

  const title = mode === 'register' ? 'Створити акаунт' : 'Вхід'

  if (step === 'code') {
    return (
      <Frame
        title={existing ? 'Ви вже з нами' : 'Введіть код'}
        subtitle={existing
          ? `На ${email} уже є акаунт. Надіслали код для входу.`
          : `Надіслали шість цифр на ${email}`}
        onBack={() => { setStep('email'); setCode(''); setCodeError(''); setExisting(false) }}
      >
        <input
          ref={codeRef}
          value={code}
          onChange={(e) => onCodeChange(e.target.value)}
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={CODE_LENGTH}
          disabled={busy}
          aria-label="Код з листа"
          className="input"
          style={{
            height: 64,
            fontSize: 30,
            fontWeight: 700,
            textAlign: 'center',
            letterSpacing: '0.35em',
            textIndent: '0.35em',
          }}
        />

        {codeError && <p className="field-error">{codeError}</p>}
        {busy && !codeError && (
          <p className="t-sm mt-2" style={{ color: 'var(--color-muted)' }}>Перевіряємо…</p>
        )}

        <button
          type="button"
          disabled={left > 0 || busy}
          onClick={() => sendCode()}
          className="t-sm mt-6 underline underline-offset-2"
          style={{ color: left > 0 ? 'var(--color-faint)' : 'var(--color-accent)' }}
        >
          {left > 0 ? `Надіслати ще раз через ${left} с` : 'Надіслати код ще раз'}
        </button>

        <p className="t-xs mt-4" style={{ color: 'var(--color-faint)', lineHeight: 1.5 }}>
          Лист приходить за кілька секунд. Якщо його немає — подивіться в «Спам».
        </p>
      </Frame>
    )
  }

  return (
    <Frame
      title={title}
      subtitle={mode === 'register'
        ? 'Пароль не потрібен — надішлемо код на пошту'
        : 'Надішлемо код на пошту'}
      onBack={null}
    >
      <form onSubmit={sendCode} className="flex flex-col gap-4">
        <div>
          <label className="field-label" htmlFor="m-email">Пошта</label>
          <input
            id="m-email"
            type="email"
            required
            autoFocus
            autoComplete="email"
            inputMode="email"
            autoCapitalize="none"
            className="input"
            // 16px — не вкус, а порог: при меньшем размере iOS зумит поле
            // и обратно не отъезжает.
            style={{ height: 52, fontSize: 16 }}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="you@example.com"
          />
        </div>

        {error && <p className="field-error">{error}</p>}

        <button
          className="btn-primary flex items-center justify-center"
          style={{ height: 52, fontSize: 16 }}
          disabled={busy || email.trim().length < 5}
        >
          {busy ? 'Надсилаємо…' : 'Далі'}
        </button>
      </form>

      <p className="t-sm mt-6" style={{ color: 'var(--color-muted)' }}>
        {mode === 'register' ? (
          <>Вже маєте акаунт? <Link href="/m/login" className="underline underline-offset-2">Увійти</Link></>
        ) : (
          <>Немає акаунта? <Link href="/m/register" className="underline underline-offset-2">Створити</Link></>
        )}
      </p>
    </Frame>
  )
}

// Каркас экрана приложения: заголовок слева, кнопка «назад» стрелкой,
// содержимое прижато к верху. Так устроен любой нативный экран ввода.
function Frame({ title, subtitle, onBack, children }: {
  title: string
  subtitle?: string
  onBack: (() => void) | null
  children: React.ReactNode
}) {
  return (
    <main className="flex flex-1 flex-col px-6">
      <div className="flex items-center" style={{ height: 56, marginLeft: -8 }}>
        {onBack ? (
          <button
            type="button"
            onClick={onBack}
            aria-label="Назад"
            className="flex items-center justify-center"
            style={{ width: 'var(--tap-min)', height: 'var(--tap-min)' }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        ) : (
          <Link
            href="/m"
            aria-label="Назад"
            className="flex items-center justify-center"
            style={{ width: 'var(--tap-min)', height: 'var(--tap-min)' }}
          >
            <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
                 stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </Link>
        )}
      </div>

      <h1 className="display t-2xl mt-4">{title}</h1>
      {subtitle && (
        <p className="t-md mt-2" style={{ color: 'var(--color-muted)', lineHeight: 1.5 }}>
          {subtitle}
        </p>
      )}
      <div className="mt-7">{children}</div>
    </main>
  )
}
