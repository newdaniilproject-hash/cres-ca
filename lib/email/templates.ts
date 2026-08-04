import { emailLayout, codeBlock, escapeHtml } from './layout'

// Письма продукта. Каждое возвращает тему и HTML — отправляет их
// обработчик очереди (app/api/cron/notifications) либо Supabase Auth.
//
// Правило текста: первая строка отвечает на вопрос «что мне с этим
// делать», а не приветствует. Человек читает письмо в списке из сорока
// других, и «Вітаємо!» ему ничего не сообщает.
//
// Срок жизни кода и ссылок называется прямо. Письмо без срока
// заставляет гадать, протухло оно или нет.

export type Mail = { subject: string; html: string }

const P = (t: string) => `<p style="margin:0 0 12px;">${t}</p>`

// ── Регистрация: шестизначный код ────────────────────────────────────
// Код, а не ссылка. Причины две: ссылка ломается почтовыми клиентами,
// которые открывают её в своём браузере без сессии, и код единственный
// работает в мобильном приложении, где почта открывается в другом окне.
export function mailSignupCode(code: string): Mail {
  return {
    subject: `${code} — код підтвердження CRES-CA`,
    html: emailLayout({
      preheader: `Код ${code}. Дійсний 10 хвилин.`,
      heading: 'Підтвердіть пошту',
      body:
        P('Введіть цей код на сторінці реєстрації:') +
        codeBlock(code) +
        P('Код дійсний <b>10 хвилин</b> і працює один раз.'),
      footNote:
        'Якщо ви не реєструвалися в CRES-CA — просто видаліть цей лист. ' +
        'Без коду ніхто не отримає доступ до вашої пошти.',
    }),
  }
}

// ── Вход по коду ─────────────────────────────────────────────────────
export function mailLoginCode(code: string): Mail {
  return {
    subject: `${code} — код входу CRES-CA`,
    html: emailLayout({
      preheader: `Код ${code}. Дійсний 10 хвилин.`,
      heading: 'Код для входу',
      body: P('Введіть його, щоб увійти:') + codeBlock(code) +
            P('Код дійсний <b>10 хвилин</b>.'),
      footNote:
        'Не ви намагалися увійти? Тоді хтось знає вашу пошту, але не має коду — ' +
        'доступ він не отримає. Змінювати пароль не обовʼязково.',
    }),
  }
}

// ── Сброс пароля ─────────────────────────────────────────────────────
export function mailPasswordReset(url: string): Mail {
  return {
    subject: 'Відновлення пароля CRES-CA',
    html: emailLayout({
      preheader: 'Посилання дійсне 1 годину.',
      heading: 'Новий пароль',
      body: P('Натисніть кнопку, щоб задати новий пароль. Посилання дійсне <b>1 годину</b> і спрацює один раз.'),
      button: { label: 'Задати новий пароль', url },
      footNote:
        'Якщо ви не просили змінити пароль — нічого робити не потрібно, ' +
        'старий пароль продовжує працювати.',
    }),
  }
}

// ── Приветствие после онбординга ─────────────────────────────────────
// Отправляется не в момент регистрации, а когда заведение заполнено:
// поздравлять раньше нечем, а список дальнейших шагов до заполнения
// профиля выглядит как упрёк.
export function mailWelcome(shopName: string, shopUrl: string): Mail {
  return {
    subject: `${shopName} — ваша сторінка готова`,
    html: emailLayout({
      preheader: 'Скопіюйте посилання і додайте в шапку Instagram.',
      heading: 'Сторінка готова',
      body:
        P(`Заклад <b>${escapeHtml(shopName)}</b> створено. Ось ваше посилання:`) +
        P(`<a href="${shopUrl}" style="color:#2563eb;">${escapeHtml(shopUrl)}</a>`) +
        P('Додайте його в шапку Instagram — клієнти зможуть дивитися послуги ' +
          'і записуватися самі, навіть коли ви зайняті або спите.'),
      button: { label: 'Відкрити кабінет', url: 'https://cres-ca.com/app' },
      footNote: 'Далі варто додати послуги з цінами і фото робіт — сторінка із заповненим ' +
                'профілем викликає більше довіри, ніж порожня.',
    }),
  }
}

