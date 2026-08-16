'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { abs } from '@/lib/site'

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

// Журнал пишется триггером на `tenant_members` (0080), то есть события
// `blocked`/`unblocked` в нём — ТОЛЬКО про доступ. Карточка мастера
// в журнал прав не попадает и попадать не должна: это не право.
// Отсюда и подписи — «закрито доступ», а не «заблоковано»: последнее
// на этом экране теперь значит два разных состояния.
const ACTION_LABEL: Record<string, string> = {
  added: 'додано в команду', removed: 'прибрано з команди',
  changed: 'змінено доступ', blocked: 'закрито доступ', unblocked: 'відкрито доступ',
}
const ACTION_TONE: Record<string, string> = {
  added: 'badge-success', removed: 'badge-danger', changed: 'badge',
  blocked: 'badge-danger', unblocked: 'badge-success',
}

const ROLE_LABEL: Record<string, string> = {
  owner: 'власник', admin: 'адміністратор', manager: 'менеджер',
  operator: 'майстер / склад', accountant: 'бухгалтер',
  viewer: 'перегляд', inspector: 'інспектор',
}

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

// Дата МЕСТНЫМИ частями, а не срезом `toISOString()`. Срез режет по UTC,
// а в поле `<input type="date">` дата пишется как местная полночь-без-минуты
// (`${value}T23:59:59`), и для отрицательных смещений одно и то же значение
// показывалось в поле одним днём, а в бейдже «до …» — предыдущим.
function fmtDay(ts: string | null): string {
  if (!ts) return ''
  const d = new Date(ts)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

// Украинские числительные: 1 сеанс, 2 сеанси, 5 сеансів. Приём тот же,
// что в lib/email/templates.ts — выбор формы по остатку; библиотека ради
// двух строк не нужна. Проверка `> 1` давала «5 сеанси».
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}

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
function teamErrorText(raw: string): string {
  const m = raw.toLowerCase()

  if (m.includes('perms_no_star'))
    return 'Дозвіл «*» видати не можна: це повний доступ власника.'

  // Два разных отказа по рангу с одинаковым хвостом: один про правку
  // строки (сторож), другой про принудительный выход (`end_sessions`).
  if (m.includes('завершити сеанси того'))
    return 'Ця людина за роллю вища за вас — завершити її сеанси не можна.'

  if (m.includes('чия роль вища за власну'))
    return 'Ця людина за роллю вища за вас — змінювати її може лише рівний їй або вищий.'

  if (m.includes('видати роль, вищу за власну')) {
    const pair = raw.match(/\(([a-z_]+) > ([a-z_]+)\)/)
    const label = pair ? ROLE_LABEL[pair[1]] ?? pair[1] : ''
    return label
      ? `Роль «${label}» вища за вашу — видати її не можна.`
      : 'Не можна видати роль, вищу за власну.'
  }

  if (m.includes('row-level security') || m.includes('permission denied'))
    return 'Недостатньо прав для цієї дії. Можливо, ваш доступ щойно змінили — оновіть сторінку.'

  if (m.includes('jwt') || m.includes('не автентифіковано'))
    return 'Сеанс завершено. Увійдіть заново.'

  // База отвечает по-украински намеренно (0081): её отказы уже написаны
  // для человека и объясняют, что делать. Переписывать их здесь значит
  // разойтись с ними при первой же правке миграции.
  if (/[а-яіїєґ]/i.test(raw)) return raw

  return 'Дію не виконано. Спробуйте ще раз або оновіть сторінку.'
}

