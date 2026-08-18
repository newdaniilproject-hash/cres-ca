import { NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/service'
import { render } from '@/lib/notify/render'
import { queueEmailHtml } from '@/lib/email/queue'
import { sendEmail, sendPush, sendViber, sendSms } from '@/lib/notify/send'
import { pushTarget, type RefType } from '@/lib/notify/target'
import { cronDenial } from '../guard'

export const dynamic = 'force-dynamic'
export const maxDuration = 60
// `node:crypto` в проверке источника (сравнение секрета за постоянное
// время) на edge-рантайме отсутствует — рантайм назван явно, как в
// app/api/team/invite/route.ts.
export const runtime = 'nodejs'

/**
 * Один ответ на любой отказ: наружу не уходит даже намёк, что именно
 * не сошлось. Функция, а не константа — тело ответа читается один раз,
 * и общий объект отдал бы пустоту со второго запроса.
 */
const denied = () => NextResponse.json(
  { error: 'unauthorized' },
  { status: 401, headers: { 'cache-control': 'no-store' } },
)

// Обработчик очереди уведомлений (0011_notifications.sql). Триггеры базы
// только СТАВЯТ в очередь — отправляет наружу этот роут, сервисным ключом,
// вызывается по расписанию (см. supabase/migrations/0018_notification_cron.sql:
// pg_cron бьёт сюда раз в 5 минут через pg_net, в обход суточного лимита
// крона на бесплатном тарифе Vercel).
export async function GET(req: Request) {
  // Секрет плюс проверка источника — разбор в ../guard.ts.
  const denial = cronDenial(req)
  if (denial) {
    // В журнал Vercel, а не в ответ: журнал видит владелец, ответ — все.
    console.warn(`[cron/notifications] відмова: ${denial}`)
    return denied()
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

        // Письмо уходит двумя телами. HTML — каркас из lib/email
        // (таблицы, инлайновый стиль), чтобы письмо о заказе выглядело
        // так же, как приглашение в команду, а не голой строкой.
        // Текст — тот же самый текст шаблона: его показывают читалки
        // без HTML и он же идёт в предпросмотр. Оба тела собираются
        // из ОДНОГО текста базы, поэтому разъехаться не могут, а
        // переопределение шаблона арендатором продолжает работать.
        const html = queueEmailHtml(String(row.event), subject, body)
        await sendEmail(String(row.to_email), subject, body, html)
      } else if (row.channel === 'push') {
        if (!row.user_id) throw new Error('нет user_id для push (гость)')
        // Заголовок — тот же `subject`, что и у письма: одно событие
        // не должно называться по-разному в почте и в шторке телефона.
        // Адрес считается СЕЙЧАС, а не при постановке в очередь:
        // напоминание за 24 часа открывается завтра, и заморозить ссылку
        // значит однажды привести человека в переехавший раздел.
        await sendPush(row.user_id, body, {
          title: render(template.subject ?? '', payload) || undefined,
          url: pushTarget(String(row.event), row.ref_type as RefType, row.ref_id),
        })
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

  // Ответ служебный: перед сайтом стоит Cloudflare, и закешированный
  // «processed: 0» означал бы очередь, которая тихо перестала разбираться.
  return NextResponse.json(
    { processed: (batch ?? []).length, sent, failed },
    { headers: { 'cache-control': 'no-store' } },
  )
}
