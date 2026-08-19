'use client'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { LEGAL_VERSION, LEGAL_DOCS } from '@/lib/legal'
import { signupSource } from '@/lib/consent'
import { codeErrorText, humanAuthError } from '@/lib/auth-errors'
import { dbErrorText } from '@/lib/errors/db'
import { guardSignUp } from '@/lib/ratelimit/guard'
import { AuthShell } from '../../auth-shell'
import { useT } from '@/lib/i18n/client'
import { CodeInput } from '@/app/m/code-input'
import { MailIcon, PasswordInput, PasswordStrength, mmss } from '@/components/auth-ui'

// Онбординг продавца: акаунт → код из письма → заведение.
// После register_tenant ОБЯЗАТЕЛЕН refreshSession: членство попадает
// в токен только при следующей его выдаче.
//
// ⚠️ ЧТО ЗДЕСЬ БЫЛО СЛОМАНО (починено 19.08.2026):
//   — подтверждение почты было ТУПИКОМ: красная строка «підтвердіть пошту
//     за листом», а в письме — код, который вводить было некуда. Теперь
//     здесь тот же шаг кода, что на /register: шесть цифр, verifyOtp,
//     повтор с отсчётом. После кода человек продолжает поток сам собой —
//     сессия уже есть, открывается шаг заведения;
//   — signUp шёл БЕЗ options.data: галочки согласия не было вовсе,
//     и запись в журнале согласий получала версию «по умолчанию»,
//     то есть не значила ничего;
//   — error.message показывался человеку сырым: GoTrue отвечает
//     по-английски, а Postgres при нарушении уникальности печатает
//     ЗНАЧЕНИЕ поля (М25). Теперь GoTrue разбирает humanAuthError,
//     ответ register_tenant — dbErrorText.
const CODE_LENGTH = 6
const RESEND_SECONDS = 60

type Step = 'account' | 'code' | 'shop'

