'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'

type Kind = 'services' | 'goods' | 'both'

const KINDS: { value: Kind; label: string; hint: string }[] = [
  { value: 'services', label: 'Послуги', hint: 'Записи, майстри, розклад' },
  { value: 'goods',    label: 'Товари',  hint: 'Каталог і замовлення' },
  { value: 'both',     label: 'І те, й інше', hint: 'Записи та товари разом' },
]

// Створення закладу — екран застосунку, а не сторінка сайту.
// Один крок, велика кнопка внизу, клавіатура нічого не перекриває.
export default function MobileShopPage() {
  const supabase = useMemo(() => createClient(), [])

  const [ready, setReady] = useState(false)
  const [who, setWho] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Kind>('services')
  const [city, setCity] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      if (!data.session) { window.location.replace('/m'); return }
      setWho(data.session.user.email ?? '')
      setReady(true)
    })
    return () => { alive = false }
  }, [supabase])

  // Экран не должен быть ловушкой: человек мог попасть сюда сразу после
  // запуска, потому что вход уже был. Он видит, под кем зашёл, и может выйти.
  async function signOut() {
    await supabase.auth.signOut()
    window.location.href = '/m'
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.rpc('register_tenant', {
      p_name: name.trim(),
      p_kind: kind,
      p_city: city.trim() || null,
    })
    if (error) { setBusy(false); setError(error.message); return }
    // Полная перезагрузка: права и модули приезжают новым токеном,
    // клиентская навигация оставила бы старый.
    window.location.href = '/app'
  }

  if (!ready) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <div className="display t-2xl" style={{ opacity: 0.35 }}>
          Маркет<span style={{ color: 'var(--color-gold)' }}>.</span>
        </div>
      </main>
    )
  }

  return (
    <main className="flex flex-1 flex-col px-6 pb-6">
      <div className="flex items-center justify-between" style={{ height: 56 }}>
        <span className="display t-lg">
          Маркет<span style={{ color: 'var(--color-gold)' }}>.</span>
        </span>
        <button
          type="button"
          onClick={signOut}
          className="t-sm underline underline-offset-2"
          style={{ color: 'var(--color-muted)', minHeight: 'var(--tap-min)' }}
        >
          Вийти
        </button>
      </div>

      <h1 className="display t-2xl mt-2">Ваш заклад</h1>
      <p className="t-md mt-2" style={{ color: 'var(--color-muted)', lineHeight: 1.5 }}>
        {who ? <>Ви увійшли як {who}. </> : null}
        Залишився один крок — назву й місто можна змінити будь-коли.
      </p>

      <form onSubmit={create} className="mt-7 flex flex-1 flex-col">
        <label className="field-label" htmlFor="shop-name">Назва закладу</label>
        <input
          id="shop-name"
          required
          autoFocus
          className="input"
          style={{ height: 52, fontSize: 16 }}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Braids Studio"
        />

        <p className="field-label mt-5">Чим займаєтесь?</p>
        <div className="flex flex-col gap-2">
          {KINDS.map((k) => {
            const on = kind === k.value
            return (
              <button
                key={k.value}
                type="button"
                onClick={() => setKind(k.value)}
                className="card-flat flex items-center justify-between gap-3 text-left"
                style={{
                  minHeight: 'var(--tap-min)',
                  borderColor: on ? 'var(--color-accent)' : undefined,
                  background: on ? 'var(--color-accent-soft)' : undefined,
                }}
              >
                <span>
                  <span className="t-md block">{k.label}</span>
                  <span className="t-xs block" style={{ color: 'var(--color-faint)' }}>{k.hint}</span>
                </span>
                <span
                  aria-hidden
                  style={{
                    width: 20, height: 20, borderRadius: 999, flexShrink: 0,
                    border: `2px solid ${on ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
                    background: on ? 'var(--color-accent)' : 'transparent',
                  }}
                />
              </button>
            )
          })}
        </div>

        <label className="field-label mt-5" htmlFor="shop-city">Місто</label>
        <input
          id="shop-city"
          className="input"
          style={{ height: 52, fontSize: 16 }}
          value={city}
          onChange={(e) => setCity(e.target.value)}
          placeholder="Харків"
        />

        {error && <p className="field-error">{error}</p>}

        <div className="flex-1" />

        <button
          className="btn-primary mt-6 flex items-center justify-center"
          style={{ height: 52, fontSize: 16 }}
          disabled={busy || name.trim().length < 2}
        >
          {busy ? 'Створюємо…' : 'Створити заклад'}
        </button>

        <p className="t-xs mt-3" style={{ color: 'var(--color-faint)', lineHeight: 1.5 }}>
          Заклад створюється як чернетка: наповнюйте склад одразу,
          публічна сторінка вмикається після перевірки.
        </p>
      </form>
    </main>
  )
}
