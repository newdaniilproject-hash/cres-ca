'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { abs } from '@/lib/site'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'
import { SecurityLog, type SecurityEvent } from './security-log'
import { DataAccessLog, type DataAccessRow } from './data-access-log'
import { maskText } from '@/lib/redact'
import { IconChevronRight, IconClose, IconUsers } from '@/components/icons'

// ── Что здесь и почему именно так ─────────────────────────────────────────
//
// Экран собирает готовые механизмы базы в одно место: приглашение (0050),
// передача владения (0052), срок доступа (0054), журнал прав и сеансы
// (0076), шаблоны и потолок скидки (0077, 0079), сторож членств (0081).
//
// Ни одно действие здесь НЕ пишет в таблицы «своим» способом. Роль, права,
// потолок и срок меняются обычным UPDATE по `tenant_members` — именно
// потому, что на нём висят и защита от самопонижения, и неизменяемый
// журнал, и разрыв сеансов. Блокировка и передача владения идут функциями
// по той же причине. Если завтра кто-то добавит сюда «быстрый путь»
// в обход — журнал перестанет быть полным, и это будет видно только
// в день разбирательства.
//
// ── ТРИ РАЗНЫХ «не работает», которые нельзя смешивать (0081, 0082) ───────
//
//   `blocked_at`       — НЕТ ДОСТУПА. Человек не войдёт в кабинет. Ставит
//                        `block_member`, снимает `unblock_member`, и это
//                        единственный источник правды о входе.
//   `staff_blocked_at` — НЕ РАБОТАЕТ. Карточка мастера погашена: человек
//                        пропадает из расписания и из списка, на кого
//                        записывают клиента, но кабинет ему открыт.
//                        Своей кнопки здесь нет и заводить её нельзя:
//                        признак правят только block_member/unblock_member
//                        через транзакционный флаг `app.staff_block`.
//   `staff_is_active`  — НЕ ПРИНИМАЕТ ЗАПИСИ. Отпуск или больничный,
//                        обычная колонка карточки мастера.
//
// До 0082 `team_overview` склеивала первые два через `coalesce`, и мастер
// в отпуске выглядел лишённым доступа. Обратно из одного значения два
// не достаются — поэтому здесь они и показываются, и подписываются
// РАЗДЕЛЬНО, разным тоном.

