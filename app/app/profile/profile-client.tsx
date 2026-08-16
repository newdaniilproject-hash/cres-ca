'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { ThemeToggle } from '@/components/theme'
import { useToast } from '@/components/toast'
import { IconExit, IconGear, IconUser } from '@/components/icons'

const ROLE_LABEL: Record<string, string> = {
  owner: 'Власник',
  admin: 'Адміністратор',
  operator: 'Майстер',
  inspector: 'Інспектор',
  staff: 'Співробітник',
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4"
         style={{ paddingBlock: 'var(--space-2)' }}>
      <span className="t-sm shrink-0" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <span className="t-md min-w-0 text-right">{value}</span>
    </div>
  )
}

export function ProfileClient({
  email, name, role, tenantName, tenantDraft, canSettings,
}: {
  email: string
  name: string
  role: string
  tenantName: string
  tenantDraft: boolean
  /** Есть ли `settings.read`. Считает сервер — см. `page.tsx`. */
  canSettings: boolean
}) {
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()

  const [pass, setPass] = useState(false)
  const [mail, setMail] = useState(false)
  const [kill, setKill] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [confirm, setConfirm] = useState('')

  const initial = (name || email).trim().charAt(0).toUpperCase()

  async function changePassword(e: React.FormEvent) {
    e.preventDefault()
    if (password !== password2) {
      toast.error('Паролі не збігаються')
      return
    }
    setBusy('pass')
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(null)
    if (error) { toast.error('Пароль не змінено', error.message); return }
    setPassword(''); setPassword2(''); setPass(false)
    toast.success('Пароль змінено')
  }

  async function changeEmail(e: React.FormEvent) {
    e.preventDefault()
    setBusy('mail')
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() })
    setBusy(null)
    if (error) { toast.error('Пошту не змінено', error.message); return }
    setNewEmail(''); setMail(false)
    toast.info('Підтвердіть зміну',
      'Листи пішли на стару і на нову адресу — перейдіть за обома.')
  }

  async function signOut() {
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  // Удаление аккаунта — требование Apple 5.1.1(v) и условие сделки
  // «данные клиента — его собственность». База умеет это с 0058, но
  // отказывается работать, пока в хранилище лежат файлы заведения:
  // удалять их из SQL Supabase запрещает, это делает приложение.
  // Поэтому сначала честно считаем файлы и говорим, сколько их.
  async function deleteAccount(e: React.FormEvent) {
    e.preventDefault()
    if (confirm.trim().toUpperCase() !== 'ВИДАЛИТИ') {
      toast.error('Введіть слово ВИДАЛИТИ', 'Так підтверджується незворотна дія.')
      return
    }
    setBusy('kill')
    const { data: files, error: countError } = await supabase.rpc('my_account_files_count')
    if (countError) {
      setBusy(null)
      toast.error('Не вдалося перевірити файли', countError.message)
      return
    }
    if (Number(files ?? 0) > 0) {
      setBusy(null)
      toast.error(`У сховищі ще ${files} файлів`,
        'Видаліть документи засобів у складі, потім поверніться сюди.')
      return
    }
    const { error } = await supabase.rpc('delete_my_account')
    setBusy(null)
    if (error) { toast.error('Акаунт не видалено', error.message); return }
    await supabase.auth.signOut()
    window.location.href = '/'
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ── Кто вошёл ────────────────────────────────────────── */}
      <section className="card rise-1 flex items-center gap-4">
        <span className="avatarbtn shrink-0"
              style={{ width: 56, height: 56, fontSize: 22 }}>
          {initial || <IconUser size={24} />}
        </span>
        <div className="min-w-0">
          <p className="display t-xl truncate">{name || 'Без імені'}</p>
          <p className="t-sm truncate" style={{ color: 'var(--color-muted)' }}>{email}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <span className="badge-accent">{ROLE_LABEL[role] ?? role}</span>
            {tenantName && <span className="badge">{tenantName}</span>}
            {tenantDraft && <span className="badge-warn">чернетка</span>}
          </p>
        </div>
      </section>

      {/* ── Данные ───────────────────────────────────────────── */}
      <section className="card rise-2">
        <h2 className="t-sm mb-1" style={{ color: 'var(--color-faint)' }}>ОБЛІКОВИЙ ЗАПИС</h2>
        <Row label="Імʼя" value={name || '—'} />
        <Row label="Пошта" value={email} />
        <Row label="Роль" value={ROLE_LABEL[role] ?? role} />
        <p className="field-hint mt-2">
          Імʼя видно на наліпках розливу як «відповідальний майстер» —
          порожнє поле там і надрукується порожнім.
        </p>
      </section>

      {/* ── Безопасность ─────────────────────────────────────── */}
      <section className="card rise-2 !p-0">
        <button type="button" onClick={() => setPass(true)}
                className="row w-full px-5 text-left" style={{ minHeight: 'var(--tap-min)' }}>
          <span>
            <span className="t-md block">Змінити пароль</span>
            <span className="t-xs block" style={{ color: 'var(--color-faint)' }}>
              Новий пароль набирається двічі
            </span>
          </span>
          <span aria-hidden style={{ color: 'var(--color-faint)' }}>›</span>
        </button>

        <button type="button" onClick={() => setMail(true)}
                className="row w-full px-5 text-left" style={{ minHeight: 'var(--tap-min)' }}>
          <span>
            <span className="t-md block">Змінити пошту</span>
            <span className="t-xs block" style={{ color: 'var(--color-faint)' }}>
              Підтвердження піде на обидві адреси
            </span>
          </span>
          <span aria-hidden style={{ color: 'var(--color-faint)' }}>›</span>
        </button>

        {/* Без `settings.read` страница разворачивает на `/app`. Ссылка,
            ведущая в редирект, читается как поломка — прячем целиком:
            пункт, который ничего не открывает, хуже отсутствующего. */}
        {canSettings && (
          <Link href="/app/settings" className="row px-5" style={{ minHeight: 'var(--tap-min)' }}>
            <span className="flex items-center gap-3">
              <span aria-hidden style={{ color: 'var(--color-muted)' }}><IconGear size={20} /></span>
              <span>
                <span className="t-md block">Налаштування закладу</span>
                <span className="t-xs block" style={{ color: 'var(--color-faint)' }}>
                  Назва, адреса, публікація, команда
                </span>
              </span>
            </span>
            <span aria-hidden style={{ color: 'var(--color-faint)' }}>›</span>
          </Link>
        )}
      </section>

      {/* ── Вид ──────────────────────────────────────────────── */}
      <section className="card rise-3 flex items-center justify-between gap-3">
        <span>
          <span className="t-md block">Оформлення</span>
          <span className="t-xs block" style={{ color: 'var(--color-faint)' }}>
            Світла, темна або як у системі
          </span>
        </span>
        <ThemeToggle />
      </section>

      {/* ── Выход и удаление ─────────────────────────────────── */}
      <section className="flex flex-col gap-2 rise-3">
        <button type="button" onClick={() => void signOut()}
                className="btn-secondary flex items-center justify-center gap-2">
          <IconExit size={18} /> Вийти з акаунту
        </button>
        <button type="button" onClick={() => setKill(true)} className="btn-ghost"
                style={{ color: 'var(--color-danger)' }}>
          Видалити акаунт
        </button>
      </section>

      {/* ── Пароль ───────────────────────────────────────────── */}
      <Sheet open={pass} onClose={() => setPass(false)} title="Новий пароль">
        <form onSubmit={changePassword} className="grid gap-3">
          <div>
            <label className="field-label">Новий пароль</label>
            <input required autoFocus type="password" minLength={8} className="input"
                   autoComplete="new-password"
                   value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="field-hint">Мінімум 8 символів.</p>
          </div>
          <div>
            <label className="field-label">Повторіть пароль</label>
            <input required type="password" minLength={8} className="input"
                   autoComplete="new-password"
                   value={password2} onChange={(e) => setPassword2(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy === 'pass' || !password}>
              {busy === 'pass' ? 'Зберігаємо…' : 'Змінити пароль'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setPass(false)}>
              Скасувати
            </button>
          </div>
        </form>
      </Sheet>

      {/* ── Почта ────────────────────────────────────────────── */}
      <Sheet open={mail} onClose={() => setMail(false)} title="Нова пошта">
        <form onSubmit={changeEmail} className="grid gap-3">
          <div>
            <label className="field-label">Нова адреса</label>
            <input required autoFocus type="email" className="input"
                   inputMode="email" autoComplete="email" placeholder="name@example.com"
                   value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            <p className="field-hint">
              Поки не перейдете за посиланням в обох листах, вхід залишиться
              за старою адресою.
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy === 'mail' || !newEmail.trim()}>
              {busy === 'mail' ? 'Надсилаємо…' : 'Змінити пошту'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setMail(false)}>
              Скасувати
            </button>
          </div>
        </form>
      </Sheet>

      {/* ── Удаление ─────────────────────────────────────────── */}
      <Sheet open={kill} onClose={() => setKill(false)} title="Видалення акаунту">
        <form onSubmit={deleteAccount} className="grid gap-3">
          <p className="t-md">
            Зникне все: заклад, склад, журнали, документи і сам обліковий запис.
            Відновити не вийде — це не «архів», а видалення.
          </p>
          <p className="field-hint">
            Якщо у закладі є інші власники, він залишиться їм. Ваші записи
            в незмінюваних журналах теж залишаться — вони доказ перевірці,
            і прибрати їх не можна нікому.
          </p>
          <div>
            <label className="field-label">Наберіть слово ВИДАЛИТИ</label>
            <input required className="input" value={confirm}
                   onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button className="btn-danger" disabled={busy === 'kill'}>
              {busy === 'kill' ? 'Видаляємо…' : 'Видалити назавжди'}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setKill(false)}>
              Скасувати
            </button>
          </div>
        </form>
      </Sheet>
    </div>
  )
}
