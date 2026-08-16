'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

// ── Что здесь и почему именно так ─────────────────────────────────────────
//
// Экран собирает шесть готовых механизмов базы в одно место: приглашение
// (0050), блокировка (0051), передача владения (0052), срок доступа (0054),
// журнал прав и сеансы (0076), шаблоны и потолок скидки (0077, 0079).
//
// Ни одно действие здесь НЕ пишет в таблицы «своим» способом. Роль, права,
// потолок и срок меняются обычным UPDATE по `tenant_members` — именно
// потому, что на нём висят и защита от самопонижения, и неизменяемый
// журнал, и разрыв сеансов. Блокировка и передача владения идут функциями
// по той же причине. Если завтра кто-то добавит сюда «быстрый путь»
// в обход — журнал перестанет быть полным, и это будет видно только
// в день разбирательства.

type Member = {
  user_id: string; full_name: string | null; email: string | null
  role: string; permissions: Record<string, boolean> | null
  discount_cap_pct: number | null; effective_cap_pct: number
  blocked_at: string | null; blocked_reason: string | null
  access_expires_at: string | null; staff_id: string | null; joined_at: string
}
type Invite = {
  id: string; email: string; role: string; status: string
  created_at: string; expires_at: string; access_days: number | null
}
type Session = {
  user_id: string; staff_name: string | null; session_id: string
  device: string | null; ip: string | null
  started_at: string; last_seen: string
}
type Template = {
  id: string; name: string; role: string
  permissions: Record<string, boolean> | null; cap_pct: number | null
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'власник', admin: 'адміністратор', manager: 'менеджер',
  operator: 'майстер / склад', accountant: 'бухгалтер',
  viewer: 'перегляд', inspector: 'інспектор',
}

// Тот же порядок, что у role_rank() в базе. Держать его здесь — не
// дублирование правды, а её отображение: сравнение рангов всё равно
// делает база, а этот массив только рисует список сверху вниз.
const ROLE_ORDER = ['owner', 'admin', 'manager', 'accountant', 'operator', 'viewer', 'inspector']

const ROLE_HINT: Record<string, string> = {
  owner: 'Усе, включно з передачею закладу.',
  admin: 'Усе, крім передачі закладу.',
  manager: 'Замовлення, записи, клієнти, каталог, склад.',
  accountant: 'Фінанси й документи. Без складу.',
  operator: 'Свої записи, склад, журнали. Без фінансів і телефонів чужих клієнтів.',
  viewer: 'Тільки дивиться.',
  inspector: 'Реєстр, журнали, документи. Доступ за строком.',
}