function SellerRegisterInner() {
  const t = useT()
  const supabase = createClient()

  // Адрес возврата — тот же приём, что на /login и /register: принимаем
  // только внутренний путь с одним ведущим слэшем, иначе форма становится
  // открытым перенаправлением (`//evil.com` — это чужой сайт, а не путь).
  const params = useSearchParams()
  const rawNext = params.get('next')
  const next = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : '/app'
  const query = rawNext === next ? `?next=${encodeURIComponent(next)}` : ''
  const selfHref = `/register/seller${query}`

  const [step, setStep] = useState<Step>('account')

  // шаг «акаунт»
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [agree, setAgree] = useState(false)
  const [taken, setTaken] = useState(false)

  // шаг «код»
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [left, setLeft] = useState(0)

  // шаг «заведение»
  const [shopName, setShopName] = useState('')
  const [kind, setKind] = useState<'services' | 'goods' | 'both'>('services')
  const [city, setCity] = useState('')

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Уже вошёл? — сразу шаг заведения. В useEffect, а не в теле рендера:
  // then-цепочка в теле — это setState во время отрисовки, то есть
  // лишний перерендер на каждый кадр и предупреждение React в консоли.
  useEffect(() => {
    let alive = true
    supabase.auth.getUser().then(({ data }) => {
      if (alive && data.user) setStep('shop')
    })
    return () => { alive = false }
  }, [supabase])

  // Отсчёт до повторной отправки кода — тот же, что на /register.
  useEffect(() => {
    if (left <= 0) return
    const id = setTimeout(() => setLeft((v) => v - 1), 1000)
    return () => clearTimeout(id)
  }, [left])

  const mismatch = confirm.length > 0 && confirm !== password
  const ready =
    email.trim().length >= 5 &&
    password.length >= 8 &&
    confirm === password &&
    agree

  async function submitAccount(e: React.FormEvent) {
    e.preventDefault()
    if (!ready || busy) return
    setBusy(true); setError(''); setTaken(false)
    // Тот же предел регистрации, что и на `/register`: это вторая форма
    // ОДНОГО действия, и считать их по разным счётчикам значило бы отдать
    // шесть регистраций в час вместо трёх.
    const gate = await guardSignUp()
    if (!gate.ok) { setBusy(false); setError(gate.message); return }

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          locale: 'uk',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          // Версия документов уходит вместе с регистрацией: триггер
          // handle_new_user кладёт её в журнал согласий. Галочка без
          // этой строки — картинка, а не согласие.
          terms_version: LEGAL_VERSION,
          // Именно signupSource(), а не 'seller': ограничение
          // user_consents.source принимает только web/ios/android,
          // и чужое значение уронило бы саму регистрацию триггером.
          signup_source: signupSource(),
          // А вот здесь именно 'seller': это ДРУГОЕ поле, оно уходит
          // не в журнал согласий, а в `profiles.intent` (0118), и решает,
          // куда вернуть человека, если он бросит онбординг на шаге
          // заведения. Без него он вернулся бы в кабинет покупателя.
          intent: 'seller',
        },
      },
    })
    setBusy(false)
    if (error) { setError(humanAuthError(t, error.message)); return }

    // Почта уже занята ПОДТВЕРЖДЁННЫМ акаунтом: GoTrue возвращает user
    // с identities: [] и письма не шлёт — без проверки человек вечно
    // ждал бы код. Та же карточка, что на /register.
    if (data.user && (data.user.identities?.length ?? 0) === 0) {
      setTaken(true)
      return
    }

    // Подтверждение отключено в настройках — сессия выдана сразу.
    if (data.session) { setStep('shop'); return }

    // Требуется подтверждение почты: код уже уехал письмом,
    // вводим его здесь же, не выбрасывая человека из потока.
    setCode(''); setCodeError(''); setLeft(RESEND_SECONDS)
    setStep('code')
  }

  async function verify(v: string) {
    if (busy) return
    setBusy(true); setCodeError('')
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(), token: v, type: 'signup',
    })
    if (error) {
      setBusy(false); setCodeError(codeErrorText(t, error.message)); setCode('')
      return
    }
    setBusy(false)
    // verifyOtp с type:'signup' уже выдал сессию — продолжаем поток:
    // следующий шаг и есть создание заведения.
    setStep('shop')
  }

  async function resend() {
    if (left > 0 || busy) return
    setBusy(true); setCodeError('')
    // Счётчик guardSignUp повтор НЕ тратит — причина та же, что на
    // /register: повтор заперт отсчётом 60 секунд и пределом Supabase.
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() })
    setBusy(false)
    if (error) { setCodeError(humanAuthError(t, error.message)); return }
    setLeft(RESEND_SECONDS)
  }

  async function submitShop(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    setBusy(true); setError('')
    const { error } = await supabase.rpc('register_tenant', {
      p_name: shopName, p_kind: kind, p_city: city || null,
    })
    // Ответ базы — через общий разбор М25 (lib/errors/db.ts): сырой
    // error.message от Postgres печатает значения полей.
    if (error) { setBusy(false); setError(dbErrorText(t, error)); return }
    await supabase.auth.refreshSession()   // членство → в токен
    // Переход полной навигацией, а не router.push: серверные компоненты
    // кабинета читают сессию из кук, и мягкий переход гонится со свежей
    // кукой — тот же грабль описан в app/(auth)/register/page.tsx.
    window.location.href = next
  }

  // ── Код ──────────────────────────────────────────────────────
  if (step === 'code') {
    return (
      <AuthShell title={t('auth.register.code.title')}
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
                  disabled={left > 0 || busy} onClick={() => void resend()}>
            {t('auth.code.resend')}
          </button>
          <button type="button" className="link-quiet"
                  onClick={() => { setStep('account'); setCode(''); setCodeError('') }}>
            {t('auth.code.changeEmail')}
          </button>
        </div>

        <div className="note note-row">
          <span style={{ color: 'var(--color-muted)' }}><MailIcon size={20} /></span>
          <span>{t('auth.code.noMail')}</span>
        </div>
      </AuthShell>
    )
  }

  // ── Заведение ────────────────────────────────────────────────
  if (step === 'shop') {
    return (
      <AuthShell title={t('auth.seller.step2.title')} subtitle={t('auth.seller.step2.subtitle')}>
        <form onSubmit={submitShop} className="flex flex-col gap-5">
          <div>
            <label className="field-label" htmlFor="shop">{t('auth.seller.shop.label')}</label>
            <input id="shop" required minLength={2} className="input"
                   value={shopName} onChange={(e) => setShopName(e.target.value)}
                   placeholder="Braids Studio" />
          </div>

          <div>
            <p className="field-label">{t('auth.seller.kind.label')}</p>
            {/* В списке лежат ЗНАЧЕНИЯ (`services`), которые уезжают
                в `register_tenant`; подпись к ним берётся из словаря. */}
            <div className="flex flex-wrap gap-2">
              {(['services', 'goods', 'both'] as const).map((v) => (
                <button key={v} type="button" onClick={() => setKind(v)}
                        className={kind === v ? 'chip-active' : 'chip'}>
                  {t(`auth.seller.kind.${v}`)}
                </button>
              ))}
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="city">{t('auth.seller.city.label')}</label>
            <input id="city" className="input" value={city}
                   onChange={(e) => setCity(e.target.value)}
                   placeholder={t('auth.seller.city.placeholder')} />
          </div>

          {error && <p className="field-error">{error}</p>}

          <button className="btn-primary btn-tall" disabled={busy}>
            {busy ? t('auth.seller.busy') : t('auth.seller.submit')}
          </button>
          <p className="field-hint">{t('auth.seller.hint')}</p>
        </form>
      </AuthShell>
    )
  }

  // ── Акаунт ───────────────────────────────────────────────────
  return (
    <AuthShell title={t('auth.seller.step1.title')} subtitle={t('auth.seller.step1.subtitle')}>
      <form onSubmit={submitAccount} className="flex flex-col gap-4">
        <div>
          <label className="field-label" htmlFor="email">{t('auth.seller.email.label')}</label>
          <input id="email" type="email" required className="input" autoComplete="email"
                 inputMode="email" autoCapitalize="none" spellCheck={false}
                 value={email}
                 onChange={(e) => { setEmail(e.target.value); setTaken(false) }}
                 placeholder="you@example.com" />
        </div>
        <div>
          <label className="field-label" htmlFor="pass">{t('auth.field.password')}</label>
          <PasswordInput id="pass" value={password} onChange={setPassword}
                         autoComplete="new-password" />
          <PasswordStrength value={password} />
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

        {/* Согласие с версией — та же разметка, что на /register:
            без terms_version запись в журнале согласий не значит ничего,
            а кнопка без галочки заперта. */}
        <label className="checkline">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree(e.target.checked)} />
          <span>
            {t('auth.register.agree.lead')}{' '}
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

        {/* Ключи m.register.taken.* общие с /register и приложением. */}
        {taken && (
          <div className="card-flat" style={{ borderColor: 'var(--color-accent)' }}>
            <p className="t-md">{t('m.register.taken.title')}</p>
            <p className="t-sm mt-1 prose-muted">{t('m.register.taken.desc')}</p>
            <Link href={`/login?next=${encodeURIComponent(selfHref)}`}
                  className="btn-primary btn-tall mt-3">
              {t('m.register.taken.action')}
            </Link>
            <Link href={`/forgot?email=${encodeURIComponent(email.trim())}`}
                  className="link-quiet mt-2 block text-center">
              {t('auth.register.taken.forgot')}
            </Link>
          </div>
        )}

        {error && <p className="field-error">{error}</p>}

        <button className="btn-primary btn-tall" disabled={busy || !ready}>
          {busy ? t('auth.busy') : t('auth.seller.next')}
        </button>
      </form>

      {/* Только шаг акаунта: дальше человек уже вошёл. Возвращаемся
          на СЕБЯ вместе с адресом возврата — иначе после входа человек
          попадает на чистый экран продавца и теряет то, ради чего пришёл. */}
      <p className="t-md mt-6 prose-muted">
        {t('auth.seller.haveAccount')}{' '}
        <Link href={`/login?next=${encodeURIComponent(selfHref)}`}
              className="underline underline-offset-2">{t('auth.seller.login')}</Link>
      </p>
    </AuthShell>
  )
}

export default function SellerRegisterPage() {
  // useSearchParams требует границы Suspense, иначе прод-сборка Next
  // падает на пререндере. В этом проекте уже ловилось — см. /login.
  return <Suspense><SellerRegisterInner /></Suspense>
}
