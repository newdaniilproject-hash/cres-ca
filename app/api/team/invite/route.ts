import { createHash } from 'node:crypto'
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can } from '@/lib/tenant'
import { mailTeamInvite } from '@/lib/email/templates'
import { sendEmail } from '@/lib/notify/send'
import { abs } from '@/lib/site'

export const dynamic = 'force-dynamic'
// node:crypto — встроенный модуль Node, но на edge-рантайме его нет.
// Сверка хеша токена (ниже) без него не работает, поэтому рантайм
// назван явно, а не оставлен на умолчание.
export const runtime = 'nodejs'

const ROLE_LABEL: Record<string, string> = {
  owner: 'власник', admin: 'адміністратор', manager: 'менеджер',
  operator: 'майстер / склад', accountant: 'бухгалтер',
  viewer: 'перегляд', inspector: 'інспектор',
}

// Письмо с приглашением.
//
// Роут существует по одной причине: RESEND_API_KEY — серверный секрет,
// и отправить письмо из браузера нельзя. Вся ЛОГИКА приглашения при этом
// остаётся в базе — здесь только конверт.
//
// ⚠️ Проверка прав повторяется ЗДЕСЬ полностью, хотя ссылку выдала база.
// Иначе роут становится способом разослать письмо от имени CRESKO
// с произвольным текстом ссылки: адрес приглашения приходит из тела
// запроса, а его никто не подписывал. Поэтому: у вошедшего должно быть
// team.write в названном заведении, и приглашение на эту почту должно
// действительно висеть неоплаченным. Адрес письма собирается ЗДЕСЬ
// из токена, а не берётся из тела, — чтобы в письмо нельзя было
// подставить чужой домен.
//
// ⚠️ И этого мало: `abs()` защищает домен, но не путь. Без сверки самого
// токена в письмо от имени CRESKO кладётся ЛЮБОЙ адрес нашего же домена
// (`/invite/<что угодно>` — а дальше хоть `../..`), и достаточно одного
// живого приглашения на этот адрес, чтобы рассылать такие письма сколько
// угодно. Сверяем: sha256 присланного токена обязан совпасть с
// `invitations.token_hash`.
//
// Почему хеш считается здесь, а не берётся ссылка из базы: в базе
// секрета НЕТ вовсе — 0050 хранит только `token_hash`, сам токен
// показывается один раз в ответе `create_invitation`. Вернуть готовую
// ссылку неоткуда, значит остаётся сверка. Зависимостей она не требует:
// `node:crypto` встроен, а алгоритм тот же, что в базе (sha256 → hex).
//
// Сравнение обычным `!==`, без timingSafeEqual: сравниваются ХЕШИ, и по
// времени сравнения подобрать можно разве что хеш, который и так лежит
// в базе, — сам токен из него не восстанавливается.

// Ограничение частоты. Новых таблиц и колонок под это не заводим
// (SQL правит другой агент), поэтому ограничителя два, и каждый закрывает
// ровно свою дыру:
//
// 1. `SEND_COOLDOWN_MS` — память процесса: «на эту почту в этом заведении
//    письмо уже уходило меньше минуты назад». Это единственное место,
//    где вообще известно время ОТПРАВКИ письма: колонки под него нет.
//    Чего он НЕ даёт: память живёт в одном экземпляре функции и обнуляется
//    при холодном старте, так что при раскладке на несколько экземпляров
//    ограничение не общее. Это заслон от долбёжки кнопкой и простого
//    скрипта, а не от распределённой атаки.
// 2. `FRESH_INVITE_MS` — по `invitations.created_at`: письмо уходит только
//    вместе со свежесозданным приглашением. Это ограничение переживает
//    перезапуск, потому что лежит в базе. Оно закрывает главный сценарий:
//    взять давно висящее `pending`-приглашение и слать по нему письма
//    хоть тысячу раз. Чтобы отправить письмо ещё раз, придётся создать
//    приглашение заново, а больше одного живого на пару «заведение +
//    почта» база не разрешает (invitations_one_live_per_email), то есть
//    сначала отозвать старое.
//    Чего он НЕ даёт: внутри своего окна повторы им не ограничены —
//    за это отвечает пункт 1.
const SEND_COOLDOWN_MS = 60_000
const FRESH_INVITE_MS = 10 * 60_000
const lastSent = new Map<string, number>()

