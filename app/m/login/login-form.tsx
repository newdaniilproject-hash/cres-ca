'use client'

import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CodeInput } from '../code-input'
import { nextRoute } from '../where'
import { AppScreen, Field, keepVisible } from '../ui'
import { MailIcon, PasswordStrength, mmss } from '@/components/auth-ui'
import { OAuthButtons } from '../oauth'
import { authErrorText } from '@/app/(auth)/google-button'
import { humanAuthError, lockedText } from '@/lib/auth-errors'
import { useT } from '@/lib/i18n/client'
import { guardSignIn } from '@/lib/ratelimit/guard'
import { applySession, signInWithPassword, type SignInLock } from '@/lib/sign-in'

// Шесть цифр — столько же, сколько в вебе и в макетах владельца.
// Было восемь; расхождение с настройкой Supabase (MAILER_OTP_LENGTH)
// и было причиной, по которой веб-регистрация не проходила вовсе.
const CODE_LENGTH = 6
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
  const t = useT()
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
  //
  // ⚠️ Через authErrorText, а не дословно (12.08.2026): сюда приезжает
  // либо err из cresca://auth?error=… (тот же текст, что вернул
  // провайдер или Supabase), либо error.message из неудавшегося
  // exchangeCodeForSession в components/deep-link.tsx. Ни то ни другое
  // не рассчитано на глаза человека.
  const [error, setError] = useState(() => {
    const oauth = params.get('oauth')
    return oauth ? authErrorText(t, oauth) : ''
  })
  const [noAccount, setNoAccount] = useState(false)
  // Замок учётной записи (0085). Отдельным состоянием, а не строкой в
  // `error`: у него другой тон, другой совет и своя карточка. Строкой
  // под полем «вас замкнено на 15 хвилин» теряется среди «невірний пароль».
  const [lock, setLock] = useState<SignInLock | null>(null)

  function tick() {
    setLeft(RESEND_SECONDS)
    const id = setInterval(() => {
      setLeft((v) => { if (v <= 1) { clearInterval(id); return 0 } return v - 1 })
    }, 1000)
  }

  // ── Вход паролем ─────────────────────────────────────────────
  async function signIn(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(''); setNoAccount(false); setLock(null)

    // Вход паролем идёт ЧЕРЕЗ НАШ СЕРВЕР (`/api/auth/sign-in`), тем же
    // путём, что и в вебе: один набор серверных действий на обе поверхности
    // (CLAUDE.md, «Общий слой вместо паритета»). Ограничитель частоты
    // тратится ВНУТРИ роута — здесь его звать больше нельзя, иначе одна
    // попытка списывает две.
    const res = await signInWithPassword(email, password)
    if (!res.ok) {
      setBusy(false)

      if (res.kind === 'limited') { setError(res.message); return }
      if (res.kind === 'locked') { setLock(res.lock); return }

      // ⚠️ Подстроки, ПО КОТОРЫМ разбирается ответ сервера
      // (`email not confirmed`, `invalid login`), НЕ переводятся:
      // сервер отвечает по-английски всегда, и перевод условия сломал
      // бы разбор. Переводится только то, что читает человек.
      const m = res.message.toLowerCase()
      if (m.includes('email not confirmed')) {
        setError(t('m.login.error.notConfirmed'))
        return
      }
      if (m.includes('invalid login')) { setError(t('m.login.error.invalid')); return }
      // Сюда приходит и «User is banned» — замок стоял ещё до этой попытки,
      // и у него своя строка в `humanAuthError`.
      setError(humanAuthError(t, res.message))
      return
    }

    const failed = await applySession(supabase, res.session)
    if (failed) { setBusy(false); setError(humanAuthError(t, failed)); return }
    window.location.href = await nextRoute(supabase)
  }

  // ── Код на почту: и вход, и восстановление пароля ────────────
  async function sendCode(e?: React.FormEvent) {
    e?.preventDefault()
    setBusy(true); setError(''); setNoAccount(false)

    // Этой же функцией работает кнопка «надіслати ще раз», поэтому счётчик
    // тратится и на повтор: иначе предел обходится одной отправкой формы
    // и дальше повторами, каждый из которых — письмо от нашего имени.
    const gate = await guardSignIn()
    if (!gate.ok) { setBusy(false); setError(gate.message); return }

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
      setBusy(false); setCodeError(t('m.login.code.invalid')); setCode(''); return
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
      <AppScreen title={t('m.login.newpass.title')} subtitle={t('m.login.newpass.subtitle')}>
        <form onSubmit={saveNewPassword} className="flex flex-col gap-5">
          <Field label={t('m.field.password')} htmlFor="l-newpass">
            <PasswordInput
              id="l-newpass" value={password} onChange={setPassword}
              see={seePass} onSee={() => setSeePass((v) => !v)} autoComplete="new-password"
            />
            <PasswordStrength value={password} />
          </Field>
          {error && <p className="field-error">{error}</p>}
          <button className="btn-primary flex items-center justify-center"
                  style={{ height: 52, fontSize: 16 }}
                  disabled={busy || password.length < 8}>
            {busy ? t('common.saving') : t('m.login.newpass.submit')}
          </button>
        </form>
      </AppScreen>
    )
  }

  // ── Код ──────────────────────────────────────────────────────
  if (step === 'code') {
    return (
      <AppScreen
        title={mode === 'reset' ? t('m.login.code.title.reset') : t('m.login.code.title.login')}
        subtitle={t('auth.code.sentTo', { email: email.trim(), n: CODE_LENGTH })}
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
                  disabled={left > 0 || busy} onClick={() => void sendCode()}>
            {t('auth.code.resend')}
          </button>
        </div>

        <div className="note note-row">
          <span style={{ color: 'var(--color-muted)' }}><MailIcon size={20} /></span>
          <span>{t('m.login.code.noMail')}</span>
        </div>
      </AppScreen>
    )
  }

  // ── Форма входа ──────────────────────────────────────────────
  const byPassword = mode === 'password'
  return (
    <AppScreen
      title={mode === 'reset' ? t('m.login.title.reset') : t('m.login.title.login')}
      subtitle={
        mode === 'reset' ? t('m.login.subtitle.reset')
          : byPassword ? t('m.login.subtitle.password') : t('m.login.subtitle.code')
      }
      backHref="/m"
      onBack={mode === 'password' ? undefined : () => { setMode('password'); setError(''); setNoAccount(false); setLock(null) }}
    >
      <form onSubmit={byPassword ? signIn : sendCode} className="flex flex-col gap-5">
        <Field label={t('m.field.email')} htmlFor="l-email">
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
          <Field label={t('m.field.password')} htmlFor="l-pass">
            <PasswordInput
              id="l-pass" value={password} onChange={setPassword}
              see={seePass} onSee={() => setSeePass((v) => !v)} autoComplete="current-password"
            />
          </Field>
        )}

        {noAccount && (
          <div className="card-flat" style={{ borderColor: 'var(--color-accent)' }}>
            <p className="t-md">{t('m.login.noAccount.title')}</p>
            <p className="t-sm mt-1 prose-muted">{t('m.login.noAccount.desc')}</p>
            <Link href="/m/register" className="btn-primary mt-3 flex items-center justify-center"
                  style={{ height: 48, fontSize: 16 }}>
              {t('m.login.noAccount.action')}
            </Link>
          </div>
        )}

        {/* Замок 0085. Не строка под полем, а карточка с выходом: человеку
            надо сказать три вещи — что заперто, до какого времени и что
            блокировка снимется сама. Молчаливый отказ читается как
            поломка продукта. */}
        {lock && (
          <div className="card-flat" style={{ borderColor: 'var(--color-danger)' }}>
            <p className="t-md">{t('auth.locked.title')}</p>
            <p className="t-sm mt-1 prose-muted">{lockedText(t, lock)}</p>
            <p className="t-sm mt-1 prose-muted">{t('auth.locked.hint')}</p>
            <button type="button" className="btn-secondary mt-3 flex items-center justify-center"
                    style={{ height: 48, fontSize: 16 }}
                    onClick={() => { setMode('reset'); setLock(null); setError('') }}>
              {t('auth.blocked.reset')}
            </button>
          </div>
        )}

        {error && <p className="field-error">{error}</p>}

        <button className="btn-primary flex items-center justify-center"
                style={{ height: 52, fontSize: 16 }}
                disabled={busy || email.trim().length < 5 || (byPassword && password.length < 1)}>
          {busy ? t('m.login.busy') : byPassword ? t('m.login.submit') : t('m.login.sendCode')}
        </button>
      </form>

      {/* Провайдеры показываем только на обычном входе: на экране
          восстановления пароля кнопка «Продовжити з Apple» — это
          другой разговор, и человек теряет нить. */}
      {mode !== 'reset' && <OAuthButtons disabled={busy} />}

      <div className="mt-6 flex flex-col items-center gap-3">
        {byPassword ? (
          <>
            <button type="button" onClick={() => { setMode('code'); setError(''); setLock(null) }}
                    className="t-sm underline underline-offset-2"
                    style={{ color: 'var(--color-accent)', minHeight: 'var(--tap-min)' }}>
              {t('m.login.byCode')}
            </button>
            <button type="button" onClick={() => { setMode('reset'); setError(''); setLock(null) }}
                    className="t-sm underline underline-offset-2 prose-muted"
                    style={{ minHeight: 'var(--tap-min)' }}>
              {t('m.login.forgot')}
            </button>
          </>
        ) : (
          <button type="button" onClick={() => { setMode('password'); setError(''); setLock(null) }}
                  className="t-sm underline underline-offset-2"
                  style={{ color: 'var(--color-accent)', minHeight: 'var(--tap-min)' }}>
            {t('m.login.byPassword')}
          </button>
        )}

        <p className="t-sm prose-muted">
          {t('m.login.noAcc.lead')}{' '}
          <Link href="/m/register" className="underline underline-offset-2">
            {t('m.login.noAcc.link')}
          </Link>
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
  const t = useT()
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
        aria-label={see ? t('auth.password.hide.aria') : t('auth.password.show.aria')}
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
