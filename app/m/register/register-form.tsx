'use client'

import Link from 'next/link'
import { useEffect, useMemo, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { LEGAL_VERSION, LEGAL_DOCS } from '@/lib/legal'
import { signupSource } from '@/lib/consent'
import { CodeInput } from '../code-input'
import { nextRoute } from '../where'
import { AppScreen, Field, keepVisible } from '../ui'
// PasswordInput — ОБЩИЙ (`components/auth-ui.tsx`). Здесь его разметка
// была выписана заново ДВАЖДЫ — под пароль и под подтверждение, — вместе
// со своими значками глаза и кнопкой 52×52. Правило проекта: «не забудь
// продублировать» — признак отсутствующей архитектуры, а не дисциплины.
import { MailIcon, PasswordInput, PasswordStrength, mmss } from '@/components/auth-ui'
import { humanAuthError } from '@/lib/auth-errors'
import { useT } from '@/lib/i18n/client'
import { guardSignUp } from '@/lib/ratelimit/guard'

// Шесть цифр — как в вебе и в макетах владельца (было восемь).
const CODE_LENGTH = 6
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
  const t = useT()
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
  const [confirm, setConfirm] = useState('')
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
    confirm === password &&
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

    // 3 регистрации за час с адреса. Считается только создание акаунта:
    // почему повтор письма счётчик не тратит — в `app/(auth)/register/page.tsx`.
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
          phone: `+380${phone}`,
          birth_date: birth.toISOString().slice(0, 10),
          // Версия документов уходит вместе с регистрацией: триггер
          // handle_new_user кладёт её в журнал согласий. Галочка без
          // этой строки — картинка, а не согласие.
          terms_version: LEGAL_VERSION,
          // Откуда пришла регистрация — в журнал согласий. Значения
          // сверены с ограничением в базе: web, ios, android.
          signup_source: signupSource(),
          // `/m` — оболочка ПРОДАВЦА: её приземление без заведения ведёт
          // на `/m/shop`, то есть на его создание. Признак (0118) обязан
          // это повторять, иначе следующий вход уведёт человека в кабинет
          // покупателя из середины собственного онбординга.
          intent: 'seller',
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
      // Через переводчик: сырой английский текст GoTrue не показываем (М25).
      setError(humanAuthError(t, error.message))
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
      setCodeError(t('m.register.code.invalid'))
      setCode('')
      return
    }
    window.location.href = await nextRoute(supabase)
  }

  async function resend() {
    setBusy(true); setCodeError('')
    const { error } = await supabase.auth.resend({ type: 'signup', email: email.trim() })
    setBusy(false)
    // Через переводчик: тут частый ответ «for security purposes … after
    // N seconds», и у него своя ветка со сроком по-человечески.
    if (error) { setCodeError(humanAuthError(t, error.message)); return }
    tick()
  }

  // ── Экран кода ───────────────────────────────────────────────
  if (step === 'code') {
    return (
      <AppScreen
        title={t('m.register.code.title')}
        subtitle={t('auth.code.sentTo', { email: email.trim(), n: CODE_LENGTH })}
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
          <span>{t('m.login.code.noMail')}</span>
        </div>
      </AppScreen>
    )
  }

  // ── Форма ────────────────────────────────────────────────────
  return (
    <AppScreen
      title={t('m.register.title')}
      subtitle={t('m.register.subtitle')}
      backHref="/m"
    >
      {/* Провайдеры ПЕРЕД анкетой, а не под ней. Человеку, готовому
          войти одним тапом, незачем пролистывать семь полей, чтобы
          об этой возможности узнать. Согласие тут же строкой: галочки
          он не увидит, а запись в журнал уйдёт всё равно. */}

      <form onSubmit={submit} className="flex flex-col gap-5">
        <div className="flex gap-3">
          <Field label={t('auth.field.firstName')} htmlFor="f-first" className="flex-1">
            <input
              id="f-first" required autoComplete="given-name" autoCapitalize="words"
              // Ни высоты, ни кегля инлайном: и то и другое задаёт `.input`
              // в globals.css (`--h-input` и пол в 16px на касательных
              // устройствах, ниже которого iOS зумит страницу на фокусе).
              // Инлайновые 52px делали поля приложения на 4px выше, чем
              // те же поля в вебе и в кабинете.
              className="input"
              value={first} onFocus={keepVisible}
              onChange={(e) => setFirst(e.target.value)}
              placeholder={t('m.register.first.placeholder')}
            />
          </Field>
          <Field label={t('auth.field.lastName')} htmlFor="f-last" className="flex-1">
            <input
              id="f-last" required autoComplete="family-name" autoCapitalize="words"
              className="input"
              value={last} onFocus={keepVisible}
              onChange={(e) => setLast(e.target.value)}
              placeholder={t('m.register.last.placeholder')}
            />
          </Field>
        </div>

        <Field label={t('m.register.phone.label')} htmlFor="f-phone">
          {/* ⚠️ `.input` ТЕПЕРЬ НА САМОМ ПОЛЕ, А НЕ НА ОБЁРТКЕ.
              Раньше класс висел на `<div>`, а внутри лежал голый `<input>`
              без рамки, и поле выглядело ВЫКЛЮЧЕННЫМ: `.input:read-only`
              в globals.css красит фон второй поверхностью и делает
              границу пунктирной, а псевдокласс `:read-only` по спецификации
              совпадает с ЛЮБЫМ нередактируемым элементом — с `<div>`
              в том числе. Поэтому единственное обязательное поле анкеты
              стояло серым среди белых (снимок 390px, 20.08.2026).
              Заодно у обёртки не срабатывал `.input:focus`: `<div>`
              фокуса не получает, и рамка при наборе номера не загоралась.

              Префикс — надпись поверх поля, а не его сосед: он не поле
              ввода, стирать и править его нечего (разбор — в шапке
              `formatPhone`). `pointer-events: none`, чтобы нажатие
              на «+380» попадало в поле, а не в подпись. */}
          <div className="relative">
            <span aria-hidden
                  className="tabular pointer-events-none absolute inset-y-0 left-0 flex items-center pl-3.5"
                  style={{ color: 'var(--color-muted)' }}>
              +380
            </span>
            <input
              id="f-phone" required type="tel" inputMode="numeric" autoComplete="tel-national"
              className="input tabular pl-16"
              style={{ letterSpacing: '0.02em' }}
              value={formatPhone(phone)}
              onFocus={keepVisible}
              onChange={(e) => setPhone(e.target.value.replace(/\D/g, '').slice(0, 9))}
              placeholder={t('m.register.phone.placeholder')}
            />
          </div>
          {phone.length > 0 && phone.length < 9 && (
            <p className="field-hint">{t.plural('m.register.phone.more', 9 - phone.length)}</p>
          )}
        </Field>

        <Field label={t('m.register.birth.label')} htmlFor="f-dd">
          <div className="flex items-center gap-2">
            <input
              id="f-dd" required inputMode="numeric" aria-label={t('m.register.birth.day.aria')}
              className="input tabular w-16 text-center"
              value={dd} onFocus={keepVisible}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 2)
                setDd(v)
                // Автопереход, но только когда двусмысленности уже нет:
                // после «0» ждём вторую цифру, после «4» — нет.
                if (v.length === 2 || (v.length === 1 && Number(v) > 3)) mmRef.current?.focus()
              }}
              placeholder={t('m.register.birth.day.placeholder')}
            />
            <span aria-hidden style={{ color: 'var(--color-faint)' }}>·</span>
            <input
              ref={mmRef} required inputMode="numeric" aria-label={t('m.register.birth.month.aria')}
              className="input tabular w-16 text-center"
              value={mm} onFocus={keepVisible}
              onChange={(e) => {
                const v = e.target.value.replace(/\D/g, '').slice(0, 2)
                setMm(v)
                if (v.length === 2 || (v.length === 1 && Number(v) > 1)) yRef.current?.focus()
              }}
              placeholder={t('m.register.birth.month.placeholder')}
            />
            <span aria-hidden style={{ color: 'var(--color-faint)' }}>·</span>
            <input
              ref={yRef} required inputMode="numeric" aria-label={t('m.register.birth.year.aria')}
              className="input tabular flex-1 text-center"
              value={yyyy} onFocus={keepVisible}
              onChange={(e) => setYyyy(e.target.value.replace(/\D/g, '').slice(0, 4))}
              placeholder={t('m.register.birth.year.placeholder')}
            />
          </div>
          {birthBad && (
            <p className="field-error">
              {!birth
                ? t('m.register.birth.error.noSuchDate')
                : ageYears(birth) < 16
                  ? t('m.register.birth.error.tooYoung')
                  : t('m.register.birth.error.year')}
            </p>
          )}
          {!birthBad && birthTouched && !birthReady && (
            <p className="field-hint">{t('m.register.birth.example')}</p>
          )}
        </Field>

        <Field label={t('m.field.email')} htmlFor="f-email">
          <input
            id="f-email" required type="email" autoComplete="email" inputMode="email"
            autoCapitalize="none" spellCheck={false}
            className="input"
            value={email} onFocus={keepVisible}
            onChange={(e) => { setEmail(e.target.value); setTaken(false) }}
            placeholder="you@example.com"
          />
        </Field>

        {/* Глазик внутри `PasswordInput` — единственный способ на телефоне
            не ошибиться в пароле, который набираешь вслепую большим
            пальцем. Своё состояние «видно/не видно» он держит сам. */}
        <Field label={t('m.field.password')} htmlFor="f-pass">
          <PasswordInput
            id="f-pass" value={password} onChange={setPassword}
            onFocus={keepVisible} autoComplete="new-password"
          />
          <PasswordStrength value={password} />
        </Field>

        {/* Подтверждение пароля. Придуманный вслепую на телефоне пароль
            с опечаткой человек обнаруживает только на следующем входе —
            и уходит в восстановление, думая, что сломались мы. */}
        <Field label={t('auth.field.confirmPassword')} htmlFor="f-pass2">
          <PasswordInput
            id="f-pass2" value={confirm} onChange={setConfirm}
            onFocus={keepVisible} autoComplete="new-password"
            invalid={confirm.length > 0 && confirm !== password}
          />
          {confirm.length > 0 && confirm !== password && (
            <p className="field-error">{t('auth.field.mismatch')}</p>
          )}
        </Field>

        {/* Согласие. Ссылки открываются, а не просто подчёркнуты:
            галочка без читаемого текста — повод для отказа и в App Store,
            и у Meta при верификации бизнеса.

            `.checkline` — тот же класс, что на веб-регистрации и в
            онбординге. Здесь его разметка была выписана инлайном заново:
            те же 22×22, тот же зазор, тот же цвет ссылки — то есть
            третья запись одной и той же строки согласия. */}
        <label className="checkline">
          <input
            type="checkbox"
            checked={agree}
            onChange={(e) => setAgree(e.target.checked)}
          />
          <span>
            {t('m.register.agree.lead')}{' '}
            {/* Названия документов приходят из `lib/legal.ts`: это перечень
                юридических документов, а не строки интерфейса. */}
            {LEGAL_DOCS.map((d, i) => (
              <span key={d.href}>
                {/* Без target="_blank": в приложении новое окно веб-вью
                    открывается пустой белой страницей без кнопки назад.
                    Документ открывается в том же экране, а стрелка
                    в его шапке возвращает ровно сюда. */}
                <Link href={d.href}>{d.label}</Link>
                {i < LEGAL_DOCS.length - 2
                  ? ', '
                  : i === LEGAL_DOCS.length - 2 ? ` ${t('m.register.agree.and')} ` : ''}
              </span>
            ))}
            .
          </span>
        </label>

        {taken && (
          <div className="card-flat" style={{ borderColor: 'var(--color-accent)' }}>
            <p className="t-md">{t('m.register.taken.title')}</p>
            <p className="t-sm mt-1 prose-muted">{t('m.register.taken.desc')}</p>
            <Link
              href={`/m/login?email=${encodeURIComponent(email.trim())}`}
              className="btn-primary btn-tall mt-3"
            >
              {t('m.register.taken.action')}
            </Link>
          </div>
        )}

        {error && <p className="field-error">{error}</p>}

        <p className="t-sm text-center prose-muted">
          {t('m.register.haveAccount')}{' '}
          <Link href="/m/login" className="underline underline-offset-2">
            {t('m.register.login')}
          </Link>
        </p>

        {/* Полоса главного действия: плавает у нижней кромки экрана
            и поднимается над клавиатурой. Внутри формы намеренно —
            кнопка обязана оставаться её кнопкой отправки. Разбор
            и прежний дефект — в globals.css, `.m-actionbar`. */}
        <div className="m-actionbar">
          {/* `btn-tall` — та же высота главной кнопки, что на всех
              экранах входа; своих 52px и 16px инлайном здесь быть не
              должно, значение живёт в globals.css одной записью. */}
          <button className="btn-primary btn-tall" disabled={busy || !ready}>
            {busy ? t('m.register.busy') : t('m.register.submit')}
          </button>
        </div>
      </form>
    </AppScreen>
  )
}