function fmt(ts: string | null): string {
  if (!ts) return '—'
  return new Date(ts).toLocaleString('uk-UA', {
    day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

function fmtDay(ts: string | null): string {
  if (!ts) return ''
  return new Date(ts).toISOString().slice(0, 10)
}

export function TeamClient(props: {
  tenantId: string; shopName: string; myUserId: string; myRole: string
  canWrite: boolean
  members: Member[]; invites: Invite[]; sessions: Session[]
  templates: Template[]
  grants: { role: string; permission: string }[]
  caps: { role: string; cap_pct: number }[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)

  // Права по ролям — из role_grants, а не из списка в коде.
  const permsByRole = useMemo(() => {
    const map: Record<string, Set<string>> = {}
    for (const g of props.grants) {
      if (!map[g.role]) map[g.role] = new Set()
      map[g.role].add(g.permission)
    }
    return map
  }, [props.grants])

  const allPerms = useMemo(
    () => [...new Set(props.grants.map((g) => g.permission))].sort(),
    [props.grants],
  )

  const capByRole = useMemo(() => {
    const map: Record<string, number> = {}
    for (const c of props.caps) map[c.role] = c.cap_pct
    return map
  }, [props.caps])

  const myRank = ROLE_ORDER.indexOf(props.myRole)
  // Роль, вышестоящую за собственную, база всё равно не пустит
  // (`role_rank` в create_invitation). Список сокращаем здесь, чтобы
  // человек не выбирал то, что гарантированно откажут.
  const assignableRoles = ROLE_ORDER.filter((r) => ROLE_ORDER.indexOf(r) >= myRank && r !== 'owner')

  const sessionsByUser = useMemo(() => {
    const map: Record<string, Session[]> = {}
    for (const s of props.sessions) {
      if (!map[s.user_id]) map[s.user_id] = []
      map[s.user_id].push(s)
    }
    return map
  }, [props.sessions])

  // PromiseLike, а не Promise: конструкторы запросов supabase-js — это
  // thenable-объекты, а не настоящие обещания. Promise здесь не собирается.
  async function run(key: string, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(key); setError('')
    const { error } = await fn()
    setBusy('')
    if (error) { setError(error.message); return false }
    router.refresh()
    return true
  }

  // ── Приглашение ─────────────────────────────────────────────────────────

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState(assignableRoles.includes('operator') ? 'operator' : assignableRoles[0] ?? 'viewer')
  const [inviteDays, setInviteDays] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [mailState, setMailState] = useState<'' | 'sending' | 'sent' | 'failed'>('')

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setBusy('invite'); setError(''); setInviteLink(''); setMailState('')

    const days = inviteDays.trim() === '' ? null : Number(inviteDays)
    const { data, error } = await supabase.rpc('create_invitation', {
      p_tenant_id: props.tenantId,
      p_email: inviteEmail.trim(),
      p_role: inviteRole,
      p_permissions: {},
      p_access_days: days,
    })
    setBusy('')
    if (error) { setError(error.message); return }

    const row = Array.isArray(data) ? data[0] : data
    const token = row?.token as string | undefined
    if (!token) { setError('запрошення створено, але посилання не повернулося'); router.refresh(); return }

    const link = `${location.origin}/invite/${token}`
    setInviteLink(link)
    router.refresh()

    // Письмо — ВТОРЫМ шагом и не критично. Ссылка уже показана на экране:
    // если почта не настроена или Resend откажет, владелец всё равно
    // отправит её сам в мессенджере. Обратный порядок («сначала письмо,
    // потом показать») означал бы, что сбой почты теряет приглашение.
    setMailState('sending')
    try {
      const res = await fetch('/api/team/invite', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: props.tenantId, email: inviteEmail.trim(), token }),
      })
      setMailState(res.ok ? 'sent' : 'failed')
    } catch { setMailState('failed') }

    setInviteEmail('')
  }

  // ── Правка участника ────────────────────────────────────────────────────

  async function setRole(m: Member, role: string) {
    await run(`role:${m.user_id}`, () =>
      supabase.from('tenant_members').update({ role })
        .eq('tenant_id', props.tenantId).eq('user_id', m.user_id))
  }

  async function setCap(m: Member, value: string) {
    const pct = value.trim() === '' ? null : Math.max(0, Math.min(100, Number(value)))
    await run(`cap:${m.user_id}`, () =>
      supabase.from('tenant_members').update({ discount_cap_pct: pct })
        .eq('tenant_id', props.tenantId).eq('user_id', m.user_id))
  }

  async function setExpiry(m: Member, value: string) {
    const at = value.trim() === '' ? null : new Date(`${value}T23:59:59`).toISOString()
    await run(`exp:${m.user_id}`, () =>
      supabase.from('tenant_members').update({ access_expires_at: at })
        .eq('tenant_id', props.tenantId).eq('user_id', m.user_id))
  }

  // Тонкая выдача. Ключ в `permissions` — это ОТКЛОНЕНИЕ от роли, а не
  // копия её набора: совпало с ролью — ключ убираем. Иначе набор роли
  // застывает слепком, и завтрашняя правка `role_grants` этого человека
  // уже не касается.
  async function togglePerm(m: Member, perm: string, next: boolean) {
    const base = permsByRole[m.role]?.has(perm) ?? false
    const cur = { ...(m.permissions ?? {}) }
    if (next === base) delete cur[perm]
    else cur[perm] = next
    await run(`perm:${m.user_id}:${perm}`, () =>
      supabase.from('tenant_members').update({ permissions: cur })
        .eq('tenant_id', props.tenantId).eq('user_id', m.user_id))
  }

  // Причина блокировки — поле на экране, а не prompt(): системное окно
  // блокирует вкладку целиком, а сама причина уходит в неизменяемый журнал
  // прав и должна быть видна тому, кто её пишет, до нажатия.
  const [blockReason, setBlockReason] = useState('')

  async function block(m: Member) {
    const ok = await run(`block:${m.user_id}`, async () =>
      supabase.rpc('block_member', {
        p_tenant_id: props.tenantId, p_user_id: m.user_id,
        p_reason: blockReason.trim() || null,
      }))
    if (ok) setBlockReason('')
  }

  async function unblock(m: Member) {
    await run(`unblock:${m.user_id}`, async () =>
      supabase.rpc('unblock_member', { p_tenant_id: props.tenantId, p_user_id: m.user_id }))
  }

  async function applyTemplate(m: Member, templateId: string) {
    if (!templateId) return
    await run(`tpl:${m.user_id}`, async () =>
      supabase.rpc('apply_permission_template', {
        p_tenant_id: props.tenantId, p_user_id: m.user_id, p_template_id: templateId,
      }))
  }

  const [transferTo, setTransferTo] = useState('')
  async function transfer(m: Member) {
    if (transferTo !== (m.email ?? m.full_name ?? '')) return
    await run(`own:${m.user_id}`, async () =>
      supabase.rpc('transfer_ownership', {
        p_tenant_id: props.tenantId, p_to_user_id: m.user_id,
      }))
    setTransferTo('')
  }

  async function endSessions(userId: string | null) {
    await run(`sess:${userId ?? 'all'}`, async () =>
      supabase.rpc('end_sessions', {
        p_tenant_id: props.tenantId, p_user_id: userId,
      }))
  }

  async function revokeInvite(id: string) {
    await run(`inv:${id}`, async () => supabase.rpc('revoke_invitation', { p_id: id }))
  }

  // ── Шаблоны ─────────────────────────────────────────────────────────────

  const [tplName, setTplName] = useState('')
  const [tplRole, setTplRole] = useState(assignableRoles[0] ?? 'viewer')
  const [tplCap, setTplCap] = useState('')

  async function createTemplate(e: React.FormEvent) {
    e.preventDefault()
    const ok = await run('tpl-new', () =>
      supabase.from('permission_templates').insert({
        tenant_id: props.tenantId, name: tplName.trim(), role: tplRole,
        permissions: {},
        cap_pct: tplCap.trim() === '' ? null : Number(tplCap),
      }))
    if (ok) { setTplName(''); setTplCap('') }
  }

  async function deleteTemplate(id: string) {
    await run(`tpl-del:${id}`, () =>
      supabase.from('permission_templates').delete().eq('id', id))
  }

  return (
    <div className="flex flex-col gap-5 pb-8">
      {error && <p className="field-error">{error}</p>}

      {/* ── Приглашение ─────────────────────────────────────────────── */}
      {props.canWrite && (
        <section className="card rise-1">
          <h2 className="t-lg mb-1">Запросити людину</h2>
          <p className="t-md mb-4 prose-muted">
            Надішлемо лист із посиланням. Воно діє 72 години й спрацьовує один раз —
            і тільки для тієї пошти, на яку виписане.
          </p>

          <form onSubmit={invite} className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
            <div>
              <label className="field-label">Пошта</label>
              <input required type="email" className="input" value={inviteEmail}
                     onChange={(e) => setInviteEmail(e.target.value)}
                     placeholder="olya@example.com" />
            </div>
            <div>
              <label className="field-label">Роль</label>
              <select className="select" value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}>
                {assignableRoles.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Доступ, днів</label>
              <input type="number" min={1} max={365} className="input sm:w-28"
                     value={inviteDays} onChange={(e) => setInviteDays(e.target.value)}
                     placeholder={inviteRole === 'inspector' ? '7' : 'без строку'} />
            </div>
            <button className="btn-primary" disabled={busy === 'invite'}>
              {busy === 'invite' ? 'Створюємо…' : 'Запросити'}
            </button>
          </form>

          <p className="field-hint mt-2">{ROLE_HINT[inviteRole]}</p>

          {inviteLink && (
            <div className="card-flat mt-4 flex flex-col gap-2">
              <p className="t-md">Посилання створено. Покажіть його людині або надішліть самі:</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="t-sm break-all">{inviteLink}</code>
                <button type="button" className="btn-secondary t-sm"
                        onClick={() => navigator.clipboard.writeText(inviteLink)}>
                  Скопіювати
                </button>
              </div>
              <p className="t-sm prose-muted">
                {mailState === 'sending' && 'Надсилаємо лист…'}
                {mailState === 'sent' && 'Лист надіслано ✓'}
                {mailState === 'failed' && 'Лист не пішов — надішліть посилання самі.'}
              </p>
            </div>
          )}
        </section>
      )}

      {/* ── Незакрытые приглашения ──────────────────────────────────── */}
      {props.invites.length > 0 && (
        <section className="card rise-2 !p-0">
          <div className="p-5 pb-3">
            <h2 className="t-lg">Чекають на прийняття</h2>
          </div>
          {props.invites.map((i) => (
            <div key={i.id} className="row px-5">
              <div className="min-w-0">
                <p className="t-md truncate">{i.email}</p>
                <p className="t-xs prose-muted">
                  {ROLE_LABEL[i.role] ?? i.role} · діє до {fmt(i.expires_at)}
                  {i.access_days ? ` · доступ ${i.access_days} дн.` : ''}
                </p>
              </div>
              {props.canWrite && (
                <button type="button" className="btn-ghost t-sm"
                        disabled={busy === `inv:${i.id}`}
                        onClick={() => revokeInvite(i.id)}>
                  Відкликати
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {/* ── Команда ─────────────────────────────────────────────────── */}
      <section className="card rise-3 !p-0">
        <div className="p-5 pb-3">
          <h2 className="t-lg">Команда</h2>
          <p className="t-sm prose-muted">
            Зміна ролі або прав миттєво завершує сеанси людини: права живуть
            у токені, і без виходу нове обмеження почало б діяти лише за годину.
          </p>
        </div>

        {props.members.map((m) => {
          const self = m.user_id === props.myUserId
          const editable = props.canWrite && !self && m.role !== 'owner'
          const isOpen = open === m.user_id
          const rolePerms = permsByRole[m.role] ?? new Set<string>()
          const live = sessionsByUser[m.user_id]?.length ?? 0

          return (
            <div key={m.user_id} className="border-b" style={{ borderColor: 'var(--color-border)' }}>
              {/* Строка — не <button>: внутри неё живут блоки и вторая
                  строка текста, а содержимое кнопки по стандарту —
                  строчное. Роль и обработчик клавиатуры дают то же
                  поведение для скринридера и Tab, без неверной разметки. */}
              <div role="button" tabIndex={0}
                   className="row w-full cursor-pointer px-5 text-left"
                   onClick={() => setOpen(isOpen ? null : m.user_id)}
                   onKeyDown={(e) => {
                     if (e.key === 'Enter' || e.key === ' ') {
                       e.preventDefault(); setOpen(isOpen ? null : m.user_id)
                     }
                   }}>
                <div className="min-w-0">
                  <p className="t-md truncate">
                    {m.full_name ?? m.email ?? 'Без імені'}
                    {self && <span className="t-xs prose-muted"> — це ви</span>}
                  </p>
                  <p className="t-xs prose-muted truncate">
                    {m.email}
                    {live > 0 && ` · ${live} активн. сеанс${live > 1 ? 'и' : ''}`}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  {m.blocked_at && <span className="badge-danger">заблоковано</span>}
                  {!m.blocked_at && m.access_expires_at && (
                    <span className="badge-warn">до {fmtDay(m.access_expires_at)}</span>
                  )}
                  <span className={m.role === 'owner' ? 'badge-accent' : 'badge'}>
                    {ROLE_LABEL[m.role] ?? m.role}
                  </span>
                </div>
              </div>

              {isOpen && (
                <div className="flex flex-col gap-4 px-5 pb-5">
                  {m.blocked_at && (
                    <p className="t-sm prose-muted">
                      Заблоковано {fmt(m.blocked_at)}
                      {m.blocked_reason ? `: ${m.blocked_reason}` : ''}
                    </p>
                  )}

                  {self && (
                    <p className="field-hint">
                      Свою роль і свої права змінити не можна — це захист від
                      втрати доступу до власного закладу. Попросіть іншого
                      власника або передайте володіння.
                    </p>
                  )}

                  {editable && (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className="field-label">Роль</label>
                        {/* Текущая роль обязана быть в списке, даже если она
                            выше моей: иначе select покажет чужое значение
                            и первое же касание понизит человека молча. */}
                        <select className="select" value={m.role}
                                disabled={busy === `role:${m.user_id}`}
                                onChange={(e) => setRole(m, e.target.value)}>
                          {[...new Set([m.role, ...assignableRoles])].map((r) => (
                            <option key={r} value={r}
                                    disabled={!assignableRoles.includes(r)}>
                              {ROLE_LABEL[r] ?? r}
                            </option>
                          ))}
                        </select>
                        <p className="field-hint">{ROLE_HINT[m.role]}</p>
                      </div>

                      <div>
                        <label className="field-label">Стеля знижки, %</label>
                        <input type="number" min={0} max={100} className="input"
                               defaultValue={m.discount_cap_pct ?? ''}
                               placeholder={`за роллю — ${capByRole[m.role] ?? 0}`}
                               disabled={busy === `cap:${m.user_id}`}
                               onBlur={(e) => setCap(m, e.target.value)} />
                        <p className="field-hint">Зараз діє {m.effective_cap_pct}%.</p>
                      </div>

                      <div>
                        <label className="field-label">Доступ до</label>
                        <input type="date" className="input"
                               defaultValue={fmtDay(m.access_expires_at)}
                               disabled={busy === `exp:${m.user_id}`}
                               onBlur={(e) => setExpiry(m, e.target.value)} />
                        <p className="field-hint">Порожньо — безстроково.</p>
                      </div>
                    </div>
                  )}

                  {editable && props.templates.length > 0 && (
                    <div>
                      <label className="field-label">Застосувати шаблон</label>
                      <select className="select sm:max-w-xs" value=""
                              disabled={busy === `tpl:${m.user_id}`}
                              onChange={(e) => applyTemplate(m, e.target.value)}>
                        <option value="">— обрати —</option>
                        {props.templates.map((t) => (
                          <option key={t.id} value={t.id}>{t.name}</option>
                        ))}
                      </select>
                      <p className="field-hint">
                        Шаблон перезаписує роль, точкові дозволи й стелю знижки.
                      </p>
                    </div>
                  )}

                  {/* Точечная выдача */}
                  {editable && (
                    <div>
                      <p className="field-label">Точкові дозволи</p>
                      <p className="field-hint mb-2">
                        Галочка, що збігається з роллю, не зберігається окремо:
                        зміниться роль — зміниться й доступ.
                      </p>
                      <div className="grid gap-x-4 gap-y-1 sm:grid-cols-2">
                        {allPerms.map((p) => {
                          const base = rolePerms.has(p)
                          const val = m.permissions?.[p] ?? base
                          const overridden = m.permissions?.[p] !== undefined
                          return (
                            <label key={p} className="t-sm flex items-center gap-2">
                              <input type="checkbox" checked={val}
                                     disabled={busy === `perm:${m.user_id}:${p}`}
                                     onChange={(e) => togglePerm(m, p, e.target.checked)} />
                              <span className={overridden ? 'font-semibold' : ''}>{p}</span>
                              {overridden && <span className="badge t-xs">окремо</span>}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  )}

                  {/* Сеансы этого человека */}
                  {(sessionsByUser[m.user_id] ?? []).length > 0 && (
                    <div>
                      <p className="field-label">Активні сеанси</p>
                      {(sessionsByUser[m.user_id] ?? []).map((s) => (
                        <p key={s.session_id} className="t-sm prose-muted">
                          {s.device?.slice(0, 60) ?? 'невідомий пристрій'} · {s.ip ?? '—'} ·
                          {' '}остання дія {fmt(s.last_seen)}
                        </p>
                      ))}
                      {props.canWrite && !self && (
                        <button type="button" className="btn-secondary t-sm mt-2"
                                disabled={busy === `sess:${m.user_id}`}
                                onClick={() => endSessions(m.user_id)}>
                          Завершити сеанси
                        </button>
                      )}
                    </div>
                  )}

                  {/* Опасная зона */}
                  {props.canWrite && !self && (
                    m.blocked_at ? (
                      <div>
                        <button type="button" className="btn-secondary t-sm"
                                disabled={busy === `unblock:${m.user_id}`}
                                onClick={() => unblock(m)}>
                          Розблокувати
                        </button>
                      </div>
                    ) : (
                      <div className="flex flex-wrap items-end gap-2">
                        <div className="grow sm:max-w-xs">
                          <label className="field-label">Причина блокування</label>
                          <input className="input" value={blockReason}
                                 onChange={(e) => setBlockReason(e.target.value)}
                                 placeholder="звільнення, втрата телефону…" />
                        </div>
                        <button type="button" className="btn-danger t-sm"
                                disabled={busy === `block:${m.user_id}`}
                                onClick={() => block(m)}>
                          Заблокувати доступ
                        </button>
                      </div>
                    )
                  )}

                  {/* Передача владения. Слово-подтверждение, а не «ви впевнені»:
                      действие необратимо для нажавшего — он станет админом
                      и вернуть себе владение уже не сможет. */}
                  {props.myRole === 'owner' && !self && !m.blocked_at && (
                    <div className="card-flat flex flex-col gap-2">
                      <p className="t-md">Передати володіння закладом</p>
                      <p className="t-sm prose-muted">
                        Ви станете адміністратором. Повернути володіння зможе
                        тільки новий власник.
                      </p>
                      <label className="field-label">
                        Надрукуйте <b>{m.email ?? m.full_name}</b> для підтвердження
                      </label>
                      <input className="input" value={transferTo} autoComplete="off"
                             onChange={(e) => setTransferTo(e.target.value)} />
                      <div>
                        <button type="button" className="btn-danger t-sm"
                                disabled={transferTo !== (m.email ?? m.full_name ?? '')
                                          || busy === `own:${m.user_id}`}
                                onClick={() => transfer(m)}>
                          Передати володіння
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          )
        })}
      </section>

      {/* ── Шаблоны прав ────────────────────────────────────────────── */}
      {props.canWrite && (
        <section className="card rise-3">
          <h2 className="t-lg mb-1">Шаблони доступу</h2>
          <p className="t-md mb-4 prose-muted">
            Набір «роль + точкові дозволи + стеля знижки» під вашу посаду.
            Щоб не збирати п’ятнадцять галочок кожному новому майстру.
          </p>

          {props.templates.map((t) => (
            <div key={t.id} className="row">
              <div className="min-w-0">
                <p className="t-md truncate">{t.name}</p>
                <p className="t-xs prose-muted">
                  {ROLE_LABEL[t.role] ?? t.role}
                  {t.cap_pct !== null ? ` · знижка до ${t.cap_pct}%` : ''}
                  {' · '}
                  {Object.keys(t.permissions ?? {}).length} точкових
                </p>
              </div>
              <button type="button" className="btn-ghost t-sm"
                      disabled={busy === `tpl-del:${t.id}`}
                      onClick={() => deleteTemplate(t.id)}>
                Видалити
              </button>
            </div>
          ))}

          <form onSubmit={createTemplate}
                className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
            <div>
              <label className="field-label">Назва</label>
              <input required className="input" value={tplName}
                     onChange={(e) => setTplName(e.target.value)}
                     placeholder="Майстер зміни" />
            </div>
            <div>
              <label className="field-label">Роль</label>
              <select className="select" value={tplRole}
                      onChange={(e) => setTplRole(e.target.value)}>
                {assignableRoles.map((r) => (
                  <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label">Знижка, %</label>
              <input type="number" min={0} max={100} className="input sm:w-24"
                     value={tplCap} onChange={(e) => setTplCap(e.target.value)}
                     placeholder="за роллю" />
            </div>
            <button className="btn-secondary" disabled={busy === 'tpl-new'}>
              Додати шаблон
            </button>
          </form>
          <p className="field-hint mt-2">
            Точкові дозволи в шаблоні поки задаються порожніми — застосування
            шаблону ставить чисту роль і стелю. Галочки в шаблоні — наступним кроком.
          </p>
        </section>
      )}

      {/* ── Все сеансы ──────────────────────────────────────────────── */}
      <section className="card rise-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="t-lg">Активні сеанси</h2>
          {props.canWrite && props.sessions.length > 0 && (
            <button type="button" className="btn-secondary t-sm"
                    disabled={busy === 'sess:all'}
                    onClick={() => endSessions(null)}>
              Завершити всі, крім мого
            </button>
          )}
        </div>
        {props.sessions.length === 0 ? (
          <p className="t-md prose-muted mt-2">Активних сеансів немає.</p>
        ) : (
          <p className="t-sm prose-muted mt-2">
            {props.sessions.length} сеанс(ів). Подробиці — у картці людини вище.
          </p>
        )}
      </section>
    </div>
  )
}
