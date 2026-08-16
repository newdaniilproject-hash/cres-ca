'use client'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { LEGAL_VERSION, LEGAL_DOCS } from '@/lib/legal'
import { signupSource } from '@/lib/consent'
import { humanAuthError, codeErrorText } from '@/lib/auth-errors'
import { AuthShell } from '../auth-shell'
import { GoogleButton } from '../google-button'
import { CodeInput } from '@/app/m/code-input'
import { MailIcon, PasswordInput, SuccessScreen, mmss } from '@/components/auth-ui'

// Регистрация покупателя. Четыре экрана одного потока: анкета →
// «перевірте пошту» → код → успех.
//
// Подтверждение почты — КОДОМ, а не ссылкой. Ссылку ломают почтовые
// клиенты, которые открывают её во встроенном браузере без сессии,
// и она бесполезна в мобильном приложении: почта открывается в другом
// окне, человек возвращается — а подтверждать нечего. Код переносится
// глазами и работает везде одинаково.
//
// ⚠️ ГЛАВНОЕ, ЧТО ЗДЕСЬ БЫЛО СЛОМАНО (починено 13.08.2026):
// форма ждала 6 знаков, а Supabase был настроен на 8 (MAILER_OTP_LENGTH),
// поэтому кнопка «Підтвердити» не разблокировалась НИКОГДА и веб-регистрацию
// нельзя было пройти физически. Решение владельца — шесть цифр везде;
// длина кода теперь одна константа на весь проект, и та же, что в /m.
//
// Условия на стороне Supabase (миграцией не делаются):
//   1. Authentication → Emails → Templates → Confirm signup:
//      в шаблоне {{ .Token }}, а не {{ .ConfirmationURL }}.
//   2. Sign In / Providers → Email → Email OTP length = 6,
//      Email OTP expiration = 600 (10 минут).
const CODE_LENGTH = 6
const RESEND_SECONDS = 60

type Step = 'form' | 'sent' | 'code' | 'done'

