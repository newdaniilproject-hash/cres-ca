'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { ThemeToggle } from '@/components/theme'
import { TextSize } from '@/components/text-size'
import { useToast } from '@/components/toast'
import { useConfirm } from '@/components/confirm'
import { PasswordInput, PasswordStrength } from '@/components/auth-ui'
import { IconExit, IconGear, IconLock, IconMail, IconUser } from '@/components/icons'
import { humanAuthError } from '@/lib/auth-errors'
import { dbErrorText } from '@/lib/errors/db'
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

// `onClick` превращает строку в кнопку с шевроном: имя и телефон теперь
// правятся прямо отсюда, и строка обязана выглядеть нажимаемой — иначе
// подсказка «имя печатается на наліпках» остаётся упрёком без выхода.
function Row({ label, value, onClick }: {
  label: string; value: React.ReactNode; onClick?: () => void
}) {
  const inner = (
    <>
      <span className="t-sm shrink-0" style={{ color: 'var(--color-muted)' }}>{label}</span>
      <span className="t-md min-w-0 text-right">
        {value}
        {onClick && <span aria-hidden className="ml-2" style={{ color: 'var(--color-faint)' }}>›</span>}
      </span>
    </>
  )
  if (onClick) {
    return (
      <button type="button" onClick={onClick}
              className="flex w-full items-start justify-between gap-4 text-left"
              style={{ paddingBlock: 'var(--space-2)', minHeight: 'var(--tap-min)' }}>
        {inner}
      </button>
    )
  }
  return (
    <div className="flex items-start justify-between gap-4"
         style={{ paddingBlock: 'var(--space-2)' }}>
      {inner}
    </div>
  )
}

