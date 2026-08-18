'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { CodeInput } from '@/app/m/code-input'
import { MailIcon, PasswordInput, mmss } from '@/components/auth-ui'
import { IconArrowRight, IconCheck, IconScissors, IconUser, IconUsers } from '@/components/icons'
import { humanAuthError, codeErrorText } from '@/lib/auth-errors'
import { signupSource } from '@/lib/consent'
import { LEGAL_VERSION, LEGAL_DOCS } from '@/lib/legal'
import { guardSignUp } from '@/lib/ratelimit/guard'
import { useT } from '@/lib/i18n/client'
import type { Key } from '@/lib/i18n/dict'

// ── МАСТЕР РЕГИСТРАЦИИ ПРОДАВЦА ────────────────────────────────────────────
//
// Переписан 18.08.2026 по макетам «регистрация салона» и «регистрация
// мастера». Было: две страницы — почта с паролем, затем название заведения,
// вид и город. Человек попадал в кабинет за полторы минуты и с пустым
// заведением: без расписания, без специальности, без мастеров. Дальше он
// сам искал, где это завести, а поиск по специальности его не находил.
//
// ЗАЧЕМ СЕМЬ ШАГОВ ВМЕСТО ДВУХ. Не ради «правильного онбординга», а потому
// что ровно эти данные нужны продукту, чтобы работать:
//
//   • СПЕЦИАЛЬНОСТЬ из справочника — единственный способ найти заведение
//     поиском. «Перукар», «парикмахер», «барбер» и «стрижка» — один мастер,
//     а покупатель наберёт любое из четырёх; синонимы живут в справочнике
//     и попадают в поисковый вектор триггером `tenants_search_refresh`.
//     Свободный текст в поиске не работает — это записано в CLAUDE.md.
//   • ГРАФИК РАБОТЫ — без него `available_slots` не отдаст ни одного слота,
//     то есть кнопка «Записатися» на витрине не покажет ничего.
//   • МАСТЕРА — запись ставится к мастеру, а не к заведению; без строки
//     в `staff` записываться не к кому.
//
// То есть шаг, который здесь пропустят, превращается в сломанную функцию
// через неделю. Поэтому пропуск разрешён ровно там, где он безвреден
// (услуги, мастера), и не разрешён там, где нет.
//
// ── ГДЕ СОЗДАЁТСЯ ЗАВЕДЕНИЕ ────────────────────────────────────────────────
// В САМОМ КОНЦЕ, одним `finish()`. Соблазн создать его сразу после ввода
// названия велик — тогда фото можно загрузить на том же шаге. Но брошенный
// на середине мастер оставил бы полупустой заклад, а `register_tenant`
// разрешает не больше трёх черновиков на человека: три брошенные попытки —
// и четвёртая регистрация падает с ошибкой, которую человек не поймёт.
//
// Плата за это одна: фото выбирается на своём шаге, а уезжает в хранилище
// после создания — путь в бакете начинается с `tenant_id` (правило 1),
// и до создания его физически нет. Для человека разницы нет.
//
// ── ПОЧЕМУ САЛОН И МАСТЕР — ОДИН ФАЙЛ ──────────────────────────────────────
// У них общие пять шагов из семи и один и тот же итог: `tenants` +
// `tenant_members` + `staff` + `working_hours`. Разводить их по двум файлам
// значит завести две копии логики создания заведения, а копии разъезжаются
// (CLAUDE.md → «Общий слой вместо паритета»). Различие — состав шагов,
// и оно объявлено данными: массив `FLOW`.

export type Speciality = { id: string; name: string; kind: string | null }

type Role = 'salon' | 'master'
type StepId =
  | 'role' | 'account' | 'code' | 'about' | 'address'
  | 'spec' | 'services' | 'schedule' | 'staff' | 'done'

// Состав шагов — данные, а не ветвление в разметке. Счётчик «Крок N з M»
// считается отсюда же, поэтому он не может соврать: добавили шаг — номер
// поехал сам.
const FLOW: Record<Role, StepId[]> = {
  salon: ['role', 'account', 'code', 'about', 'address', 'services', 'schedule', 'staff', 'done'],
  master: ['role', 'account', 'code', 'about', 'spec', 'services', 'schedule', 'done'],
}

const RESEND_SECONDS = 60
const CODE_LENGTH = 6

// Понедельник первым: неделя в Украине начинается с него, и график,
// начинающийся с воскресенья, читается как чужой.
const WEEK = [1, 2, 3, 4, 5, 6, 7] as const
type Day = { on: boolean; from: string; to: string; breakFrom: string; breakTo: string }

const DEFAULT_WEEK: Record<number, Day> = {
  1: { on: true, from: '09:00', to: '19:00', breakFrom: '', breakTo: '' },
  2: { on: true, from: '09:00', to: '19:00', breakFrom: '', breakTo: '' },
  3: { on: true, from: '09:00', to: '19:00', breakFrom: '', breakTo: '' },
  4: { on: true, from: '09:00', to: '19:00', breakFrom: '', breakTo: '' },
  5: { on: true, from: '09:00', to: '19:00', breakFrom: '', breakTo: '' },
  6: { on: true, from: '10:00', to: '16:00', breakFrom: '', breakTo: '' },
  7: { on: false, from: '10:00', to: '16:00', breakFrom: '', breakTo: '' },
}

