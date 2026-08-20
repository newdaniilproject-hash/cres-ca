'use client'

import Link from 'next/link'
import { useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PasswordInput, PasswordStrength } from '@/components/auth-ui'
import { humanAuthError } from '@/lib/auth-errors'
import { afterSignOut } from '@/lib/where'
import { useT } from '@/lib/i18n/client'

// Безопасность: смена пароля, смена почты (с подтверждением обоих
// адресов — это включено в Supabase по умолчанию), выход.
export default function SecurityPage() {
  const t = useT()
  const supabase = createClient()

  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [email, setEmail] = useState('')
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    // Повтор пароля: опечатка в пароле, набранном вслепую, обнаружилась бы
    // только на следующем входе — и увела бы человека в восстановление.
    if (password !== password2) {
      setMsg({ kind: 'err', text: t('auth.field.mismatch') })
      return
    }
    setBusy('pass'); setMsg(null)
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(null)
    // Отказ — через общий переводчик GoTrue: сырой английский текст
    // человеку не показываем (М25), сырьё переводчик пишет в консоль сам.
    setMsg(error ? { kind: 'err', text: humanAuthError(t, error.message) }
                 : { kind: 'ok', text: t('account.security.pass.ok') })
    if (!error) { setPassword(''); setPassword2('') }
  }

  async function changeEmail(e: React.FormEvent) {
    e.preventDefault()
    setBusy('email'); setMsg(null)
    // emailRedirectTo: обе ссылки подтверждения приземляются на нашу
    // страницу с объяснением «подтвердите и второе письмо», а не на
    // корень сайта, где человек не понимает, закончил он или нет.
    const { error } = await supabase.auth.updateUser(
      { email },
      { emailRedirectTo: `${window.location.origin}/auth/confirm` },
    )
    setBusy(null)
    setMsg(error ? { kind: 'err', text: humanAuthError(t, error.message) }
                 : { kind: 'ok', text: t('account.security.email.ok') })
  }

  async function signOut() {
    setBusy('out')
    // scope: 'local' — иначе supabase-js по умолчанию гасит сессии ГЛОБАЛЬНО,
    // и «Вийти» на ноутбуке разлогинивает телефон. Выход со всех устройств —
    // отдельное осознанное действие в профиле кабинета.
    await supabase.auth.signOut({ scope: 'local' })
    // ⚠️ НЕ `router.push('/')`. Это была ЧЕТВЁРТАЯ кнопка «Вийти», ведущая
    // на продающую главную; три остальных (панель, шторка под аватаром,
    // профиль) переведены на `afterSignOut()` 20.08.2026, а эта осталась —
    // ровно тот случай, ради которого источник правды и заводился.
    // Внутри обёртки `/` показывало САЙТ внутри приложения; выход — это
    // «хочу войти другим», а не «ушёл с сайта». `location.href`, а не
    // `router.push`: сессия уже погашена, и мягкий переход отрисовал бы
    // экран со старыми данными из кэша роутера.
    window.location.href = afterSignOut()
  }

  return (
    <main className="mx-auto max-w-sm px-5 py-12">
      <Link href="/account" className="btn-ghost rise -ml-3 mb-6">
        ← {t('account.security.back')}
      </Link>
      <h1 className="display rise t-2xl">{t('account.security.title')}</h1>

      {msg && (
        <p className={`rise t-md mt-4 ${msg.kind === 'err' ? 'field-error !mt-4' : ''}`}
           style={msg.kind === 'ok' ? { color: 'var(--color-success)' } : undefined}>
          {msg.text}
        </p>
      )}

      <form onSubmit={changePassword} className="card rise-1 mt-6 flex flex-col gap-3">
        <div>
          <label className="field-label" htmlFor="np">{t('account.security.pass.label')}</label>
          <PasswordInput id="np" value={password} onChange={setPassword}
                         autoComplete="new-password" />
          <PasswordStrength value={password} />
        </div>
        <div>
          <label className="field-label" htmlFor="np2">{t('auth.field.confirmPassword')}</label>
          <PasswordInput id="np2" value={password2} onChange={setPassword2}
                         autoComplete="new-password"
                         invalid={password2.length > 0 && password2 !== password} />
        </div>
        <button className="btn-primary btn-tall" disabled={busy === 'pass' || password.length < 8}>
          {busy === 'pass' ? t('common.saving') : t('account.security.pass.submit')}
        </button>
      </form>

      <form onSubmit={changeEmail} className="card rise-2 mt-4 flex flex-col gap-3">
        <label className="field-label !mb-0" htmlFor="ne">{t('account.security.email.label')}</label>
        <input id="ne" type="email" required className="input"
               value={email} onChange={(e) => setEmail(e.target.value)} />
        <p className="field-hint !mt-0">{t('account.security.email.hint')}</p>
        <button className="btn-primary btn-tall" disabled={busy === 'email'}>
          {busy === 'email' ? t('account.security.email.busy') : t('account.security.email.submit')}
        </button>
      </form>

      <button onClick={signOut} className="btn-danger rise-3 mt-8 w-full" disabled={busy === 'out'}>
        {busy === 'out' ? t('account.security.signOut.busy') : t('account.security.signOut')}
      </button>
    </main>
  )
}