export function TeamClient(props: {
  tenantId: string; myUserId: string | null; myRole: string
  canWrite: boolean
  members: Member[]; invites: Invite[]; sessions: Session[]
  templates: Template[]
  grants: { role: string; permission: string }[]
  caps: { role: string; cap_pct: number }[]
  audit: Audit[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  const [busy, setBusy] = useState('')
  const [error, setError] = useState('')
  const [open, setOpen] = useState<string | null>(null)
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
      if (error) { setError(teamErrorText(error.message)); return false }
    } catch {
      // Обрыв связи. Без этого перехвата очередь записи прав ниже
      // повисла бы навсегда: следующее переключение ждало бы обещание,
      // которое никогда не разрешится.
      setError('Немає зв’язку з сервером — спробуйте ще раз.')
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
    if (error) { setError(teamErrorText(error.message)); return }

    const row = Array.isArray(data) ? data[0] : data
    const token = row?.token as string | undefined
    if (!token) { setError('Запрошення створено, але посилання не повернулося.'); router.refresh(); return }

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
      setError('Скопіювати не вдалося — виділіть посилання і скопіюйте вручну.')
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
    setTransferTo((t) => { const copy = { ...t }; delete copy[m.user_id]; return copy })
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

  async function saveTemplateCap(t: Template, value: string) {
    const cap = value.trim() === '' ? null : Math.max(0, Math.min(100, Number(value)))
    await run(`tpl-cap:${t.id}`, () =>
      supabase.from('permission_templates').update({ cap_pct: cap }).eq('id', t.id))
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

  return (
    <div className="flex flex-col gap-5 pb-8">
      {/* role="alert" — отказ базы приходит после нажатия где-то ниже
          по экрану, и без объявления его просто не замечают. */}
      {error && <p className="field-error" role="alert">{error}</p>}

      {!knowMe && (
        <p className="note note-danger">
          Не вдалося визначити, під ким ви увійшли, тому блокування,
          завершення сеансів і передача володіння сховані: інакше екран
          запропонував би застосувати їх до вас самих. Оновіть сторінку
          або увійдіть заново.
        </p>
      )}

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
              <label className="field-label" htmlFor="invite-email">Пошта</label>
              <input required type="email" className="input" id="invite-email" value={inviteEmail}
                     onChange={(e) => setInviteEmail(e.target.value)}
                     placeholder="olya@example.com" />
            </div>
            <div>
              <label className="field-label" htmlFor="invite-role">Роль</label>
              {/* Роль, чей набор прав шире моего, отказывает не сейчас,
                  а через трое суток и приглашённому (0081, п. 5): роль
                  и права проверяются В МОМЕНТ ПРИЁМА. Отложенный отказ
                  чужому человеку — худший вид отказа, поэтому гасим. */}
              <select className="select" id="invite-role" value={inviteRole}
                      onChange={(e) => setInviteRole(e.target.value)}>
                {assignableRoles.map((r) => (
                  <option key={r} value={r} disabled={!invitable.has(r)}>
                    {ROLE_LABEL[r] ?? r}{invitable.has(r) ? '' : ' — понад ваш доступ'}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className="field-label" htmlFor="invite-days">Доступ, днів</label>
              <input type="number" min={1} max={365} className="input sm:w-28" id="invite-days"
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
                <button type="button" className="btn-secondary t-sm" onClick={() => void copyLink()}>
                  {copied ? 'Скопійовано ✓' : 'Скопіювати'}
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

        {props.members.length === 0 && (
          <div className="empty px-5 pb-5">
            <span className="empty-icon" aria-hidden>◎</span>
            <p className="empty-title">Список порожній</p>
            <p className="empty-desc">
              Тут з’являться всі, хто прийняв запрошення.
            </p>
          </div>
        )}

        {props.members.map((m) => {
          const self = knowMe && m.user_id === props.myUserId
          // Строку того, чья роль выше моей, сторож не пускает ВООБЩЕ —
          // ни роль, ни срок, ни стелю, ни блокировку (0081). Раньше
          // экран показывал управляющему полный набор полей на карточке
          // администратора, и каждое из них отвечало отказом.
          const outranksMe = rank(m.role) > myRank
          // Без своего id правим только через «только чтение»: иначе
          // экран предложит понизить роль самому себе, а база откажет
          // (0052) — человек решит, что сломано.
          const editable = props.canWrite && knowMe && !self
            && !outranksMe && m.role !== 'owner'
          // Блокировка и принудительный выход — тоже по рангу: у обоих
          // проверка стоит в базе (`end_sessions` явно, `block_member` —
          // через сторожа на UPDATE). Строка владельца сюда не попадает
          // никогда: он выше всех, а сам себя не блокирует.
          const dangerous = props.canWrite && knowMe && !self && !outranksMe
          const isOpen = open === m.user_id
          const rolePerms = permsByRole[m.role] ?? new Set<string>()
          const live = sessionsByUser[m.user_id]?.length ?? 0
          const permKey = `member:${m.user_id}`
          const shownPerms: Record<string, boolean> =
            savedPerms[permKey] ?? m.permissions ?? {}
          const granted = allPerms.filter((p) => shownPerms[p] ?? rolePerms.has(p))

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
                    {m.full_name ?? m.email ?? 'Без імені'}
                    {self && <span className="t-xs prose-muted"> — це ви</span>}
                  </p>
                  <p className="t-xs prose-muted truncate">
                    {m.email}
                    {live > 0 && ` · ${live} ${plural(live,
                      'активний сеанс', 'активні сеанси', 'активних сеансів')}`}
                  </p>
                </div>
                {/* Три состояния — три разных бейджа и три разных тона.
                    Красный отдан ТОЛЬКО отсутствию доступа: человек,
                    у которого погашена карточка мастера, работать не может,
                    но в кабинет заходит, и красным его помечать нельзя.
                    Перенос по строке — потому что на 390px четыре бейджа
                    рядом с именем не помещаются. */}
                <div className="flex shrink-0 flex-wrap items-center justify-end gap-1.5">
                  {m.blocked_at && <span className="badge-danger">немає доступу</span>}
                  {m.staff_blocked_at && <span className="badge-warn">не працює</span>}
                  {m.staff_is_active === false && (
                    <span className="badge">не приймає записи</span>
                  )}
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
                  {/* Развёрнутое объяснение каждого состояния: бейдж
                      называет, а карточка отвечает на «и что теперь».
                      Три состояния независимы и могут стоять разом. */}
                  {(m.blocked_at || m.staff_blocked_at || m.staff_is_active === false) && (
                    <div className="card-flat flex flex-col gap-3">
                      {m.blocked_at && (
                        <div>
                          <p className="t-sm">
                            <b>Немає доступу</b> з {fmt(m.blocked_at)}
                            {m.blocked_reason ? ` · ${m.blocked_reason}` : ''}
                          </p>
                          <p className="field-hint">
                            У кабінет не зайде — ні з телефона, ні за прямим
                            посиланням. Знімається кнопкою «Розблокувати»:
                            вона поверне і доступ, і картку майстра.
                          </p>
                        </div>
                      )}

                      {m.staff_blocked_at && (
                        <div>
                          <p className="t-sm">
                            <b>Не працює</b> з {fmt(m.staff_blocked_at)}
                            {m.staff_blocked_reason ? ` · ${m.staff_blocked_reason}` : ''}
                          </p>
                          <p className="field-hint">
                            Це картка майстра в розділі «Записи», а не доступ:
                            людина зникає з розкладу й зі списку, на кого
                            записують клієнта.{' '}
                            {m.blocked_at
                              ? 'Повернеться разом із доступом.'
                              : 'Кабінет при цьому відкритий. Окремої кнопки тут немає: картку гасить і повертає те саме блокування доступу.'}
                          </p>
                        </div>
                      )}

                      {m.staff_is_active === false && (
                        <div>
                          <p className="t-sm"><b>Не приймає записи</b></p>
                          <p className="field-hint">
                            Відпустка або лікарняний: доступ у кабінет є,
                            у розкладі людини немає. Вмикають і вимикають
                            у картці майстра — розділ «Записи», не тут.
                          </p>
                        </div>
                      )}
                    </div>
                  )}

                  {outranksMe && !self && (
                    <p className="field-hint">
                      Ця людина за роллю вища за вас, тому її картка тут
                      тільки для перегляду: ні роль, ні строк, ні блокування
                      змінити не вийде. Це зробить власник або рівний їй.
                    </p>
                  )}

                  {self && (
                    <p className="field-hint">
                      Свою роль і свої права змінити не можна — це захист від
                      втрати доступу до власного закладу. Попросіть іншого
                      власника або передайте володіння.
                    </p>
                  )}

                  {editable ? (
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <label className="field-label" htmlFor={`role-${m.user_id}`}>Роль</label>
                        {/* Текущая роль обязана быть в списке, даже если она
                            выше моей: иначе select покажет чужое значение
                            и первое же касание понизит человека молча.
                            Гасим и роли, чей набор шире моего: смена роли
                            выдаёт человеку её права, а «нельзя выдать то,
                            чего нет у тебя» база проверяет и здесь (0081). */}
                        <select className="select" id={`role-${m.user_id}`} value={m.role}
                                disabled={busy === `role:${m.user_id}`}
                                onChange={(e) => setRole(m, e.target.value)}>
                          {[...new Set([m.role, ...assignableRoles])].map((r) => (
                            <option key={r} value={r}
                                    disabled={r !== m.role && (!assignableRoles.includes(r)
                                      || notMine(r, m.permissions, m.role, m.permissions).length > 0)}>
                              {ROLE_LABEL[r] ?? r}
                            </option>
                          ))}
                        </select>
                        <p className="field-hint">{ROLE_HINT[m.role]}</p>
                      </div>

                      <div>
                        <label className="field-label" htmlFor={`cap-${m.user_id}`}>Стеля знижки, %</label>
                        <input type="number" min={0} max={100} className="input"
                               id={`cap-${m.user_id}`}
                               defaultValue={m.discount_cap_pct ?? ''}
                               placeholder={`за роллю — ${capByRole[m.role] ?? 0}`}
                               disabled={busy === `cap:${m.user_id}`}
                               onBlur={(e) => setCap(m, e.target.value)} />
                        <p className="field-hint">Зараз діє {m.effective_cap_pct}%.</p>
                      </div>

                      <div>
                        <label className="field-label" htmlFor={`exp-${m.user_id}`}>Доступ до</label>
                        <input type="date" className="input" id={`exp-${m.user_id}`}
                               defaultValue={fmtDay(m.access_expires_at)}
                               disabled={busy === `exp:${m.user_id}`}
                               onBlur={(e) => setExpiry(m, e.target.value)} />
                        <p className="field-hint">Порожньо — безстроково.</p>
                      </div>
                    </div>
                  ) : (
                    // Раскрытая карточка без права записи (у роли manager
                    // есть team.read и нет team.write) показывала пустоту —
                    // экран выглядел сломанным. Показываем состав доступа
                    // на чтение: «чому Оля не бачить фінансів» — первый
                    // вопрос, с которым сюда и приходят.
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div>
                        <p className="field-label">Роль</p>
                        <p className="t-md">{ROLE_LABEL[m.role] ?? m.role}</p>
                        <p className="field-hint">{ROLE_HINT[m.role]}</p>
                      </div>
                      <div>
                        <p className="field-label">Стеля знижки</p>
                        <p className="t-md tabular">{m.effective_cap_pct}%</p>
                        <p className="field-hint">
                          {m.discount_cap_pct === null ? 'за роллю' : 'окремо для людини'}
                        </p>
                      </div>
                      <div>
                        <p className="field-label">Доступ</p>
                        <p className="t-md">
                          {m.access_expires_at ? `до ${fmtDay(m.access_expires_at)}` : 'безстроково'}
                        </p>
                        <p className="field-hint">у команді з {fmt(m.joined_at)}</p>
                      </div>
                    </div>
                  )}

                  {editable && props.templates.length > 0 && (
                    <div>
                      <label className="field-label" htmlFor={`tpl-${m.user_id}`}>Застосувати шаблон</label>
                      <select className="select sm:max-w-xs" id={`tpl-${m.user_id}`} value=""
                              disabled={busy === `tpl:${m.user_id}`}
                              onChange={(e) => applyTemplate(m, e.target.value)}>
                        <option value="">— обрати —</option>
                        {/* Шаблон, который выдаёт роль выше моей или права,
                            которых у меня нет, база отклонит (0081, п. 7).
                            Гасим его здесь, а не ловим отказ после нажатия. */}
                        {props.templates.map((t) => {
                          const off = rank(t.role) > myRank
                            || notMine(t.role, t.permissions, m.role, m.permissions).length > 0
                          return (
                            <option key={t.id} value={t.id} disabled={off}>
                              {t.name}{off ? ' — понад ваш доступ' : ''}
                            </option>
                          )
                        })}
                      </select>
                      <p className="field-hint">
                        Шаблон перезаписує роль, точкові дозволи й стелю знижки.
                      </p>
                    </div>
                  )}

                  {/* Точечная выдача */}
                  {editable ? (
                    <div>
                      <p className="field-label">Точкові дозволи</p>
                      <p className="field-hint mb-2">
                        Галочка, що збігається з роллю, не зберігається окремо:
                        зміниться роль — зміниться й доступ.
                        {!iHaveStar && ' Погашені — це те, чого немає у вас самих: видати таке база не дасть.'}
                      </p>
                      <div className="grid gap-x-4 sm:grid-cols-2">
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
                              <span className={overridden ? 'font-semibold'
                                : cannotGive ? 'prose-muted' : ''}>{p}</span>
                              {overridden && <span className="badge t-xs">окремо</span>}
                            </label>
                          )
                        })}
                      </div>
                    </div>
                  ) : (
                    <div>
                      <p className="field-label">Що дозволено</p>
                      {granted.length === 0 ? (
                        <p className="t-sm prose-muted">
                          Нічого понад перегляд власного профілю.
                        </p>
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
                      <p className="field-hint">
                        Синім — видане окремо, поза набором ролі.
                      </p>
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
                      {dangerous && (
                        <button type="button" className="btn-secondary t-sm mt-2"
                                disabled={busy === `sess:${m.user_id}`}
                                onClick={() => endSessions(m.user_id)}>
                          Завершити сеанси
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
                          Розблокувати
                        </button>
                        <p className="field-hint">
                          Поверне і доступ до кабінету, і картку майстра
                          в розкладі.
                        </p>
                      </div>
                    ) : (
                      <div className="flex flex-col gap-1">
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="grow sm:max-w-xs">
                            <label className="field-label" htmlFor={`block-${m.user_id}`}>
                              Причина блокування
                            </label>
                            <input className="input" id={`block-${m.user_id}`}
                                   value={blockReason[m.user_id] ?? ''}
                                   onChange={(e) => setBlockReason(
                                     (r) => ({ ...r, [m.user_id]: e.target.value }))}
                                   placeholder="звільнення, втрата телефону…" />
                          </div>
                          <button type="button" className="btn-danger t-sm"
                                  disabled={busy === `block:${m.user_id}`}
                                  onClick={() => block(m)}>
                            Заблокувати доступ
                          </button>
                        </div>
                        <p className="field-hint">
                          Закриє вхід у кабінет і заразом погасить картку
                          майстра: людина зникне і зі списку, на кого
                          записують клієнта. Причина йде в незмінний журнал.
                        </p>
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
                      <p className="t-md">Передати володіння закладом</p>
                      <p className="t-sm prose-muted">
                        Ви станете адміністратором, а сеанси на цьому пристрої
                        завершаться — доведеться увійти заново. Повернути
                        володіння зможе тільки новий власник.
                      </p>
                      <label className="field-label" htmlFor={`own-${m.user_id}`}>
                        Надрукуйте <b>{m.email ?? m.full_name}</b> для підтвердження
                      </label>
                      <input className="input" id={`own-${m.user_id}`}
                             value={transferTo[m.user_id] ?? ''}
                             autoComplete="off"
                             onChange={(e) => setTransferTo(
                               (t) => ({ ...t, [m.user_id]: e.target.value }))} />
                      <div>
                        <button type="button" className="btn-danger t-sm"
                                disabled={(transferTo[m.user_id] ?? '') !== (m.email ?? m.full_name ?? '')
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

          {props.templates.length === 0 && (
            <p className="t-sm prose-muted">Шаблонів ще немає — створіть перший нижче.</p>
          )}

          {props.templates.map((t) => {
            const tRolePerms = permsByRole[t.role] ?? new Set<string>()
            const tOpen = openTpl === t.id
            const tplKey = `tpl:${t.id}`
            const tPerms: Record<string, boolean> =
              savedPerms[tplKey] ?? t.permissions ?? {}
            return (
              // Граница — на обёртке, а не на `.row`: правило
              // `.row:last-child` гасит её у последнего ребёнка, а `.row`
              // здесь всегда единственный ребёнок своего div, поэтому
              // список шаблонов шёл вообще без разделителей.
              <div key={t.id} className="border-b last:border-b-0"
                   style={{ borderColor: 'var(--color-border)' }}>
                <div className="row">
                  {/* Две строки текста дают около 38px — ниже --tap-min.
                      Высота задаётся здесь, а не отступами: отступы
                      раздули бы строку списка. */}
                  <button type="button" className="min-w-0 grow text-left"
                          style={{ minHeight: 'var(--tap-min)' }}
                          aria-expanded={tOpen}
                          onClick={() => setOpenTpl(tOpen ? null : t.id)}>
                    <span className="t-md block truncate">{t.name}</span>
                    <span className="t-xs prose-muted block">
                      {ROLE_LABEL[t.role] ?? t.role}
                      {t.cap_pct !== null ? ` · знижка до ${t.cap_pct}%` : ' · знижка за роллю'}
                      {' · '}
                      {Object.keys(tPerms).length === 0
                        ? 'без точкових дозволів'
                        : `${Object.keys(tPerms).length} ${plural(Object.keys(tPerms).length,
                            'точковий дозвіл', 'точкові дозволи', 'точкових дозволів')}`}
                    </span>
                  </button>
                  <button type="button" className="btn-ghost t-sm"
                          disabled={busy === `tpl-del:${t.id}`}
                          onClick={() => deleteTemplate(t.id)}>
                    Видалити
                  </button>
                </div>

                {tOpen && (
                  <div className="card-flat mb-3 flex flex-col gap-3">
                    <div className="sm:max-w-[12rem]">
                      <label className="field-label" htmlFor={`tpl-cap-${t.id}`}>Стеля знижки, %</label>
                      <input type="number" min={0} max={100} className="input"
                             id={`tpl-cap-${t.id}`}
                             defaultValue={t.cap_pct ?? ''}
                             placeholder={`за роллю — ${capByRole[t.role] ?? 0}`}
                             disabled={busy === `tpl-cap:${t.id}`}
                             onBlur={(e) => saveTemplateCap(t, e.target.value)} />
                    </div>
                    <div>
                      <p className="field-label">Точкові дозволи шаблону</p>
                      <p className="field-hint mb-2">
                        Зберігається лише те, що ВІДРІЗНЯЄТЬСЯ від ролі
                        «{ROLE_LABEL[t.role] ?? t.role}». Збіг із роллю не
                        записується: зміниться набір ролі — зміниться й шаблон.
                        {!iHaveStar && ' Шаблон, що видає більше, ніж є у вас, база не застосує — у картці людини він буде погашений.'}
                      </p>
                      <div className="grid gap-x-4 sm:grid-cols-2">
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
                                     disabled={busy === `tpl-perm:${t.id}:${p}`}
                                     onChange={(e) => queuePerms(
                                       tplKey, `tpl-perm:${t.id}:${p}`,
                                       tPerms, t.role, p, e.target.checked,
                                       (perms) => supabase.from('permission_templates')
                                         .update({ permissions: perms }).eq('id', t.id))} />
                              <span className={overridden ? 'font-semibold' : ''}>{p}</span>
                              {overridden && <span className="badge t-xs">окремо</span>}
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
                <label className="field-label" htmlFor="tpl-name">Назва</label>
                <input required className="input" id="tpl-name" value={tplName}
                       onChange={(e) => setTplName(e.target.value)}
                       placeholder="Майстер зміни" />
              </div>
              <div>
                <label className="field-label" htmlFor="tpl-role">Роль</label>
                <select className="select" id="tpl-role" value={tplRole}
                        onChange={(e) => setTplRole(e.target.value)}>
                  {assignableRoles.map((r) => (
                    <option key={r} value={r}>{ROLE_LABEL[r] ?? r}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="field-label" htmlFor="tpl-new-cap">Знижка, %</label>
                <input type="number" min={0} max={100} className="input sm:w-24" id="tpl-new-cap"
                       value={tplCap} onChange={(e) => setTplCap(e.target.value)}
                       placeholder="за роллю" />
              </div>
            </div>

            {/* Дозволы НОВОГО шаблона — здесь же, а не «потом отредактируете».
                Шаблон, созданный пустым, применяется как чистая роль, и первое
                же применение сотрёт человеку то, ради чего шаблон и заводили. */}
            <div>
              <p className="field-label">Точкові дозволи нового шаблону</p>
              <p className="field-hint mb-2">
                Відносно ролі «{ROLE_LABEL[tplRole] ?? tplRole}». Порожньо —
                шаблон ставить чисту роль.
              </p>
              <div className="grid gap-x-4 sm:grid-cols-2">
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
                Додати шаблон
              </button>
            </div>
          </form>
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
            {props.sessions.length}{' '}
            {plural(props.sessions.length, 'сеанс', 'сеанси', 'сеансів')}.
            {' '}Подробиці — у картці людини вище.
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
            <h2 className="t-lg">Журнал доступів</h2>
            <p className="t-sm prose-muted">
              Хто, кому й що змінив. Записи не редагуються і не видаляються —
              навіть власником.
            </p>
          </div>
          {props.audit.length > 0 && (
            <button type="button" className="btn-secondary t-sm"
                    aria-expanded={auditOpen}
                    onClick={() => setAuditOpen(!auditOpen)}>
              {auditOpen ? 'Згорнути' : `Показати (${props.audit.length})`}
            </button>
          )}
        </div>

        {props.audit.length === 0 && (
          <p className="t-md prose-muted px-5 pb-5">
            Поки порожньо: доступи ще ніхто не змінював.
          </p>
        )}

        {auditOpen && props.audit.map((a) => (
          <div key={a.id} className="row items-start px-5">
            <div className="min-w-0">
              <p className="t-md">
                <b>{a.actor_name ?? 'система'}</b>
                {' → '}
                {a.target_name ?? 'учасник'}
              </p>
              <p className="t-xs prose-muted">{fmt(a.at)}</p>

              {a.role_before !== a.role_after && (
                <p className="t-sm">
                  роль: {a.role_before ? (ROLE_LABEL[a.role_before] ?? a.role_before) : '—'}
                  {' → '}
                  {a.role_after ? (ROLE_LABEL[a.role_after] ?? a.role_after) : '—'}
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
              {ACTION_LABEL[a.action] ?? a.action}
            </span>
          </div>
        ))}
      </section>
    </div>
  )
}
