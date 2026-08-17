import { NextResponse } from 'next/server'
import { headers } from 'next/headers'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '@/lib/supabase/config'
import { createServiceClient } from '@/lib/supabase/service'
import { guardSignIn } from '@/lib/ratelimit/guard'
import { fromCloudflare, parseAddr, type HeaderBag } from '@/lib/ratelimit/address'

export const dynamic = 'force-dynamic'
// Сервисный ключ и разбор адреса — Node, не edge. Названо явно, а не
// оставлено на умолчание: на edge-рантайме `createServiceClient` работает,
// а вот менять рантайм задним числом дороже, чем написать строку.
export const runtime = 'nodejs'

// ===========================================================================
// СЕРВЕРНЫЙ ВХОД. Единственная точка, где НЕУДАЧНЫЙ вход виден нашему коду.
// ===========================================================================
//
// ── Зачем роут, если Supabase и так проверяет пароль ───────────────────────
//
// До этого файла `signInWithPassword` звался ПРЯМО ИЗ БРАУЗЕРА (`app/(auth)/
// login/page.tsx`, `app/m/login/`), то есть мимо нас. Неудачную попытку мы
// не видели вовсе: `auth.audit_log_entries` пуста (GoTrue пишет туда только
// СОСТОЯВШИЕСЯ действия, вида «login_failed» в его перечне нет), триггерной
// точки на неудачный вход не существует — вешать триггер не на что. Всё это
// разобрано в шапке миграции 0085 и здесь не пересказывается.
//
// Отсюда разделение, которое надо держать в голове:
//
//   БАЗА умеет посчитать и запереть, КОГДА ЕЙ ОБ ЭТОМ СКАЖУТ. Говорит
//   `record_failed_login()`, и сказать ей может только серверная сторона —
//   функция выдана ТОЛЬКО `service_role`. Будь она у `authenticated` или
//   у анонима, кто угодно запирал бы чужую почту десятью вызовами.
//
// ⚠️ Этот роут НЕ ЗАМЕНЯЕТ защиту Supabase и не претендует на это. Публичный
// ключ лежит в бандле (он и не может быть секретом), и клиент, который
// стучится в `/auth/v1/token` напрямую, сюда не заходит вовсе. Такой перебор
// ограничивается там, где он проходит: ограничитель Cloudflare перед доменом
// Supabase и встроенные лимиты Supabase Auth. Роут даёт ровно одно, чего
// не было: ТОЧКУ, В КОТОРОЙ НЕУДАЧУ ВИДНО.
//
// ── Почему сессия возвращается телом, а не ставится куками здесь ───────────
//
// Куки сессии ставит браузерный клиент (`@supabase/ssr`) — он же их потом
// читает и обновляет. Поставь их роут своим набором опций — и получится два
// писателя одного хранилища, расходящихся на первой смене версии библиотеки.
// Поэтому роут отдаёт токены, а форма зовёт `setSession()`: хранилище
// остаётся ровно тем же, что и до появления роута, и меняется только то,
// ради чего он заведён, — путь запроса.
//
// ── Правило 3 соблюдено ────────────────────────────────────────────────────
//
// Сервисный ключ здесь есть, но он не на пути пользовательского РЕНДЕРА:
// это обработчик запроса формы, а не серверный компонент страницы. Ключом
// делается ровно один вызов — `record_failed_login` — и только после того,
// как GoTrue уже ответил «Invalid login credentials». Данные пользователя
// сервисным ключом не читаются ни строкой.

/** Что роут отдаёт форме при отказе из-за замка. */
type Lock = { locked: boolean; until: string | null; attempts: number }

// ── Адрес человека ─────────────────────────────────────────────────────────
//
// Тот же приём, что в `lib/ratelimit/address.ts`, и по той же причине:
// `cf-connecting-ip` — это заголовок КЛИЕНТА, и верить ему можно только
// тогда, когда запрос реально пришёл из сетей Cloudflare. Иначе тот, кто
// стучится к origin мимо Cloudflare (домен вида `<проект>.vercel.app`
// перебирается, а не утекает), подставит в журнал безопасности любой адрес
// и подпишет им чужой перебор.
//
// Почему не зовём `client()` оттуда напрямую: она отдаёт КЛЮЧ СЧЁТЧИКА
// (IPv6 свёрнут до /64 и записан шестнадцатеричным), а базе нужен `inet` —
// настоящий адрес. Разбор и список сетей при этом переиспользуются целиком,
// второй копии правила «кому верить» здесь нет.

/** Последнее значение списка `a, b, c` — то, что дописал ближайший прокси. */
function last(v: string | null | undefined): string | null {
  if (!v) return null
  const parts = v.split(',').map((s) => s.trim()).filter(Boolean)
  return parts.length ? parts[parts.length - 1] : null
}

/**
 * Адрес текстом, пригодный для `inet`: без скобок, порта и зоны интерфейса.
 * `null` — «адрес не определён»; база примет null и запишет событие без него.
 */
