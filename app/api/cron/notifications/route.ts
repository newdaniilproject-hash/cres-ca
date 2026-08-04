import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { render } from '@/lib/notify/render'
import { sendEmail, sendPush, sendViber, sendSms } from '@/lib/notify/send'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Обработчик очереди уведомлений (0011_notifications.sql). Триггеры базы
// только СТАВЯТ в очередь — отправляет наружу этот роут, сервисным ключом,
// вызывается по расписанию (см. supabase/migrations/0018_notification_cron.sql:
// pg_cron бьёт сюда раз в 5 минут через pg_net, в обход суточного лимита
// крона на бесплатном тарифе Vercel).
export async function GET(req: Request) {
  const secret = process.env.CRON_SECRET
  const auth = req.headers.get('authorization')
  if (!secret || auth !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  const supabase = createServiceClient()

  const { data: batch, error: takeError } = await supabase.rpc('notifications_take', {
    p_limit: 25,
  })
  if (takeError) {
    return NextResponse.json({ error: takeError.message }, { status: 500 })
  }

  let sent = 0
  let failed = 0

  for (const row of batch ?? []) {
    try {
      // In-app: строка сама и есть уведомление, отдельной отправки не требует —
      // фронт читает notification_outbox напрямую. Закрываем как отправленную.
      if (row.channel === 'inapp') {
        await supabase.rpc('notification_mark', { p_id: row.id, p_ok: true })
        sent++
        continue
      }

      const { data: templates } = await supabase
        .from('notification_templates')
        .select('subject, body')
        .eq('event', row.event)
        .eq('channel', row.channel)
        .eq('locale', row.locale)
        .eq('is_active', true)
        .or(`tenant_id.eq.${row.tenant_id},tenant_id.is.null`)
        .order('tenant_id', { ascending: false, nullsFirst: false })
        .limit(1)

      const template = templates?.[0]
      if (!template) {
        throw new Error(`нет активного шаблона: ${row.event}/${row.channel}/${row.locale}`)
      }

      const payload = (row.payload ?? {}) as Record<string, unknown>
      const body = render(template.body, payload)

      if (row.channel === 'email') {
        if (!row.to_email) throw new Error('нет email получателя')
        const subject = render(template.subject ?? '', payload)
        await sendEmail(row.to_email, subject, body)
      } else if (row.channel === 'push') {
        if (!row.user_id) throw new Error('нет user_id для push (гость)')
        await sendPush(row.user_id, body)
      } else if (row.channel === 'viber') {
        await sendViber()
      } else if (row.channel === 'sms') {
        await sendSms()
      } else {
        throw new Error(`неизвестный канал: ${row.channel}`)
      }

      await supabase.rpc('notification_mark', { p_id: row.id, p_ok: true })
      sent++
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      await supabase.rpc('notification_mark', { p_id: row.id, p_ok: false, p_error: message })
      failed++
    }
  }

  return NextResponse.json({ processed: (batch ?? []).length, sent, failed })
}