// ── Приглашение сотрудника ───────────────────────────────────────────
export function mailTeamInvite(shopName: string, role: string, url: string): Mail {
  return {
    subject: `Запрошення до ${shopName}`,
    html: emailLayout({
      preheader: `Вас запросили як «${role}».`,
      heading: 'Вас запросили в команду',
      body:
        P(`Вам відкрили доступ до закладу <b>${escapeHtml(shopName)}</b> у ролі <b>${escapeHtml(role)}</b>.`) +
        P('Прийміть запрошення, щоб почати працювати.'),
      button: { label: 'Прийняти запрошення', url },
      footNote: 'Посилання дійсне 7 днів.',
    }),
  }
}

// ── Заказ принят ─────────────────────────────────────────────────────
export function mailOrderCreated(o: {
  number: number | string; name: string; total: string; shop: string; trackUrl: string
}): Mail {
  return {
    subject: `Замовлення №${o.number} прийнято`,
    html: emailLayout({
      preheader: `${o.shop} отримав ваше замовлення на ${o.total}.`,
      heading: `Замовлення №${escapeHtml(String(o.number))} прийнято`,
      body:
        P(`Вітаємо, ${escapeHtml(o.name)}! Заклад <b>${escapeHtml(o.shop)}</b> ` +
          `отримав ваше замовлення на суму <b>${escapeHtml(o.total)}</b>.`) +
        P('Ми напишемо, щойно статус зміниться.'),
      button: { label: 'Стежити за замовленням', url: o.trackUrl },
    }),
  }
}

export function mailOrderShipped(o: {
  number: number | string; tracking: string; trackUrl: string
}): Mail {
  return {
    subject: `Замовлення №${o.number} відправлено`,
    html: emailLayout({
      preheader: `Накладна ${o.tracking}.`,
      heading: `Замовлення №${escapeHtml(String(o.number))} в дорозі`,
      body:
        P('Замовлення передано перевізнику.') +
        (o.tracking ? P(`Номер накладної: <b>${escapeHtml(o.tracking)}</b>`) : ''),
      button: { label: 'Стежити за доставкою', url: o.trackUrl },
    }),
  }
}

export function mailOrderCancelled(o: {
  number: number | string; reason: string; shop: string
}): Mail {
  return {
    subject: `Замовлення №${o.number} скасовано`,
    html: emailLayout({
      preheader: o.reason || 'Замовлення скасовано.',
      heading: `Замовлення №${escapeHtml(String(o.number))} скасовано`,
      body:
        P(`Заклад <b>${escapeHtml(o.shop)}</b> скасував замовлення.`) +
        (o.reason ? P(`Причина: ${escapeHtml(o.reason)}`) : '') +
        P('Якщо ви вже оплатили — зверніться до закладу, гроші повертає він: ' +
          'платформа не проводить оплати через себе.'),
    }),
  }
}

// ── Запись на услугу ─────────────────────────────────────────────────
export function mailBookingCreated(b: {
  name: string; title: string; when: string; staff: string; shop: string; manageUrl: string
}): Mail {
  return {
    subject: `Запис підтверджено — ${b.when}`,
    html: emailLayout({
      preheader: `${b.title}, ${b.when}.`,
      heading: 'Ви записані',
      body:
        P(`Вітаємо, ${escapeHtml(b.name)}!`) +
        P(`<b>${escapeHtml(b.title)}</b><br>` +
          `${escapeHtml(b.when)}<br>` +
          (b.staff ? `Майстер: ${escapeHtml(b.staff)}<br>` : '') +
          `${escapeHtml(b.shop)}`),
      button: { label: 'Перенести або скасувати', url: b.manageUrl },
      footNote: 'Якщо плани зміняться — перенесіть запис завчасно. ' +
                'Так майстер встигне запропонувати час іншому.',
    }),
  }
}

