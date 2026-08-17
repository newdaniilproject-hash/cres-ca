import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { createServiceClient } from '@/lib/supabase/service'

export const dynamic = 'force-dynamic'
export const runtime = 'nodejs'

// ── Выдача и отзыв доступа сотрудника платформы (0093) ─────────────────────
//
// ПОЧЕМУ СЕРВИСНЫМ КЛЮЧОМ. На `platform_access_grants` нет ни одной политики
// на INSERT и UPDATE, и это решение, а не упущение — оно записано в шапке
// 0093. Обращение в поддержку приходит владельцу платформы, а не в базу
// клиента; просить клиента «нажмите кнопку выдачи доступа» значит получить
// либо отказ, либо привычку нажимать не глядя. Клиент доступ не выдаёт,
// но УЗНАЁТ о нём письмом (триггер `platform_access_notify`) и видит его
// в своём списке грантов.
//
// ПОЧЕМУ ПРИЗНАК ЧИТАЕТСЯ ИЗ БАЗЫ, А НЕ ИЗ ТОКЕНА. `is_staff` в токене
// живёт до его обновления. Для рисования экрана этого хватает (lib/tenant.ts),
// для ВЫДАЧИ доступа к чужим данным — нет: снятый вчера признак не должен
// работать сегодня. Здесь спрашивается `profiles.is_staff` напрямую.
//
// ПОЧЕМУ ТОЛЬКО СЕБЕ. Грант выдаётся тому, кто его просит, и никому больше.
// Возможность выписать доступ другому человеку превращает этот роут
// в раздачу ключей: одна скомпрометированная учётная запись поддержки —
// и доступ есть у всех. Сотрудников платформы сегодня один, и заводить
// под него механику делегирования незачем.
//
// ⚠️ Ни одна ошибка отсюда не рассказывает, что именно не сошлось: этот
// адрес открыт всему интернету, и разница между «ты не сотрудник» и
// «такого закладу немає» — это уже сведения.

const denied = () => NextResponse.json(
  { error: 'unauthorized' },
  { status: 401, headers: { 'cache-control': 'no-store' } },
)

/** Потолок из 0093: `platform_access_max_30_days`. Повторён здесь, чтобы
 *  человек увидел понятный отказ, а не сообщение о нарушении ограничения. */
const MAX_DAYS = 30
const MIN_REASON = 10

async function staffUserId(): Promise<string | null> {
  const supabase = await createClient()
  const { data: { session } } = await supabase.auth.getSession()
  const uid = session?.user?.id
  if (!uid) return null

  const service = createServiceClient()
  const { data, error } = await service
    .from('profiles').select('is_staff').eq('id', uid).single()
  if (error || data?.is_staff !== true) return null
  return uid
}

export async function POST(req: Request) {
  const uid = await staffUserId()
  if (!uid) return denied()

  let body: { slug?: unknown; reason?: unknown; days?: unknown; revoke?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'bad-body' }, { status: 400 })
  }

  const service = createServiceClient()

  // ── Отзыв ────────────────────────────────────────────────────────────────
  //
  // Отзывается только свой грант: `eq('staff_user_id', uid)`. Сторож
  // `platform_access_guard` не пропустит правку ничего, кроме отзыва,
  // и не даст отозвать дважды — здесь этого не повторяем.
  if (typeof body.revoke === 'string' && body.revoke !== '') {
    const { error } = await service
      .from('platform_access_grants')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', body.revoke)
      .eq('staff_user_id', uid)
      .is('revoked_at', null)
    if (error) return NextResponse.json({ error: error.message }, { status: 400 })
    return NextResponse.json({ ok: true }, { headers: { 'cache-control': 'no-store' } })
  }

  // ── Выдача ───────────────────────────────────────────────────────────────
  const slug = typeof body.slug === 'string' ? body.slug.trim() : ''
  const reason = typeof body.reason === 'string' ? body.reason.trim() : ''
  const days = Number(body.days)

  if (slug === '') return NextResponse.json({ error: 'no-slug' }, { status: 400 })
  if (reason.length < MIN_REASON) {
    return NextResponse.json({ error: 'short-reason' }, { status: 400 })
  }
  if (!Number.isFinite(days) || days < 1 || days > MAX_DAYS) {
    return NextResponse.json({ error: 'bad-days' }, { status: 400 })
  }

  // Заведение ищется по слагу, а не выбирается из списка: список всех
  // заведений платформы — это и есть та база, доступ к которой мы здесь
  // ограничиваем. Сотрудник поддержки знает слаг из обращения.
  const { data: tenant } = await service
    .from('tenants').select('id, name').eq('slug', slug).single()
  if (!tenant) return NextResponse.json({ error: 'no-tenant' }, { status: 404 })

  const expires = new Date(Date.now() + days * 864e5).toISOString()
  const { error } = await service.from('platform_access_grants').insert({
    staff_user_id: uid,
    tenant_id: tenant.id,
    reason,
    granted_by: uid,
    expires_at: expires,
  })
  if (error) return NextResponse.json({ error: error.message }, { status: 400 })

  return NextResponse.json(
    { ok: true, tenant: tenant.name, expires },
    { headers: { 'cache-control': 'no-store' } },
  )
}
