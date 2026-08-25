// Вёрстка Paperless-отчёта. Отдельным файлом, потому что это документ
// с юридическим весом: его читает проверяющий, и структура должна быть
// стабильной и правимой без правки серверной логики.
//
// ── ЯЗЫК ЭТОГО ФАЙЛА: РЕШЕНИЕ И ПРИЧИНА (шаг локализации, 16.08.2026) ──────
//
// РЕШЕНИЕ: документ ВСЕГДА украинский. Строки отсюда в словарь
// локализации НЕ уезжают, `Lang` в этот файл не приходит, куку языка он
// не читает и читать не должен.
//
// Причина. Это не экран, а бумага для Держпродспоживслужби: разделы 1–7
// названы по Техрегламенту (постанова КМУ № 65), а подвал — заявление
// о неизменности журналов. Язык такого документа определяется не тем,
// на каком языке мастеру удобнее нажимать кнопки, а тем, кому его
// предъявляют. Мастер вправе держать интерфейс русским; распечатать
// инспектору русский «Звіт із санітарного обліку» он не вправе, и цена
// ошибки — не неудобство, а непринятый документ на проверке.
//
// Почему не «язык отчёта — отдельная настройка». Настройка означает, что
// у документа появляется состояние, в котором он собран НЕ по-украински,
// — то есть заведение получает способ напечатать негодную бумагу, и
// сделать это можно случайно, один раз переключив тумблер. Настройка
// защищает от проблемы, которой нет (проверяющий читает по-украински
// всегда), и создаёт ту, которой не было.
//
// Почему подписи кнопок здесь тоже украинские, хотя это интерфейс.
// «Зберегти як PDF / Друк» — часть той же печатной страницы. Ради двух
// слов пришлось бы протянуть сюда язык кабинета, а именно этот провод
// потом и превращается в русский отчёт: следующая правка «раз уж lang
// есть — переведём и заголовки» выглядит безобидно. Проще держать файл
// без языка вовсе.
//
// Как это ОБЕСПЕЧЕНО, а не просто обещано:
//   • у `reportHtml` нет и не заводится параметра языка — передать сюда
//     куку технически нечем (см. `app/app/journals/report/route.ts`);
//   • даты и числа форматируются через `DOC_LOCALE` ниже, а не через
//     `t.date` / `t.number`: те берут язык интерфейса;
//   • `<html lang="uk">` в разметке — не украшение, а то же заявление.
// Проверка при ревью одна: в этом файле не должно появиться ни импорта
// из `lib/i18n`, ни строки `lang`.

// Цвета и геометрия печати — из общего источника (`lib/design/tokens.ts`).
// До 19.08.2026 здесь жила СВОЯ палитра — сепия первого оформления
// (#16150f, #22443a, #6a6355). Тема продукта менялась дважды, отчёт для
// проверки не менялся ни разу: клиент нёс в Держпродспоживслужбу документ
// в цветах, которых в приложении нет.
import { PRINT as P, RADIUS as R } from '@/lib/design/tokens'

type Named = { name: string } | null
type Person = { full_name: string | null } | null