export function mailBookingReminder(b: {
  title: string; when: string; staff: string; manageUrl: string; hours: 24 | 2
}): Mail {
  const head = b.hours === 24 ? 'Завтра у вас запис' : 'Через 2 години'
  return {
    subject: `${head} — ${b.title}`,
    html: emailLayout({
      preheader: `${b.title}, ${b.when}.`,
      heading: head,
      body: P(`<b>${escapeHtml(b.title)}</b><br>${escapeHtml(b.when)}` +
              (b.staff ? `<br>Майстер: ${escapeHtml(b.staff)}` : '')),
      button: { label: 'Перенести', url: b.manageUrl },
    }),
  }
}

// ── Склад: сроки годности ────────────────────────────────────────────
// Письмо продавцу, а не покупателю. Список, а не по письму на позицию:
// иначе утром приходит восемь одинаковых писем и их перестают открывать.
export function mailExpiryDigest(items: {
  material: string; code: string; useBy: string; daysLeft: number
}[]): Mail {
  const rows = items.map((i) => {
    const soon = i.daysLeft <= 7
    return `<tr>
      <td style="padding:9px 0;border-bottom:1px solid #e6e6ea;font:400 14px/1.4 -apple-system,Arial,sans-serif;">
        <b>${escapeHtml(i.material)}</b><br>
        <span style="color:#5b5b66;font-size:13px;">${escapeHtml(i.code)}</span>
      </td>
      <td style="padding:9px 0;border-bottom:1px solid #e6e6ea;text-align:right;
                 font:600 14px/1.4 -apple-system,Arial,sans-serif;
                 color:${soon ? '#b91c1c' : '#b45309'};white-space:nowrap;">
        ${escapeHtml(i.useBy)}<br>
        <span style="font-weight:400;font-size:12px;">${i.daysLeft} дн</span>
      </td>
    </tr>`
  }).join('')

  return {
    subject: `Спливає термін: ${items.length} ${plural(items.length, 'позиція', 'позиції', 'позицій')}`,
    html: emailLayout({
      preheader: 'Перевірте склад перед перевіркою.',
      heading: 'Спливає термін придатності',
      body:
        P('Ці ємності треба замінити або списати:') +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                style="margin:16px 0;">${rows}</table>` +
        P('Прострочена косметика в реєстрі — перше, що дивиться інспектор.'),
      button: { label: 'Відкрити склад', url: 'https://cres-ca.com/app/inventory' },
    }),
  }
}

// ── Склад: пора заказать ─────────────────────────────────────────────
export function mailReorderDigest(items: { title: string; toOrder: string }[]): Mail {
  const rows = items.map((i) => `<tr>
    <td style="padding:9px 0;border-bottom:1px solid #e6e6ea;font:400 14px/1.4 -apple-system,Arial,sans-serif;">
      ${escapeHtml(i.title)}</td>
    <td style="padding:9px 0;border-bottom:1px solid #e6e6ea;text-align:right;
               font:600 14px/1.4 -apple-system,Arial,sans-serif;white-space:nowrap;">
      ${escapeHtml(i.toOrder)}</td>
  </tr>`).join('')

  return {
    subject: `Пора замовити: ${items.length} ${plural(items.length, 'позиція', 'позиції', 'позицій')}`,
    html: emailLayout({
      preheader: 'Залишки нижче порогу.',
      heading: 'Час поповнити склад',
      body:
        P('Ці позиції опустилися нижче вашого порогу:') +
        `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"
                style="margin:16px 0;">${rows}</table>`,
      button: { label: 'Відкрити список', url: 'https://cres-ca.com/app/inventory/reorder' },
    }),
  }
}

// Украинские числительные: 1 позиція, 2 позиції, 5 позицій.
function plural(n: number, one: string, few: string, many: string): string {
  const m10 = n % 10, m100 = n % 100
  if (m10 === 1 && m100 !== 11) return one
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few
  return many
}
