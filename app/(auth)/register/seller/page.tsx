'use client'

import Link from 'next/link'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { AuthShell } from '../../auth-shell'
import { GoogleButton } from '../../google-button'

// Онбординг продавца: два шага. Шаг 1 — аккаунт (или уже вошли),
// шаг 2 — заведение. После register_tenant ОБЯЗАТЕЛЕН refreshSession:
// членство попадает в токен только при следующей его выдаче.
export default function SellerRegisterPage() {
  const router = useRouter()
  const supabase = createClient()

  const [step, setStep] = useState<0 | 1>(0)
  const [checked, setChecked] = useState(false)

  // шаг 1
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  // шаг 2
  const [shopName, setShopName] = useState('')
  const [kind, setKind] = useState<'services' | 'goods' | 'both'>('services')
  const [city, setCity] = useState('')

  const [state, setState] = useState<'idle' | 'busy' | 'error'>('idle')
  const [error, setError] = useState('')

  // Уже вошёл? — сразу второй шаг.
  if (!checked) {
    void supabase.auth.getUser().then(({ data }) => {
      if (data.user) setStep(1)
      setChecked(true)
    })
  }

  async function submitAccount(e: React.FormEvent) {
    e.preventDefault()
    setState('busy'); setError('')
    const { data, error } = await supabase.auth.signUp({ email, password })
    if (error) { setState('error'); setError(error.message); return }
    if (!data.session) {
      // Требуется подтверждение почты: заведение создадим после входа.
      setState('error')
      setError('Підтвердіть пошту за листом і поверніться сюди — крок збережеться.')
      return
    }
    setState('idle'); setStep(1)
  }

  async function submitShop(e: React.FormEvent) {
    e.preventDefault()
    setState('busy'); setError('')
    const { error } = await supabase.rpc('register_tenant', {
      p_name: shopName, p_kind: kind, p_city: city || null,
    })
    if (error) { setState('error'); setError(error.message); return }
    await supabase.auth.refreshSession()   // членство → в токен
    router.push('/app'); router.refresh()
  }

  return (
    <AuthShell
      title={step === 0 ? 'Акаунт для бізнесу' : 'Ваш заклад'}
      subtitle={step === 0
        ? 'Крок 1 із 2 · склад, записи і клієнти — безкоштовно'
        : 'Крок 2 із 2 · назву можна змінити будь-коли'}
    >
      {step === 0 ? (
        <>
        <form onSubmit={submitAccount} className="flex flex-col gap-4">
          <div>
            <label className="field-label" htmlFor="email">Пошта</label>
            <input id="email" type="email" required className="input" autoComplete="email"
                   value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div>
            <label className="field-label" htmlFor="pass">Пароль</label>
            <input id="pass" type="password" required minLength={8} className="input"
                   autoComplete="new-password"
                   value={password} onChange={(e) => setPassword(e.target.value)} />
          </div>
          {state === 'error' && <p className="field-error">{error}</p>}
          <button className="btn-primary" disabled={state === 'busy'}>
            {state === 'busy' ? 'Хвилинку…' : 'Далі'}
          </button>
        </form>

        {/* Только шаг 1: на шаге заведения человек уже вошёл */}
        <GoogleButton next="/register/seller" />

        <p className="t-md mt-6 prose-muted">
          Вже є акаунт? <Link href="/login?next=/register/seller" className="underline underline-offset-2">Увійти</Link>
        </p>
        </>
      ) : (
        <form onSubmit={submitShop} className="flex flex-col gap-5">
          <div>
            <label className="field-label" htmlFor="shop">Назва закладу</label>
            <input id="shop" required minLength={2} className="input"
                   value={shopName} onChange={(e) => setShopName(e.target.value)}
                   placeholder="Braids Studio" />
          </div>

          <div>
            <p className="field-label">Чим займаєтесь?</p>
            <div className="flex flex-wrap gap-2">
              {([['services', 'Послуги'], ['goods', 'Товари'], ['both', 'І те, й інше']] as const)
                .map(([v, label]) => (
                  <button key={v} type="button" onClick={() => setKind(v)}
                          className={kind === v ? 'chip-active' : 'chip'}>
                    {label}
                  </button>
                ))}
            </div>
          </div>

          <div>
            <label className="field-label" htmlFor="city">Місто</label>
            <input id="city" className="input" value={city}
                   onChange={(e) => setCity(e.target.value)} placeholder="Харків" />
          </div>

          {state === 'error' && <p className="field-error">{error}</p>}

          <button className="btn-primary" disabled={state === 'busy'}>
            {state === 'busy' ? 'Створюємо…' : 'Створити заклад'}
          </button>
          <p className="field-hint">
            Заклад створюється як чернетка: наповнюйте склад і календар одразу,
            публічна сторінка вмикається після перевірки.
          </p>
        </form>
      )}
    </AuthShell>
  )
}