type Member = {
  user_id: string; full_name: string | null; email: string | null
  role: string; permissions: Record<string, boolean> | null
  discount_cap_pct: number | null; effective_cap_pct: number
  blocked_at: string | null; blocked_reason: string | null
  access_expires_at: string | null
  staff_id: string | null
  staff_blocked_at: string | null; staff_blocked_reason: string | null
  // null — карточки мастера у человека нет вовсе (левое соединение
  // в team_overview). Именно поэтому проверка везде `=== false`,
  // а не `!m.staff_is_active`: бухгалтер без карточки не «в отпуске».
  staff_is_active: boolean | null
  joined_at: string
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
type Audit = {
  id: string; at: string
  actor: string | null; actor_name: string | null
  target: string; target_name: string | null
  action: string
  role_before: string | null; role_after: string | null
  perms_added: string[] | null; perms_removed: string[] | null
  note: string | null
}

// ── Значения базы и подписи к ним — РАЗНЫЕ вещи ────────────────────────────
//
// `owner`, `added`, `stock.read` — служебные значения перечислений и ключи
// прав. Они НЕ переводятся никогда: по ним сверяется база, они уезжают
// в запросы и приезжают в журнале. Переводится подпись к значению, и живёт
// она в словаре (`role.owner`, `team.audit.action.added`).
//
// Значение, которого нет в списке, показывается КАК ЕСТЬ. Это не запасной
// вариант «на всякий случай»: новая роль в базе появится раньше, чем строка
// в словаре, и увидеть `supervisor` полезнее, чем пустоту или чужое слово.
const ROLES = [
  'owner', 'admin', 'manager', 'accountant', 'operator', 'viewer', 'inspector',
] as const
type Role = (typeof ROLES)[number]
const isRole = (r: string): r is Role => (ROLES as readonly string[]).includes(r)

const roleLabel = (t: T, r: string): string => (isRole(r) ? t(`role.${r}`) : r)
const roleHint = (t: T, r: string): string => (isRole(r) ? t(`role.hint.${r}`) : '')

// Журнал пишется триггером на `tenant_members` (0080), то есть события
// `blocked`/`unblocked` в нём — ТОЛЬКО про доступ. Карточка мастера
// в журнал прав не попадает и попадать не должна: это не право.
// Отсюда и подписи — «закрито доступ», а не «заблоковано»: последнее
// на этом экране теперь значит два разных состояния.
const ACTIONS = ['added', 'removed', 'changed', 'blocked', 'unblocked'] as const
type AuditAction = (typeof ACTIONS)[number]
const isAction = (a: string): a is AuditAction =>
  (ACTIONS as readonly string[]).includes(a)
const actionLabel = (t: T, a: string): string =>
  (isAction(a) ? t(`team.audit.action.${a}`) : a)

// Тон бейджа — не текст, а класс оформления: в словаре ему делать нечего.
const ACTION_TONE: Record<string, string> = {
  added: 'badge-success', removed: 'badge-danger', changed: 'badge',
  blocked: 'badge-danger', unblocked: 'badge-success',
}

// ── CRESKO Web, §16 «Співробітники» — колонки таблиц широкого экрана ──────
// Ширины из хендоффа дословно. Второй грид — для вкладки «Запрошення»:
// у приглашения нет ни роли в команде, ни прав, ни даты вступления,
// и втискивать его в чужую таблицу прочерками значит показать четыре
// пустые колонки вместо одной честной строки.
const TGRID = '1.8fr 1.3fr 1fr 1.2fr 1fr 34px'
const IGRID = '2fr 1.2fr 1.2fr auto'

// Порядок ОТОБРАЖЕНИЯ списка ролей сверху вниз. Сравнивать роли по
// индексу в этом массиве нельзя: у `role_rank()` accountant и operator
// РАВНЫ (по 40), а в списке они стоят друг за другом. По индексу
// выходило, что бухгалтер выше мастера, и экран прятал у мастера
// правку бухгалтера, которую база разрешает.
const ROLE_ORDER = ['owner', 'admin', 'manager', 'accountant', 'operator', 'viewer', 'inspector']

// Те же числа, что у role_rank() в базе (0050). Держать их здесь — не
// дублирование правды, а её отображение: отказ всё равно выносит база,
// а эти числа только решают, показывать ли действие, которое она
// гарантированно отклонит.
const ROLE_RANK: Record<string, number> = {
  owner: 100, admin: 80, manager: 60, accountant: 40, operator: 40, viewer: 20, inspector: 10,
}
// Неизвестная роль — самый низ: лучше не показать законное действие,
// чем предложить то, что откажут.
const rank = (role: string): number => ROLE_RANK[role] ?? 0

// Дата, время, дробь и процент — через `t.date`, `t.dateTime`, `t.number`
// и `t.percent` (`lib/i18n/format.ts`). Своих `fmt` и `fmtDay` на экране
// больше нет: месяцы, разделитель разрядов и место символа процента зависят
// от языка, и собранные руками они остались бы украинскими навсегда.
// Единственное исключение — значение для `<input type="date">`: это формат
// поля, а не текст, и `t.inputDay` не локализует его намеренно.

// Отказы базы — на человеческий. Приём тот же, что в lib/auth-errors.ts:
// словарь по подстроке, всё неопознанное отдаётся как есть.
//
// Здесь он нужен не «на всякий случай». Отказы сторожа (0081) написаны
// по-украински и предназначены человеку — их и показываем дословно,
// иначе заведётся второй источник правды о том, почему отказано. Но три
// вида ответа человеку ничего не говорят, и как раз они самые частые:
//
//   • «(100 > 60)» в отказе по рангу — это ЧИСЛА role_rank, а не проценты
//     и не количество. Читается как ошибка программы;
//   • имя ограничения `tenant_members_perms_no_star` вместо объяснения,
//     что ключ `*` — это полный доступ владельца;
//   • английские ответы PostgREST и RLS, которые к тому же приходят
//     ровно в момент, когда доступ у смотрящего уже изменили.
//
// ВАЖНОЕ ПРО СЛОВАРЬ: переводится ОТВЕТ ЧЕЛОВЕКУ, а не отказ базы. Подстроки,
// по которым здесь идёт разбор («чия роль вища за власну»), — это ТЕКСТ
// ОТКАЗА ИЗ МИГРАЦИИ, и он не ключ словаря: переведи его — и разбор
// перестанет узнавать свой же случай.
function teamErrorText(t: T, raw: string): string {
  const m = raw.toLowerCase()

  if (m.includes('perms_no_star')) return t('team.error.noStar')

  // Два разных отказа по рангу с одинаковым хвостом: один про правку
  // строки (сторож), другой про принудительный выход (`end_sessions`).
  if (m.includes('завершити сеанси того')) return t('team.error.rankSessions')

  if (m.includes('чия роль вища за власну')) return t('team.error.rankEdit')

  if (m.includes('видати роль, вищу за власну')) {
    const pair = raw.match(/\(([a-z_]+) > ([a-z_]+)\)/)
    const label = pair ? roleLabel(t, pair[1]) : ''
    return label
      ? t('team.error.rankRole', { role: label })
      : t('team.error.rankRoleAny')
  }

  if (m.includes('row-level security') || m.includes('permission denied'))
    return t('team.error.denied')

  if (m.includes('jwt') || m.includes('не автентифіковано'))
    return t('team.error.session')

  // База отвечает по-украински намеренно (0081): её отказы уже написаны
  // для человека и объясняют, что делать. Переписывать их здесь значит
  // разойтись с ними при первой же правке миграции. В словарь они по той же
  // причине не едут: источник правды о причине отказа — миграция.
  // Показываем, но ОБЕЗЛИЧИВАЕМ: в подстановку `%` нашего же
  // `raise exception` могло уехать значение поля — телефон участника
  // или почта. Та же причина, что у общего разбора в lib/errors/db.ts.
  if (/[а-яіїєґ]/i.test(raw)) return maskText(raw) ?? raw

  return t('team.error.generic')
}

export function TeamClient(props: {
  tenantId: string; myUserId: string | null; myRole: string
  canWrite: boolean
  members: Member[]; invites: Invite[]; sessions: Session[]
  templates: Template[]
  grants: { role: string; permission: string }[]
  caps: { role: string; cap_pct: number }[]
  audit: Audit[]
  security: SecurityEvent[]
  access: DataAccessRow[]
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)
  // Широкий экран: вкладка списка и выбранный человек. Выбор — состояние,
  // а не адрес: карточку открывают, чтобы сверить её со строкой списка
  // («кому из двух Оль закрыт доступ»), и уводить ради этого с экрана
  // значит заставить вернуться.
  const [webTab, setWebTab] = useState<'all' | 'active' | 'blocked' | 'invites'>('all')
  // Раскрыта ли форма приглашения на широком экране. На телефоне она
  // раскрыта всегда и этого состояния не читает.
  const [inviting, setInviting] = useState(false)
  const [picked, setPicked] = useState<string | null>(null)
  // Журнал свёрнут по умолчанию: двести строк истории над экраном, где
  // работают каждый день, превращают его в ленту, а не в инструмент.
  const [auditOpen, setAuditOpen] = useState(false)

  // Без своего id опасные действия не показываются НИКОМУ. Иначе `self`
  // не срабатывает ни на ком, и человек видит «заблокувати доступ»
  // и «передати володіння» на собственной строке.
  const knowMe = !!props.myUserId

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

  // ── «Нельзя выдать право, которого нет у тебя самого» (0081) ────────────
  //
  // Тот же разбор, что делает `effective_perm_set()`: набор роли минус
  // снятое точечно плюс выданное точечно; у владельца — `*`. Повторён
  // здесь ровно затем, чтобы не показывать действие, которое база
  // отклонит. Решение по-прежнему за базой: это фильтр, а не проверка.
  function effPerms(role: string, perms: Record<string, boolean> | null): Set<string> {
    if (role === 'owner') return new Set(['*'])
    const out = new Set<string>()
    for (const p of permsByRole[role] ?? new Set<string>()) if (perms?.[p] !== false) out.add(p)
    for (const [p, on] of Object.entries(perms ?? {})) if (on) out.add(p)
    return out
  }

  // Мой собственный набор — из МОЕЙ строки в списке, а не из одной роли:
  // точечно снятое право база тоже вычитает, и без этого экран предлагал
  // бы выдать то, чего у меня уже нет.
  const myPerms = useMemo(() => {
    const me = props.members.find((x) => x.user_id === props.myUserId)
    return effPerms(me?.role ?? props.myRole, me?.permissions ?? null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.members, props.myUserId, props.myRole, permsByRole])

  const iHaveStar = myPerms.has('*')

  // Считается та же РАЗНИЦА, что и в `assert_grant_within`: не весь новый
  // набор, а только то, что правкой добавляется. Иначе понизить человека,
  // у которого прав больше моего, было бы «нельзя» — а это законно.
  function notMine(
    nextRole: string, nextPerms: Record<string, boolean> | null,
    prevRole: string, prevPerms: Record<string, boolean> | null,
  ): string[] {
    if (iHaveStar) return []
    const prev = effPerms(prevRole, prevPerms)
    return [...effPerms(nextRole, nextPerms)]
      .filter((p) => !prev.has(p) && !myPerms.has(p)).sort()
  }

  const myRank = rank(props.myRole)
  // Роль, вышестоящую за собственную, база всё равно не пустит
  // (`role_rank` в create_invitation, сторож в 0081). Список сокращаем
  // здесь, чтобы человек не выбирал то, что гарантированно откажут.
  const assignableRoles = ROLE_ORDER.filter((r) => rank(r) <= myRank && r !== 'owner')

  // Приглашение проверяется НА МОМЕНТ ПРИЁМА (0081, п. 5): роль, чей
  // набор прав шире моего, отказывает не мне сейчас, а приглашённому
  // через три дня — и текстом про меня. Такую роль гасим сразу.
  // Без useMemo намеренно: ролей семь, и запоминать тут нечего, а список
  // зависимостей на массиве, который пересобирается каждый рендер, врёт.
  const invitable = new Set(
    assignableRoles.filter((r) => notMine(r, null, '', null).length === 0))

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
    try {
      const { error } = await fn()
      if (error) { setError(teamErrorText(t, error.message)); return false }
    } catch {
      // Обрыв связи. Без этого перехвата очередь записи прав ниже
      // повисла бы навсегда: следующее переключение ждало бы обещание,
      // которое никогда не разрешится.
      setError(t('team.error.offline'))
      return false
    } finally {
      setBusy('')
    }
    router.refresh()
    return true
  }

  // ── Приглашение ─────────────────────────────────────────────────────────

  const [inviteEmail, setInviteEmail] = useState('')
  const [inviteRole, setInviteRole] = useState(
    invitable.has('operator') ? 'operator' : [...invitable][0] ?? assignableRoles[0] ?? 'viewer')
  const [inviteDays, setInviteDays] = useState('')
  const [inviteLink, setInviteLink] = useState('')
  const [copied, setCopied] = useState(false)
  const [mailState, setMailState] = useState<'' | 'sending' | 'sent' | 'failed'>('')

  async function invite(e: React.FormEvent) {
    e.preventDefault()
    setBusy('invite'); setError(''); setInviteLink(''); setMailState(''); setCopied(false)

    // Почта запоминается ДО запроса: поле очищается сразу после успеха,
    // а письмо уходит вторым шагом — иначе в конверт попало бы то, что
    // человек успел набрать следующим.
    const email = inviteEmail.trim()
    const days = inviteDays.trim() === '' ? null : Number(inviteDays)
    const { data, error } = await supabase.rpc('create_invitation', {
      p_tenant_id: props.tenantId,
      p_email: email,
      p_role: inviteRole,
      p_permissions: {},
      p_access_days: days,
    })
    setBusy('')
    if (error) { setError(teamErrorText(t, error.message)); return }

    const row = Array.isArray(data) ? data[0] : data
    const token = row?.token as string | undefined
    if (!token) { setError(t('team.error.noLink')); router.refresh(); return }

    // Адрес — из lib/site.ts, тем же способом, что и в письме. На
    // `location.origin` ссылка на экране и ссылка в письме расходятся
    // на www-версии, на превью-деплое и внутри обёртки, а приглашение
    // выписано ровно на один адрес.
    setInviteLink(abs(`/invite/${token}`))
    setInviteEmail('')
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
        body: JSON.stringify({ tenantId: props.tenantId, email, token }),
      })
      setMailState(res.ok ? 'sent' : 'failed')
    } catch { setMailState('failed') }
  }

  async function copyLink() {
    try {
      await navigator.clipboard.writeText(inviteLink)
      setCopied(true)
    } catch {
      // Буфер обмена недоступен без защищённого соединения — не молчим,
      // иначе человек уверен, что скопировал.
      setError(t('team.error.copy'))
    }
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

  // ── Точечные дозволы: почему очередь и два набора ───────────────────────
  //
  // Права пишутся ЦЕЛЫМ объектом, а пропсы обновляются только после
  // router.refresh(). Три быстрых клика, посчитанные от пропса, отменяли
  // друг друга: второй отправлял набор, в котором первого изменения ещё
  // не было, — галочка загоралась и через секунду гасла.
  //
  // `pending` — набор, каким он СТАНЕТ после всех уже отправленных
  // переключений; от него считается следующее. `saved` — то, что сервер
  // подтвердил, и галочка рисуется из него: состояния, которого нет
  // в базе, на экране не появляется. Записи по одному ключу идут
  // очередью, потому что два одновременных UPDATE одного объекта
  // разрешаются по времени ответа, а не по времени нажатия.
  const pendingPerms = useRef<Record<string, Record<string, boolean>>>({})
  const permQueue = useRef<Record<string, Promise<unknown>>>({})
  const permInFlight = useRef(0)
  const [savedPerms, setSavedPerms] = useState<Record<string, Record<string, boolean>>>({})

  // Пришли свежие данные с сервера — местные наборы отдают им место.
  // Иначе применённый шаблон (он переписывает `permissions` целиком)
  // или правка из соседней вкладки остались бы заслонёнными, а первое
  // же переключение галочки их отменило бы.
  //
  // Пока хоть одна запись в полёте, наборы не трогаем: очередь считает
  // следующий объект именно от них. Незавершённая запись всё равно
  // вызовет свой router.refresh(), и уборка случится на нём.
  useEffect(() => {
    if (permInFlight.current > 0) return
    pendingPerms.current = {}
    setSavedPerms((s) => (Object.keys(s).length ? {} : s))
  }, [props.members, props.templates])

  // Ключ в `permissions` — это ОТКЛОНЕНИЕ от роли, а не копия её набора:
  // совпало с ролью — ключ убираем. Иначе набор роли застывает слепком,
  // и завтрашняя правка `role_grants` этого человека уже не касается.
  function togglePermIn(
    perms: Record<string, boolean>, role: string, perm: string, next: boolean,
  ): Record<string, boolean> {
    const base = permsByRole[role]?.has(perm) ?? false
    const copy = { ...perms }
    if (next === base) delete copy[perm]
    else copy[perm] = next
    return copy
  }

  function queuePerms(
    key: string, busyKey: string,
    saved: Record<string, boolean>, role: string, perm: string, next: boolean,
    write: (perms: Record<string, boolean>) => PromiseLike<{ error: { message: string } | null }>,
  ) {
    const perms = togglePermIn(pendingPerms.current[key] ?? saved, role, perm, next)
    pendingPerms.current[key] = perms
    permInFlight.current += 1
    const prev = permQueue.current[key] ?? Promise.resolve()
    permQueue.current[key] = prev.then(async () => {
      const ok = await run(busyKey, () => write(perms))
      if (ok) setSavedPerms((s) => ({ ...s, [key]: perms }))
      // Не записалось — «будущий» набор откатываем к подтверждённому,
      // иначе следующее нажатие потащит с собой и то, что не сохранилось.
      else delete pendingPerms.current[key]
      permInFlight.current -= 1
    })
  }

  // Причина блокировки — поле на экране, а не prompt(): системное окно
  // блокирует вкладку целиком, а сама причина уходит в неизменяемый журнал
  // прав и должна быть видна тому, кто её пишет, до нажатия.
  //
  // Причина хранится ПО УЧАСТНИКУ. Одно поле на весь список означало, что
  // набранная для одного человека фраза уезжала в журнал рядом с именем
  // другого — а журнал не редактируется и не удаляется.
  const [blockReason, setBlockReason] = useState<Record<string, string>>({})

  // Обе функции работают ПАРОЙ таблиц (0081): `block_member` закрывает
  // доступ и заодно гасит карточку мастера, `unblock_member` возвращает
  // и то, и другое. Отдельной кнопки «погасить только карточку» здесь нет
  // и быть не может: признак в `staff` правится лишь этими двумя через
  // транзакционный флаг `app.staff_block`, любая прямая правка падает.
  async function block(m: Member) {
    const ok = await run(`block:${m.user_id}`, async () =>
      supabase.rpc('block_member', {
        p_tenant_id: props.tenantId, p_user_id: m.user_id,
        p_reason: (blockReason[m.user_id] ?? '').trim() || null,
      }))
    if (ok) setBlockReason((r) => { const copy = { ...r }; delete copy[m.user_id]; return copy })
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

  // Подтверждение хранится ПО УЧАСТНИКУ, как и причина блокировки: одно
  // поле на весь список означало, что набранное в карточке одного человека
  // показывалось в карточке следующего — на необратимом действии этого
  // достаточно, чтобы нажать не глядя.
  const [transferTo, setTransferTo] = useState<Record<string, string>>({})

  // Передача владения меняет МОЮ строку в tenant_members, а триггер на ней
  // сносит МОИ сеансы. Одного router.refresh() тут мало и он врёт: токен
  // на руках всё ещё говорит «owner», поэтому панель передачи остаётся
  // на экране, роль показана прежняя, а через несколько минут человека
  // молча выбрасывает на вход. Поэтому — явный выход и жёсткая
  // перезагрузка, как в app/invite/[token]/accept-client.tsx.
  async function transfer(m: Member) {
    const target = m.email ?? m.full_name ?? ''
    if (!target || (transferTo[m.user_id] ?? '') !== target) return
    const ok = await run(`own:${m.user_id}`, async () =>
      supabase.rpc('transfer_ownership', {
        p_tenant_id: props.tenantId, p_to_user_id: m.user_id,
      }))
    // Поле подтверждения чистится только при успехе: на ошибке человек
    // должен видеть, что он набрал, а не набирать заново.
    if (!ok) return
    setTransferTo((prev) => { const copy = { ...prev }; delete copy[m.user_id]; return copy })
    try {
      await supabase.auth.signOut()
    } catch {
      // Сеанса на сервере уже нет — выход всё равно чистит куки.
    }
    window.location.href = `/login?next=${encodeURIComponent('/app/team')}`
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
  // Точечные дозволы нового шаблона. Хранятся ровно в той же форме, что
  // и у участника, — объект «право → true/false», где ключ означает
  // ОТКЛОНЕНИЕ от роли. Иначе шаблон и участник разошлись бы формой,
  // а `apply_permission_template` переносит одно в другое как есть.
  const [tplPerms, setTplPerms] = useState<Record<string, boolean>>({})
  const [openTpl, setOpenTpl] = useState<string | null>(null)

  async function saveTemplateCap(tpl: Template, value: string) {
    const cap = value.trim() === '' ? null : Math.max(0, Math.min(100, Number(value)))
    await run(`tpl-cap:${tpl.id}`, () =>
      supabase.from('permission_templates').update({ cap_pct: cap }).eq('id', tpl.id))
  }

  async function createTemplate(e: React.FormEvent) {
    e.preventDefault()
    const ok = await run('tpl-new', () =>
      supabase.from('permission_templates').insert({
        tenant_id: props.tenantId, name: tplName.trim(), role: tplRole,
        permissions: tplPerms,
        cap_pct: tplCap.trim() === '' ? null : Number(tplCap),
      }))
    if (ok) { setTplName(''); setTplCap(''); setTplPerms({}) }
  }

  async function deleteTemplate(id: string) {
    await run(`tpl-del:${id}`, () =>
      supabase.from('permission_templates').delete().eq('id', id))
  }

  // ── Признаки участника ──────────────────────────────────────────────────
  // Считаются в ОДНОМ месте, потому что раскладок стало две: список
  // с раскрытием на телефоне и таблица с панелью на широком экране.
  // Второй набор тех же вычислений разошёлся бы с первым на первой правке
  // ранга, и разошёлся бы молча — обе раскладки продолжали бы работать,
  // просто показывали бы разное.
  function memberFlags(m: Member) {
    const self = knowMe && m.user_id === props.myUserId
    // Строку того, чья роль выше моей, сторож не пускает ВООБЩЕ —
    // ни роль, ни срок, ни стелю, ни блокировку (0081).
    const outranksMe = rank(m.role) > myRank
    // Без своего id правим только через «только чтение»: иначе экран
    // предложит понизить роль самому себе, а база откажет (0052) —
    // человек решит, что сломано.
    const editable = props.canWrite && knowMe && !self
      && !outranksMe && m.role !== 'owner'
    // Блокировка и принудительный выход — тоже по рангу: у обоих проверка
    // стоит в базе (`end_sessions` явно, `block_member` — через сторожа
    // на UPDATE). Строка владельца сюда не попадает никогда.
    const dangerous = props.canWrite && knowMe && !self && !outranksMe
    const rolePerms = permsByRole[m.role] ?? new Set<string>()
    const live = sessionsByUser[m.user_id]?.length ?? 0
    const permKey = `member:${m.user_id}`
    const shownPerms: Record<string, boolean> =
      savedPerms[permKey] ?? m.permissions ?? {}
    const granted = allPerms.filter((p) => shownPerms[p] ?? rolePerms.has(p))
    return { self, outranksMe, editable, dangerous, rolePerms, live, permKey, shownPerms, granted }
  }

  // ── Карточка участника: ОДНО тело на обе раскладки ──────────────────────
  //
  // На телефоне она раскрывается под строкой списка, на широком экране
  // лежит в правой панели. Разметка одна и обработчики одни: вторая копия
  // формы прав означала бы, что «быстрый путь» мимо триггеров заводится
  // ровно в одной из них, и журнал прав перестаёт быть полным (см. шапку).
  //
  // `dense` — единственное отличие: в панели 398px трёхколоночная сетка
  // полей превращается в три поля по сто пикселей, а сетка дозволов —
  // в два столбца обрезанных ключей. Классы Tailwind считают ширину ОКНА,
  // а не контейнера, поэтому раскладку приходится называть явно.
  //
  // `ns` — пространство имён идентификаторов полей. Мобильный список
  // на широком экране спрятан классом, но из DOM никуда не девается,
  // и без приставки `id` полей совпали бы: `<label for>` тогда указывает
  // на первый попавшийся элемент, то есть на невидимый.
  function memberDetail(m: Member, dense = false) {
    const { self, outranksMe, editable, dangerous, rolePerms, permKey, shownPerms, granted }
      = memberFlags(m)
    const ns = dense ? 'w' : 'm'
    const cols3 = dense ? '' : 'sm:grid-cols-3'
    const cols2 = dense ? '' : 'sm:grid-cols-2'

    return (
      <>
        {/* Развёрнутое объяснение каждого состояния: бейдж
            называет, а карточка отвечает на «и что теперь».
            Три состояния независимы и могут стоять разом. */}
        {(m.blocked_at || m.staff_blocked_at || m.staff_is_active === false) && (
          <div className="card-flat flex flex-col gap-3">
            {m.blocked_at && (
              <div>
                {/* Жирная часть — отдельный ключ: разметки
                    в словаре не бывает, а вырезать <b> из строки
                    значит завести свой мини-язык шаблонов. */}
                <p className="t-sm">
                  <b>{t('team.state.noAccess.title')}</b>{' '}
                  {t('common.since', { date: t.dateTime(m.blocked_at) })}
                  {/* Причина — то, что набрал человек. Не переводится. */}
                  {m.blocked_reason ? ` · ${m.blocked_reason}` : ''}
                </p>
                <p className="field-hint">{t('team.state.noAccess.hint')}</p>
              </div>
            )}

            {m.staff_blocked_at && (
              <div>
                <p className="t-sm">
                  <b>{t('team.state.notWorking.title')}</b>{' '}
                  {t('common.since', { date: t.dateTime(m.staff_blocked_at) })}
                  {m.staff_blocked_reason ? ` · ${m.staff_blocked_reason}` : ''}
                </p>
                <p className="field-hint">
                  {t('team.state.notWorking.hint')}{' '}
                  {m.blocked_at
                    ? t('team.state.notWorking.hintBlocked')
                    : t('team.state.notWorking.hintOpen')}
                </p>
              </div>
            )}

            {m.staff_is_active === false && (
              <div>
                <p className="t-sm"><b>{t('team.state.notBooking.title')}</b></p>
                <p className="field-hint">{t('team.state.notBooking.hint')}</p>
              </div>
            )}
          </div>
        )}

        {outranksMe && !self && (
          <p className="field-hint">{t('team.hint.outranksMe')}</p>
        )}

        {self && <p className="field-hint">{t('team.hint.self')}</p>}

        {editable ? (
          <div className={`grid gap-3 ${cols3}`}>
            <div>
              <label className="field-label" htmlFor={`${ns}-role-${m.user_id}`}>
                {t('common.role')}
              </label>
              {/* Текущая роль обязана быть в списке, даже если она
                  выше моей: иначе select покажет чужое значение
                  и первое же касание понизит человека молча.
                  Гасим и роли, чей набор шире моего: смена роли
                  выдаёт человеку её права, а «нельзя выдать то,
                  чего нет у тебя» база проверяет и здесь (0081). */}
              <select className="select" id={`${ns}-role-${m.user_id}`} value={m.role}
                      disabled={busy === `role:${m.user_id}`}
                      onChange={(e) => setRole(m, e.target.value)}>
                {[...new Set([m.role, ...assignableRoles])].map((r) => (
                  <option key={r} value={r}
                          disabled={r !== m.role && (!assignableRoles.includes(r)
                            || notMine(r, m.permissions, m.role, m.permissions).length > 0)}>
                    {roleLabel(t, r)}
                  </option>
                ))}
              </select>
              <p className="field-hint">{roleHint(t, m.role)}</p>
            </div>

            <div>
              <label className="field-label" htmlFor={`${ns}-cap-${m.user_id}`}>
                {t('team.field.cap.label')}
              </label>
              {/* Подстановка внутри подсказки поля и процент через
                  Intl: знак и пробел перед ним ставит локаль. */}
              <input type="number" min={0} max={100} className="input"
                     id={`${ns}-cap-${m.user_id}`}
                     defaultValue={m.discount_cap_pct ?? ''}
                     placeholder={t('team.field.cap.placeholder', {
                       n: t.number(capByRole[m.role] ?? 0),
                     })}
                     disabled={busy === `cap:${m.user_id}`}
                     onBlur={(e) => setCap(m, e.target.value)} />
              <p className="field-hint">
                {t('team.field.cap.effective', {
                  pct: t.percent(m.effective_cap_pct),
                })}
              </p>
            </div>

            <div>
              <label className="field-label" htmlFor={`${ns}-exp-${m.user_id}`}>
                {t('team.field.expiry.label')}
              </label>
              {/* Значение поля даты — формат браузера, а не локали. */}
              <input type="date" className="input" id={`${ns}-exp-${m.user_id}`}
                     defaultValue={t.inputDay(m.access_expires_at)}
                     disabled={busy === `exp:${m.user_id}`}
                     onBlur={(e) => setExpiry(m, e.target.value)} />
              <p className="field-hint">{t('team.field.expiry.hint')}</p>
            </div>
          </div>
        ) : (
          // Раскрытая карточка без права записи (у роли manager
          // есть team.read и нет team.write) показывала пустоту —
          // экран выглядел сломанным. Показываем состав доступа
          // на чтение: «чому Оля не бачить фінансів» — первый
          // вопрос, с которым сюда и приходят.
          <div className={`grid gap-3 ${cols3}`}>
            <div>
              <p className="field-label">{t('common.role')}</p>
              <p className="t-md">{roleLabel(t, m.role)}</p>
              <p className="field-hint">{roleHint(t, m.role)}</p>
            </div>
            <div>
              <p className="field-label">{t('team.view.cap.label')}</p>
              <p className="t-md tabular">{t.percent(m.effective_cap_pct)}</p>
              <p className="field-hint">
                {m.discount_cap_pct === null
                  ? t('team.view.cap.byRole')
                  : t('team.view.cap.personal')}
              </p>
            </div>
            <div>
              <p className="field-label">{t('team.view.access.label')}</p>
              <p className="t-md">
                {m.access_expires_at
                  ? t('team.view.access.until', { date: t.date(m.access_expires_at) })
                  : t('team.view.access.forever')}
              </p>
              <p className="field-hint">
                {t('team.view.joined', { date: t.dateTime(m.joined_at) })}
              </p>
            </div>
          </div>
        )}

        {editable && props.templates.length > 0 && (
          <div>
            <label className="field-label" htmlFor={`${ns}-tpl-${m.user_id}`}>
              {t('team.tplApply.label')}
            </label>
            <select className={`select ${dense ? '' : 'sm:max-w-xs'}`}
                    id={`${ns}-tpl-${m.user_id}`} value=""
                    disabled={busy === `tpl:${m.user_id}`}
                    onChange={(e) => applyTemplate(m, e.target.value)}>
              <option value="">{t('team.tplApply.none')}</option>
              {/* Шаблон, который выдаёт роль выше моей или права,
                  которых у меня нет, база отклонит (0081, п. 7).
                  Гасим его здесь, а не ловим отказ после нажатия. */}
              {/* Параметр `tpl`, а не `t`: имя `t` занято
                  переводчиком, и тень над ним гасит весь экран. */}
              {props.templates.map((tpl) => {
                const off = rank(tpl.role) > myRank
                  || notMine(tpl.role, tpl.permissions, m.role, m.permissions).length > 0
                return (
                  <option key={tpl.id} value={tpl.id} disabled={off}>
                    {/* Тот же ключ, что и у роли выше: смысл один
                        — «это выше вашего доступа», и текст обязан
                        быть один. */}
                    {off ? t('team.beyond', { name: tpl.name }) : tpl.name}
                  </option>
                )
              })}
            </select>
            <p className="field-hint">{t('team.tplApply.hint')}</p>
          </div>
        )}

        {/* Точечная выдача */}
        {editable ? (
          <div>
            <p className="field-label">{t('team.perms.label')}</p>
            <p className="field-hint mb-2">
              {t('team.perms.hint')}
              {!iHaveStar && ` ${t('team.perms.hintNotMine')}`}
            </p>
            <div className={`grid gap-x-4 ${cols2}`}>
              {allPerms.map((p) => {
                const base = rolePerms.has(p)
                const val = shownPerms[p] ?? base
                const overridden = shownPerms[p] !== undefined
                // Снять можно любое право, выдать — только своё
                // (0081). Поэтому запрет ровно на включение.
                const cannotGive = !val && !iHaveStar && !myPerms.has(p)
                return (
                  // Зона нажатия — не размер квадратика: строка
                  // держит --tap-min, иначе с телефона в список
                  // из двадцати прав попасть нельзя.
                  <label key={p} className="t-sm flex items-center gap-2"
                         style={{ minHeight: 'var(--tap-min)' }}>
                    <input type="checkbox" checked={val} className="shrink-0"
                           disabled={busy === `perm:${m.user_id}:${p}` || cannotGive}
                           onChange={(e) => queuePerms(
                             permKey, `perm:${m.user_id}:${p}`,
                             shownPerms, m.role, p, e.target.checked,
                             (perms) => supabase.from('tenant_members')
                               .update({ permissions: perms })
                               .eq('tenant_id', props.tenantId)
                               .eq('user_id', m.user_id))} />
                    {/* `p` — ключ права (`stock.read`). Служебное
                        значение: не переводится ни здесь, ни ниже. */}
                    <span className={overridden ? 'font-semibold'
                      : cannotGive ? 'prose-muted' : ''}>{p}</span>
                    {overridden && (
                      <span className="badge t-xs">{t('team.perms.override')}</span>
                    )}
                  </label>
                )
              })}
            </div>
          </div>
        ) : (
          <div>
            <p className="field-label">{t('team.granted.label')}</p>
            {granted.length === 0 ? (
              <p className="t-sm prose-muted">{t('team.granted.none')}</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {granted.map((p) => (
                  <span key={p}
                        className={shownPerms[p] !== undefined ? 'badge-accent' : 'badge'}>
                    {p}
                  </span>
                ))}
              </div>
            )}
            <p className="field-hint">{t('team.granted.hint')}</p>
          </div>
        )}

        {/* Сеансы этого человека */}
        {(sessionsByUser[m.user_id] ?? []).length > 0 && (
          <div>
            <p className="field-label">{t('team.sessions.title')}</p>
            {(sessionsByUser[m.user_id] ?? []).map((s) => (
              // Строка устройства и адрес — данные, а не текст.
              <p key={s.session_id} className="t-sm prose-muted">
                {s.device?.slice(0, 60) ?? t('team.sessions.unknownDevice')}
                {' · '}{s.ip ?? '—'}{' · '}
                {t('team.sessions.lastSeen', { date: t.dateTime(s.last_seen) })}
              </p>
            ))}
            {dangerous && (
              <button type="button" className="btn-secondary t-sm mt-2"
                      disabled={busy === `sess:${m.user_id}`}
                      onClick={() => endSessions(m.user_id)}>
                {t('team.sessions.end')}
              </button>
            )}
          </div>
        )}

        {/* Опасная зона. Обе кнопки — ТОЛЬКО про доступ
            (`blocked_at`). Кнопки «не працює» здесь нет
            намеренно: `staff.blocked_at` правят исключительно
            block_member/unblock_member (0081), поэтому она
            делала бы ровно то же самое вторым именем. */}
        {dangerous && (
          m.blocked_at ? (
            <div>
              <button type="button" className="btn-secondary t-sm"
                      disabled={busy === `unblock:${m.user_id}`}
                      onClick={() => unblock(m)}>
                {t('team.block.unblock')}
              </button>
              <p className="field-hint">{t('team.block.unblockHint')}</p>
            </div>
          ) : (
            <div className="flex flex-col gap-1">
              <div className="flex flex-wrap items-end gap-2">
                <div className={`grow ${dense ? '' : 'sm:max-w-xs'}`}>
                  <label className="field-label" htmlFor={`${ns}-block-${m.user_id}`}>
                    {t('team.block.reason.label')}
                  </label>
                  <input className="input" id={`${ns}-block-${m.user_id}`}
                         value={blockReason[m.user_id] ?? ''}
                         onChange={(e) => setBlockReason(
                           (r) => ({ ...r, [m.user_id]: e.target.value }))}
                         placeholder={t('team.block.reason.placeholder')} />
                </div>
                <button type="button" className="btn-danger t-sm"
                        disabled={busy === `block:${m.user_id}`}
                        onClick={() => block(m)}>
                  {t('team.block.submit')}
                </button>
              </div>
              <p className="field-hint">{t('team.block.hint')}</p>
            </div>
          )
        )}

        {/* Передача владения. Слово-подтверждение, а не «ви впевнені»:
            действие необратимо для нажавшего — он станет админом
            и вернуть себе владение уже не сможет. Владельцу
            владение не передают: база на это отвечает «ви вже
            власник», и предлагать такое нельзя. */}
        {props.myRole === 'owner' && knowMe && !self
         && m.role !== 'owner' && !m.blocked_at && (
          <div className="card-flat flex flex-col gap-2">
            <p className="t-md">{t('team.transfer.title')}</p>
            <p className="t-sm prose-muted">{t('team.transfer.desc')}</p>
            {/* Подстановка внутри жирного — два ключа, «до» и
                «после». Разметку в словарь класть нельзя, а резать
                строку по `{name}` значит завести свой шаблонизатор
                ради одного места. */}
            <label className="field-label" htmlFor={`${ns}-own-${m.user_id}`}>
              {t('team.transfer.confirm.pre')}{' '}
              <b>{m.email ?? m.full_name}</b>{' '}
              {t('team.transfer.confirm.post')}
            </label>
            <input className="input" id={`${ns}-own-${m.user_id}`}
                   value={transferTo[m.user_id] ?? ''}
                   autoComplete="off"
                   onChange={(e) => setTransferTo(
                     (prev) => ({ ...prev, [m.user_id]: e.target.value }))} />
            <div>
              <button type="button" className="btn-danger t-sm"
                      disabled={(transferTo[m.user_id] ?? '') !== (m.email ?? m.full_name ?? '')
                                || busy === `own:${m.user_id}`}
                      onClick={() => transfer(m)}>
                {t('team.transfer.submit')}
              </button>
            </div>
          </div>
        )}
      </>
    )
  }

  // ── Бейджи состояния ────────────────────────────────────────────────────
  // Три состояния — три разных бейджа и три разных тона. Красный отдан
  // ТОЛЬКО отсутствию доступа: человек, у которого погашена карточка
  // мастера, работать не может, но в кабинет заходит, и красным его
  // помечать нельзя. Список общий у строки списка и строки таблицы:
  // разъехавшиеся тона читались бы как разные состояния.
  function stateBadges(m: Member) {
    return (
      <>
        {m.blocked_at && (
          <span className="badge-danger">{t('team.badge.noAccess')}</span>
        )}
        {m.staff_blocked_at && (
          <span className="badge-warn">{t('team.badge.notWorking')}</span>
        )}
        {m.staff_is_active === false && (
          <span className="badge">{t('team.badge.notBooking')}</span>
        )}
        {!m.blocked_at && m.access_expires_at && (
          <span className="badge-warn">
            {t('team.badge.until', { date: t.date(m.access_expires_at) })}
          </span>
        )}
      </>
    )
  }

  // Вкладки широкого экрана и их счётчики — по РЕАЛЬНЫМ данным, а не по
  // списку состояний: вкладка с нулём, которая никогда не наполнится,
  // это обещание фильтра, которого нет. «Заблоковані» считает `blocked_at`
  // и только его: погашенная карточка мастера — не блокировка доступа
  // (разбор в шапке файла).
  const blockedMembers = props.members.filter((m) => m.blocked_at)
  const activeMembers = props.members.filter((m) => !m.blocked_at)
  const webRows = webTab === 'blocked' ? blockedMembers
    : webTab === 'active' ? activeMembers
    : props.members
  const webTabs: { key: typeof webTab; label: string; n: number }[] = [
    { key: 'all', label: t('team.web.tab.all'), n: props.members.length },
    { key: 'active', label: t('team.web.tab.active'), n: activeMembers.length },
    { key: 'blocked', label: t('team.web.tab.blocked'), n: blockedMembers.length },
    { key: 'invites', label: t('team.web.tab.invites'), n: props.invites.length },
  ]
  const pickedMember = props.members.find((m) => m.user_id === picked) ?? null

  return (
    <div className="flex flex-col gap-5 pb-8">
      {/* role="alert" — отказ базы приходит после нажатия где-то ниже
          по экрану, и без объявления его просто не замечают. */}
      {error && <p className="field-error" role="alert">{error}</p>}

      {!knowMe && (
        <p className="note note-danger">{t('team.unknownSelf')}</p>
      )}

      {/* ═══ CRESKO Web, §16 «Співробітники» — хедер экрана (только lg) ═══
          Плашка со значком, имя экрана тем же ключом, которым его называет
          панель и вкладка браузера, и подпись под ним. Справа — `primary`
          «Запросити людину» из хендоффа.

          ⚠️ ПРЕЖНИЙ КОММЕНТАРИЙ ЗДЕСЬ УТВЕРЖДАЛ обратное: «кнопки нет
          намеренно, форма и так на виду». На 1440 это стоило первого
          экрана — форма из четырёх полей стояла РАСКРЫТОЙ всегда, между
          именем раздела и таблицей, ради действия, которое делают раз
          в месяц. Второго входа кнопка не заводит: на широком экране
          форма ПОЯВЛЯЕТСЯ по ней и больше нигде не лежит. На телефоне
          она по-прежнему раскрыта — там ниже неё ничего не теряется. */}
      <div className="hidden items-center justify-between gap-4 lg:flex">
        <div className="flex min-w-0 items-center gap-3">
          <span aria-hidden className="flex shrink-0 items-center justify-center"
                style={{
                  width: 44, height: 44,
                  borderRadius: 'var(--radius-plate)',
                  background: 'var(--color-accent-soft)',
                  color: 'var(--color-accent-ink)',
                }}>
            <IconUsers size={22} />
          </span>
          <div className="min-w-0">
            <h1 className="webh1" data-size="27">{t('app.screen.team.title')}</h1>
            <p style={{ fontSize: 14, color: 'var(--color-muted)' }}>
              {t('app.screen.team.desc')}
            </p>
          </div>
        </div>
        {props.canWrite && (
          <button type="button" className="btn-primary shrink-0"
                  aria-expanded={inviting}
                  onClick={() => setInviting(!inviting)}>
            {t('team.invite.title')}
          </button>
        )}
      </div>

      {/* ── Приглашение ─────────────────────────────────────────────── */}
      {props.canWrite && (
        <section className={`card rise-1 ${inviting ? '' : 'lg:hidden'}`}>
          <h2 className="t-lg mb-1">{t('team.invite.title')}</h2>
          <p className="t-md mb-4 prose-muted">{t('team.invite.desc')}</p>

          <form onSubmit={invite} className="grid gap-3 sm:grid-cols-[1fr_auto_auto_auto] sm:items-end">
            <div>
              <label className="field-label" htmlFor="invite-email">
                {t('team.invite.email.label')}
              </label>
              {/* Подсказка в поле — такая же строка интерфейса, как подпись:
                  в русском примере имя другое, в английском — другое. */}
              <input required type="email" className="input" id="invite-email" value={inviteEmail}
                     onChange={(e) => setInviteEmail(e.target.value)}
                     placeholder={t('team.invite.email.placeholder')} />
            </div>
            <div>
              <label className="field-label" htmlFor="invite-role">{t('common.role')}</label>
              {/* Роль, чей набор прав шире моего, отказывает не сейчас,
                  а через трое суток и приглашённому (0081, п. 5): роль
                  и права проверяются В МОМЕНТ ПРИЁМА. Отложенный отказ
                  чужому человеку — худший вид отказа, поэтому гасим. */}
              <select className="select" id="invite-role" value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}>
                {assignableRoles.map((r) => (
                  <option key={r} value={r} disabled={!invitable.has(r)}>
                    {/* Строка с подстановкой: собирать её сложением
                        («подпись» + « — понад ваш доступ») нельзя — порядок
                        слов в языках разный, и склейка ломается первой же. */}
                    {invitable.has(r)
                      ? roleLabel(t, r)
                      : t('team.beyond', { name: roleLabel(t, r) })}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="invite-days">
                {t('team.invite.days.label')}
              </label>
              {/* «7» — число, а не текст: в словарь оно не едет. */}
              <input type="number" min={1} max={365} className="input sm:w-28" id="invite-days"
                     value={inviteDays} onChange={(e) => setInviteDays(e.target.value)}
                     placeholder={inviteRole === 'inspector' ? '7' : t('team.invite.days.placeholder')} />
            </div>
            <button className="btn-primary" disabled={busy === 'invite'}>
              {busy === 'invite' ? t('team.invite.submitBusy') : t('team.invite.submit')}
            </button>
          </form>

          <p className="field-hint mt-2">{roleHint(t, inviteRole)}</p>

          {inviteLink && (
            <div className="card-flat mt-4 flex flex-col gap-2">
              <p className="t-md">{t('team.invite.linkReady')}</p>
              <div className="flex flex-wrap items-center gap-2">
                <code className="t-sm break-all">{inviteLink}</code>
                <button type="button" className="btn-secondary t-sm" onClick={() => void copyLink()}>
                  {copied ? t('common.copied') : t('common.copy')}
                </button>
              </div>
              <p className="t-sm prose-muted">
                {mailState === 'sending' && t('team.invite.mail.sending')}
                {mailState === 'sent' && t('team.invite.mail.sent')}
                {mailState === 'failed' && t('team.invite.mail.failed')}
              </p>
            </div>
          )}
        </section>
      )}

      {/* ── Незакрытые приглашения (узкий экран) ────────────────────── */}
      {/* На широком они живут вкладкой «Запрошення» той же таблицы:
          иначе один и тот же список стоял бы на экране дважды. */}
      {props.invites.length > 0 && (
        <section className="card rise-2 !p-0 lg:hidden">
          <div className="p-5 pb-3">
            <h2 className="t-lg">{t('team.pending.title')}</h2>
          </div>
          {props.invites.map((i) => (
            <div key={i.id} className="row px-5">
              <div className="min-w-0">
                <p className="t-md truncate">{i.email}</p>
                {/* Дата — через `t.dateTime`, а не сборкой из частей:
                    порядок «день. месяц. год» держит локаль. */}
                <p className="t-xs prose-muted">
                  {t('team.pending.meta', {
                    role: roleLabel(t, i.role),
                    date: t.dateTime(i.expires_at),
                  })}
                  {/* Числительное: 1 день / 2 дні / 5 днів. Было
                      сокращение «дн.», которое не склоняется, — теперь
                      форма выбирается по остатку. */}
                  {i.access_days ? ` · ${t.plural('team.pending.days', i.access_days)}` : ''}
                </p>
              </div>
              {props.canWrite && (
                <button type="button" className="btn-ghost t-sm"
                        disabled={busy === `inv:${i.id}`}
                        onClick={() => revokeInvite(i.id)}>
                  {t('team.pending.revoke')}
                </button>
              )}
            </div>
          ))}
        </section>
      )}

      {/* ── Команда: список с раскрытием (узкий экран) ──────────────── */}
      {/* На широком экране тот же список лежит таблицей с панелью ниже.
          Разведены по РАСКЛАДКАМ, а не спрятаны: карточка у обоих одна
          (`memberDetail`), состояние и обработчики тоже. */}
      <section className="card rise-3 !p-0 lg:hidden">
        <div className="p-5 pb-3">
          <h2 className="t-lg">{t('team.members.title')}</h2>
          <p className="t-sm prose-muted">{t('team.members.desc')}</p>
        </div>

        {props.members.length === 0 && (
          <div className="empty px-5 pb-5">
            {/* Значок — символ, а не текст: `aria-hidden`, в словарь не едет. */}
            <span className="empty-icon" aria-hidden>◎</span>
            <p className="empty-title">{t('team.members.empty.title')}</p>
            <p className="empty-desc">{t('team.members.empty.desc')}</p>
          </div>
        )}

        {props.members.map((m) => {
          const { self, live } = memberFlags(m)
          const isOpen = open === m.user_id

          return (
            <div key={m.user_id}
                 className="border-b last:border-b-0"
                 style={{ borderColor: 'var(--color-border)' }}>
              {/* Строка — не <button>: внутри неё живут блоки и вторая
                  строка текста, а содержимое кнопки по стандарту —
                  строчное. Роль и обработчик клавиатуры дают то же
                  поведение для скринридера и Tab, без неверной разметки. */}
              <div role="button" tabIndex={0} aria-expanded={isOpen}
                   className="row w-full cursor-pointer px-5 text-left"
                   onClick={() => setOpen(isOpen ? null : m.user_id)}
                   onKeyDown={(e) => {
                     if (e.key === 'Enter' || e.key === ' ') {
                       e.preventDefault(); setOpen(isOpen ? null : m.user_id)
                     }
                   }}>
                <div className="min-w-0">
                  <p className="t-md truncate">
                    {m.full_name ?? m.email ?? t('common.noName')}
                    {self && <span className="t-xs prose-muted"> {t('team.member.self')}</span>}
                  </p>
                  <p className="t-xs prose-muted truncate">
                    {m.email}
                    {live > 0 && ` · ${t.plural('team.member.sessions', live)}`}
                  </p>
                </div>
                {/* Перенос по строке — потому что на 390px четыре бейджа
                    рядом с именем не помещаются. `min-w-0` вместо `shrink-0`:
                    с последним блок брал ширину по содержимому и НЕ переносил
                    ничего — четыре бейджа уезжали за правый край экрана,
                    и страница начинала ездить вбок. */}
                <div className="flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                  {stateBadges(m)}
                  <span className={m.role === 'owner' ? 'badge-accent' : 'badge'}>
                    {roleLabel(t, m.role)}
                  </span>
                </div>
              </div>

              {isOpen && (
                <div className="flex flex-col gap-4 px-5 pb-5">
                  {memberDetail(m)}
                </div>
              )}
            </div>
          )
        })}
      </section>

      {/* ═══ CRESKO Web, §16: таблица + панель выбранного (только lg) ═══ */}
      <div className="hidden flex-col gap-4 lg:flex">
        <div className="wtabs">
          {webTabs.map((tab) => (
            <button key={tab.key} type="button" className="wtab"
                    data-active={webTab === tab.key}
                    style={{ minHeight: 'var(--tap-min)' }}
                    onClick={() => setWebTab(tab.key)}>
              {tab.label} · <span className="tabular">{t.number(tab.n)}</span>
            </button>
          ))}
        </div>

        <div className="flex gap-5">
          <div className="min-w-0 flex-1">
            {webTab === 'invites' ? (
              // Приглашение — не участник: ни роли в команде, ни прав,
              // ни даты вступления у него ещё нет. Своя таблица и своё
              // единственное действие — отозвать, тем же обработчиком,
              // что и на телефоне.
              <div className="wtable">
                <div className="wtable-head" style={{ gridTemplateColumns: IGRID }}>
                  <span>{t('team.web.invites.email')}</span>
                  <span>{t('common.role')}</span>
                  <span>{t('team.web.invites.until')}</span>
                  <span />
                </div>
                {props.invites.length === 0 ? (
                  <div className="empty">{t('team.web.invites.empty')}</div>
                ) : props.invites.map((i) => (
                  <div key={i.id} className="wtable-row"
                       style={{ gridTemplateColumns: IGRID, minHeight: 'var(--tap-min)' }}>
                    {/* Почта приглашённого — данные, не текст. */}
                    <span className="truncate font-semibold"
                          style={{ color: 'var(--color-text)' }}>{i.email}</span>
                    <span><span className="badge">{roleLabel(t, i.role)}</span></span>
                    <span className="tabular">{t.dateTime(i.expires_at)}</span>
                    <span className="flex justify-end">
                      {props.canWrite && (
                        <button type="button" className="btn-ghost"
                                disabled={busy === `inv:${i.id}`}
                                onClick={() => revokeInvite(i.id)}>
                          {t('team.pending.revoke')}
                        </button>
                      )}
                    </span>
                  </div>
                ))}
              </div>
            ) : (
              <div className="wtable">
                <div className="wtable-head" style={{ gridTemplateColumns: TGRID }}>
                  <span>{t('team.web.table.member')}</span>
                  <span>{t('common.role')}</span>
                  <span>{t('team.web.table.status')}</span>
                  <span>{t('team.web.table.perms')}</span>
                  <span>{t('team.web.table.joined')}</span>
                  <span />
                </div>
                {webRows.length === 0 ? (
                  <div className="empty">{t('team.web.table.empty')}</div>
                ) : webRows.map((m) => {
                  const { self, granted } = memberFlags(m)
                  return (
                    // Строка целиком кнопка: второго действия внутри неё
                    // нет — всё, что можно сделать с человеком, лежит
                    // в панели справа. Зона нажатия `--tap-min`: тем же
                    // экраном пользуются с планшета.
                    <button key={m.user_id} type="button" className="wtable-row"
                            aria-current={picked === m.user_id ? 'true' : undefined}
                            style={{
                              gridTemplateColumns: TGRID,
                              minHeight: 'var(--tap-min)',
                              background: picked === m.user_id
                                ? 'var(--color-accent-soft)' : undefined,
                            }}
                            onClick={() => setPicked(
                              picked === m.user_id ? null : m.user_id)}>
                      <span className="flex min-w-0 items-center gap-3">
                        {/* Аватар — буква имени: колонки под фото
                            у участника нет (`staff.avatar` пуста и
                            загрузки к ней ещё нет), а пустой серый
                            кружок был бы честнее только на вид. */}
                        <span aria-hidden className="list-anchor" data-tone="accent"
                              style={{ width: 36, height: 36, fontWeight: 650 }}>
                          {(m.full_name ?? m.email ?? '?').trim().charAt(0).toUpperCase()}
                        </span>
                        <span className="min-w-0">
                          {/* Имя и почта — данные, не переводятся. */}
                          <span className="block truncate font-semibold"
                                style={{ color: 'var(--color-text)' }}>
                            {m.full_name ?? m.email ?? t('common.noName')}
                            {self && (
                              <span className="prose-muted"> {t('team.member.self')}</span>
                            )}
                          </span>
                          <span className="block truncate"
                                style={{ color: 'var(--color-faint)' }}>{m.email}</span>
                        </span>
                      </span>
                      <span>
                        <span className={m.role === 'owner' ? 'badge-accent' : 'badge'}>
                          {roleLabel(t, m.role)}
                        </span>
                      </span>
                      <span className="flex flex-wrap gap-1">
                        {/* Ни одного состояния — значит человек работает.
                            Пустая клетка читалась бы как «данных нет». */}
                        {m.blocked_at || m.staff_blocked_at || m.staff_is_active === false
                         || m.access_expires_at
                          ? stateBadges(m)
                          : <span className="badge-success">{t('team.web.status.ok')}</span>}
                      </span>
                      <span className="tabular">
                        {m.role === 'owner'
                          ? t('team.web.perms.all')
                          : t.plural('team.web.perms.count', granted.length)}
                      </span>
                      <span className="tabular">{t.date(m.joined_at)}</span>
                      <span aria-hidden className="flex justify-end"
                            style={{ color: 'var(--color-faint)' }}>
                        <IconChevronRight size={18} />
                      </span>
                    </button>
                  )
                })}
                <div className="wtable-foot">
                  <span className="tabular">
                    {t('team.web.table.total', { n: t.number(webRows.length) })}
                  </span>
                </div>
              </div>
            )}
          </div>

          {webTab !== 'invites' && pickedMember && (
            <aside className="wpanel">
              <div className="flex items-start justify-between gap-3">
                <span aria-hidden className="list-anchor" data-tone="accent"
                      style={{ width: 66, height: 66, fontSize: 24, fontWeight: 700 }}>
                  {(pickedMember.full_name ?? pickedMember.email ?? '?')
                    .trim().charAt(0).toUpperCase()}
                </span>
                <button type="button" className="btn-icon"
                        aria-label={t('common.close.aria')}
                        onClick={() => setPicked(null)}>
                  <IconClose size={18} />
                </button>
              </div>

              <h2 className="mt-3" style={{ fontSize: 21, fontWeight: 750, lineHeight: 1.2 }}>
                {pickedMember.full_name ?? pickedMember.email ?? t('common.noName')}
              </h2>
              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                <span className={pickedMember.role === 'owner' ? 'badge-accent' : 'badge'}>
                  {roleLabel(t, pickedMember.role)}
                </span>
                {stateBadges(pickedMember)}
              </div>

              {/* Основное — тем же «ключ → значение», что и в паспорте
                  засоба: девять величин подряд без разделителей
                  сливаются в столбик текста. */}
              <p className="webh2 mb-2 mt-5">{t('team.web.panel.info')}</p>
              <div className="kv">
                <div className="kv-row">
                  <span className="kv-key">{t('team.invite.email.label')}</span>
                  <span className="kv-val truncate">
                    {pickedMember.email ?? t('common.noValue')}
                  </span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">{t('team.view.cap.label')}</span>
                  <span className="kv-val tabular">
                    {t.percent(pickedMember.effective_cap_pct)}
                  </span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">{t('team.view.access.label')}</span>
                  <span className="kv-val">
                    {pickedMember.access_expires_at
                      ? t('team.view.access.until', {
                          date: t.date(pickedMember.access_expires_at),
                        })
                      : t('team.view.access.forever')}
                  </span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">{t('team.web.table.joined')}</span>
                  <span className="kv-val tabular">{t.date(pickedMember.joined_at)}</span>
                </div>
                <div className="kv-row">
                  <span className="kv-key">{t('team.sessions.title')}</span>
                  <span className="kv-val tabular">
                    {t.plural('team.sessions.count', memberFlags(pickedMember).live)}
                  </span>
                </div>
              </div>

              {/* Дальше — та же карточка, что раскрывается под строкой
                  на телефоне: роль, стеля, срок, шаблон, точечные дозволы,
                  сеансы, блокировка и передача владения. Одно тело и одни
                  обработчики (`memberDetail`); `dense` только раскладывает
                  поля в одну колонку — на 398px трёхколоночная сетка даёт
                  три поля по сто пикселей. */}
              <div className="mt-5 flex flex-col gap-4">
                {memberDetail(pickedMember, true)}
              </div>
            </aside>
          )}
        </div>
      </div>

      {/* ── Шаблоны прав ────────────────────────────────────────────── */}
      {props.canWrite && (
        <section className="card rise-3">
          <h2 className="t-lg mb-1">{t('team.templates.title')}</h2>
          <p className="t-md mb-4 prose-muted">{t('team.templates.desc')}</p>

          {props.templates.length === 0 && (
            <p className="t-sm prose-muted">{t('team.templates.empty')}</p>
          )}

          {props.templates.map((tpl) => {
            const tRolePerms = permsByRole[tpl.role] ?? new Set<string>()
            const tOpen = openTpl === tpl.id
            const tplKey = `tpl:${tpl.id}`
            const tPerms: Record<string, boolean> =
              savedPerms[tplKey] ?? tpl.permissions ?? {}
            return (
              // Граница — на обёртке, а не на `.row`: правило
              // `.row:last-child` гасит её у последнего ребёнка, а `.row`
              // здесь всегда единственный ребёнок своего div, поэтому
              // список шаблонов шёл вообще без разделителей.
              <div key={tpl.id} className="border-b last:border-b-0"
                   style={{ borderColor: 'var(--color-border)' }}>
                <div className="row">
                  {/* Две строки текста дают около 38px — ниже --tap-min.
                      Высота задаётся здесь, а не отступами: отступы
                      раздули бы строку списка. */}
                  <button type="button" className="min-w-0 grow text-left"
                          style={{ minHeight: 'var(--tap-min)' }}
                          aria-expanded={tOpen}
                          onClick={() => setOpenTpl(tOpen ? null : tpl.id)}>
                    {/* Имя шаблона придумал человек — это данные. */}
                    <span className="t-md block truncate">{tpl.name}</span>
                    <span className="t-xs prose-muted block">
                      {roleLabel(t, tpl.role)}
                      {' · '}
                      {tpl.cap_pct !== null
                        ? t('team.templates.capTo', { pct: t.percent(tpl.cap_pct) })
                        : t('team.templates.capByRole')}
                      {' · '}
                      {Object.keys(tPerms).length === 0
                        ? t('team.templates.noPerms')
                        : t.plural('team.templates.permCount', Object.keys(tPerms).length)}
                    </span>
                  </button>
                  <button type="button" className="btn-ghost t-sm"
                          disabled={busy === `tpl-del:${tpl.id}`}
                          onClick={() => deleteTemplate(tpl.id)}>
                    {t('common.delete')}
                  </button>
                </div>

                {tOpen && (
                  <div className="card-flat mb-3 flex flex-col gap-3">
                    <div className="sm:max-w-[12rem]">
                      <label className="field-label" htmlFor={`tpl-cap-${tpl.id}`}>
                        {t('team.field.cap.label')}
                      </label>
                      <input type="number" min={0} max={100} className="input"
                             id={`tpl-cap-${tpl.id}`}
                             defaultValue={tpl.cap_pct ?? ''}
                             placeholder={t('team.field.cap.placeholder', {
                               n: t.number(capByRole[tpl.role] ?? 0),
                             })}
                             disabled={busy === `tpl-cap:${tpl.id}`}
                             onBlur={(e) => saveTemplateCap(tpl, e.target.value)} />
                    </div>
                    <div>
                      <p className="field-label">{t('team.templates.perms.label')}</p>
                      <p className="field-hint mb-2">
                        {t('team.templates.perms.hint', { role: roleLabel(t, tpl.role) })}
                        {!iHaveStar && ` ${t('team.templates.perms.hintNotMine')}`}
                      </p>
                      <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-4">
                        {allPerms.map((p) => {
                          const base = tRolePerms.has(p)
                          const val = tPerms[p] ?? base
                          const overridden = tPerms[p] !== undefined
                          return (
                            <label key={p} className="t-sm flex items-center gap-2"
                                   style={{ minHeight: 'var(--tap-min)' }}>
                              {/* Ключ занятости — на КАЖДУЮ галочку, а не
                                  на шаблон целиком: с общим ключом гасла
                                  вся сетка разом, хотя записывается одна. */}
                              <input type="checkbox" checked={val} className="shrink-0"
                                     disabled={busy === `tpl-perm:${tpl.id}:${p}`}
                                     onChange={(e) => queuePerms(
                                       tplKey, `tpl-perm:${tpl.id}:${p}`,
                                       tPerms, tpl.role, p, e.target.checked,
                                       (perms) => supabase.from('permission_templates')
                                         .update({ permissions: perms }).eq('id', tpl.id))} />
                              <span className={overridden ? 'font-semibold' : ''}>{p}</span>
                              {overridden && (
                                <span className="badge t-xs">{t('team.perms.override')}</span>
                              )}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )
          })}

          <form onSubmit={createTemplate} className="mt-4 flex flex-col gap-3">
            <div className="grid gap-3 sm:grid-cols-[1fr_auto_auto] sm:items-end">
              <div>
                <label className="field-label" htmlFor="tpl-name">
                  {t('team.templates.new.name.label')}
                </label>
                <input required className="input" id="tpl-name" value={tplName}
                       onChange={(e) => setTplName(e.target.value)}
                       placeholder={t('team.templates.new.name.placeholder')} />
              </div>
              <div>
                <label className="field-label" htmlFor="tpl-role">{t('common.role')}</label>
                <select className="select" id="tpl-role" value={tplRole}
                        onChange={(e) => setTplRole(e.target.value)}>
                  {assignableRoles.map((r) => (
                    <option key={r} value={r}>{roleLabel(t, r)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="tpl-new-cap">
                  {t('team.templates.new.cap.label')}
                </label>
                <input type="number" min={0} max={100} className="input sm:w-24" id="tpl-new-cap"
                       value={tplCap} onChange={(e) => setTplCap(e.target.value)}
                       placeholder={t('team.templates.new.cap.placeholder')} />
              </div>
            </div>

            {/* Дозволы НОВОГО шаблона — здесь же, а не «потом отредактируете».
                Шаблон, созданный пустым, применяется как чистая роль, и первое
                же применение сотрёт человеку то, ради чего шаблон и заводили. */}
            <div>
              <p className="field-label">{t('team.templates.new.perms.label')}</p>
              <p className="field-hint mb-2">
                {t('team.templates.new.perms.hint', { role: roleLabel(t, tplRole) })}
              </p>
              <div className="grid gap-x-4 sm:grid-cols-2 lg:grid-cols-4">
                {allPerms.map((p) => {
                  const base = permsByRole[tplRole]?.has(p) ?? false
                  const val = tplPerms[p] ?? base
                  const overridden = tplPerms[p] !== undefined
                  return (
                    <label key={p} className="t-sm flex items-center gap-2"
                           style={{ minHeight: 'var(--tap-min)' }}>
                      <input type="checkbox" checked={val} className="shrink-0"
                             onChange={(e) =>
                               setTplPerms(togglePermIn(tplPerms, tplRole, p, e.target.checked))} />
                      <span className={overridden ? 'font-semibold' : ''}>{p}</span>
                    </label>
                  )
                })}
              </div>
            </div>

            <div>
              <button className="btn-secondary" disabled={busy === 'tpl-new'}>
                {t('team.templates.new.submit')}
              </button>
            </div>
          </form>
        </section>
      )}

      {/* ── Все сеансы ──────────────────────────────────────────────── */}
      {/* ⚠️ Заголовок раздела называется «Сеанси» ДОСЛОВНО, и это не
          стилистика. Шаблон письма о входе с нового устройства (0085,
          `notification_templates`, событие `security.new_device`) говорит
          человеку: «відкрийте Команда → Сеанси і завершіть сеанс». Путь
          из письма обязан существовать и называться так же — иначе письмо
          отправляет туда, чего нет, и читается как обман. Раздел назывался
          «Активні сеанси», и это расхождение закрыто здесь, а не в базе:
          шаблон лежит в `notification_templates`, где его вправе
          переопределить арендатор, а заголовок экрана — наш. */}
      <section className="card rise-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="t-lg">{t('team.sessions.title')}</h2>
          {props.canWrite && props.sessions.length > 0 && (
            <button type="button" className="btn-secondary t-sm"
                    disabled={busy === 'sess:all'}
                    onClick={() => endSessions(null)}>
              {t('team.sessions.endAll')}
            </button>
          )}
        </div>
        {props.sessions.length === 0 ? (
          <p className="t-md prose-muted mt-2">{t('team.sessions.empty')}</p>
        ) : (
          <p className="t-sm prose-muted mt-2">
            {t.plural('team.sessions.count', props.sessions.length)}.
            {' '}{t('team.sessions.details')}
          </p>
        )}
      </section>

      {/* ── Журнал прав ─────────────────────────────────────────────── */}
      {/* Пишется триггером на tenant_members с 0076, а видно его стало
          только сейчас. Записи НЕИЗМЕНЯЕМЫ: ни правки, ни удаления —
          ни через приложение, ни через панель базы. Именно поэтому строка
          «Оля видала собі фінанси» тут и имеет вес. */}
      <section className="card rise-3 !p-0">
        <div className="flex flex-wrap items-center justify-between gap-2 p-5 pb-3">
          <div>
            <h2 className="t-lg">{t('team.audit.title')}</h2>
            <p className="t-sm prose-muted">{t('team.audit.desc')}</p>
          </div>
          {props.audit.length > 0 && (
            <button type="button" className="btn-secondary t-sm"
                    aria-expanded={auditOpen}
                    onClick={() => setAuditOpen(!auditOpen)}>
              {auditOpen
                ? t('team.audit.collapse')
                : t('team.audit.expand', { n: t.number(props.audit.length) })}
            </button>
          )}
        </div>

        {props.audit.length === 0 && (
          <p className="t-md prose-muted px-5 pb-5">{t('team.audit.empty')}</p>
        )}

        {auditOpen && props.audit.map((a) => (
          <div key={a.id} className="row items-start px-5">
            <div className="min-w-0">
              <p className="t-md">
                <b>{a.actor_name ?? t('team.audit.system')}</b>
                {' → '}
                {a.target_name ?? t('team.audit.member')}
              </p>
              <p className="t-xs prose-muted">{t.dateTime(a.at)}</p>

              {a.role_before !== a.role_after && (
                <p className="t-sm">
                  {t('team.audit.roleChange', {
                    before: a.role_before ? roleLabel(t, a.role_before) : '—',
                    after: a.role_after ? roleLabel(t, a.role_after) : '—',
                  })}
                </p>
              )}
              {(a.perms_added ?? []).length > 0 && (
                <p className="t-sm" style={{ color: 'var(--color-success)' }}>
                  + {(a.perms_added ?? []).join(', ')}
                </p>
              )}
              {(a.perms_removed ?? []).length > 0 && (
                <p className="t-sm" style={{ color: 'var(--color-danger)' }}>
                  − {(a.perms_removed ?? []).join(', ')}
                </p>
              )}
              {a.note && <p className="t-sm prose-muted">{a.note}</p>}
            </div>
            <span className={`${ACTION_TONE[a.action] ?? 'badge'} shrink-0`}>
              {actionLabel(t, a.action)}
            </span>
          </div>
        ))}
      </section>

      {/* ── Журнал безопасности ─────────────────────────────────────── */}
      {/* Рядом с журналом доступов и сразу после него: оба отвечают на
          вопрос «что тут происходило», только один про действия своих,
          а другой про попытки — в том числе чужие. Своим файлом, потому
          что это отдельный механизм со своей функцией чтения (0085),
          а не ещё одна секция этого экрана. */}
      <SecurityLog events={props.security} />

      {/* ── Журнал доступа к данным ─────────────────────────────────── */}
      {/* Третий журнал и третий вопрос. Первые два отвечают «кто кому что
          выдал» и «кто ломился». Этот — «кто СМОТРЕЛ»: открытая карточка
          и выгруженный список не меняют ни строки и потому не попадают
          ни в один журнал изменений. Без него на вопрос «откуда у
          конкурента телефоны моих клиентов» ответить нечем. */}
      <DataAccessLog rows={props.access} />
    </div>
  )
}
