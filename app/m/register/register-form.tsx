'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LEGAL_VERSION, LEGAL_DOCS } from '@/lib/legal'
import { CodeInput } from '../code-input'
import { nextRoute } from '../where'
import { AppScreen, Field, keepVisible } from '../ui'
import { OAuthButtons } from '../oauth'

const CODE_LENGTH = 8
const RESEND_SECONDS = 60

// ── Телефон ────────────────────────────────────────────────────
// В Украине мобильный номер — ровно девять цифр после +380. Префикс
// не поле ввода, а подпись слева: человек не должен его стирать,
// а мы не должны разбирать, что он там написал — «+380», «380»,
// «0» или «0 (50)». Ограничение по длине, о котором просили, —
// вот оно, девять цифр и ни одной больше.
function formatPhone(digits: string) {
  const d = digits.slice(0, 9)
  const parts = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)]
  return parts.filter(Boolean).join(' ')
}

// ── Дата рождения ──────────────────────────────────────────────
// Три поля, а не системный выбор даты: колесо в веб-вью выглядит
// чужим и открывается на сегодняшнем годе, из-за чего до 1990-х
// человек крутит его секунд десять.
//
// Проверяем настоящую дату, а не «число от 1 до 31»: 31 февраля
// и 30 февраля високосного года одинаково не существуют.
function validDate(dd: string, mm: string, yyyy: string): Date | null {
  if (dd.length < 1 || mm.length < 1 || yyyy.length !== 4) return null
  const d = Number(dd), m = Number(mm), y = Number(yyyy)
  if (!d || !m || !y) return null
  if (m < 1 || m > 12 || d < 1 || d > 31) return null
  const dt = new Date(Date.UTC(y, m - 1, d))
  // Единственная надёжная проверка: собрать дату и посмотреть, не
  // переехала ли она. 31.02 превращается в 03.03 — значит, её нет.
  if (dt.getUTCFullYear() !== y || dt.getUTCMonth() !== m - 1 || dt.getUTCDate() !== d) return null
  return dt
}

// Платформа для журнала согласий. Именно эти три значения разрешены
// ограничением user_consents.source — «app» база не примет.
function signupSource(): 'web' | 'ios' | 'android' {
  if (typeof window === 'undefined') return 'web'
  const w = window as unknown as { Capacitor?: { getPlatform?: () => string } }
  const p = w.Capacitor?.getPlatform?.()
  if (p === 'ios' || p === 'android') return p
  // На Android при удалённом server.url моста Capacitor нет — опознаём
  // приложение по интерфейсам, которые ставит MainActivity.
  const a = window as unknown as { AndroidBiometric?: unknown; AndroidOneSignal?: unknown }
  if (a.AndroidBiometric || a.AndroidOneSignal) return 'android'
  return 'web'
}

function ageYears(dt: Date) {
  const now = new Date()
  let a = now.getUTCFullYear() - dt.getUTCFullYear()
  const before =
    now.getUTCMonth() < dt.getUTCMonth() ||
    (now.getUTCMonth() === dt.getUTCMonth() && now.getUTCDate() < dt.getUTCDate())
  if (before) a -= 1
  return a
}