function sentRecently(key: string): boolean {
  const now = Date.now()
  // Чистим по ходу дела: без этого карта растёт на каждую новую почту
  // и живёт столько же, сколько экземпляр функции.
  for (const [k, at] of lastSent) if (now - at >= SEND_COOLDOWN_MS) lastSent.delete(k)
  const at = lastSent.get(key)
  return at !== undefined && now - at < SEND_COOLDOWN_MS
}

export async function POST(req: Request) {
  let body: { tenantId?: string; email?: string; token?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'некоректний запит' }, { status: 400 })
  }

  const { tenantId, email, token } = body
  if (!tenantId || !email || !token) {
    return NextResponse.json({ error: 'бракує даних' }, { status: 400 })
  }

  const m = await currentMembership()
  if (!m || m.tenantId !== tenantId || !can(m, 'team.write')) {
    return NextResponse.json({ error: 'немає права' }, { status: 403 })
  }

  const to = email.trim()
  const supabase = await createClient()

  // Читаем через RLS от имени вошедшего: политика invitations_read сама
  // отсечёт чужое заведение, второй проверки арендатора не нужно.
  const { data: invite } = await supabase.from('invitations')
    .select('role, token_hash, created_at, expires_at')
    .eq('tenant_id', tenantId)
    .eq('email', to.toLowerCase())
    .eq('status', 'pending')
    .maybeSingle()

  if (!invite) {
    return NextResponse.json({ error: 'запрошення не знайдено' }, { status: 404 })
  }

  const hash = createHash('sha256').update(token).digest('hex')
  if (hash !== invite.token_hash) {
    return NextResponse.json({ error: 'посилання не від цього запрошення' }, { status: 403 })
  }

  const expiresAt = new Date(invite.expires_at)
  if (expiresAt.getTime() <= Date.now()) {
    // Слать письмо с заведомо мёртвой ссылкой хуже, чем не слать вовсе:
    // человек сходит по ней и упрётся в «посилання більше не працює».
    return NextResponse.json({ error: 'запрошення протерміноване' }, { status: 410 })
  }

  if (Date.now() - new Date(invite.created_at).getTime() > FRESH_INVITE_MS) {
    return NextResponse.json(
      { error: 'запрошення надто давнє — створіть нове, щоб надіслати лист' },
      { status: 429 },
    )
  }

  const key = `${tenantId}:${to.toLowerCase()}`
  if (sentRecently(key)) {
    return NextResponse.json(
      { error: 'лист на цю пошту вже пішов — зачекайте хвилину' },
      { status: 429 },
    )
  }

  const { data: shop } = await supabase.from('tenants')
    .select('name').eq('id', tenantId).single()

  const mail = mailTeamInvite(
    shop?.name ?? 'закладу',
    ROLE_LABEL[invite.role] ?? invite.role,
    abs(`/invite/${token}`),
    expiresAt,
  )

  // Отметку ставим ДО отправки, а не после: иначе два запроса подряд
  // успевают проскочить оба. Неудачная отправка тоже занимает минуту —
  // это осознанно: если Resend отказывает, повтор через секунду отказом
  // же и кончится, а письмо в это время может и уйти (ошибка бывает
  // после приёма).
  lastSent.set(key, Date.now())

  try {
    await sendEmail(to, mail.subject, undefined, mail.html)
  } catch (e) {
    // Не 500: приглашение уже создано и ссылка уже у владельца на экране.
    // Ответ говорит ровно то, что случилось, — письмо не ушло.
    return NextResponse.json(
      { error: e instanceof Error ? e.message : 'лист не надіслано' },
      { status: 502 },
    )
  }

  return NextResponse.json({ ok: true })
}
