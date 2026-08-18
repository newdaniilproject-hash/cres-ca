'use client'

import Link from 'next/link'
import { Suspense, useEffect, useState } from 'react'
import { useSearchParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import {
  authErrorText, codeErrorText, humanAuthError, lockedText, lockoutSeconds, lockoutText,
} from '@/lib/auth-errors'
import { nextRoute } from '@/lib/where'
import { useT } from '@/lib/i18n/client'
import { guardSignIn } from '@/lib/ratelimit/guard'
import { applySession, signInWithPassword } from '@/lib/sign-in'
import { AuthShell } from '../auth-shell'
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
  const t = useT()
  const params = useSearchParams()
  // next приходит из адреса — принимаем только внутренний путь,
  // иначе ссылка вида /login?next=https://… уводит человека с площадки.
  //
  // Раньше запасным значением стояло '/account' — покупательский кабинет,
  // и туда попадал КАЖДЫЙ вошедший. Теперь запасного адреса здесь нет:
  // если человек никуда конкретно не шёл, куда его вести, решает
  // lib/where.ts уже после входа (нет заведения → его создание).
  // Контракт next при этом цел: шёл на страницу — попадёт на неё.
  const rawNext = params.get('next')
  const safeNext = rawNext && rawNext.startsWith('/') && !rawNext.startsWith('//') ? rawNext : ''
  const next = safeNext || null
  // Адрес возврата обязан пережить переход «вхід → реєстрація».
  // Человек приходит сюда по /login?next=/invite/<token> (или из любого
  // закрытого экрана), не находит акаунта, жмёт «Створити акаунт» — и без
  // этого параметра цель терялась: после регистрации его выбрасывало на
  // умолчание, а не туда, куда он шёл. `/register` и `/register/seller`
  // читают тот же `next` и проверяют его тем же правилом «только
  // внутренний путь», так что передавать безопасно.
  //
  // Когда `next` не задавали, параметр не подставляем НАМЕРЕННО: пусть
  // обе формы регистрации сами решают, куда вести, — тем же lib/where.ts.
  const nextQuery = safeNext ? `?next=${encodeURIComponent(safeNext)}` : ''
  const registerHref = `/register${nextQuery}`
  const sellerHref = `/register/seller${nextQuery}`
  const returned = params.get('error')
  const supabase = createClient()

  const [mode, setMode] = useState<Mode>('password')
  const [step, setStep] = useState<Step>('form')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(returned ? authErrorText(t, returned) : '')
  const [noAccount, setNoAccount] = useState(false)
  const [left, setLeft] = useState(0)
  const [lockWait, setLockWait] = useState('')
  // Готовая фраза НАШЕГО замка (0085): «до 14:05 — після 10 невдалих спроб».
  // Пустая строка означает, что сюда привёл предел Supabase, а не он.
  const [lockNote, setLockNote] = useState('')
  // Куда уходим после успеха. Считается один раз — в момент, когда
  // сессия уже есть: до входа членства прочитать нечем.
  const [target, setTarget] = useState('/app')

  // Вход состоялся: экран успеха, а следом — переход. Оба пути входа
  // (пароль и код) заканчиваются здесь, чтобы решение о том, куда вести,
  // жило в одном месте, а не в двух обработчиках.
  async function done() {
    setTarget(next ?? await nextRoute(supabase))
    setStep('done')
  }

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
    setError(authErrorText(t, raw))
    window.history.replaceState(null, '', window.location.pathname + window.location.search)
  }, [])

  // Перебор попыток — отдельный экран, а не строка под полем.
  // Возвращает true, если это действительно блокировка.
  function catchLockout(message: string, status?: number): boolean {
    const sec = lockoutSeconds(message, status)
    if (sec === null) return false
    setLockNote('')
    setLockWait(lockoutText(t, sec))
    setStep('blocked')
    return true
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(''); setNoAccount(false)

    if (mode === 'code') {
      // Ограничение частоты. Спрашиваем СВОЙ сервер до обращения в Supabase:
      // отправка кода выполняется браузером напрямую, и ни Cloudflare,
      // ни `proxy.ts` её не видят. Чего этот заслон не даёт — написано
      // в `lib/ratelimit/guard.ts`, и повторять это здесь незачем.
      //
      // У входа ПАРОЛЕМ этого вызова больше нет: пароль уходит через
      // `/api/auth/sign-in`, и счётчик тратит сам роут. Два вызова на одну
      // попытку молча превратили бы предел 5 в предел 2.
      const gate = await guardSignIn()
      if (!gate.ok) { setBusy(false); setError(gate.message); return }

      // shouldCreateUser: false — вход не должен молча создавать акаунт.
      // Регистрация это отдельное обещание с отдельной формой.
      const { error } = await supabase.auth.signInWithOtp({
        email: email.trim(), options: { shouldCreateUser: false },
      })
      setBusy(false)
      if (error) {
        if (catchLockout(error.message, error.status)) return
        if (error.message.toLowerCase().includes('signups not allowed')) { setNoAccount(true); return }
        setError(humanAuthError(t, error.message))
        return
      }
      setCode(''); setCodeError(''); setLeft(RESEND_SECONDS); setStep('code')
      return
    }

    // Вход паролем идёт ЧЕРЕЗ НАШ СЕРВЕР, а не напрямую в Supabase.
    // Единственная причина — неудачную попытку надо увидеть и посчитать:
    // база сама её не замечает (шапка миграции 0085). Разбор — в шапке
    // `app/api/auth/sign-in/route.ts`.
    const res = await signInWithPassword(email, password)
    if (!res.ok) {
      setBusy(false)

      // Наш ограничитель частоты: текст уже человеческий и переведён.
      if (res.kind === 'limited') { setError(res.message); return }

      // Замок 0085: десятая неверная попытка. Показываем ВРЕМЯ СНЯТИЯ
      // и число попыток — молчаливый отказ человек читает как поломку.
      if (res.kind === 'locked') {
        setLockNote(lockedText(t, res.lock))
        setLockWait('')
        setStep('blocked')
        return
      }

      // Предел самого Supabase — другой экран с другим сроком.
      if (catchLockout(res.message, res.status)) return
      // Сюда же приходит «User is banned»: замок уже стоял до этой попытки,
      // и `humanAuthError` отвечает на него отдельной строкой.
      setError(humanAuthError(t, res.message))
      return
    }

    const failed = await applySession(supabase, res.session)
    setBusy(false)
    if (failed) { setError(humanAuthError(t, failed)); return }
    await done()
  }

  async function verify(v: string) {
    if (busy) return
    setBusy(true); setCodeError('')
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(), token: v, type: 'email',
    })
    if (error) {
      setBusy(false); setCodeError(codeErrorText(t, error.message)); setCode('')
      return
    }
    setBusy(false)
    await done()
  }

  async function resend() {
    if (left > 0 || busy) return
    setBusy(true); setCodeError('')
    // Повтор письма тратит ту же попытку входа: иначе предел обходится
    // одной отправкой формы и дальше кнопкой «надіслати ще раз».
    const gate = await guardSignIn()
    if (!gate.ok) { setBusy(false); setCodeError(gate.message); return }
    const { error } = await supabase.auth.signInWithOtp({
      email: email.trim(), options: { shouldCreateUser: false },
    })
    setBusy(false)
    if (error) { setCodeError(humanAuthError(t, error.message)); return }
    setLeft(RESEND_SECONDS)
  }

  // ── Вход выполнен ────────────────────────────────────────────
  // Переход полной навигацией, а не router.push: серверная проверка
  // сессии на следующей странице должна увидеть свежие куки.
  if (step === 'done') {
    return (
      <AuthShell>
        <SuccessScreen
          title={t('auth.login.done.title')}
          subtitle={t('auth.login.done.desc')}
          actionLabel={t('common.continue')}
          onAction={() => { window.location.href = target }}
        />
        <Redirect to={target} />
      </AuthShell>
    )
  }

  // ── Блокировка ───────────────────────────────────────────────
  if (step === 'blocked') {
    return (
      <AuthShell>
        <BlockedScreen
          waitText={lockWait}
          note={lockNote || undefined}
          onReset={() => { window.location.href = '/forgot' }}
          onBack={() => { setStep('form'); setError(''); setPassword('') }}
        />
      </AuthShell>
    )
  }

  // ── Код ──────────────────────────────────────────────────────
  if (step === 'code') {
    return (
      <AuthShell title={t('auth.login.code.title')}
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
                  onClick={() => { setStep('form'); setCode(''); setCodeError('') }}>
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

  // ── Форма ────────────────────────────────────────────────────
  const byPassword = mode === 'password'
  return (
    <AuthShell title={t('auth.login.title')} subtitle={t('auth.login.subtitle')}>
      <div className="mb-6 flex gap-2">
        <button type="button" onClick={() => { setMode('password'); setError('') }}
                className={byPassword ? 'chip-active' : 'chip'}>
          {t('auth.login.tab.password')}
        </button>
        <button type="button" onClick={() => { setMode('code'); setError('') }}
                className={byPassword ? 'chip' : 'chip-active'}>
          {t('auth.login.tab.code')}
        </button>
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
              <label className="field-label" htmlFor="pass">{t('auth.field.password')}</label>
              <Link href="/forgot" className="t-xs underline underline-offset-2 prose-muted">
                {t('auth.login.forgot')}
              </Link>
            </div>
            <PasswordInput id="pass" value={password} onChange={setPassword}
                           autoComplete="current-password" />
          </div>
        )}

        {noAccount && (
          <div className="card-flat" style={{ borderColor: 'var(--color-accent)' }}>
            <p className="t-md">{t('auth.login.noAccount.title')}</p>
            <p className="t-sm mt-1 prose-muted">{t('auth.login.noAccount.desc')}</p>
            <Link href={registerHref} className="btn-primary btn-tall mt-3">
              {t('auth.login.noAccount.action')}
            </Link>
          </div>
        )}

        {error && <p className="field-error">{error}</p>}

        <button className="btn-primary btn-tall"
                disabled={busy || email.trim().length < 5 || (byPassword && password.length < 1)}>
          {busy ? t('auth.busy') : byPassword ? t('auth.login.submit') : t('auth.login.sendCode')}
        </button>
      </form>


      {/* Ссылка внутри предложения — отдельные ключи: разметки
          в словаре не бывает. */}
      <p className="t-md mt-6 prose-muted">
        {t('auth.login.register.lead')}{' '}
        <Link href={registerHref} className="underline underline-offset-2">
          {t('auth.login.register.buyer')}
        </Link>
        {' · '}
        <Link href={sellerHref} className="underline underline-offset-2">
          {t('auth.login.register.seller')}
        </Link>
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
