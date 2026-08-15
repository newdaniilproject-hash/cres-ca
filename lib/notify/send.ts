// Отправка по каналу. Один канал — один маленький клиент к чужому API,
// без SDK: меньше веса в бандле, меньше версий следить. Каждая функция
// либо отправляет и возвращает, либо бросает — обработчик сам решает,
// что делать с ошибкой (notification_mark считает попытки и откладывает).

export async function sendEmail(to: string, subject: string, text: string) {
  const key = process.env.RESEND_API_KEY
  if (!key) throw new Error('канал email не настроен: нет RESEND_API_KEY')

  // Отправитель по умолчанию совпадает с тем, чем УЖЕ шлёт Supabase Auth
  // (код подтверждения почты): `CRESKO <no-reply@cres-ca.com>`. Проверено
  // на живом письме 15.08.2026.
  //
  // Здесь стояло `Маркетплейс <noreply@cres-ca.com>` — и это расходилось
  // с реальностью дважды. Имя: клиент получал код входа от «CRESKO»,
  // а письмо о заказе от «Маркетплейс», и это выглядит как два разных
  // сервиса. Адрес: `noreply` без дефиса — другой ящик, чем `no-reply`,
  // и почтовики считают репутацию отправителя ПО АДРЕСУ. Два адреса
  // на одном домене — это две репутации, каждая вдвое слабее, и обе
  // ближе к спаму. Меняем на один.
  const from = process.env.RESEND_FROM_EMAIL ?? 'CRESKO <no-reply@cres-ca.com>'

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from, to, subject, text }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`Resend ${res.status}: ${body.slice(0, 300)}`)
  }
}

export async function sendPush(userId: string, message: string) {
  const appId = process.env.ONESIGNAL_APP_ID
  const key = process.env.ONESIGNAL_API_KEY
  if (!appId || !key) throw new Error('канал push не настроен: нет ONESIGNAL_APP_ID/ONESIGNAL_API_KEY')

  const res = await fetch('https://api.onesignal.com/notifications', {
    method: 'POST',
    headers: { Authorization: `Key ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      app_id: appId,
      include_aliases: { external_id: [userId] },
      target_channel: 'push',
      contents: { en: message, uk: message },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OneSignal ${res.status}: ${body.slice(0, 300)}`)
  }
}

// Viber и SMS сознательно не реализованы: канал был заложен в схему
// (0011_notifications.sql), но провайдер не выбран и не подключён.
// Бросаем понятную ошибку вместо тихой имитации успеха — строка уйдёт
// в retry и останется видна в last_error, а не потеряется молча.
export async function sendViber(): Promise<never> {
  throw new Error('канал viber не подключён: провайдер не выбран')
}
export async function sendSms(): Promise<never> {
  throw new Error('канал sms не подключён: провайдер не выбран')
}
