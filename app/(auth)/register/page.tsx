'use client'

import Link from 'next/link'
import { useEffect, useRef, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { AuthShell } from '../auth-shell'
import { GoogleButton } from '../google-button'

// Регистрация покупателя: имя, почта, пароль. Телефон попросим тогда,
// когда он реально понадобится — при первом заказе (create_order).
//
// Подтверждение почты — КОДОМ, а не ссылкой. Ссылку ломают почтовые
// клиенты, которые открывают её во встроенном браузере без сессии,
// и она бесполезна в мобильном приложении: почта открывается в другом
// окне, человек возвращается — а подтверждать нечего. Код переносится
// глазами и работает везде одинаково.
//
// Условие на стороне Supabase (миграцией не делается):
//   1. Authentication → Emails → Templates → Confirm signup:
//      в шаблоне должен стоять {{ .Token }}, а не {{ .ConfirmationURL }}.
//      Пока стоит ссылка — кода в письме не будет.
//   2. Sign In / Providers → Email → Email OTP length = 6,
//      Email OTP expiration = 600 (10 минут).
//
// Три грабли, на которые уже наступили в первой крес-ке и которые
// здесь обойдены сознательно — см. комментарии по коду.
const CODE_LENGTH = 6
const RESEND_SECONDS = 60

export default function RegisterPage() {
  const supabase = createClient()

  const [step, setStep] = useState<'form' | 'code'>('form')
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [code, setCode] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [note, setNote] = useState('')
  const [left, setLeft] = useState(0)
  const codeRef = useRef<HTMLInputElement>(null)

  // Отсчёт до повторной отправки. Без него человек жмёт «надіслати ще раз»
  // трижды подряд, упирается в лимит почтовика и решает, что сломалось.
  useEffect(() => {
    if (left <= 0) return
    const id = setTimeout(() => setLeft((v) => v - 1), 1000)
    return () => clearTimeout(id)
  }, [left])

  useEffect(() => {
    if (step === 'code') codeRef.current?.focus()
  }, [step])

  async function submitForm(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError(''); setNote('')

    const { data, error } = await supabase.auth.signUp({
      email, password,
      options: {
        data: {
          full_name: name,
          locale: 'uk',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        },
      },
    })

    setBusy(false)
    if (error) { setError(humanError(error.message)); return }

    // ГРАБЛИ №1. Здесь напрашивается проверка data.user.identities.length === 0
    // как признак «такой уже есть». Делать её нельзя: Supabase намеренно
    // возвращает пустой список ВСЕМ, чтобы по форме регистрации нельзя было
    // перебором узнать, кто зарегистрирован. В первой крес-ке эта проверка
    // стояла и давала ложные срабатывания — живых людей выбрасывало на «Увійти».
    // Если почта действительно занята, это честно скажет verifyOtp.
    void data

    // Подтверждение отключено в настройках — сессия выдана сразу.
    if (data.session) { window.location.href = '/account'; return }

    setStep('code')
    setLeft(RESEND_SECONDS)
  }

  async function submitCode(e: React.FormEvent) {
    e.preventDefault()
    if (code.length !== CODE_LENGTH || busy) return
    setBusy(true); setError(''); setNote('')

    const { error } = await supabase.auth.verifyOtp({
      email, token: code, type: 'signup',
    })

    if (error) {
      setBusy(false)
      setError(codeError(error.message))
      setCode('')
      return
    }

    // ГРАБЛИ №2. Переход только полной навигацией, а не router.push:
    // серверная проверка сессии на следующей странице должна увидеть
    // свежие куки. При мягком переходе она гонится с ними и выбрасывает
    // человека обратно на вход — ровно после успешного подтверждения.
    window.location.href = '/account'
  }

  async function resend() {
    if (left > 0 || busy) return
    setBusy(true); setError(''); setNote('')
    const { error } = await supabase.auth.resend({ type: 'signup', email })
    setBusy(false)
    if (error) { setError(humanError(error.message)); return }
    setNote('Надіслали новий код.')
    setLeft(RESEND_SECONDS)
  }

  if (step === 'code') {
    return (
      <AuthShell title="Код із листа" subtitle={`Надіслали ${CODE_LENGTH} цифр на ${email}`}>
        <form onSubmit={submitCode} className="flex flex-col gap-4">
          <div>
            <label className="field-label" htmlFor="code">Код підтвердження</label>
            {/* autoComplete="one-time-code" — iOS и Android сами подставят
                код из уведомления, и его не придётся переписывать руками. */}
            <input
              id="code"
              ref={codeRef}
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={CODE_LENGTH}
              required
              className="input text-center tabular"
              style={{ fontSize: 24, letterSpacing: '0.35em' }}
              value={code}
              onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, CODE_LENGTH))}
              placeholder="000000"
            />
            <p className="field-hint">Код діє 10 хвилин і спрацьовує один раз.</p>
          </div>

          {error && <p className="field-error">{error}</p>}
          {note && <p className="t-sm" style={{ color: 'var(--color-success)' }}>{note}</p>}

          <button className="btn-primary" disabled={busy || code.length !== CODE_LENGTH}>
            {busy ? 'Перевіряємо…' : 'Підтвердити'}
          </button>
        </form>

        <div className="t-md mt-6 flex flex-wrap items-center gap-x-4 gap-y-2 prose-muted">
          <button type="button" onClick={resend} disabled={left > 0 || busy}
                  className="underline underline-offset-2 disabled:no-underline disabled:opacity-60">
            {left > 0 ? `Надіслати ще раз через ${left} с` : 'Надіслати ще раз'}
          </button>
          <button type="button"
                  onClick={() => { setStep('form'); setCode(''); setError(''); setNote('') }}
                  className="underline underline-offset-2">
            Змінити пошту
          </button>
        </div>

        <p className="t-sm mt-4 prose-muted">
          Листа немає? Перевірте «Спам» і «Промоакції».
        </p>
      </AuthShell>
    )
  }

  return (
    <AuthShell title="Реєстрація" subtitle="Замовлення й записи в одному місці">
      <form onSubmit={submitForm} className="flex flex-col gap-4">
        <div>
          <label className="field-label" htmlFor="name">Імʼя</label>
          <input id="name" required className="input" autoComplete="name"
                 value={name} onChange={(e) => setName(e.target.value)} placeholder="Марія" />
        </div>
        <div>
          <label className="field-label" htmlFor="email">Пошта</label>
          <input id="email" type="email" required className="input" autoComplete="email"
                 value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
        </div>
        <div>
          <label className="field-label" htmlFor="pass">Пароль</label>
          <input id="pass" type="password" required minLength={8} className="input"
                 autoComplete="new-password"
                 value={password} onChange={(e) => setPassword(e.target.value)} />
          <p className="field-hint">Щонайменше 8 символів</p>
        </div>

        {error && <p className="field-error">{error}</p>}

        <button className="btn-primary" disabled={busy}>
          {busy ? 'Створюємо…' : 'Створити акаунт'}
        </button>
      </form>

      <GoogleButton next="/account" />

      <p className="t-md mt-6 prose-muted">
        Вже з нами? <Link href="/login" className="underline underline-offset-2">Увійти</Link>
      </p>
      <p className="t-xs mt-4 prose-muted">
        Створюючи акаунт, ви погоджуєтесь із{' '}
        <Link href="/privacy" className="underline underline-offset-2">політикою конфіденційності</Link>.
      </p>
    </AuthShell>
  )
}

