import { emailLayout, codeBlock, escapeHtml, escapeAttr } from './layout'
import { abs } from '@/lib/site'

// Письма продукта. Каждое возвращает тему и HTML.
//
// ⚠️ КТО ЭТО ОТПРАВЛЯЕТ — на 16.08.2026 честно так, и это не мелочь:
//
//   1. Код регистрации, код входа, код восстановления пароля — их шлёт
//      САМ Supabase Auth своими шаблонами. Из кода проекта эти функции
//      не вызываются и вызываться не могут: письмо уходит внутри GoTrue.
//      Здесь лежит вёрстка, которую вставляют в дашборд руками
//      (CLAUDE.md, «Что настраивается руками», п. 4).
//   2. Приглашение сотрудника — app/api/team/invite/route.ts, живое.
//   3. Приветствие после онбординга — отправителя пока нет.
//   4. Письма по заказам и записям (mailOrder*, mailBooking*) НЕ
//      подключены и подключены быть не могут в нынешнем виде: их шлёт
//      очередь уведомлений, а тексты для неё живут в базе
//      (`notification_templates`, 0011/0023) и переопределяются
//      арендатором. Взять тело отсюда значило бы игнорировать это
//      переопределение. Очередь берёт из базы ТЕКСТ, а каркас — из
//      lib/email/layout.ts (см. lib/email/queue.ts). Кнопки этих писем
//      к тому же ведут на страницы, которых в проекте нет: публичного
//      экрана слежения за заказом и экрана переноса записи не существует.
//   5. Дайджесты склада — событий под них в базе нет вовсе: 0014/0048
//      ставят в очередь предупреждение НА КАЖДУЮ ёмкость, а не список,
//      и «пора замовити» не ставит ничего. Отправителя нет.
//
// Пункты 3–5 — обещание из CLAUDE.md, которое пока не выполнено; это
// решение владельца (доделать отправителей или удалить по правилу 8),
// а не то, что чинится правкой модуля писем.
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
// Здесь была версия СО ССЫЛКОЙ (`mailPasswordReset(url)`) — удалена
// по правилу 8: замена подхода означает удаление старой реализации
// в том же коммите, история живёт в git.
//
// Почему не удалено письмо целиком, а переписано на код: восстановление
// пароля шлёт САМ Supabase Auth своим шаблоном (Authentication → Emails →
// Reset password), и этот шаблон настраивается руками — как и SMTP через
// Resend (CLAUDE.md, «Что настраивается руками», п. 4, и «Почта»).
// Файл — источник вёрстки, которую туда вставляют, ровно как для кода
// регистрации и кода входа выше: их тоже не зовёт никакой код проекта.
// Удалить эту функцию значило бы оставить одно из трёх писем Supabase
// без украинской вёрстки, то есть вернуть английский шаблон по умолчанию.
//
// Что чинится: экран /forgot с 13.08.2026 принимает КОД (`verifyOtp`,
// type 'recovery'), а шаблон в Supabase отдаёт `{{ .Token }}` — ссылки
// в письме нет вовсе. Письмо с кнопкой «задати новий пароль» вело бы
// в никуда.
//
// Срок — 10 минут: `Email OTP expiration = 600` одно на ВСЕ письма
// Supabase Auth, отдельной настройки для восстановления нет.
export function mailPasswordResetCode(code: string): Mail {
  return {
    subject: `${code} — код відновлення пароля CRES-CA`,
    html: emailLayout({
      preheader: `Код ${code}. Дійсний 10 хвилин.`,
      heading: 'Новий пароль',
      body:
        P('Введіть цей код на сторінці відновлення — новий пароль задається там же:') +
        codeBlock(code) +
        P('Код дійсний <b>10 хвилин</b> і працює один раз.'),
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
//
// `shopUrl` вызывающий собирает через `abs()` — руками домен не пишет
// (см. lib/site.ts). Здесь он ещё и экранируется как значение атрибута:
// в адрес попадает slug заведения, то есть строка от пользователя.
export function mailWelcome(shopName: string, shopUrl: string): Mail {
  return {
    subject: `${shopName} — ваша сторінка готова`,
    html: emailLayout({
      preheader: 'Скопіюйте посилання і додайте в шапку Instagram.',
      heading: 'Сторінка готова',
      body:
        P(`Заклад <b>${escapeHtml(shopName)}</b> створено. Ось ваше посилання:`) +
        P(`<a href="${escapeAttr(shopUrl)}" style="color:#2563eb;">${escapeHtml(shopUrl)}</a>`) +
        P('Додайте його в шапку Instagram — клієнти зможуть дивитися послуги ' +
          'і записуватися самі, навіть коли ви зайняті або спите.'),
      button: { label: 'Відкрити кабінет', url: abs('/app') },
      footNote: 'Далі варто додати послуги з цінами і фото робіт — сторінка із заповненим ' +
                'профілем викликає більше довіри, ніж порожня.',
    }),
  }
}

// ── Приглашение сотрудника ───────────────────────────────────────────
// Срок берётся из самого приглашения (`invitations.expires_at`), а не
// пишется в тексте числом. Здесь стояло «Посилання дійсне 7 днів», тогда
// как база даёт 72 часа (0050) и экран приёма говорит «72 години»: письмо
// врало ровно вдвое с лишним, и человек шёл по ссылке на четвёртый день.
// Число в тексте расходится с базой при первой же правке миграции —
// поэтому его тут нет вовсе, есть срок конкретного приглашения.
export function mailTeamInvite(shopName: string, role: string, url: string, expiresAt: Date): Mail {
  return {
    subject: `Запрошення до ${shopName}`,
    html: emailLayout({
      preheader: `Вас запросили як «${role}».`,
      heading: 'Вас запросили в команду',
      body:
        P(`Вам відкрили доступ до закладу <b>${escapeHtml(shopName)}</b> у ролі <b>${escapeHtml(role)}</b>.`) +
        P('Прийміть запрошення, щоб почати працювати.'),
      button: { label: 'Прийняти запрошення', url },
      footNote:
        `Посилання дійсне до ${kyivMoment(expiresAt)} і спрацює один раз. ` +
        'Приймати треба з тієї пошти, на яку прийшов цей лист, — на іншій воно не спрацює.',
    }),
  }
}

// Момент по-киевски: письмо читают в Украине, а сервер считает в UTC,
// и «дійсне до 12:00» на три часа раньше правды — это то же враньё,
// только мельче. Часовой пояс назван явно, чтобы не зависеть от того,
// как настроена машина сборки.
function kyivMoment(d: Date): string {
  return d.toLocaleString('uk-UA', {
    timeZone: 'Europe/Kyiv',
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  })
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
      button: { label: 'Відкрити склад', url: abs('/app/inventory') },
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
      button: { label: 'Відкрити список', url: abs('/app/inventory/reorder') },
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