export type ReportData = {
  shop: {
    name: string; legal_name: string | null; tax_id: string | null
    city: string | null; address: string | null; contact_phone: string | null
  } | null
  days: number
  materials: Array<{
    name: string; brand: string | null; country_of_origin: string | null
    inci: string | null; notification_code: string | null
    /** Коли підтверджено ДОКУМЕНТОМ (0106). null — лише слова постачальника. */
    notification_confirmed_at: string | null
    pao_months: number | null
    unit: string
    /**
     * Остаток — СКЛАДСКОЕ сведение, а не санитарное: его отдаёт `materials`
     * по праву `stock.read`, которого у роли `inspector` нет (0035),
     * и в `compliance_materials` этой колонки нет намеренно.
     *
     * Поэтому здесь `null`, а не число, и НЕ ноль. Ноль в документе для
     * проверки читается как «засобу немає на складі» — то есть отчёт
     * с юридическим весом врал бы молча. Отсутствие значения означает
     * ровно «показывать нечего», и колонка тогда не рисуется вовсе.
     */
    current_stock?: number | null
    is_cosmetic: boolean
  }>
  /**
   * Рисовать ли колонку «Залишок». Не передан — выводится из данных:
   * колонка появляется, только если остаток приехал хоть по одной
   * позиции. Умолчание выбрано так, что забытый флаг даёт документ
   * БЕЗ пустой колонки, а не с ней: пустая ячейка в отчёте для проверки
   * хуже отсутствующей.
   */
  showStock?: boolean
  batches: Array<{
    batch_number: string; expiry_date: string; received_at: string | null
    materials: Named; suppliers: Named
  }>
  containers: Array<{
    code: string; status: string; opened_at: string | null; use_by: string | null
    volume: number | null; unit: string | null; materials: Named
  }>
  solutions: Array<{
    agent_name: string; registration: string | null; concentration: string
    volume: number; unit: string; prepared_at: string; expires_at: string
    profiles: Person
  }>
  cleaning: Array<{ performed_at: string; cleaning_tasks: Named; profiles: Person }>
  cycles: Array<{
    device: string; temperature_c: number; duration_minutes: number
    indicator_ok: boolean; indicator_note: string | null
    performed_at: string; profiles: Person
  }>
  cards: Array<{ title: string; version: number; steps: unknown; created_at: string }>
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

// Локаль ДОКУМЕНТА, а не пользователя. Именована, чтобы правка «а давайте
// брать язык из куки» не выглядела мелкой: см. решение в шапке файла.
const DOC_LOCALE = 'uk-UA'

const d = (s: string | null) =>
  s ? new Date(s).toLocaleDateString(DOC_LOCALE) : '—'
const dt = (s: string | null) =>
  s ? new Date(s).toLocaleString(DOC_LOCALE, {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) : '—'

// Прочерк вместо пустой ячейки. Пустая ячейка в напечатанном документе
// неотличима от типографского брака: проверяющий не знает, «нет данных»
// это или «строка обрезалась». Прочерк — заявление, а не пропуск.
const or = (s: string | null | undefined) =>
  s != null && String(s).trim() !== '' ? esc(s) : '—'

// Имя исполнителя. ТРИ разных состояния, и склеивать их нельзя —
// подвал документа обещает, что у каждой записи зафиксирован исполнитель.
//
//   имя есть           → печатаем имя;
//   исполнитель есть,  → «імʼя недоступне»: `compliance_actors` (0083)
//   имени нет            строится от `tenant_members`, и у того, кого
//                        вывели из состава команды, имя перестаёт
//                        доставаться. Сама запись и её автор в базе целы;
//   исполнителя нет    → «не зафіксовано». В базе колонки `prepared_by`
//                        и `performed_by` объявлены `not null`, поэтому
//                        такого быть не должно; если случилось — это
//                        обязано БРОСАТЬСЯ В ГЛАЗА, а не выглядеть
//                        прочерком «данных нет».
const who = (p: Person) => {
  if (p == null) return '<span class="warn">не зафіксовано</span>'
  const name = p.full_name?.trim()
  return name ? esc(name) : '<span class="warn">імʼя недоступне</span>'
}
const namePending = (p: Person) => p == null || !p.full_name?.trim()

// Шаги техкарты пишутся ДВУМЯ наборами ключей, и читать надо оба.
// Карты первых салонов заведены по образцу из 0014 (`step`, `solution`,
// `proportion`, `note`), а экран `app/app/techcards` сохраняет `title`,
// `detail`, `minutes`. Отчёт читал только первый набор — и всякая карта,
// созданная на экране, печаталась списком пустых пунктов: заголовок шага
// пуст, описание пропало, осталось «, 15 хв». Документ, ради которого
// техкарты и ведутся, показывал проверяющему пустой регламент.
function stepLine(raw: unknown): string {
  const o = (raw ?? {}) as Record<string, unknown>
  const title = String(o.title ?? o.step ?? '').trim()
  const detail = String(o.detail ?? o.solution ?? '').trim()
  const proportion = String(o.proportion ?? '').trim()
  const note = String(o.note ?? '').trim()
  const minutes = o.minutes == null || String(o.minutes).trim() === ''
    ? '' : String(o.minutes).trim()
  return `<b>${title ? esc(title) : '<span class="warn">крок без назви</span>'}</b>${
    detail ? ` — ${esc(detail)}` : ''}${
    proportion ? `, пропорція ${esc(proportion)}` : ''}${
    minutes ? `, ${esc(minutes)} хв` : ''}${
    note && note !== detail ? `. ${esc(note)}` : ''}`
}

function table(head: string[], rows: string[][]) {
  if (rows.length === 0) return '<p class="empty">Записів за період немає.</p>'
  return `<table>
  <thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead>
  <tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody>
</table>`
}

export function reportHtml(x: ReportData): string {
  const now = new Date()
  const s = x.shop

  // Колонка «Залишок» — единственная складская во всём документе.
  // Тому, кто пришёл с проверкой, её не показывают вовсе: у роли
  // `inspector` нет `stock.read`, значения не будет, а пустая ячейка
  // в шести строках подряд читается как «склад пуст».
  const showStock = x.showStock ?? x.materials.some((m) => m.current_stock != null)

  // Сколько записей журналов напечатается без имени исполнителя.
  // Считается ДО вёрстки, потому что от этого зависит текст подвала:
  // обещание «у кожного запису зафіксовано час та виконавця» не должно
  // стоять рядом с прочерком без объяснения.
  const unnamed =
    x.solutions.filter((r) => namePending(r.profiles)).length +
    x.cleaning.filter((r) => namePending(r.profiles)).length +
    x.cycles.filter((r) => namePending(r.profiles)).length

  const sections = [
    {
      n: '1', title: 'Реєстр косметичних засобів і матеріалів',
      note: 'Відповідно до Технічного регламенту на косметичну продукцію (постанова КМУ № 65).',
      body: table(
        ['Назва', 'Бренд', 'Країна', 'Код нотифікації МОЗ', 'Підтверджено', 'PAO, міс',
         ...(showStock ? ['Залишок'] : [])],
        x.materials.map((m) => [
          esc(m.name) + (m.is_cosmetic ? ' <span class="tag">косметика</span>' : ''),
          or(m.brand), or(m.country_of_origin),
          m.notification_code ? esc(m.notification_code) : '<span class="warn">не вказано</span>',
          // КОД — це слова постачальника, ПІДТВЕРДЖЕННЯ — документ (0106).
          // Різниця між ними і є те, що перевірка дивиться першим, і саме
          // її документ мовчав: 0107 додала цю колонку у функцію, яку ніхто
          // не викликає. Прочерк ставиться лише некосметиці — у неї
          // нотифікації не буває, і «не підтверджено» на шампуні для рук
          // читалось би як порушення там, де його немає.
          !m.is_cosmetic
            ? '—'
            : m.notification_confirmed_at
              ? esc(dt(m.notification_confirmed_at))
              : '<span class="warn">не підтверджено</span>',
          m.pao_months != null ? String(m.pao_months) : '—',
          // Ноль вместо отсутствующего остатка не подставляется нигде:
          // см. объяснение у поля `current_stock`.
          ...(showStock
            ? [m.current_stock != null ? `${Number(m.current_stock)} ${esc(m.unit)}` : '—']
            : []),
        ]),
      ),
    },
    {
      n: '2', title: 'Партії та терміни придатності',
      note: 'Простежуваність: номер партії, постачальник, дата надходження.',
      body: table(
        ['Засіб', 'Партія', 'Постачальник', 'Надійшла', 'Придатна до'],
        x.batches.map((b) => {
          const expired = new Date(b.expiry_date) < now
          return [
            or(b.materials?.name), esc(b.batch_number),
            or(b.suppliers?.name), d(b.received_at),
            expired ? `<span class="warn">${d(b.expiry_date)}</span>` : d(b.expiry_date),
          ]
        }),
      ),
    },
    {
      n: '3', title: 'Ємності: відкриття та PAO',
      note: 'Дата «використати до» обчислюється системою як менша з дат: термін партії або дата відкриття + PAO. Дата відкриття не редагується.',
      body: table(
        ['Засіб', 'Код ємності', 'Стан', 'Відкрито', 'Використати до', 'Обʼєм'],
        x.containers.map((c) => {
          const expired = c.use_by ? new Date(c.use_by) < now : false
          // `disposed` — четвёртое состояние ёмкости (`container_status`).
          // Без него в украинском документе печаталось английское слово
          // из enum: списанная банка выглядела как сбой вёрстки.
          const st = {
            sealed: 'запечатана', opened: 'відкрита',
            finished: 'використана', disposed: 'списана',
          }[c.status] ?? c.status
          return [
            or(c.materials?.name), esc(c.code), esc(st), dt(c.opened_at),
            expired ? `<span class="warn">${d(c.use_by)}</span>` : d(c.use_by),
            c.volume != null ? `${Number(c.volume)} ${esc(c.unit ?? '')}` : '—',
          ]
        }),
      ),
    },
    {
      n: '4', title: 'Журнал приготування дезінфекційних розчинів',
      note: '',
      body: table(
        ['Засіб', 'Реєстрація', 'Концентрація', 'Обʼєм', 'Приготовано', 'Придатний до', 'Виконавець'],
        x.solutions.map((r) => [
          esc(r.agent_name), or(r.registration), or(r.concentration),
          `${Number(r.volume)} ${esc(r.unit)}`, dt(r.prepared_at), dt(r.expires_at), who(r.profiles),
        ]),
      ),
    },
    {
      n: '5', title: 'Журнал прибирання та кварцування',
      note: '',
      body: table(
        ['Захід', 'Виконано', 'Виконавець'],
        x.cleaning.map((r) => [or(r.cleaning_tasks?.name), dt(r.performed_at), who(r.profiles)]),
      ),
    },
    {
      n: '6', title: 'Журнал стерилізації інструментів',
      note: 'Фіксуються всі цикли, зокрема невдалі — за показником індикатора.',
      body: table(
        ['Пристрій', 'Температура', 'Тривалість', 'Індикатор', 'Колір', 'Дата', 'Виконавець'],
        x.cycles.map((r) => [
          or(r.device), `${r.temperature_c} °C`, `${r.duration_minutes} хв`,
          r.indicator_ok ? 'успішно' : '<span class="warn">провал</span>',
          // Колонка кольору окремо від «успішно/провал»: ТЗ 3.3 просить
          // саме результат КОЛЬОРУ, і перевірка порівнює його з еталоном.
          or(r.indicator_note),
          dt(r.performed_at), who(r.profiles),
        ]),
      ),
    },
    {
      n: '7', title: 'Технологічні карти обробки',
      note: 'Затверджена версія карти незмінна; зміна регламенту створює нову версію.',
      body: x.cards.length === 0
        ? '<p class="empty">Карток немає.</p>'
        : x.cards.map((c) => {
            const steps = Array.isArray(c.steps) ? c.steps : []
            return `
          <div class="card">
            <h3>${or(c.title)} <span class="tag">версія ${c.version}</span></h3>
            ${steps.length === 0
              ? '<p class="empty">Кроків у цій версії не записано.</p>'
              : `<ol>${steps.map((st) => `<li>${stepLine(st)}</li>`).join('')}</ol>`}
          </div>`
          }).join(''),
    },
  ]

  return `<!doctype html>
<html lang="uk"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Звіт для перевірки — ${s?.name ? esc(s.name) : 'заклад не визначено'}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font: ${P.size.base}px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif;
         color: ${P.ink}; background: ${P.paper}; margin: 0; padding: 24px; max-width: 1000px; }
  header { border-bottom: 2px solid ${P.head}; padding-bottom: 14px; margin-bottom: 20px; }
  h1 { font-size: ${P.size.h1}px; margin: 0 0 4px; }
  h2 { font-size: ${P.size.h2}px; margin: 26px 0 6px; padding-top: 12px;
       border-top: 1px solid ${P.line}; page-break-after: avoid; }
  h3 { font-size: 12px; margin: 10px 0 4px; }
  .meta { color: ${P.muted}; font-size: 10.5px; }
  .meta b { color: ${P.ink}; }
  .note { color: ${P.muted}; font-size: ${P.size.small}px; margin: 0 0 8px; font-style: italic; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 4px; font-size: ${P.size.small}px;
          page-break-inside: auto; }
  th { text-align: left; background: ${P.tint}; font-weight: 600; }
  th, td { border: 1px solid ${P.line}; padding: 4px 6px; vertical-align: top; }
  tr { page-break-inside: avoid; }
  .warn { color: ${P.danger}; font-weight: 600; }
  .tag { display: inline-block; font-size: ${P.size.tiny}px; padding: 1px 6px; border-radius: 99px;
         background: ${P.tagBg}; color: ${P.head}; vertical-align: middle; }
  .empty { color: ${P.muted}; font-style: italic; margin: 6px 0 12px; }
  .card { border: 1px solid ${P.line}; border-radius: ${R.plate}px; padding: 8px 12px; margin: 8px 0;
          page-break-inside: avoid; }
  footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid ${P.line};
           color: ${P.muted}; font-size: ${P.size.small}px; }
  .actions { margin-bottom: 18px; }
  button { font: inherit; padding: 9px 16px; border-radius: ${R.control}px; border: 0;
           background: ${P.head}; color: ${P.paper}; cursor: pointer; }
  @media print { .actions { display: none; } body { padding: 0; } }
</style>
</head><body>

<div class="actions"><button onclick="window.print()">Зберегти як PDF / Друк</button></div>

<header>
  <h1>Звіт із санітарного обліку та обліку косметичної продукції</h1>
  <p class="meta">
    <!-- Шапка без названия заклада — это не «поле пустое», а документ,
         который нельзя предъявить: непонятно, чей он. Пустая строка это
         прятала, поэтому здесь прямое предупреждение. -->
    <b>${s?.name ? esc(s.name) : '<span class="warn">заклад не визначено</span>'}</b>${
      s?.legal_name ? ` · ${esc(s.legal_name)}` : ''}${
      s?.tax_id ? ` · ЄДРПОУ/ІПН ${esc(s.tax_id)}` : ''}<br>
    ${[s?.address, s?.city].filter(Boolean).map(esc).join(', ') || 'Адресу не вказано'}${
      s?.contact_phone ? ` · ${esc(s.contact_phone)}` : ''}<br>
    Сформовано: <b>${dt(now.toISOString())}</b> · Період журналів: останні <b>${x.days}</b> днів
  </p>
</header>

${sections.map((sec) => `
  <section>
    <h2>${sec.n}. ${esc(sec.title)}</h2>
    ${sec.note ? `<p class="note">${esc(sec.note)}</p>` : ''}
    ${sec.body}
  </section>`).join('')}

<footer>
  Документ сформовано автоматично з облікової системи. Записи журналів
  (розділи 4–6) незмінні: система не дозволяє редагувати або видаляти їх
  після внесення — виправлення вносяться окремим новим записом. У кожного
  запису зафіксовано час та виконавця.${unnamed > 0 ? `
  <br><span class="warn">У ${unnamed} ${unnamed === 1 ? 'записі' : 'записах'}
  імʼя виконавця не відображається</span>: людину вилучено зі складу команди
  або вона не вказала імені. Сам запис і його автор збережені в базі
  незмінними — не показане лише імʼя.` : ''}
</footer>

</body></html>`
}