function textAddr(raw: string | null | undefined): string | null {
  if (!raw) return null
  let s = raw.trim()
  const bracketed = /^\[([^\]]+)\](?::\d+)?$/.exec(s)
  if (bracketed) s = bracketed[1]
  s = s.split('%')[0]
  // `1.2.3.4:5678` — IPv4 с портом. В IPv6 двоеточий всегда не меньше двух.
  const colon = s.indexOf(':')
  if (colon > 0 && s.indexOf(':', colon + 1) === -1 && s.slice(0, colon).includes('.')) {
    s = s.slice(0, colon)
  }
  // Сверка тем же разбором, что и у ограничителя: неразобранное значение
  // отправлять в `inet` нельзя — это ошибка запроса, а не пустой адрес.
  return s && parseAddr(s) ? s : null
}

function clientAddr(h: HeaderBag): string | null {
  const edgeRaw = last(h.get('x-vercel-forwarded-for'))
    ?? h.get('x-real-ip')?.trim()
    ?? last(h.get('x-forwarded-for'))
  const edge = textAddr(edgeRaw)
  if (!edge) return null

  const parsed = parseAddr(edge)
  if (parsed && fromCloudflare(parsed)) {
    const claimed = textAddr(h.get('cf-connecting-ip'))
    if (claimed) return claimed
  }
  // Пришли не через Cloudflare — заголовки клиента игнорируются целиком.
  return edge
}

// ── Сама попытка ───────────────────────────────────────────────────────────

export async function POST(req: Request) {
  let body: { email?: unknown; password?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  const email = typeof body.email === 'string' ? body.email.trim() : ''
  const password = typeof body.password === 'string' ? body.password : ''
  if (!email || !password) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 })
  }

  // Ограничитель частоты. Раньше его звала сама форма — теперь он здесь,
  // и это не «перенос для порядка»: попытка входа тратит ровно один счётчик,
  // а не два. Если бы вызов остался и в форме, и здесь, предел 5 за 15 хвилин
  // молча стал бы пределом 2 (ровно та ошибка, от которой `rules.ts`
  // отказалась для серверных действий).
  //
  // ⚠️ По той же причине `/api/auth/sign-in` НЕ должен попасть в список
  // SIGNIN в `lib/ratelimit/rules.ts`: путь считается там по `any`, а `signin`
  // тратится здесь явно и по смыслу.
  const gate = await guardSignIn()
  if (!gate.ok) {
    return NextResponse.json(
      { error: gate.message, limited: true },
      { status: 429, headers: { 'Retry-After': String(gate.retryAfter) } },
    )
  }

  const h = await headers()
  const ip = clientAddr(h)
  const ua = h.get('user-agent')?.slice(0, 400) ?? null

  // Обычный публичный ключ и никакого хранилища: сессию роут не держит,
  // он её только передаёт форме.
  const auth = createSupabaseClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
    auth: { autoRefreshToken: false, persistSession: false },
  })

  const { data, error } = await auth.auth.signInWithPassword({ email, password })

  if (!error && data.session) {
    return NextResponse.json({
      ok: true,
      session: {
        access_token: data.session.access_token,
        refresh_token: data.session.refresh_token,
      },
    })
  }

  const message = error?.message ?? 'sign_in_failed'
  const lower = message.toLowerCase()

  // ⚠️ Разбирается ОТВЕТ СЕРВЕРА, а не текст для человека: подстрока
  // английская навсегда (`lib/auth-errors.ts`, «две стороны этого файла»).
  // Считаем только НЕВЕРНЫЙ ПАРОЛЬ. «Email not confirmed» и «user is banned» —
  // не попытка подбора: первое означает недорегистрацию, второе значит, что
  // замок УЖЕ стоит, и досчитывать его до бесконечности незачем.
  let lock: Lock | null = null
  if (lower.includes('invalid login credentials')) {
    lock = await recordFailure(email, ip, ua)
  }

  return NextResponse.json(
    { error: message, status: error?.status ?? 400, lock },
    // 423 Locked — отдельный код намеренно: форма по нему показывает экран
    // замка, а не строку «невірний пароль» под полем. Молчаливый отказ
    // читается как поломка продукта.
    { status: lock?.locked ? 423 : 401 },
  )
}

/**
 * Сказать базе о неудачной попытке. Возвращает «заперто / до какого времени /
 * сколько попыток» либо `null`, если сказать не удалось.
 *
 * ⚠️ Ни одна ошибка отсюда наружу не идёт. Незаданный `SUPABASE_SERVICE_ROLE_KEY`
 * на превью-развёртывании или недоступная база не имеют права превратить
 * «невірний пароль» в 500: человек с верным паролем в этот момент входит,
 * и его вход не должен зависеть от того, посчитали ли мы чужую попытку.
 */
async function recordFailure(
  email: string, ip: string | null, ua: string | null,
): Promise<Lock | null> {
  try {
    const service = createServiceClient()
    const { data, error } = await service.rpc('record_failed_login', {
      p_email: email,
      p_ip: ip,
      p_user_agent: ua,
    })
    if (error) throw new Error(error.message)

    const row = (data ?? {}) as { locked?: boolean; until?: string; attempts?: number }
    return {
      locked: row.locked === true,
      until: typeof row.until === 'string' ? row.until : null,
      attempts: typeof row.attempts === 'number' ? row.attempts : 0,
    }
  } catch (e) {
    // Тихий сторож, сломавшийся полгода назад, не отличим от сторожа,
    // которому нечего сказать (та же мысль, что в `auth_session_device_watch`).
    console.warn('[auth] невдалий вхід не записано:',
      e instanceof Error ? e.message : String(e))
    return null
  }
}
