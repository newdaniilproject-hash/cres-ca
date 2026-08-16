import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { currentMembership, can } from '@/lib/tenant'
import { mailTeamInvite } from '@/lib/email/templates'
import { sendEmail } from '@/lib/notify/send'
import { abs } from '@/lib/site'

export const dynamic = 'force-dynamic'

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

  const supabase = await createClient()

  // Читаем через RLS от имени вошедшего: политика invitations_read сама
  // отсечёт чужое заведение, второй проверки арендатора не нужно.
  const { data: invite } = await supabase.from('invitations')
    .select('role, expires_at')
    .eq('tenant_id', tenantId)
    .eq('email', email.trim().toLowerCase())
    .eq('status', 'pending')
    .maybeSingle()

  if (!invite) {
    return NextResponse.json({ error: 'запрошення не знайдено' }, { status: 404 })
  }

  const { data: shop } = await supabase.from('tenants')
    .select('name').eq('id', tenantId).single()

  const mail = mailTeamInvite(
    shop?.name ?? 'закладу',
    ROLE_LABEL[invite.role] ?? invite.role,
    abs(`/invite/${token}`),
  )

  try {
    await sendEmail(email.trim(), mail.subject, undefined, mail.html)
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