type Staff = { name: string; title: string }

export function SellerWizard({
  specialities, next,
}: { specialities: Speciality[]; next: string }) {
  const t = useT()
  const supabase = createClient()

  const [role, setRole] = useState<Role>('salon')
  const [step, setStep] = useState<StepId>('role')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  // Уже вошёл — акаунт создавать не надо.
  //
  // Так сюда попадают трое: человек с адресом возврата
  // `?next=/register/seller`, покупатель, решивший открыть заклад, и тот,
  // кто бросил мастера на середине и вернулся. Всем троим форма пароля
  // означала бы «зарегистрируйтесь ещё раз», а `signUp` на занятую почту
  // молча ничего не сделает — человек застрянет на первом шаге навсегда.
  // Это поведение было в прежней двухшаговой форме; здесь оно
  // восстановлено, а не придумано.
  //
  // Имя берём из метаданных токена: на шаге «Готово» им подписывается
  // заклад мастера, и пустая строка дала бы заведение без названия.
  const [signedIn, setSignedIn] = useState(false)
  useEffect(() => {
    let alive = true
    void createClient().auth.getUser().then(({ data }) => {
      if (!alive || !data.user) return
      const meta = data.user.user_metadata as Record<string, string> | undefined
      setSignedIn(true)
      setEmail(data.user.email ?? '')
      setFirst((v) => v || (meta?.first_name ?? ''))
      setLast((v) => v || (meta?.last_name ?? ''))
    })
    return () => { alive = false }
  }, [])

  // ── Шаг «акаунт» ─────────────────────────────────────────
  const [first, setFirst] = useState('')
  const [last, setLast] = useState('')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')
  const [agree, setAgree] = useState(false)

  // ── Шаг «код» ────────────────────────────────────────────
  const [code, setCode] = useState('')
  const [codeError, setCodeError] = useState('')
  const [left, setLeft] = useState(0)

  // ── Шаг «про заклад» ─────────────────────────────────────
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [phone, setPhone] = useState('')
  const [instagram, setInstagram] = useState('')
  const [site, setSite] = useState('')
  const [city, setCity] = useState('')
  const [photo, setPhoto] = useState<File | null>(null)
  const [photoUrl, setPhotoUrl] = useState('')

  // ── Шаг «адреса» (только салон) ──────────────────────────
  const [street, setStreet] = useState('')
  const [house, setHouse] = useState('')
  const [room, setRoom] = useState('')

  // ── Шаги «спеціальність» и «послуги» ─────────────────────
  const [specId, setSpecId] = useState('')
  const [specQuery, setSpecQuery] = useState('')
  const [specNote, setSpecNote] = useState('')
  const [services, setServices] = useState<string[]>([])

  // ── Шаг «графік» ─────────────────────────────────────────
  const [week, setWeek] = useState<Record<number, Day>>(DEFAULT_WEEK)

  // ── Шаг «команда» (только салон) ─────────────────────────
  const [staff, setStaff] = useState<Staff[]>([{ name: '', title: '' }])

  // Вошедшему шаги «акаунт» и «код» не показываются — и счётчик «Крок N з M»
  // считается по тому же массиву, поэтому он не обещает семь экранов там,
  // где их пять.
  const flow = useMemo(
    () => FLOW[role].filter((s) => !(signedIn && (s === 'account' || s === 'code'))),
    [role, signedIn],
  )
  const index = Math.max(0, flow.indexOf(step))
  // Экран «Хто ви?» и экран успеха номера не получают: первый — это ещё
  // не шаг заполнения, второй — уже не шаг. Считаем то, что между ними.
  const total = flow.length - 2

  // Услуги показываем ТОЛЬКО услуговые специальности: «Автозапчастини»
  // и «Одяг» в списке «які послуги надаєте» — это не выбор, это шум.
  //
  // Значения перечисления — `service` и `product` (0020). Не `goods`:
  // так называется вид ЗАВЕДЕНИЯ (`tenant_kind`), и перепутать их легко —
  // фильтр по `goods` молча пропускал весь справочник, и на шаге услуг
  // салона стояли «Хендмейд» и «Дитяче». Поймано снимком экрана.
  const serviceSpecs = useMemo(
    () => specialities.filter((s) => s.kind === 'service'),
    [specialities],
  )
  const specMatches = useMemo(() => {
    const q = specQuery.trim().toLowerCase()
    if (!q) return serviceSpecs
    return serviceSpecs.filter((s) => s.name.toLowerCase().includes(q))
  }, [serviceSpecs, specQuery])

  function go(to: StepId) { setError(''); setStep(to) }
  function nextStep() { go(flow[Math.min(index + 1, flow.length - 1)]) }
  function prevStep() { go(flow[Math.max(index - 1, 0)]) }

  // Отсчёт до повторной отправки кода. Интервал живёт ровно столько,
  // сколько идёт отсчёт: вечный таймер на экране, где он не нужен, —
  // это работа в фоне ни для чего.
  function startCountdown() {
    setLeft(RESEND_SECONDS)
    const id = setInterval(() => {
      setLeft((v) => {
        if (v <= 1) { clearInterval(id); return 0 }
        return v - 1
      })
    }, 1000)
  }

  // ── Создание акаунта ─────────────────────────────────────
  async function submitAccount(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    if (password !== confirm) { setError(t('reg.account.mismatch')); return }
    setBusy(true); setError('')

    // Тот же предел, что и на `/register`: это вторая форма ОДНОГО
    // действия, и считать их по разным счётчикам значило бы отдать
    // шесть регистраций в час вместо трёх.
    const gate = await guardSignUp()
    if (!gate.ok) { setBusy(false); setError(gate.message); return }

    const { data, error: err } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          first_name: first.trim(),
          last_name: last.trim(),
          full_name: `${first.trim()} ${last.trim()}`.trim(),
          locale: 'uk',
          timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          // Версия документов уходит вместе с регистрацией: триггер
          // handle_new_user кладёт её в журнал согласий. Галочка без
          // этой строки — картинка, а не согласие.
          terms_version: LEGAL_VERSION,
          signup_source: signupSource(),
        },
      },
    })
    setBusy(false)
    if (err) { setError(humanAuthError(t, err.message)); return }

    // Подтверждение почты отключено в настройках — сессия выдана сразу,
    // и шаг с кодом становится лишним экраном.
    if (data.session) { go('about'); return }
    startCountdown()
    go('code')
  }

  async function verify(v: string) {
    if (busy) return
    setBusy(true); setCodeError('')
    const { error: err } = await supabase.auth.verifyOtp({
      email: email.trim(), token: v, type: 'signup',
    })
    setBusy(false)
    if (err) { setCodeError(codeErrorText(t, err.message)); setCode(''); return }
    go('about')
  }

  async function resend() {
    if (left > 0 || busy) return
    setBusy(true); setError(''); setCodeError('')
    const { error: err } = await supabase.auth.resend({ type: 'signup', email: email.trim() })
    setBusy(false)
    if (err) { setError(humanAuthError(t, err.message)); return }
    startCountdown()
  }

  function pickPhoto(file: File | null) {
    setPhoto(file)
    setPhotoUrl(file ? URL.createObjectURL(file) : '')
  }

  // ── Создание заведения ───────────────────────────────────
  //
  // Порядок важен: сначала `register_tenant` (он же выдаёт членство),
  // потом обновление реквизитов, затем мастера и график, и только
  // в конце `refreshSession` — членство и права попадают в токен
  // только при следующей его выдаче. Без обновления сессии кабинет
  // откроется без прав и развернёт человека на регистрацию заново.
  async function finish() {
    if (busy) return
    setBusy(true); setError('')

    const tenantName = role === 'salon'
      ? name.trim()
      : `${first.trim()} ${last.trim()}`.trim()

    const { data: tenant, error: regErr } = await supabase
      .rpc('register_tenant', {
        p_name: tenantName,
        // Салон и мастер продают услуги; товары включаются модулем
        // `catalog` в кабинете, и вид заведения там же меняется.
        p_kind: 'services',
        p_city: city.trim() || null,
      })
      .select('id')
      .single<{ id: string }>()

    if (regErr || !tenant) {
      setBusy(false)
      setError(regErr?.message ?? t('reg.saving'))
      return
    }

    const tenantId = tenant.id

    // ⚠️ ГРАБЛИ, СТОИВШИЕ ЗАВЕДЕНИЯ БЕЗ АДРЕСА, МАСТЕРОВ И ГРАФИКА.
    //
    // Обновить сессию нужно ЗДЕСЬ, а не после всех записей. Права в этом
    // проекте берутся ИЗ ТОКЕНА, а не из таблицы (правило 3): политики
    // спрашивают `tenants_with('settings.write')`, и она разбирает
    // `request.jwt.claims`. `register_tenant` дописал членство в базу,
    // но в токене его ещё нет — он был выдан до регистрации заведения.
    //
    // Что происходило без этой строки: `update tenants` отбивался RLS
    // МОЛЧА (UPDATE, не нашедший ни одной доступной строки, — это ноль
    // строк, а не ошибка), `insert staff` падал, график не писался вовсе.
    // Заведение создавалось, экран показывал «Салон успішно створено!»
    // и сводку из полей формы — то есть врал: в базе не было ничего,
    // кроме названия и города. Поймано запросом к базе после прохода
    // мастера, глазами это не видно.
    await supabase.auth.refreshSession()

    // Реквизиты. Отдельным обновлением, а не параметрами
    // `register_tenant`: у функции их четыре, и расширять её сигнатуру
    // ради формы — значит менять миграцию при каждой правке экрана.
    const address = [street.trim(), house.trim() && `буд. ${house.trim()}`, room.trim() && `прим. ${room.trim()}`]
      .filter(Boolean).join(', ')

    const { error: updErr } = await supabase.from('tenants').update({
      tagline: desc.trim() || null,
      contact_phone: phone.trim() || null,
      address: address || null,
      speciality_id: specId || services[0] || null,
      // Свободный текст плюс остальные выбранные направления: и то,
      // и другое идёт в поисковый вектор весом ниже справочника.
      speciality_note: [
        specNote.trim(),
        ...services
          .filter((id) => id !== (specId || services[0]))
          .map((id) => specialities.find((s) => s.id === id)?.name ?? ''),
      ].filter(Boolean).join(', ') || null,
    }).eq('id', tenantId)

    // Мастера. Владелец-одиночка тоже становится строкой в `staff`:
    // запись ставится к мастеру, а не к заведению, и без этой строки
    // записываться не к кому.
    const people: Staff[] = role === 'master'
      ? [{ name: `${first.trim()} ${last.trim()}`.trim(), title: specialities.find((s) => s.id === specId)?.name ?? '' }]
      : staff.filter((s) => s.name.trim())

    const rows = people.length > 0 ? people : [{ name: tenantName, title: '' }]
    const { data: created, error: staffErr } = await supabase.from('staff')
      .insert(rows.map((p, i) => ({
        tenant_id: tenantId, name: p.name.trim(), title: p.title.trim() || null, position: i + 1,
      })))
      .select('id')

    // График — каждому заведённому мастеру. Перерыв записывается не
    // третьим полем, а РАЗРЫВОМ: две строки на день вместо одной.
    // Так его понимает `available_slots`, и отдельного поля под него
    // в `working_hours` нет намеренно.
    const hours: { tenant_id: string; staff_id: string; weekday: number; starts_at: string; ends_at: string }[] = []
    for (const s of created ?? []) {
      for (const d of WEEK) {
        const day = week[d]
        if (!day.on) continue
        if (day.breakFrom && day.breakTo) {
          hours.push({ tenant_id: tenantId, staff_id: s.id, weekday: d, starts_at: day.from, ends_at: day.breakFrom })
          hours.push({ tenant_id: tenantId, staff_id: s.id, weekday: d, starts_at: day.breakTo, ends_at: day.to })
        } else {
          hours.push({ tenant_id: tenantId, staff_id: s.id, weekday: d, starts_at: day.from, ends_at: day.to })
        }
      }
    }
    const { error: hoursErr } = hours.length > 0
      ? await supabase.from('working_hours').insert(hours)
      : { error: null }

    // Заведение уже создано, и возвращать человека назад поздно. Но
    // молчать нельзя: экран «створено!» рядом с пустым закладом — это
    // ровно та ложь, ради которой здесь стоит `refreshSession` выше.
    // Пишем, ЧТО именно не записалось, и отправляем в кабинет — там
    // это дозаполняется руками.
    const failed = [updErr, staffErr, hoursErr].filter(Boolean)
    if (failed.length > 0) setError(failed[0]!.message)

    // Фото — последним: заведение уже есть, значит есть и путь.
    // Ошибка загрузки НЕ отменяет регистрацию: кабинет создан, и
    // разворачивать человека назад из-за картинки нельзя.
    if (photo) {
      const mime = photo.type || 'image/jpeg'
      const ext = mime === 'image/png' ? 'png' : mime === 'image/webp' ? 'webp' : 'jpg'
      const path = `${tenantId}/logo/${Date.now().toString(36)}.${ext}`
      const up = await supabase.storage.from('media')
        .upload(path, photo, { contentType: mime, upsert: false })
      if (up.error) setError(t('reg.done.photoFailed'))
      else await supabase.from('tenants').update({ logo_path: path }).eq('id', tenantId)
    }

    setBusy(false)
    setStep('done')
  }

  // ── Общая обёртка шага ───────────────────────────────────
  const shell = (title: string, sub: string, body: React.ReactNode, foot?: React.ReactNode) => (
    <>
      <h1 className="wiz-title">{title}</h1>
      {sub && <p className="wiz-sub">{sub}</p>}
      <div className="mt-7 flex flex-col gap-4">{body}</div>
      {error && <p className="field-error mt-4">{error}</p>}
      {foot}
      {step !== 'role' && step !== 'done' && (
        <div className="wiz-progress" aria-hidden>
          {Array.from({ length: total }, (_, i) => (
            <span key={i} className="wiz-progress-seg" data-done={i < index} />
          ))}
        </div>
      )}
    </>
  )

  const backBtn = (
    <button type="button" className="btn-ghost" onClick={prevStep} disabled={busy}>
      {t('reg.back')}
    </button>
  )

  return (
    <div className="wiz">
      <div className="wiz-top">
        <Link href="/" className="land-brand" style={{ fontSize: 19 }}>
          CRESKO<span aria-hidden className="land-brand-dot" />
        </Link>
        <span className="wiz-top-title">
          {step === 'role' ? t('reg.role.badge') : t(`reg.flow.${role}` as Key)}
        </span>
        {step === 'role' || step === 'done' ? (
          <Link href="/login" className="btn-ghost t-sm">{t('reg.role.signIn')}</Link>
        ) : (
          <span className="wiz-step">{t('reg.step', { n: String(index), total: String(total) })}</span>
        )}
      </div>

      <main className="wiz-main">
        <div className="wiz-col" data-wide={step === 'role'}>

          {/* ── Хто ви? ─────────────────────────────────────── */}
          {step === 'role' && shell(t('reg.role.title'), t('reg.role.sub'), (
            <>
              <div className="role-grid">
                {([
                  ['salon', IconUsers, ['reg.role.salon.f1', 'reg.role.salon.f2', 'reg.role.salon.f3', 'reg.role.salon.f4', 'reg.role.salon.f5']],
                  ['master', IconUser, ['reg.role.master.f1', 'reg.role.master.f2', 'reg.role.master.f3', 'reg.role.master.f4', 'reg.role.master.f5']],
                ] as [Role, (p: { size?: number }) => React.ReactElement, Key[]][]).map(([r, Icon, feats]) => (
                  <div key={r} className="role-card">
                    <span className="role-icon"><Icon size={40} /></span>
                    <h2 className="t-xl display">{t(`reg.role.${r}.title` as Key)}</h2>
                    <p className="t-sm prose-muted">{t(`reg.role.${r}.text` as Key)}</p>
                    <div className="role-list">
                      {feats.map((f) => (
                        <span key={f} className="role-list-item">
                          <span className="role-check" aria-hidden>✓</span>{t(f)}
                        </span>
                      ))}
                    </div>
                    <button type="button" className="btn-primary w-full"
                            onClick={() => { setRole(r); go(signedIn ? 'about' : 'account') }}>
                      {t(`reg.role.${r}.cta` as Key)} <IconArrowRight />
                    </button>
                  </div>
                ))}
              </div>
              <p className="t-sm mt-2 text-center prose-muted">{t('reg.role.help')}</p>
              <p className="t-sm text-center prose-muted">
                {t('reg.role.haveAccount')}{' '}
                <Link href="/login" className="underline underline-offset-2">{t('reg.role.signIn')}</Link>
              </p>
            </>
          ))}

          {/* ── Акаунт ──────────────────────────────────────── */}
          {step === 'account' && shell(
            t(`reg.account.title.${role}` as Key),
            t(`reg.account.sub.${role}` as Key),
            <form onSubmit={submitAccount} className="flex flex-col gap-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="field-label" htmlFor="first">{t('reg.account.firstName')}</label>
                  <input id="first" className="input" required value={first}
                         autoComplete="given-name" placeholder={t('reg.account.firstName.ph')}
                         onChange={(e) => setFirst(e.target.value)} />
                </div>
                <div>
                  <label className="field-label" htmlFor="last">{t('reg.account.lastName')}</label>
                  <input id="last" className="input" required value={last}
                         autoComplete="family-name" placeholder={t('reg.account.lastName.ph')}
                         onChange={(e) => setLast(e.target.value)} />
                </div>
              </div>

              <div>
                <label className="field-label" htmlFor="email">{t('reg.account.email')}</label>
                <input id="email" type="email" className="input" required value={email}
                       autoComplete="email" placeholder="name@example.com"
                       onChange={(e) => setEmail(e.target.value)} />
              </div>

              <div>
                <label className="field-label" htmlFor="pass">{t('auth.field.password')}</label>
                <PasswordInput id="pass" value={password} onChange={setPassword}
                               autoComplete="new-password" />
              </div>

              <div>
                <label className="field-label" htmlFor="pass2">{t('reg.account.password2')}</label>
                <PasswordInput id="pass2" value={confirm} onChange={setConfirm}
                               autoComplete="new-password"
                               invalid={confirm.length > 0 && confirm !== password} />
              </div>

              {/* Согласие с ВЕРСИЕЙ документов: без `terms_version` запись
                  в журнале согласий не значит ничего. Ссылки открываются —
                  галочка над нечитаемым текстом это повод для отказа
                  и в App Store, и у Meta при верификации бизнеса. */}
              <label className="checkline">
                <input type="checkbox" checked={agree}
                       onChange={(e) => setAgree(e.target.checked)} />
                <span>
                  {t('auth.register.agree.lead')}{' '}
                  {LEGAL_DOCS.map((d, i) => (
                    <span key={d.href}>
                      <Link href={d.href}>{d.label.toLowerCase()}</Link>
                      {i < LEGAL_DOCS.length - 2
                        ? ', '
                        : i === LEGAL_DOCS.length - 2 ? ` ${t('auth.register.agree.and')} ` : ''}
                    </span>
                  ))}
                  .
                </span>
              </label>

              <div className="flex gap-2">
                {backBtn}
                <button className="btn-primary flex-1"
                        disabled={busy || !agree || password.length < 8 || password !== confirm}>
                  {busy ? t('reg.busy') : t('reg.next')}
                </button>
              </div>
            </form>,
          )}

          {/* ── Код із листа ────────────────────────────────── */}
          {step === 'code' && shell(
            t('reg.code.title'),
            t('auth.code.sentTo', { email: email.trim(), n: String(CODE_LENGTH) }),
            <>
              <CodeInput
                value={code} disabled={busy} invalid={!!codeError} length={CODE_LENGTH}
                onChange={(v) => {
                  setCode(v); setCodeError('')
                  if (v.length === CODE_LENGTH) void verify(v)
                }}
              />
              {codeError && <p className="field-error text-center">{codeError}</p>}

              <p className="t-sm text-center prose-muted">
                {left > 0 ? t('auth.code.resendIn', { time: mmss(left) }) : t('auth.code.resendReady')}
              </p>

              <button type="button" className="btn-primary"
                      disabled={busy || code.length !== CODE_LENGTH}
                      onClick={() => void verify(code)}>
                {busy ? t('auth.code.checking') : t('auth.code.submit')}
              </button>
              <button type="button" className="btn-ghost" disabled={left > 0 || busy}
                      onClick={() => void resend()}>
                {t('auth.code.resend')}
              </button>

              <div className="card-flat flex items-start gap-3">
                <span style={{ color: 'var(--color-accent-ink)' }}><MailIcon size={22} /></span>
                <span>
                  <span className="t-md block" style={{ fontWeight: 650 }}>{t('reg.code.noMail.title')}</span>
                  <span className="t-sm prose-muted">{t('reg.code.noMail.text')}</span>
                </span>
              </div>
            </>,
          )}

          {/* ── Про заклад / про себе ───────────────────────── */}
          {step === 'about' && shell(
            t(`reg.about.${role}.title` as Key),
            t(`reg.about.${role}.sub` as Key),
            <>
              <label className="photo-drop cursor-pointer">
                {photoUrl
                  ? <img src={photoUrl} alt="" />
                  : <span className="t-xs px-3">{t(`reg.about.photo.${role}` as Key)}</span>}
                <input type="file" accept="image/*" className="hidden"
                       onChange={(e) => pickPhoto(e.target.files?.[0] ?? null)} />
              </label>
              <p className="t-xs -mt-2 text-center prose-muted">{t('reg.about.photo.hint')}</p>

              {role === 'salon' && (
                <div>
                  <label className="field-label" htmlFor="name">{t('reg.about.name')}</label>
                  <input id="name" className="input" required minLength={2} value={name}
                         placeholder={t('reg.about.name.ph')}
                         onChange={(e) => setName(e.target.value)} />
                </div>
              )}

              <div>
                <label className="field-label" htmlFor="desc">{t('reg.about.desc')}</label>
                <textarea id="desc" className="textarea" maxLength={120} value={desc}
                          placeholder={t(role === 'salon' ? 'reg.about.desc.ph' : 'reg.about.desc.master.ph')}
                          onChange={(e) => setDesc(e.target.value)} />
                <p className="field-hint text-right tabular">{desc.length}/120</p>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="field-label" htmlFor="phone">{t('reg.about.phone')}</label>
                  <input id="phone" className="input" type="tel" value={phone}
                         placeholder="+380 __ ___ __ __" autoComplete="tel"
                         onChange={(e) => setPhone(e.target.value)} />
                </div>
                {role === 'salon' ? (
                  <div>
                    <label className="field-label" htmlFor="ig">{t('reg.about.instagram')}</label>
                    <input id="ig" className="input" value={instagram} placeholder="@your_salon"
                           onChange={(e) => setInstagram(e.target.value)} />
                  </div>
                ) : (
                  <div>
                    <label className="field-label" htmlFor="city">{t('reg.about.city')}</label>
                    <input id="city" className="input" required value={city}
                           placeholder={t('reg.about.city.ph')}
                           onChange={(e) => setCity(e.target.value)} />
                  </div>
                )}
              </div>

              {role === 'salon' && (
                <div>
                  <label className="field-label" htmlFor="site">{t('reg.about.site')}</label>
                  <input id="site" className="input" value={site} placeholder="https://your-salon.com"
                         onChange={(e) => setSite(e.target.value)} />
                </div>
              )}

              <div className="flex gap-2">
                {backBtn}
                <button type="button" className="btn-primary flex-1" onClick={nextStep}
                        disabled={role === 'salon' ? name.trim().length < 2 : city.trim().length < 2}>
                  {t('reg.next')}
                </button>
              </div>
            </>,
          )}

          {/* ── Адреса (салон) ──────────────────────────────── */}
          {step === 'address' && shell(t('reg.address.title'), t('reg.address.sub'), (
            <>
              <div>
                <label className="field-label" htmlFor="country">{t('reg.address.country')}</label>
                {/* Одна страна и выключенный выбор — честнее пустого списка:
                    заведения вне Украины платформа пока не обслуживает. */}
                <input id="country" className="input" value={t('reg.address.country.ua')} readOnly />
              </div>
              <div>
                <label className="field-label" htmlFor="city2">{t('reg.about.city')}</label>
                <input id="city2" className="input" required value={city}
                       placeholder={t('reg.about.city.ph')}
                       onChange={(e) => setCity(e.target.value)} />
              </div>
              <div>
                <label className="field-label" htmlFor="street">{t('reg.address.street')}</label>
                <input id="street" className="input" value={street}
                       placeholder={t('reg.address.street.ph')}
                       onChange={(e) => setStreet(e.target.value)} />
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="field-label" htmlFor="house">{t('reg.address.house')}</label>
                  <input id="house" className="input" value={house}
                         placeholder={t('reg.address.house.ph')}
                         onChange={(e) => setHouse(e.target.value)} />
                </div>
                <div>
                  <label className="field-label" htmlFor="room">{t('reg.address.room')}</label>
                  <input id="room" className="input" value={room}
                         placeholder={t('reg.address.room.ph')}
                         onChange={(e) => setRoom(e.target.value)} />
                </div>
              </div>
              <p className="field-hint">{t('reg.address.note')}</p>
              <div className="flex gap-2">
                {backBtn}
                <button type="button" className="btn-primary flex-1" onClick={nextStep}
                        disabled={city.trim().length < 2}>
                  {t('reg.next')}
                </button>
              </div>
            </>
          ))}

          {/* ── Спеціальність (майстер) ─────────────────────── */}
          {step === 'spec' && shell(t('reg.spec.title'), t('reg.spec.sub'), (
            <>
              <input className="input" value={specQuery} placeholder={t('reg.spec.search')}
                     onChange={(e) => setSpecQuery(e.target.value)} />
              <div className="grid gap-2 sm:grid-cols-2">
                {specMatches.map((s) => (
                  <button key={s.id} type="button" className="pick"
                          data-on={specId === s.id} onClick={() => setSpecId(s.id)}>
                    <span className="pick-box" aria-hidden>✓</span>{s.name}
                  </button>
                ))}
              </div>
              {specMatches.length === 0 && <p className="field-hint">{t('reg.spec.empty')}</p>}

              <div>
                <label className="field-label" htmlFor="specnote">{t('reg.spec.own')}</label>
                <textarea id="specnote" className="textarea" maxLength={120} value={specNote}
                          placeholder={t('reg.spec.own.ph')}
                          onChange={(e) => setSpecNote(e.target.value)} />
              </div>

              {/* Дальше пускает ЛИБО справочник, ЛИБО своё описание.
                  Требовать только справочник — тупик: в нём одиннадцать
                  услуговых строк, и «Інше» среди них нет (оно заведено
                  товарным). Мастер, чьей специальности там не оказалось,
                  упирался в выключенную кнопку и уйти мог только назад. */}
              <div className="flex gap-2">
                {backBtn}
                <button type="button" className="btn-primary flex-1" onClick={nextStep}
                        disabled={!specId && specNote.trim().length < 3}>
                  {t('reg.next')}
                </button>
              </div>
            </>
          ))}

          {/* ── Послуги ─────────────────────────────────────── */}
          {step === 'services' && shell(
            t(`reg.services.${role}.title` as Key),
            t(`reg.services.${role}.sub` as Key),
            <>
              <div className="grid gap-2 sm:grid-cols-2">
                {serviceSpecs.map((s) => {
                  const on = services.includes(s.id)
                  return (
                    <button key={s.id} type="button" className="pick" data-on={on}
                            onClick={() => setServices(on
                              ? services.filter((x) => x !== s.id)
                              : [...services, s.id])}>
                      <span className="pick-box" aria-hidden>✓</span>{s.name}
                    </button>
                  )
                })}
              </div>
              <p className="field-hint">{t('reg.services.later')}</p>
              <div className="flex gap-2">
                {backBtn}
                <button type="button" className="btn-primary flex-1" onClick={nextStep}>
                  {t('reg.next')}
                </button>
              </div>
              <button type="button" className="btn-ghost" onClick={nextStep}>
                {t('reg.services.skip')}
              </button>
            </>,
          )}

          {/* ── Графік роботи ───────────────────────────────── */}
          {step === 'schedule' && shell(
            t(`reg.schedule.${role}.title` as Key),
            t(`reg.schedule.${role}.sub` as Key),
            <>
              <div>
                {WEEK.map((d) => {
                  const day = week[d]
                  const set = (patch: Partial<Day>) =>
                    setWeek({ ...week, [d]: { ...day, ...patch } })
                  return (
                    <div key={d} className="day-row">
                      <span className="day-name">{t(`reg.schedule.day.${d}` as Key)}</span>
                      <button type="button" className="switch" data-on={day.on}
                              aria-label={t(`reg.schedule.day.${d}` as Key)}
                              aria-pressed={day.on}
                              onClick={() => set({ on: !day.on })} />
                      {day.on ? (
                        <>
                          <input type="time" className="input" value={day.from}
                                 onChange={(e) => set({ from: e.target.value })} />
                          <span className="text-center prose-muted">–</span>
                          <input type="time" className="input" value={day.to}
                                 onChange={(e) => set({ to: e.target.value })} />

                          {/* Перерыв. В базе он не поле, а РАЗРЫВ: два отрезка
                              на день вместо одного (см. `finish()`). Поэтому
                              и здесь он не «время обеда», а вторая пара «с — до». */}
                          {day.breakFrom && day.breakTo ? (
                            <span className="day-break">
                              <span className="day-break-label">{t('reg.schedule.break')}</span>
                              <input type="time" className="input" value={day.breakFrom}
                                     onChange={(e) => set({ breakFrom: e.target.value })} />
                              <span className="prose-muted">–</span>
                              <input type="time" className="input" value={day.breakTo}
                                     onChange={(e) => set({ breakTo: e.target.value })} />
                              <button type="button" className="btn-ghost t-sm"
                                      onClick={() => set({ breakFrom: '', breakTo: '' })}>
                                {t('reg.schedule.break.remove')}
                              </button>
                            </span>
                          ) : (
                            <button type="button" className="btn-ghost t-sm whitespace-nowrap"
                                    onClick={() => set({ breakFrom: '13:00', breakTo: '14:00' })}>
                              + {t('reg.schedule.break')}
                            </button>
                          )}
                        </>
                      ) : (
                        <span className="day-off">{t('reg.schedule.off')}</span>
                      )}
                    </div>
                  )
                })}
              </div>
              <p className="field-hint">{t('reg.schedule.note')}</p>
              <div className="flex gap-2">
                {backBtn}
                <button type="button" className="btn-primary flex-1"
                        disabled={busy}
                        onClick={() => (role === 'master' ? void finish() : nextStep())}>
                  {busy ? t('reg.saving') : t('reg.next')}
                </button>
              </div>
            </>,
          )}

          {/* ── Команда (салон) ─────────────────────────────── */}
          {step === 'staff' && shell(t('reg.staff.title'), t('reg.staff.sub'), (
            <>
              <div className="card-flat flex flex-col gap-2">
                {(['reg.staff.f1', 'reg.staff.f2', 'reg.staff.f3'] as Key[]).map((k) => (
                  <span key={k} className="role-list-item">
                    <span className="role-check" aria-hidden><IconCheck size={12} /></span>{t(k)}
                  </span>
                ))}
              </div>

              {staff.map((p, i) => (
                <div key={i} className="grid gap-2 sm:grid-cols-[1fr_1fr_auto]">
                  <input className="input" value={p.name} placeholder={t('reg.staff.name.ph')}
                         onChange={(e) => setStaff(staff.map((s, j) =>
                           j === i ? { ...s, name: e.target.value } : s))} />
                  <input className="input" value={p.title} placeholder={t('reg.staff.role.ph')}
                         onChange={(e) => setStaff(staff.map((s, j) =>
                           j === i ? { ...s, title: e.target.value } : s))} />
                  <button type="button" className="btn-ghost"
                          onClick={() => setStaff(staff.filter((_, j) => j !== i))}>
                    {t('reg.staff.remove')}
                  </button>
                </div>
              ))}

              <button type="button" className="btn-secondary"
                      onClick={() => setStaff([...staff, { name: '', title: '' }])}>
                + {t('reg.staff.add')}
              </button>

              <p className="field-hint">{t('reg.staff.invite')}</p>

              <div className="flex gap-2">
                {backBtn}
                <button type="button" className="btn-primary flex-1" disabled={busy}
                        onClick={() => void finish()}>
                  {busy ? t('reg.saving') : t('reg.next')}
                </button>
              </div>
              <button type="button" className="btn-ghost" disabled={busy}
                      onClick={() => { setStaff([]); void finish() }}>
                {t('reg.staff.skip')}
              </button>
            </>
          ))}

          {/* ── Готово ──────────────────────────────────────── */}
          {step === 'done' && shell(
            t(`reg.done.${role}.title` as Key),
            t(`reg.done.${role}.sub` as Key),
            <>
              <div className="card">
                <div className="sum-row">
                  <span className="sum-label">{t('reg.done.name')}</span>
                  <span>{role === 'salon' ? name : `${first} ${last}`.trim()}</span>
                </div>
                {(city || street) && (
                  <div className="sum-row">
                    <span className="sum-label">{t('reg.done.address')}</span>
                    <span>{[city, street, house].filter(Boolean).join(', ')}</span>
                  </div>
                )}
                {phone && (
                  <div className="sum-row">
                    <span className="sum-label">{t('reg.done.phone')}</span>
                    <span className="tabular">{phone}</span>
                  </div>
                )}
                {(services.length > 0 || specId) && (
                  <div className="sum-row">
                    <span className="sum-label">{t('reg.done.services')}</span>
                    <span>
                      {[specId, ...services].filter((v, i, a) => v && a.indexOf(v) === i)
                        .map((id) => specialities.find((s) => s.id === id)?.name)
                        .filter(Boolean).join(', ')}
                    </span>
                  </div>
                )}
              </div>

              {/* Переход ПОЛНОЙ навигацией, а не router.push: серверные
                  компоненты кабинета читают сессию из кук, и мягкий переход
                  гонится со свежей кукой — человек оказывается обратно
                  на регистрации сразу после успеха. */}
              <a href={next} className="btn-primary">{t('reg.done.cta')}</a>
            </>,
          )}
        </div>
      </main>
    </div>
  )
}
