'use client'

import Link from 'next/link'
import { afterSignOut } from '@/lib/where'
import { useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { Sheet } from '@/components/sheet'
import { ThemeToggle } from '@/components/theme'
import { TextSize } from '@/components/text-size'
import { LangSwitch } from '@/components/lang-switch'
import { Fold } from '@/components/fold'
import { useToast } from '@/components/toast'
import { useConfirm } from '@/components/confirm'
import { PasswordInput, PasswordStrength } from '@/components/auth-ui'
import { IconAlert, IconExit, IconGear, IconLock, IconMail, IconPlus, IconUser } from '@/components/icons'
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

// Тихая строка «подпись — значение» ВНУТРИ карточки-героя. Не кнопка:
// правится всё одним входом («Редагувати дані»), а не по строке на поле.
//
// Отдельной карточки «Обліковий запис» здесь БОЛЬШЕ НЕТ, и это не
// перестановка. Она повторяла шапку целиком: имя, почта и роль уже
// названы выше, то есть половина экрана состояла из второго показа
// того же самого (проверка 3 из «Как проходить экран»). Осталось ровно
// то, чего в шапке не было, — почта и телефон.
function Quiet({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4"
         style={{ paddingBlock: 'var(--space-2)' }}>
      <span className="t-sm shrink-0" style={{ color: 'var(--color-muted)' }}>{label}</span>
      {/* `break-words` — не оформление, а починка 20.08.2026: почта
          вроде `oksana.kovalchuk.zadorozhnia@example.com` это ОДНО слово
          без пробелов, и `min-w-0` его не ломает — он ужимает коробку,
          а не строку. На 390px такая почта расширяла страницу на 15px,
          и весь кабинет ездил вбок на экране профиля. */}
      <span className="t-md min-w-0 break-words text-right">{value}</span>
    </div>
  )
}

/** Строка-действие со значком. Один вид на все действия экрана. */
function ActionRow({ icon, title, desc, onClick, href, className = '' }: {
  icon: React.ReactNode
  title: string
  desc: string
  onClick?: () => void
  href?: string
  className?: string
}) {
  const inner = (
    <>
      <span className="flex min-w-0 items-center gap-3">
        <span className="list-anchor">{icon}</span>
        <span className="min-w-0">
          <span className="t-md block">{title}</span>
          <span className="t-xs block truncate" style={{ color: 'var(--color-faint)' }}>
            {desc}
          </span>
        </span>
      </span>
      <span aria-hidden style={{ color: 'var(--color-faint)' }}>›</span>
    </>
  )
  const cls = `row px-5 ${className}`
  const style = { minHeight: 'var(--tap-min)' }
  if (href) return <Link href={href} className={cls} style={style}>{inner}</Link>
  return (
    <button type="button" onClick={onClick} className={`${cls} w-full text-left`} style={style}>
      {inner}
    </button>
  )
}

export function ProfileClient({
  userId, tenantId, email, name, phone, avatarPath, role, tenantName, tenantDraft,
  joinedAt, bookingsToday, bookingsWeek, canSettings,
}: {
  userId: string
  /** Нужен для пути файла: `<tenant_id>/avatars/<user_id>.<ext>` (0130). */
  tenantId: string
  email: string
  name: string
  /** Телефон из `profiles.phone` — правится здесь же, шторкой. */
  phone: string
  /** Путь файла в бакете `media`, а не полный адрес: домен меняется. */
  avatarPath: string
  role: string
  tenantName: string
  tenantDraft: boolean
  /** Когда человек появился в этом заведении. */
  joinedAt: string | null
  /**
   * Мои записи. `null` — карточка мастера к учётной записи НЕ привязана,
   * и тогда плиток нет вовсе: пустая плитка со счётчиком читается как
   * «у меня ноль записей», а правда — «мы не знаем, какие ваши».
   */
  bookingsToday: number | null
  bookingsWeek: number | null
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
  const [more, setMore] = useState(false)
  const [busy, setBusy] = useState<string | null>(null)

  const [password, setPassword] = useState('')
  const [password2, setPassword2] = useState('')
  const [newEmail, setNewEmail] = useState('')
  const [confirm, setConfirm] = useState('')
  const [fullName, setFullName] = useState(name)
  const [phoneVal, setPhoneVal] = useState(phone)

  const initial = (name || email).trim().charAt(0).toUpperCase()

  // Публичный адрес фото. Бакет `media` раздаётся с CDN без подписи —
  // так же, как фото товаров; подписывать аватар значило бы платить
  // за подпись на каждой отрисовке экрана.
  const [avatar, setAvatar] = useState(avatarPath)
  // Метка версии живёт ОТДЕЛЬНО от пути, а не дописывается к нему.
  // `getPublicUrl` кодирует свой аргумент целиком: путь с «?v=…» внутри
  // превратился бы в имя файла со знаком вопроса, и картинка не нашлась бы.
  const [bust, setBust] = useState(0)
  const avatarSrc = avatar
    ? supabase.storage.from('media').getPublicUrl(avatar).data.publicUrl
      + (bust ? `?v=${bust}` : '')
    : ''
  const fileRef = useRef<HTMLInputElement | null>(null)

  // ── Своё фото (0130) ────────────────────────────────────────────────
  // Путь строго `<tenant_id>/avatars/<user_id>.<ext>` — политика хранилища
  // сверяет ВСЕ ТРИ сегмента, и любой другой путь она отобьёт. Значит имя
  // собирается здесь, а не приходит от выбора человека.
  //
  // `upsert: true` обязателен: второе фото ложится ПОВЕРХ первого, иначе
  // в бакете копились бы файлы, а показывался всё равно один. Ради этого
  // в 0130 заведена отдельная политика на UPDATE — без неё замена молча
  // не проходила бы, а первая загрузка работала.
  async function pickAvatar(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    // Поле обнуляем СРАЗУ: без этого выбор того же файла второй раз
    // не вызывает `change`, и «попробовать ещё раз» не работает.
    e.target.value = ''
    if (!file) return
    const ext = (file.name.split('.').pop() ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '')
    const path = `${tenantId}/avatars/${userId}.${ext || 'jpg'}`
    setBusy('avatar')
    const { error } = await supabase.storage.from('media')
      .upload(path, file, { upsert: true, contentType: file.type })
    if (error) { setBusy(null); toast.error(t('profile.photo.error'), error.message); return }
    const { error: dbError } = await supabase.from('profiles')
      .update({ avatar_url: path }).eq('id', userId)
    setBusy(null)
    if (dbError) { toast.error(t('profile.photo.error'), dbErrorText(t, dbError)); return }
    // Тот же путь при замене — адрес не меняется, и браузер показал бы
    // старый файл из кеша. Метка времени в запросе снимает это.
    setAvatar(path)
    setBust(Date.now())
    toast.success(t('profile.photo.ok'))
    router.refresh()
  }

  async function dropAvatar() {
    setBusy('avatar')
    // Сначала строка, потом файл: если упадёт удаление файла, экран уже
    // не показывает фото, и человек не видит «удалил, а оно висит».
    // Осиротевший файл в публичном бакете — меньшее зло, чем расхождение.
    await supabase.from('profiles').update({ avatar_url: null }).eq('id', userId)
    if (avatar) await supabase.storage.from('media').remove([avatar])
    setBusy(null)
    setAvatar('')
    router.refresh()
  }

  // ── Чего не хватает ─────────────────────────────────────────────────
  // Полоса «сделай это» показывается ТОЛЬКО когда есть что делать,
  // и ровно одна за раз: список из трёх напоминаний на экране профиля
  // читается как список ошибок, а не как подсказка. Порядок — по цене
  // невыполнения: неопубликованный заклад не виден покупателю вовсе.
  const nudge: { text: string; action: string; run: () => void } | null =
    tenantDraft && canSettings
      ? { text: t('profile.nudge.draft'), action: t('profile.nudge.draft.action'),
          run: () => router.push('/app/settings') }
      : !phone
        ? { text: t('profile.nudge.phone'), action: t('profile.nudge.phone.action'),
            run: () => { setFullName(name); setPhoneVal(phone); setPerson(true) } }
        : !avatar
          ? { text: t('profile.nudge.photo'), action: t('profile.nudge.photo.action'),
              run: () => fileRef.current?.click() }
          : null

  const hasStats = bookingsToday != null && bookingsWeek != null

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
    window.location.href = afterSignOut()
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
    window.location.href = afterSignOut()
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
    window.location.href = afterSignOut()
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

      {/* ── Кто я ────────────────────────────────────────────────
          Разложено по эталону, переданному владельцем 25.08.2026:
          крупное КРУГЛОЕ фото, под ним имя и метка, затем ряд плиток
          с числами, затем полоса «сделай это» с кнопкой, затем чистый
          список строк. Порядок именно такой — сверху то, с чем сюда
          заходят, снизу механика (правило 1 прохода экрана).

          Что взято НЕ дословно и почему: в эталоне три плитки-счётчика
          «публикации / подписчики / подписки». Таких величин в продукте
          нет, и рисовать их пустыми хуже, чем не рисовать вовсе, —
          это уже названо на «Сьогодні» про «Акції» и рейтинг. Плитки
          здесь показывают ЗАПИСИ и только тогда, когда карточка мастера
          привязана к учётной записи, то есть когда «мои записи» —
          осмысленная величина. */}
      <section className="hero rise-1">
        {/* На телефоне столбиком по центру — как в эталоне. На широком
            экране фото уходит влево, а имя встаёт рядом: центрованная
            колонка посреди карточки в 1100px читается как пустая
            страница с человеком в середине. */}
        <div className="flex flex-col items-center text-center lg:flex-row lg:gap-5 lg:text-left">
        <div className="relative shrink-0">
          {/* Фото — 96px. `img`, а не `next/image`: адрес приходит из
              хранилища с меткой времени после замены, и оптимизатор
              Next кешировал бы прошлое фото по тому же ключу. */}
          <span className="profile-photo">
            {avatarSrc
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={avatarSrc} alt="" width={96} height={96} />
              : <span className="profile-photo-letter">{initial || <IconUser size={34} />}</span>}
          </span>
          <button type="button" className="profile-photo-edit"
                  disabled={busy === 'avatar'}
                  aria-label={avatar ? t('profile.photo.change') : t('profile.photo.add')}
                  onClick={() => fileRef.current?.click()}>
            <IconPlus size={16} />
          </button>
        </div>
        {/* Поле выбора файла живёт ОДНО на экран: и кнопка на фото,
            и полоса «Додайте фото» жмут его же. Второй `input`
            разошёлся бы с первым по списку принимаемых типов. */}
        <input ref={fileRef} type="file" accept="image/*" hidden onChange={pickAvatar} />

        <div className="min-w-0 lg:flex-1">
          <p className="display t-xl mt-3 max-w-full truncate lg:mt-0">{name || t('common.noName')}</p>
          <p className="mt-1 flex flex-wrap items-center justify-center gap-2 lg:justify-start">
            <span className="badge-accent">{roleLabel(t, role)}</span>
            {tenantName && <span className="badge">{tenantName}</span>}
            {tenantDraft && <span className="badge-warn">{t('profile.badge.draft')}</span>}
          </p>
          {joinedAt && (
            <p className="t-xs mt-2" style={{ color: 'var(--color-faint)' }}>
              {t('profile.joined', { date: t.date(joinedAt) })}
            </p>
          )}
        </div>
        </div>

        {hasStats && (
          <div className="mt-4 grid w-full grid-cols-2 gap-2">
            {/* Плитка ведёт в записи: число на экране обязано иметь
                выход, иначе оно читается как нажимаемое и не работает
                (проверка 2). */}
            <Link href="/app/bookings" className="stat-tile items-center text-center">
              <span className="stat-tile-value">{t.number(bookingsToday ?? 0)}</span>
              <span className="stat-tile-label">{t('profile.stats.today')}</span>
            </Link>
            <Link href="/app/bookings?view=week" className="stat-tile items-center text-center">
              <span className="stat-tile-value">{t.number(bookingsWeek ?? 0)}</span>
              <span className="stat-tile-label">{t('profile.stats.week')}</span>
            </Link>
          </div>
        )}

        <div className="mt-3 w-full border-t pt-1 text-left"
             style={{ borderColor: 'var(--color-border)' }}>
          <Quiet label={t('profile.account.email')} value={email} />
          <Quiet label={t('profile.account.phone')} value={phone || '—'} />
        </div>

        <button type="button" className="btn-secondary mt-3 w-full"
                onClick={() => { setFullName(name); setPhoneVal(phone); setPerson(true) }}>
          {t('profile.edit')}
        </button>
      </section>

      {/* ── Чего не хватает ──────────────────────────────────────
          Из эталона: полоса с текстом и кнопкой прямо под шапкой.
          У нас она не рекламная, а рабочая — говорит ровно то, чего
          не хватает ИМЕННО ЗДЕСЬ, и исчезает, когда всё на месте.
          Одна за раз: три подсказки подряд читаются как список
          ошибок (проверка 3 — пустое состояние ОДНО). */}
      {nudge && (
        <section className="nudge rise-1">
          <span aria-hidden className="nudge-icon"><IconAlert size={18} /></span>
          <span className="t-sm min-w-0 flex-1">{nudge.text}</span>
          <button type="button" className="btn-secondary shrink-0" onClick={nudge.run}>
            {nudge.action}
          </button>
        </section>
      )}

      {/* ── Что здесь можно сделать ───────────────────────────────
          Один вид строки на все три действия (`ActionRow`), а не три
          похожие разметки: копии уже расходились в этом проекте, и
          расходятся они не оформлением. */}
      <section className="card rise-2 !p-0">
        <ActionRow icon={<IconLock size={18} />}
                   title={t('profile.password.title')} desc={t('profile.password.desc')}
                   onClick={() => setPass(true)} />
        <ActionRow icon={<IconMail size={18} />}
                   title={t('profile.email.title')} desc={t('profile.email.desc')}
                   onClick={() => setMail(true)} />
        {/* Без `settings.read` страница разворачивает на `/app`. Ссылка,
            ведущая в редирект, читается как поломка — прячем целиком:
            пункт, который ничего не открывает, хуже отсутствующего.

            ⚠️ И `lg:hidden` — ЭТО СНЯТЫЙ ДУБЛЬ. На широком экране
            «Налаштування» стоят пунктом сайдбара всегда (FIXED_BOTTOM
            в `components/app-shell.tsx`, то же право `settings.read`),
            то есть дверь в один и тот же экран лежала на виду дважды.
            На телефоне сайдбара нет — там строка остаётся. */}
        {canSettings && (
          <ActionRow href="/app/settings" className="lg:hidden"
                     icon={<IconGear size={18} />}
                     title={t('profile.settings.title')} desc={t('profile.settings.desc')} />
        )}
      </section>

      {/* «Прибрати фото» — строкой здесь, а не крестиком на самом фото:
          действие редкое, и место рядом с частым («змінити») ему
          не положено. Появляется только когда фото есть. */}
      {avatar && (
        <button type="button" onClick={() => void dropAvatar()}
                className="btn-ghost self-start" disabled={busy === 'avatar'}>
          {t('profile.photo.remove')}
        </button>
      )}

      </div>

      {/* ── Правая колонка: вид и выход ─────────────────────────────── */}
      <div className="flex flex-col gap-4">

      {/* ── Вигляд ───────────────────────────────────────────────
          Три настройки одного рода («как мне это видно») лежат ОДНОЙ
          карточкой и одинаковыми строками `.setting-row` — теми же,
          что под аватаром. Было три карточки трёх разных форм подряд,
          и соседние настройки читались как разные разделы.

          Дублем шторки под аватаром это не стало и не станет: набор
          здесь тот же по решению владельца (тема и выход — 15.08.2026,
          размер текста «под аватаром И на экране профиля» — 18.08.2026).
          Одинаковая раскладка — это и есть то, что делает два входа
          одним местом, а не двумя разными настройками. */}
      <section className="card rise-3">
        <h2 className="eyebrow mb-1">{t('profile.view.title')}</h2>
        <div className="setting-row">
          <span className="setting-label">{t('theme.aria')}</span>
          <ThemeToggle />
        </div>
        <div className="setting-row">
          <span className="setting-label">{t('app.lang.aria')}</span>
          <LangSwitch />
        </div>
        <div className="mt-1 border-t pt-3" style={{ borderColor: 'var(--color-border)' }}>
          <TextSize />
        </div>
      </section>

      {/* ── Выход ────────────────────────────────────────────────
          Выход — ОДНА кнопка. «На всіх пристроях» и «Видалити акаунт»
          ушли в свёрнутое: это действия раз в жизни, а стояли они тем
          же весом, что ежедневный выход, и вдобавок голыми ссылками
          на пустом фоне — так выглядит незаконченный экран, а не блок.

          На широком экране карточка (§17 хендоффа): три кнопки на
          пустой колонке 392px висели в воздухе. */}
      <section className="flex flex-col gap-2 rise-3 lg:rounded-2xl lg:border lg:border-[var(--color-border)] lg:bg-[var(--color-surface)] lg:p-4">
        <button type="button" onClick={() => void signOut()}
                className="btn-secondary flex items-center justify-center gap-2">
          <IconExit size={18} /> {t('profile.signOut')}
        </button>
        <Fold title={t('profile.more')} open={more} onToggle={() => setMore((v) => !v)}>
          <div className="flex flex-col gap-2">
            <button type="button" onClick={() => void signOutEverywhere()}
                    className="btn-ghost">
              {t('profile.signOutAll')}
            </button>
            <button type="button" onClick={() => setKill(true)} className="btn-ghost"
                    style={{ color: 'var(--color-danger)' }}>
              {t('profile.delete.open')}
            </button>
          </div>
        </Fold>
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