function RegisterInner() {
  const supabase = createClient()

  // Адрес возврата. Приходит из ссылки (`/register?next=/invite/<token>`)
  // и означает «человек пришёл сюда с чужого экрана, вернуть его туда».
  // Без этого приглашённый сотрудник регистрируется, попадает в общий
  // кабинет без заведения и считает, что приглашение не сработало:
  // ссылка из письма к тому моменту уже закрыта.
  //
  // Проверка ровно та же, что на /login, и она обязательна: принимаем
  // ТОЛЬКО внутренний путь с одним ведущим слэшем. `//evil.com` браузер
  // читает как протокол-относительный адрес, то есть чужой сайт, —
  // иначе форма регистрации становится открытым перенаправлением.
  const params = useSearchParams()
  const rawNext = params.get('next')
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/account'
  // Адрес возврата тащим и во вход: человек с этого экрана часто уходит
  // туда, вспомнив, что аккаунт есть, — и терять цель на полпути нельзя.
  const loginHref = next === '/account' ? '/login' : `/login?next=${encodeURIComponent(next)}`

  const [step, setStep] = useState<Step>('form')
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [agree, setAgree] = useState(false)

  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [codeError, setCodeError] = useState('')
  const [note, setNote] = useState('')
  const [left, setLeft] = useState(0)

  // Отсчёт до повторной отправки. Без него человек жмёт «надіслати ще раз»
  // трижды подряд, упирается в лимит почтовика и решает, что сломалось.
  useEffect(() => {
    if (left <= 0) return
    const id = setTimeout(() => setLeft((v) => v - 1), 1000)
    return () => clearTimeout(id)
  }, [left])

  const mismatch = confirm.length > 0 && confirm !== password
  const ready =
    first.trim().length >= 2 &&
    last.trim().length >= 2 &&
    email.trim().length >= 5 &&
    password.length >= 8 &&
    confirm === password &&
    agree

  async function submitForm(e: React.FormEvent) {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true); setError(''); setNote('')

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          first_name: first.trim(),
          last_name: last.trim(),
          full_name: `${first.trim()} ${last.trim()}`,
          locale: 'uk',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          // Версия документов уходит вместе с регистрацией: триггер
          // handle_new_user кладёт её в журнал согласий. Галочка без
          // этой строки — картинка, а не согласие.
          terms_version: LEGAL_VERSION,
          signup_source: signupSource(),
        },
      },
    })

    setBusy(false)
    if (error) { setError(humanAuthError(error.message)); return }

    // ГРАБЛИ. Здесь напрашивается проверка data.user.identities.length === 0
    // как признак «такой уже есть». Делать её нельзя: Supabase намеренно
    // возвращает пустой список ВСЕМ, чтобы по форме регистрации нельзя было
    // перебором узнать, кто зарегистрирован. В первой крес-ке эта проверка
    // стояла и давала ложные срабатывания — живых людей выбрасывало на «Увійти».
    // Если почта действительно занята, это честно скажет verifyOtp.
    void data

    // Подтверждение отключено в настройках — сессия выдана сразу.
    if (data.session) { window.location.href = next; return }

    setStep('sent')
    setLeft(RESEND_SECONDS)
  }

  async function verify(v: string) {
    if (busy) return
    setBusy(true); setCodeError('')
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(), token: v, type: 'signup',
    })
    if (error) {
      setBusy(false)
      setCodeError(codeErrorText(error.message))
      setCode('')
      return
    }
    setBusy(false)
    setStep('done')
  }

  async function resend() {
    if (left > 0 || busy) return
    setBusy(true); setError(''); setNote(''); setCodeError('')
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() })
    setBusy(false)
    if (error) { setError(humanAuthError(error.message)); return }
    setNote('Надіслали новий код.')
    setLeft(RESEND_SECONDS)
  }

  // ── Успех ────────────────────────────────────────────────────
  // ГРАБЛИ. Переход только полной навигацией, а не router.push:
  // серверная проверка сессии на следующей странице должна увидеть
  // свежие куки. При мягком переходе она гонится с ними и выбрасывает
  // человека обратно на вход — ровно после успешного подтверждения.
  if (step === 'done') {
    return (
      <AuthShell>
        <SuccessScreen
          title="Email підтверджено!"
          subtitle={next === '/account'
            ? 'Ваш акаунт успішно активовано. Тепер ви можете увійти.'
            : 'Ваш акаунт активовано. Повертаємо вас туди, звідки ви прийшли.'}
          actionLabel="Продовжити"
          onAction={() => { window.location.href = next }}
        />
      </AuthShell>
    )
  }

  // ── Перевірте пошту ──────────────────────────────────────────
  if (step === 'sent') {
    // Кнопку «Відкрити Gmail» показываем только тем, у кого почта
    // действительно на gmail.com: остальным она обещает не то.
    const gmail = /@gmail\.com$/i.test(email.trim())
    return (
      <AuthShell>
        <div className="auth-result">
          <span className="hero-circle rise" aria-hidden><MailIcon size={36} /></span>
          <h1 className="display rise-1 t-2xl mt-6 text-center">Перевірте свою пошту</h1>
          <p className="rise-2 t-md mt-2 text-center prose-muted" style={{ lineHeight: 1.5 }}>
            Ми надіслали лист для підтвердження на {email.trim()}
          </p>
          <p className="rise-2 t-sm mt-2 text-center" style={{ color: 'var(--color-faint)' }}>
            Введіть код із листа, щоб активувати акаунт
          </p>

          {error && <p className="field-error">{error}</p>}
          {note && <p className="t-sm mt-3" style={{ color: 'var(--color-success)' }}>{note}</p>}

          <div className="rise-3 auth-result-actions">
            <button type="button" className="btn-primary btn-tall"
                    onClick={() => { setCode(''); setCodeError(''); setStep('code') }}>
              Ввести код із листа
            </button>
            {gmail && (
              <a className="btn-secondary btn-tall" href="https://mail.google.com/"
                 target="_blank" rel="noopener noreferrer">
                Відкрити Gmail
              </a>
            )}
            <button type="button" className="link-quiet" onClick={() => void resend()}
                    disabled={left > 0 || busy}>
              {left > 0 ? `Надіслати лист повторно через ${left} с` : 'Надіслати лист повторно'}
            </button>
            <Link href={loginHref} className="link-quiet">Повернутися до входу</Link>
          </div>
        </div>
      </AuthShell>
    )
  }

  // ── Код ──────────────────────────────────────────────────────
  if (step === 'code') {
    return (
      <AuthShell title="Підтвердження входу"
                 subtitle={`Ми надіслали 6-значний код на ${email.trim()}`}>
        <CodeInput
          value={code}
          disabled={busy}
          invalid={!!codeError}
          length={CODE_LENGTH}
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

  // ── Анкета ───────────────────────────────────────────────────
  return (
    <AuthShell title="Реєстрація"
               subtitle="Створіть акаунт, щоб користуватися всіма можливостями CRESKO">
      <form onSubmit={submitForm} className="flex flex-col gap-4">
        <div>
          <label className="field-label" htmlFor="first">Імʼя</label>
          <input id="first" required className="input" autoComplete="given-name"
                 autoCapitalize="words"
                 value={first} onChange={(e) => setFirst(e.target.value)} placeholder="Марія" />
        </div>
        <div>
          <label className="field-label" htmlFor="last">Прізвище</label>
          <input id="last" required className="input" autoComplete="family-name"
                 autoCapitalize="words"
                 value={last} onChange={(e) => setLast(e.target.value)} placeholder="Коваленко" />
        </div>
        <div>
          <label className="field-label" htmlFor="email">Email</label>
          <input id="email" type="email" required className="input" autoComplete="email"
                 inputMode="email" autoCapitalize="none" spellCheck={false}
                 value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div>
          <label className="field-label" htmlFor="pass">Пароль</label>
          <PasswordInput id="pass" value={password} onChange={setPassword}
                         autoComplete="new-password" />
          <p className={password.length > 0 && password.length < 8 ? 'field-error' : 'field-hint'}>
            Мінімум 8 символів
          </p>
        </div>
        <div>
          <label className="field-label" htmlFor="pass2">Підтвердіть пароль</label>
          <PasswordInput id="pass2" value={confirm} onChange={setConfirm}
                         autoComplete="new-password" invalid={mismatch} />
          {mismatch && <p className="field-error">Паролі не збігаються</p>}
        </div>

        {/* Согласие с версией: без terms_version запись в журнале
            согласий не значит ничего. Ссылки открываются — галочка
            над нечитаемым текстом это повод для отказа и в App Store,
            и у Meta при верификации бизнеса. */}
        <label className="checkline">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            Я ознайомився(-лась) та погоджуюсь з{' '}
            {LEGAL_DOCS.map((d, i) => (
              <span key={d.href}>
                <Link href={d.href}>{d.label.toLowerCase()}</Link>
                {i < LEGAL_DOCS.length - 2 ? ', ' : i === LEGAL_DOCS.length - 2 ? ' і ' : ''}
              </span>
            ))}
            .
          </span>
        </label>

        {error && <p className="field-error">{error}</p>}

        <button className="btn-primary btn-tall" disabled={busy || !ready}>
          {busy ? 'Створюємо…' : 'Зареєструватися'}
        </button>
      </form>

      <GoogleButton next={next} />

      <p className="t-md mt-6 text-center prose-muted">
        Вже є акаунт?{' '}
        <Link href={loginHref} className="underline underline-offset-2">Увійти</Link>
      </p>
    </AuthShell>
  )
}

export default function RegisterPage() {
  // useSearchParams требует границы Suspense, иначе прод-сборка Next
  // падает на пререндере. В этом проекте уже ловилось — см. /login.
  return <Suspense><RegisterInner /></Suspense>
}