export function MobileRegisterForm() {
  const supabase = useMemo(() => createClient(), [])

  const [step, setStep] = useState<'form' | 'code'>('form')

  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [phone, setPhone] = useState('')          // только цифры, без +380
  const [dd, setDd] = useState('')
  const [mm, setMm] = useState('')
  const [yyyy, setYyyy] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [seePass, setSeePass] = useState(false)
  const [agree, setAgree] = useState(false)

  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [taken, setTaken] = useState(false)

  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [left, setLeft] = useState(0)

  const mmRef = useRef<HTMLInputElement>(null)
  const yRef = useRef<HTMLInputElement>(null)

  // Черновик формы переживает уход на страницу с условиями и обратно.
  // Без этого человек, который решил прочитать оферту, возвращается
  // к пустой форме и заполняет всё заново — а это как раз тот момент,
  // на котором регистрацию бросают. Пароль сюда НЕ кладём намеренно.
  const DRAFT = 'cres:reg-draft'
  const restored = useRef(false)
  useEffect(() => {
    try {
      const raw = sessionStorage.getItem(DRAFT)
      if (raw) {
        const d = JSON.parse(raw) as Record<string, string | boolean>
        setFirst(String(d.first ?? '')); setLast(String(d.last ?? ''))
        setPhone(String(d.phone ?? ''))
        setDd(String(d.dd ?? '')); setMm(String(d.mm ?? '')); setYyyy(String(d.yyyy ?? ''))
        setEmail(String(d.email ?? '')); setAgree(Boolean(d.agree))
      }
    } catch { /* приватный режим — просто без черновика */ }
    restored.current = true
  }, [])

  useEffect(() => {
    if (!restored.current) return
    try {
      sessionStorage.setItem(DRAFT, JSON.stringify({ first, last, phone, dd, mm, yyyy, email, agree }))
    } catch { /* ignore */ }
  }, [first, last, phone, dd, mm, yyyy, email, agree])

  const birth = validDate(dd, mm, yyyy)
  const birthTouched = dd !== '' || mm !== '' || yyyy !== ''
  const birthReady = yyyy.length === 4 && dd !== '' && mm !== ''
  const birthBad =
    birthReady && (!birth || ageYears(birth) < 16 || ageYears(birth) > 110)

  const ready =
    first.trim().length >= 2 &&
    last.trim().length >= 2 &&
    phone.length === 9 &&
    !!birth && !birthBad &&
    email.trim().length >= 5 &&
    password.length >= 8 &&
    agree

  function tick() {
    setLeft(RESEND_SECONDS)
    const id = setInterval(() => {
      setLeft((v) => {
        if (v <= 1) { clearInterval(id); return 0 }
        return v - 1
      })
    }, 1000)
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault()
    if (!ready || !birth) return
    setBusy(true); setError(''); setTaken(false)

    const { data, error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          first_name: first.trim(),
          last_name: last.trim(),
          full_name: `${first.trim()} ${last.trim()}`,
          phone: `+380${phone}`,
          birth_date: birth.toISOString().slice(0, 10),
          // Версия документов уходит вместе с регистрацией: триггер
          // handle_new_user кладёт её в журнал согласий. Галочка без
          // этой строки — картинка, а не согласие.
          terms_version: LEGAL_VERSION,
          // Откуда пришла регистрация — в журнал согласий. Значения
          // сверены с ограничением в базе: web, ios, android.
          signup_source: signupSource(),
        },
      },
    })

    if (error) {
      setBusy(false)
      const m = error.message.toLowerCase()
      if (m.includes('already registered') || m.includes('already been registered')) {
        setTaken(true)
        return
      }
      setError(error.message)
      return
    }

    // Акаунт создан — черновик больше не нужен.
    try { sessionStorage.removeItem(DRAFT) } catch { /* ignore */ }

    // Подтверждение почты выключено — сессия пришла сразу.
    if (data.session) { window.location.href = await nextRoute(supabase); return }

    setBusy(false)
    setCode(''); setCodeError(''); tick(); setStep('code')
  }

  async function verify(v: string) {
    setBusy(true); setCodeError('')
    const { error } = await supabase.auth.verifyOtp({
      email: email.trim(),
      token: v,
      type: 'signup',
    })
    if (error) {
      setBusy(false)
      setCodeError('Код невірний або вже застарів')
      setCode('')
      return
    }
    window.location.href = await nextRoute(supabase)
  }

  async function resend() {
    setBusy(true); setCodeError('')
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() })
    setBusy(false)
    if (error) { setCodeError(error.message); return }
    tick()
  }

  // ── Экран кода ───────────────────────────────────────────────
  if (step === 'code') {
    return (
      <AppScreen
        title="Підтвердіть пошту"
        subtitle={`Надіслали вісім цифр на ${email.trim()}`}
        onBack={() => { setStep('form'); setCode(''); setCodeError('') }}
      >
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
          <p className="t-sm mt-3 text-center prose-muted">Перевіряємо…</p>
        )}

        <div className="mt-7 text-center">
          <button
            type="button"
            disabled={left > 0 || busy}
            onClick={() => void resend()}
            className="t-sm underline underline-offset-2"
            style={{
              color: left > 0 ? 'var(--color-faint)' : 'var(--color-accent)',
              minHeight: 'var(--tap-min)',
            }}
          >
            {left > 0 ? `Надіслати ще раз через ${left} с` : 'Надіслати код ще раз'}
          </button>
        </div>

        <p className="t-xs mt-2 text-center" style={{ color: 'var(--color-faint)', lineHeight: 1.5 }}>
          Код діє годину. Якщо листа немає — подивіться в «Спам».
        </p>
      </AppScreen>
    )
  }

  // ── Форма ────────────────────────────────────────────────────
  return (
    <AppScreen
      title="Створити акаунт"
      subtitle="Кілька полів — і склад ваш"
      backHref="/m"
    >
      {/* Провайдеры ПЕРЕД анкетой, а не под ней. Человеку, готовому
          войти одним тапом, незачем пролистывать семь полей, чтобы
          об этой возможности узнать. Согласие тут же строкой: галочки
          он не увидит, а запись в журнал уйдёт всё равно. */}
      <OAuthButtons sep="below" hint="або заповніть анкету" legal disabled={busy} />

      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex gap-3">
          <Field label="Імʼя" htmlFor="f-first" className="flex-1">
            <input
              id="f-first" required autoComplete="given-name" autoCapitalize="words"
              className="input" style={{ height: 52, fontSize: 16 }}
              value={first} onFocus={keepVisible}
              onChange={(e) => setFirst(e.target.value)} placeholder="Тая"
            />
          </Field>
          <Field label="Прізвище" htmlFor="f-last" className="flex-1">
            <input
              id="f-last" required autoComplete="family-name" autoCapitalize="words"
              className="input" style={{ height: 52, fontSize: 16 }}
              value={last} onFocus={keepVisible}
              onChange={(e) => setLast(e.target.value)} placeholder="Падалко"
            />
          </Field>
        </div>

        <Field label="Телефон" htmlFor="f-phone">
          <div
            className="input flex items-center gap-2"
            style={{ height: 52, paddingRight: 0 }}
          >
            <span className="tabular shrink-0" style={{ fontSize: 16, color: 'var(--color-muted)' }}>
              +380
            </span>
            <input
              id="f-phone" required type="tel" inputMode="numeric" autoComplete="tel-national"
              className="tabular min-w-0 flex-1"
              style={{
                height: 50, fontSize: 16, border: 0, background: 'transparent',
                outline: 'none', color: 'var(--color-text)', letterSpacing: '0.02em',
              }}
              value={formatPhone(phone)}
              onFocus={keepVisible}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 9))}
              placeholder="50 123 45 67"
            />
          </div>
          {phone.length > 0 && phone.length < 9 && (
            <p className="field-hint">Ще {9 - phone.length} цифр</p>
          )}
        </Field>

        <Field label="Дата народження" htmlFor="f-dd">
          <div className="flex items-center gap-2">
            <input
              id="f-dd" required inputMode="numeric" aria-label="День"
              className="input tabular text-center" style={{ height: 52, fontSize: 16, width: 68 }}
              value={dd} onFocus={keepVisible}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 2)
                setDd(v)
                // Автопереход, но только когда двусмысленности уже нет:
                // после «0» ждём вторую цифру, после «4» — нет.
                if (v.length === 2 || (v.length === 1 && Number(v) > 3)) mmRef.current?.focus()
              }}
              placeholder="дд"
            />
            <span aria-hidden style={{ color: 'var(--color-faint)' }}>·</span>
            <input
              ref={mmRef} required inputMode="numeric" aria-label="Місяць"
              className="input tabular text-center" style={{ height: 52, fontSize: 16, width: 68 }}
              value={mm} onFocus={keepVisible}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 2)
                setMm(v)
                if (v.length === 2 || (v.length === 1 && Number(v) > 1)) yRef.current?.focus()
              }}
              placeholder="мм"
            />
            <span aria-hidden style={{ color: 'var(--color-faint)' }}>·</span>
            <input
              ref={yRef} required inputMode="numeric" aria-label="Рік"
              className="input tabular text-center" style={{ height: 52, fontSize: 16, flex: 1 }}
              value={yyyy} onFocus={keepVisible}
              onChange={(e) => setYyyy(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder="рррр"
            />
          </div>
          {birthBad && (
            <p className="field-error">
              {!birth
                ? 'Такої дати не існує'
                : ageYears(birth) < 16
                  ? 'Акаунт можна створити з 16 років'
                  : 'Перевірте рік народження'}
            </p>
          )}
          {!birthBad && birthTouched && !birthReady && (
            <p className="field-hint">Наприклад: 14 · 03 · 1997</p>
          )}
        </Field>

        <Field label="Пошта" htmlFor="f-email">
          <input
            id="f-email" required type="email" autoComplete="email" inputMode="email"
            autoCapitalize="none" spellCheck={false}
            className="input" style={{ height: 52, fontSize: 16 }}
            value={email} onFocus={keepVisible}
            onChange={(e) => { setEmail(e.target.value); setTaken(false) }}
            placeholder="you@example.com"
          />
        </Field>

        <Field label="Пароль" htmlFor="f-pass">
          <div className="relative">
            <input
              id="f-pass" required minLength={8} autoComplete="new-password"
              type={seePass ? 'text' : 'password'}
              className="input" style={{ height: 52, fontSize: 16, paddingRight: 52 }}
              value={password} onFocus={keepVisible}
              onChange={(e) => setPassword(e.target.value)}
            />
            {/* Глазик. Единственный способ на телефоне не ошибиться
                в пароле, который набираешь вслепую большим пальцем. */}
            <button
              type="button"
              onClick={() => setSeePass((v) => !v)}
              aria-label={seePass ? 'Сховати пароль' : 'Показати пароль'}
              className="absolute right-0 top-0 flex items-center justify-center"
              style={{ width: 52, height: 52, color: 'var(--color-muted)' }}
            >
              {seePass ? <EyeOff /> : <Eye />}
            </button>
          </div>
          <p className={password.length > 0 && password.length < 8 ? 'field-error' : 'field-hint'}>
            Щонайменше 8 символів
          </p>
        </Field>

        {/* Согласие. Ссылки открываются, а не просто подчёркнуты:
            галочка без читаемого текста — повод для отказа и в App Store,
            и у Meta при верификации бизнеса. */}
        <label className="flex items-start gap-3" style={{ minHeight: 'var(--tap-min)' }}>
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
            className="shrink-0"
            style={{ width: 22, height: 22, marginTop: 2, accentColor: 'var(--color-accent)' }}
          />
          <span className="t-sm" style={{ lineHeight: 1.5, color: 'var(--color-muted)' }}>
            Я приймаю{' '}
            {LEGAL_DOCS.map((d, i) => (
              <span key={d.href}>
                {/* Без target="_blank": в приложении новое окно веб-вью
                    открывается пустой белой страницей без кнопки назад.
                    Документ открывается в том же экране, а стрелка
                    в его шапке возвращает ровно сюда. */}
                <Link href={d.href} className="underline underline-offset-2"
                      style={{ color: 'var(--color-text)' }}>
                  {d.label}
                </Link>
                {i < LEGAL_DOCS.length - 2 ? ', ' : i === LEGAL_DOCS.length - 2 ? ' та ' : ''}
              </span>
            ))}
            .
          </span>
        </label>

        {taken && (
          <div className="card-flat" style={{ borderColor: 'var(--color-accent)' }}>
            <p className="t-md">Ця пошта вже зареєстрована</p>
            <p className="t-sm mt-1 prose-muted">
              Схоже, акаунт у вас уже є — увійдіть замість реєстрації.
            </p>
            <Link
              href={`/m/login?email=${encodeURIComponent(email.trim())}`}
              className="btn-primary mt-3 flex items-center justify-center"
              style={{ height: 48, fontSize: 16 }}
            >
              Увійти
            </Link>
          </div>
        )}

        {error && <p className="field-error">{error}</p>}

        <p className="t-sm text-center prose-muted">
          Вже маєте акаунт?{' '}
          <Link href="/m/login" className="underline underline-offset-2">Увійти</Link>
        </p>

        {/* Кнопка липнет к низу видимой области — над клавиатурой. */}
        <div className="m-sticky">
          <button
            className="btn-primary flex w-full items-center justify-center"
            style={{ height: 52, fontSize: 16 }}
            disabled={busy || !ready}
          >
            {busy ? 'Створюємо…' : 'Створити акаунт'}
          </button>
        </div>
      </form>
    </AppScreen>
  )
}

function Eye() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z" />
      <circle cx="12" cy="12" r="3" />
    </svg>
  )
}
function EyeOff() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor"
         strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 3l18 18" />
      <path d="M10.6 10.6a3 3 0 0 0 4.2 4.2" />
      <path d="M9.4 5.2A9.5 9.5 0 0 1 12 5c6.4 0 10 7 10 7a17 17 0 0 1-3.2 4.1" />
      <path d="M6.2 6.8A17 17 0 0 0 2 12s3.6 7 10 7c1.2 0 2.3-.2 3.3-.6" />
    </svg>
  )
}
