'use client'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { LEGAL_VERSION, LEGAL_DOCS } from '@/lib/legal'
import { signupSource } from '@/lib/consent'
import { humanAuthError, codeErrorText } from '@/lib/auth-errors'
import { nextRoute } from '@/lib/where'
import { useT } from '@/lib/i18n/client'
import { guardSignUp } from '@/lib/ratelimit/guard'
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
  const t = useT()
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
  //
  // Запасного адреса здесь нет. Раньше здесь жёстко стояло '/account' —
  // покупательский кабинет. Но CRESKO это склад для мастеров: кто
  // регистрируется, регистрируется как бизнес, и человек без заведения
  // обязан попасть на его создание. Когда `next` не задан, решает
  // lib/where.ts — одна на веб и на приложение.
  const rawNext = params.get('next')
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : null
  // Адрес возврата тащим и во вход: человек с этого экрана часто уходит
  // туда, вспомнив, что аккаунт есть, — и терять цель на полпути нельзя.
  const loginHref = next ? `/login?next=${encodeURIComponent(next)}` : '/login'

  // Куда уходим после подтверждения. Считается один раз — в момент,
  // когда сессия уже есть: до неё членства прочитать нечем.
  const [target, setTarget] = useState('/app')

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

    // Ограничение частоты: 3 регистрации за час с адреса.
    //
    // Считается ТОЛЬКО создание акаунта. Кнопка «надіслати ще раз» ниже
    // счётчик не тратит намеренно: предел и так тесный, а повтор письма
    // доступен лишь тому, кто уже прошёл эту проверку, и сверху ограничен
    // дважды — отсчётом в 60 секунд на этом экране и собственным пределом
    // Supabase на повторную отправку. Списывать за него третью попытку
    // значило бы запирать на час человека, у которого просто медленно
    // идёт почта.
    const gate = await guardSignUp()
    if (!gate.ok) { setBusy(false); setError(gate.message); return }

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
    if (error) { setError(humanAuthError(t, error.message)); return }

    // ГРАБЛИ. Здесь напрашивается проверка data.user.identities.length === 0
    // как признак «такой уже есть». Делать её нельзя: Supabase намеренно
    // возвращает пустой список ВСЕМ, чтобы по форме регистрации нельзя было
    // перебором узнать, кто зарегистрирован. В первой крес-ке эта проверка
    // стояла и давала ложные срабатывания — живых людей выбрасывало на «Увійти».
    // Если почта действительно занята, это честно скажет verifyOtp.
    void data

    // Подтверждение отключено в настройках — сессия выдана сразу.
    if (data.session) {
      window.location.href = next ?? await nextRoute(supabase)
      return
    }

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
      setCodeError(codeErrorText(t, error.message))
      setCode('')
      return
    }
    setBusy(false)
    // verifyOtp с type:'signup' уже выдал сессию — членства читаемы.
    setTarget(next ?? await nextRoute(supabase))
    setStep('done')
  }

  async function resend() {
    if (left > 0 || busy) return
    setBusy(true); setError(''); setNote(''); setCodeError('')
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() })
    setBusy(false)
    if (error) { setError(humanAuthError(t, error.message)); return }
    setNote(t('auth.register.resent'))
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
          title={t('auth.register.done.title')}
          subtitle={next
            ? t('auth.register.done.desc.next')
            : t('auth.register.done.desc.plain')}
          actionLabel={t('common.continue')}
          onAction={() => { window.location.href = target }}
        />
        <Redirect to={target} />
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
          <h1 className="display rise-1 t-2xl mt-6 text-center">
            {t('auth.register.sent.title')}
          </h1>
          <p className="rise-2 t-md mt-2 text-center prose-muted" style={{ lineHeight: 1.5 }}>
            {t('auth.register.sent.desc', { email: email.trim() })}
          </p>
          <p className="rise-2 t-sm mt-2 text-center" style={{ color: 'var(--color-faint)' }}>
            {t('auth.register.sent.hint')}
          </p>

          {error && <p className="field-error">{error}</p>}
          {note && <p className="t-sm mt-3" style={{ color: 'var(--color-success)' }}>{note}</p>}

          <div className="rise-3 auth-result-actions">
            <button type="button" className="btn-primary btn-tall"
                    onClick={() => { setCode(''); setCodeError(''); setStep('code') }}>
              {t('auth.register.sent.enterCode')}
            </button>
            {gmail && (
              <a className="btn-secondary btn-tall" href="https://mail.google.com/"
                 target="_blank" rel="noopener noreferrer">
                {t('auth.register.sent.gmail')}
              </a>
            )}
            <button type="button" className="link-quiet" onClick={() => void resend()}
                    disabled={left > 0 || busy}>
              {left > 0
                ? t('auth.register.sent.resendIn', { n: left })
                : t('auth.register.sent.resend')}
            </button>
            <Link href={loginHref} className="link-quiet">
              {t('auth.register.sent.backToLogin')}
            </Link>
          </div>
        </div>
      </AuthShell>
    )
  }

  // ── Код ──────────────────────────────────────────────────────
  if (step === 'code') {
    return (
      <AuthShell title={t('auth.register.code.title')}
                 subtitle={t('auth.code.sentTo', { email: email.trim(), n: CODE_LENGTH })}>
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
                  disabled={left > 0 || busy} onClick={() => void resend()}>
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

  // ── Анкета ───────────────────────────────────────────────────
  return (
    <AuthShell title={t('auth.register.title')} subtitle={t('auth.register.subtitle')}>
      <form onSubmit={submitForm} className="flex flex-col gap-4">
        <div>
          <label className="field-label" htmlFor="first">{t('auth.field.firstName')}</label>
          <input id="first" required className="input" autoComplete="given-name"
                 autoCapitalize="words"
                 value={first} onChange={(e) => setFirst(e.target.value)}
                 placeholder={t('auth.register.first.placeholder')} />
        </div>
        <div>
          <label className="field-label" htmlFor="last">{t('auth.field.lastName')}</label>
          <input id="last" required className="input" autoComplete="family-name"
                 autoCapitalize="words"
                 value={last} onChange={(e) => setLast(e.target.value)}
                 placeholder={t('auth.register.last.placeholder')} />
        </div>
        <div>
          <label className="field-label" htmlFor="email">Email</label>
          <input id="email" type="email" required className="input" autoComplete="email"
                 inputMode="email" autoCapitalize="none" spellCheck={false}
                 value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div>
          <label className="field-label" htmlFor="pass">{t('auth.field.password')}</label>
          <PasswordInput id="pass" value={password} onChange={setPassword}
                         autoComplete="new-password" />
          <p className={password.length > 0 && password.length < 8 ? 'field-error' : 'field-hint'}>
            {t('auth.password.min')}
          </p>
        </div>
        <div>
          <label className="field-label" htmlFor="pass2">{t('auth.field.confirmPassword')}</label>
          <PasswordInput id="pass2" value={confirm} onChange={setConfirm}
                         autoComplete="new-password" invalid={mismatch} />
          {mismatch && <p className="field-error">{t('auth.field.mismatch')}</p>}
        </div>

        {/* Согласие с версией: без terms_version запись в журнале
            согласий не значит ничего. Ссылки открываются — галочка
            над нечитаемым текстом это повод для отказа и в App Store,
            и у Meta при верификации бизнеса. */}
        <label className="checkline">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            {t('auth.register.agree.lead')}{' '}
            {/* Названия документов приходят из `lib/legal.ts` — это
                перечень юридических документов, а не строки интерфейса:
                они называются так, как называется сам документ. */}
            {LEGAL_DOCS.map((d, i) => (
              <span key={d.href}>
                <Link href={d.href}>{d.label.toLowerCase()}</Link>
                {i < LEGAL_DOCS.length - 2
                  ? ', '
                  : i === LEGAL_DOCS.length - 2 ? ` ${t('auth.register.agree.and')} ` : ''}
              </span>
            ))}
            .
          </span>
        </label>

        {error && <p className="field-error">{error}</p>}

        <button className="btn-primary btn-tall" disabled={busy || !ready}>
          {busy ? t('auth.register.busy') : t('auth.register.submit')}
        </button>
      </form>

      <GoogleButton next={next ?? undefined} />

      <p className="t-md mt-6 text-center prose-muted">
        {t('auth.register.haveAccount')}{' '}
        <Link href={loginHref} className="underline underline-offset-2">
          {t('auth.register.login')}
        </Link>
      </p>
    </AuthShell>
  )
}

// Экран успеха живёт секунду и уходит сам — так же, как на входе.
// Отдельным компонентом, чтобы эффект не висел на всей регистрации
// и не срабатывал раньше времени.
function Redirect({ to }: { to: string }) {
  useEffect(() => {
    const id = setTimeout(() => { window.location.href = to }, 1400)
    return () => clearTimeout(id)
  }, [to])
  return null
}

export default function RegisterPage() {
  // useSearchParams требует границы Suspense, иначе прод-сборка Next
  // падает на пререндере. В этом проекте уже ловилось — см. /login.
  return <Suspense><RegisterInner /></Suspense>
}