export function ProfileClient({
  userId, email, name, phone, role, tenantName, tenantDraft, canSettings,
}: {
  userId: string
  email: string
  name: string
  /** Телефон из `profiles.phone` — правится здесь же, шторкой. */
  phone: string
  role: string
  tenantName: string
  tenantDraft: boolean
  /** Есть ли `settings.read`. Считает сервер — см. `page.tsx`. */
  canSettings: boolean
}) {
  const t = useT()
  const router = useRouter()
  const supabase = useMemo(() => createClient(), [])
  const toast = useToast()
  const confirmAsk = useConfirm()

  const [pass, setPass] = useState(false)
  const [mail, setMail] = useState(false)
  const [person, setPerson] = useState(false)
  const [kill, setKill] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [confirm, setConfirm] = useState('')
  const [fullName, setFullName] = useState(name)
  const [phoneVal, setPhoneVal] = useState(phone)

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
    // Вторая строка тоста — отказ GoTrue через общий переводчик: сырой
    // английский текст человеку не показываем (М25), в том числе просьбу
    // reauthentication — у неё своя ветка в `humanAuthError`.
    if (error) { toast.error(t('profile.pass.error.failed'), humanAuthError(t, error.message)); return }
    setPassword(''); setPassword2(''); setPass(false)
    toast.success(t('profile.pass.ok'))
  }

  async function changeEmail(e: React.FormEvent) {
    e.preventDefault()
    setBusy('mail')
    // emailRedirectTo: обе ссылки подтверждения приземляются на страницу
    // с объяснением «подтвердите и второе письмо», а не на корень сайта.
    const { error } = await supabase.auth.updateUser(
      { email: newEmail.trim() },
      { emailRedirectTo: `${window.location.origin}/auth/confirm` },
    )
    setBusy(null)
    if (error) { toast.error(t('profile.mail.error.failed'), humanAuthError(t, error.message)); return }
    setNewEmail(''); setMail(false)
    toast.info(t('profile.mail.sent.title'), t('profile.mail.sent.desc'))
  }

  // Имя и телефон — прямой UPDATE в profiles: RLS на самоправку уже
  // разрешает. Почту так менять НЕЛЬЗЯ — её отбивает сторож базы (0116):
  // она меняется только процедурой GoTrue с подтверждением обеих адресов.
  async function savePerson(e: React.FormEvent) {
    e.preventDefault()
    setBusy('person')
    const { error } = await supabase.from('profiles')
      .update({ full_name: fullName.trim(), phone: phoneVal.trim() || null })
      .eq('id', userId)
    setBusy(null)
    if (error) { toast.error(dbErrorText(t, error)); return }
    setPerson(false)
    toast.success(t('profile.person.ok'))
    // Экран серверный: новое имя приезжает перечитыванием, а не своим стейтом.
    router.refresh()
  }

  async function signOut() {
    // scope: 'local' — по умолчанию supabase-js гасит сессии ГЛОБАЛЬНО,
    // и «Вийти» на ноутбуке разлогинивал телефон. Выход со всех устройств —
    // отдельная кнопка ниже, с подтверждением.
    await supabase.auth.signOut({ scope: 'local' })
    window.location.href = '/'
  }

  // Выход со всех устройств — глобальный signOut, ровно то поведение,
  // которое у обычного «Вийти» было по ошибке. С подтверждением: действие
  // рвёт сеансы на чужих по ощущению устройствах, молча так не делают.
  async function signOutEverywhere() {
    const ok = await confirmAsk({
      title: t('profile.signOutAll.confirm.title'),
      body: t('profile.signOutAll.confirm.body'),
      action: t('profile.signOutAll.confirm.action'),
      tone: 'danger',
    })
    if (!ok) return
    await supabase.auth.signOut({ scope: 'global' })
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
      // Ответ базы — через dbErrorText: Postgres в сыром тексте печатает
      // значения полей, и показывать его как есть нельзя (М25).
      toast.error(t('profile.delete.error.check'), dbErrorText(t, countError))
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
    if (error) { toast.error(t('profile.delete.error.failed'), dbErrorText(t, error)); return }
    // Акаунт уже удалён — глобальный signOut пошёл бы на сервер с мёртвой
    // сессией; локально чистим токены этого устройства, остальные сеансы
    // умерли вместе с пользователем.
    await supabase.auth.signOut({ scope: 'local' })
    window.location.href = '/'
  }

  return (
    <div className="flex flex-col gap-4">

      {/* ═══ CRESKO Web, §17 «Профіль та акаунт» — хедер экрана (только lg)
          До 20.08.2026 у этого экрана широкой раскладки не было ВОВСЕ:
          мобильный столбик карточек растягивался на 1146px, и строка
          «Пошта … anna@…» разъезжалась на всю ширину, а ползунок размера
          текста становился метровым. Кнопки действия справа нет: всё,
          что здесь делают, принадлежит своей строке, а не экрану. */}
      <div className="hidden items-center gap-3 lg:flex">
        <span aria-hidden className="flex shrink-0 items-center justify-center"
              style={{
                width: 44, height: 44,
                borderRadius: 'var(--radius-plate)',
                background: 'var(--color-accent-soft)',
                color: 'var(--color-accent-ink)',
              }}>
          <IconUser size={22} />
        </span>
        <div className="min-w-0">
          <h1 className="webh1" data-size="27">{t('app.screen.profile.title')}</h1>
          <p style={{ fontSize: 14, color: 'var(--color-muted)' }}>
            {t('app.screen.profile.desc')}
          </p>
        </div>
      </div>

      {/* ═══ Две колонки на широком экране, один столбик на телефоне ══════
          Порядок карточек на телефоне НЕ меняется: внешний контейнер там
          обычный `flex-col`, а колонки — просто два его ребёнка подряд.
          Слева то, что читают («кто я», данные, безопасность), справа —
          то, чем управляют: вид, размер текста и выход. */}
      <div className="flex flex-col gap-4 lg:grid lg:grid-cols-[minmax(0,1fr)_392px] lg:items-start lg:gap-5">
      <div className="flex flex-col gap-4">

      {/* ── Кто вошёл ────────────────────────────────────────── */}
      <section className="card rise-1 flex items-center gap-4">
        {/* Размер аватара — классами, а не inline-стилем: в хендоффе
            карточка человека несёт 66px, и на телефоне такой кружок
            съедает четверть ширины. Inline-стиль перебил бы `lg:`. */}
        <span className="avatarbtn h-14 w-14 shrink-0 text-[22px] lg:h-[66px] lg:w-[66px] lg:text-2xl">
          {initial || <IconUser size={24} />}
        </span>
        <div className="min-w-0">
          {/* Имя человека, почта и название заклада — данные, не строки. */}
          <p className="display t-xl truncate lg:text-[21px]">{name || t('common.noName')}</p>
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
        {/* Имя и телефон нажимаемы: открывают шторку «Особисті дані».
            Почта — нет: она меняется только процедурой GoTrue (строка
            «Змінити пошту» ниже), прямую правку отбивает сторож 0116. */}
        <Row label={t('profile.account.name')} value={name || '—'}
             onClick={() => { setFullName(name); setPhoneVal(phone); setPerson(true) }} />
        <Row label={t('profile.account.phone')} value={phone || '—'}
             onClick={() => { setFullName(name); setPhoneVal(phone); setPerson(true) }} />
        <Row label={t('profile.account.email')} value={email} />
        <Row label={t('common.role')} value={roleLabel(t, role)} />
        <p className="field-hint mt-2">{t('profile.account.hint')}</p>
      </section>

      {/* ── Безопасность ─────────────────────────────────────────
          Значок-якорь у каждой строки, как в макете CRESKO: там
          у каждого пункта свой кружок со значком, а не голый текст
          с шевроном. Один и тот же `.list-anchor`, что и у остальных
          списков кабинета, — не заводим для профиля свой вид строки. */}
      <section className="card rise-2 !p-0">
        <button type="button" onClick={() => setPass(true)}
                className="row w-full px-5 text-left" style={{ minHeight: 'var(--tap-min)' }}>
          <span className="flex min-w-0 items-center gap-3">
            <span className="list-anchor"><IconLock size={18} /></span>
            <span className="min-w-0">
              <span className="t-md block">{t('profile.password.title')}</span>
              <span className="t-xs block truncate" style={{ color: 'var(--color-faint)' }}>
                {t('profile.password.desc')}
              </span>
            </span>
          </span>
          <span aria-hidden style={{ color: 'var(--color-faint)' }}>›</span>
        </button>

        <button type="button" onClick={() => setMail(true)}
                className="row w-full px-5 text-left" style={{ minHeight: 'var(--tap-min)' }}>
          <span className="flex min-w-0 items-center gap-3">
            <span className="list-anchor"><IconMail size={18} /></span>
            <span className="min-w-0">
              <span className="t-md block">{t('profile.email.title')}</span>
              <span className="t-xs block truncate" style={{ color: 'var(--color-faint)' }}>
                {t('profile.email.desc')}
              </span>
            </span>
          </span>
          <span aria-hidden style={{ color: 'var(--color-faint)' }}>›</span>
        </button>

        {/* Без `settings.read` страница разворачивает на `/app`. Ссылка,
            ведущая в редирект, читается как поломка — прячем целиком:
            пункт, который ничего не открывает, хуже отсутствующего.

            ⚠️ И `lg:hidden` — ЭТО СНЯТЫЙ ДУБЛЬ. На широком экране
            «Налаштування» стоят пунктом сайдбара всегда (FIXED_BOTTOM
            в `components/app-shell.tsx`, то же право `settings.read`),
            то есть дверь в один и тот же экран лежала на виду дважды.
            На телефоне сайдбара нет — там строка остаётся. */}
        {canSettings && (
          <Link href="/app/settings" className="row px-5 lg:hidden"
                style={{ minHeight: 'var(--tap-min)' }}>
            <span className="flex min-w-0 items-center gap-3">
              <span className="list-anchor"><IconGear size={18} /></span>
              <span className="min-w-0">
                <span className="t-md block">{t('profile.settings.title')}</span>
                <span className="t-xs block truncate" style={{ color: 'var(--color-faint)' }}>
                  {t('profile.settings.desc')}
                </span>
              </span>
            </span>
            <span aria-hidden style={{ color: 'var(--color-faint)' }}>›</span>
          </Link>
        )}
      </section>

      </div>

      {/* ── Правая колонка: вид, размер текста и выход ──────────────── */}
      <div className="flex flex-col gap-4">

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

      {/* Размер текста — отдельной карточкой, а не в строку с темой:
          ползунку нужна вся ширина, в строке он ужимается до огрызка. */}
      <section className="card rise-3">
        <TextSize />
      </section>

      {/* ── Выход и удаление ───────────────────────────────────
          На широком экране — карточка «Дії з акаунтом» (§17): три голые
          кнопки на пустом фоне колонки 392px висели в воздухе и не
          читались как один блок. На телефоне карточки нет намеренно:
          там это последнее на экране, и рамка вокруг выхода делает
          его похожим на ещё один раздел настроек. */}
      <section className="flex flex-col gap-2 rise-3 lg:rounded-2xl lg:border lg:border-[var(--color-border)] lg:bg-[var(--color-surface)] lg:p-4">
        <button type="button" onClick={() => void signOut()}
                className="btn-secondary flex items-center justify-center gap-2">
          <IconExit size={18} /> {t('profile.signOut')}
        </button>
        <button type="button" onClick={() => void signOutEverywhere()}
                className="btn-ghost">
          {t('profile.signOutAll')}
        </button>
        <button type="button" onClick={() => setKill(true)} className="btn-ghost"
                style={{ color: 'var(--color-danger)' }}>
          {t('profile.delete.open')}
        </button>
      </section>

      </div>
      </div>

      {/* ── Пароль ───────────────────────────────────────────── */}
      <Sheet open={pass} onClose={() => setPass(false)} title={t('profile.pass.sheet.title')}>
        <form onSubmit={changePassword} className="grid gap-3">
          <div>
            <label className="field-label" htmlFor="pf-pass">{t('profile.pass.new.label')}</label>
            {/* Общее поле с «глазиком» и мерой надёжности — те же, что на
                входе и регистрации: два вида поля пароля разъезжаются. */}
            <PasswordInput id="pf-pass" value={password} onChange={setPassword}
                           autoComplete="new-password" autoFocus />
            <PasswordStrength value={password} />
          </div>
          <div>
            <label className="field-label" htmlFor="pf-pass2">{t('profile.pass.repeat.label')}</label>
            <PasswordInput id="pf-pass2" value={password2} onChange={setPassword2}
                           autoComplete="new-password"
                           invalid={password2.length > 0 && password2 !== password} />
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

      {/* ── Особисті дані: имя и телефон ─────────────────────── */}
      <Sheet open={person} onClose={() => setPerson(false)} title={t('profile.person.sheet.title')}>
        <form onSubmit={savePerson} className="grid gap-3">
          <div>
            <label className="field-label" htmlFor="pf-name">{t('profile.person.name.label')}</label>
            <input id="pf-name" required autoFocus className="input"
                   autoComplete="name" autoCapitalize="words"
                   value={fullName} onChange={(e) => setFullName(e.target.value)} />
            {/* Та же подсказка, что под списком: имя печатается на наліпках
                розливу — теперь его отсюда МОЖНО исправить. */}
            <p className="field-hint">{t('profile.account.hint')}</p>
          </div>
          <div>
            <label className="field-label" htmlFor="pf-phone">{t('profile.person.phone.label')}</label>
            <input id="pf-phone" type="tel" inputMode="tel" className="input"
                   autoComplete="tel"
                   value={phoneVal} onChange={(e) => setPhoneVal(e.target.value)} />
          </div>
          <div className="flex gap-2">
            <button className="btn-primary" disabled={busy === 'person' || !fullName.trim()}>
              {busy === 'person' ? t('common.saving') : t('common.save')}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setPerson(false)}>
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

      {/* Шторка подтверждения «Вийти на всіх пристроях» — один раз в конце. */}
      {confirmAsk.element}
    </div>
  )
}
