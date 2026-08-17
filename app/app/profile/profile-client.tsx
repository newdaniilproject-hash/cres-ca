'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { ThemeToggle } from '@/components/theme'
import { useToast } from '@/components/toast'
import { IconExit, IconGear, IconUser } from '@/components/icons'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'

// Подписи ролей — ОБЩИЙ словарь `role.*`: те же семь слов показывают
// `/app/team` и `/app/settings`, и расходиться им нельзя. Само значение
// (`owner`) не переводится: это ключ перечисления, по нему сверяется база.
// Неизвестная роль выводится как есть — новая роль появится в базе раньше,
// чем в словаре.
//
// Здесь был свой список из пяти подписей, и в нём стояло значение `staff`,
// которого в `member_role` (0001) нет вовсе: оно не показывалось никогда.
const ROLES = [
  'owner', 'admin', 'manager', 'accountant', 'operator', 'viewer', 'inspector',
] as const
type Role = (typeof ROLES)[number]
const roleLabel = (t: T, r: string): string =>
  ((ROLES as readonly string[]).includes(r) ? t(`role.${r as Role}`) : r)

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
  const t = useT()
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
      toast.error(t('profile.pass.error.mismatch'))
      return
    }
    setBusy('pass')
    const { error } = await supabase.auth.updateUser({ password })
    setBusy(null)
    // Вторая строка тоста — текст отказа Supabase, он показывается как есть.
    if (error) { toast.error(t('profile.pass.error.failed'), error.message); return }
    setPassword(''); setPassword2(''); setPass(false)
    toast.success(t('profile.pass.ok'))
  }

  async function changeEmail(e: React.FormEvent) {
    e.preventDefault()
    setBusy('mail')
    const { error } = await supabase.auth.updateUser({ email: newEmail.trim() })
    setBusy(null)
    if (error) { toast.error(t('profile.mail.error.failed'), error.message); return }
    setNewEmail(''); setMail(false)
    toast.info(t('profile.mail.sent.title'), t('profile.mail.sent.desc'))
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
    // Слово-подтверждение сверяется С ТЕМ ЖЕ КЛЮЧОМ, которым оно показано
    // в поле ниже. Захардкоженное «ВИДАЛИТИ» в проверке дало бы русский
    // интерфейс с украинским словом в подписи — кнопка не сработала бы
    // никогда.
    if (confirm.trim().toUpperCase() !== t('profile.delete.word')) {
      toast.error(t('profile.delete.error.word', { word: t('profile.delete.word') }),
        t('profile.delete.error.word.desc'))
      return
    }
    setBusy('kill')
    const { data: files, error: countError } = await supabase.rpc('my_account_files_count')
    if (countError) {
      setBusy(null)
      toast.error(t('profile.delete.error.check'), countError.message)
      return
    }
    const left = Number(files ?? 0)
    if (left > 0) {
      setBusy(null)
      toast.error(t.plural('profile.delete.error.files', left),
        t('profile.delete.error.files.desc'))
      return
    }
    const { error } = await supabase.rpc('delete_my_account')
    setBusy(null)
    if (error) { toast.error(t('profile.delete.error.failed'), error.message); return }
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
          {/* Имя человека, почта и название заклада — данные, не строки. */}
          <p className="display t-xl truncate">{name || t('common.noName')}</p>
          <p className="t-sm truncate" style={{ color: 'var(--color-muted)' }}>{email}</p>
          <p className="mt-1 flex flex-wrap items-center gap-2">
            <span className="badge-accent">{roleLabel(t, role)}</span>
            {tenantName && <span className="badge">{tenantName}</span>}
            {tenantDraft && <span className="badge-warn">{t('profile.badge.draft')}</span>}
          </p>
        </div>
      </section>

      {/* ── Данные ───────────────────────────────────────────── */}
      <section className="card rise-2">
        <h2 className="t-sm mb-1" style={{ color: 'var(--color-faint)' }}>
          {t('profile.account.title')}
        </h2>
        <Row label={t('profile.account.name')} value={name || '—'} />
        <Row label={t('profile.account.email')} value={email} />
        <Row label={t('common.role')} value={roleLabel(t, role)} />
        <p className="field-hint mt-2">{t('profile.account.hint')}</p>
      </section>

      {/* ── Безопасность ─────────────────────────────────────── */}
      <section className="card rise-2 !p-0">
        <button type="button" onClick={() => setPass(true)}
                className="row w-full px-5 text-left" style={{ minHeight: 'var(--tap-min)' }}>
          <span>
            <span className="t-md block">{t('profile.password.title')}</span>
            <span className="t-xs block" style={{ color: 'var(--color-faint)' }}>
              {t('profile.password.desc')}
            </span>
          </span>
          <span aria-hidden style={{ color: 'var(--color-faint)' }}>›</span>
        </button>

        <button type="button" onClick={() => setMail(true)}
                className="row w-full px-5 text-left" style={{ minHeight: 'var(--tap-min)' }}>
          <span>
            <span className="t-md block">{t('profile.email.title')}</span>
            <span className="t-xs block" style={{ color: 'var(--color-faint)' }}>
              {t('profile.email.desc')}
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
                <span className="t-md block">{t('profile.settings.title')}</span>
                <span className="t-xs block" style={{ color: 'var(--color-faint)' }}>
                  {t('profile.settings.desc')}
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
          <span className="t-md block">{t('profile.theme.title')}</span>
          <span className="t-xs block" style={{ color: 'var(--color-faint)' }}>
            {t('profile.theme.desc')}
          </span>
        </span>
        <ThemeToggle />
      </section>

      {/* ── Выход и удаление ─────────────────────────────────── */}
      <section className="flex flex-col gap-2 rise-3">
        <button type="button" onClick={() => void signOut()}
                className="btn-secondary flex items-center justify-center gap-2">
          <IconExit size={18} /> {t('profile.signOut')}
        </button>
        <button type="button" onClick={() => setKill(true)} className="btn-ghost"
                style={{ color: 'var(--color-danger)' }}>
          {t('profile.delete.open')}
        </button>
      </section>

      {/* ── Пароль ───────────────────────────────────────────── */}
      <Sheet open={pass} onClose={() => setPass(false)} title={t('profile.pass.sheet.title')}>
        <form onSubmit={changePassword} className="grid gap-3">
          <div>
            <label className="field-label">{t('profile.pass.new.label')}</label>
            <input required autoFocus type="password" minLength={8} className="input"
                   autoComplete="new-password"
                   value={password} onChange={(e) => setPassword(e.target.value)} />
            <p className="field-hint">{t('profile.pass.new.hint')}</p>
          </div>
          <div>
            <label className="field-label">{t('profile.pass.repeat.label')}</label>
            <input required type="password" minLength={8} className="input"
                   autoComplete="new-password"
                   value={password2} onChange={(e) => setPassword2(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy === 'pass' || !password}>
              {busy === 'pass' ? t('common.saving') : t('profile.pass.submit')}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setPass(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </Sheet>

      {/* ── Почта ────────────────────────────────────────────── */}
      <Sheet open={mail} onClose={() => setMail(false)} title={t('profile.mail.sheet.title')}>
        <form onSubmit={changeEmail} className="grid gap-3">
          <div>
            <label className="field-label">{t('profile.mail.new.label')}</label>
            <input required autoFocus type="email" className="input"
                   inputMode="email" autoComplete="email"
                   placeholder={t('profile.mail.new.placeholder')}
                   value={newEmail} onChange={(e) => setNewEmail(e.target.value)} />
            <p className="field-hint">{t('profile.mail.new.hint')}</p>
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy === 'mail' || !newEmail.trim()}>
              {busy === 'mail' ? t('profile.mail.submitBusy') : t('profile.mail.submit')}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setMail(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </Sheet>

      {/* ── Удаление ─────────────────────────────────────────── */}
      <Sheet open={kill} onClose={() => setKill(false)} title={t('profile.delete.sheet.title')}>
        <form onSubmit={deleteAccount} className="grid gap-3">
          <p className="t-md">{t('profile.delete.lead')}</p>
          <p className="field-hint">{t('profile.delete.hint')}</p>
          <div>
            {/* Слово подставляется тем же ключом, по которому идёт сверка. */}
            <label className="field-label">
              {t('profile.delete.confirm.label', { word: t('profile.delete.word') })}
            </label>
            <input required className="input" value={confirm}
                   onChange={(e) => setConfirm(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button className="btn-danger" disabled={busy === 'kill'}>
              {busy === 'kill' ? t('profile.delete.submitBusy') : t('profile.delete.submit')}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setKill(false)}>
              {t('common.cancel')}
            </button>
          </div>
        </form>
      </Sheet>
    </div>
  )
}