// ГРАБЛИ №3. Общий переводчик ошибок на экране кода не годится: его
// правила мапят «token expired» на «сеанс истёк, войдите заново», что
// по смыслу неверно — истёк код, а не сеанс, и человек шёл регистрироваться,
// а не входить. Поэтому для кода отдельная функция.
function codeError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('expired')) return 'Код застарів. Надішліть новий — кнопка нижче.'
  if (m.includes('already') && (m.includes('registered') || m.includes('confirmed')))
    return 'Ця пошта вже підтверджена. Увійдіть зі своїм паролем.'
  return 'Невірний код. Якщо запитували кілька разів — введіть останній.'
}

// Сообщения Supabase приходят по-английски и техническим языком.
// Показывать их человеку — значит показывать чужую внутреннюю кухню.
function humanError(message: string): string {
  const m = message.toLowerCase()
  if (m.includes('rate limit') || m.includes('too many'))
    return 'Забагато спроб. Зачекайте хвилину й спробуйте ще раз.'
  if (m.includes('already registered') || m.includes('already exists'))
    return 'Такий акаунт уже існує. Спробуйте увійти або відновити пароль.'
  if (m.includes('password'))
    return 'Пароль закороткий або надто простий.'
  if (m.includes('email') && m.includes('invalid'))
    return 'Перевірте адресу пошти.'
  return message
}
