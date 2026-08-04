// Вёрстка Paperless-отчёта. Отдельным файлом, потому что это документ
// с юридическим весом: его читает проверяющий, и структура должна быть
// стабильной и правимой без правки серверной логики.

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
    inci: string | null; notification_code: string | null; pao_months: number | null
    unit: string; current_stock: number; is_cosmetic: boolean
  }>
  batches: Array<{
    batch_number: string; expiry_date: string; received_at: string
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
    indicator_ok: boolean; performed_at: string; profiles: Person
  }>
  cards: Array<{ title: string; version: number; steps: unknown; created_at: string }>
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

const d = (s: string | null) =>
  s ? new Date(s).toLocaleDateString('uk-UA') : '—'
const dt = (s: string | null) =>
  s ? new Date(s).toLocaleString('uk-UA', {
    day: '2-digit', month: '2-digit', year: 'numeric',
    hour: '2-digit', minute: '2-digit',
  }) : '—'
const who = (p: Person) => esc(p?.full_name ?? '—')

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

  const sections = [
    {
      n: '1', title: 'Реєстр косметичних засобів і матеріалів',
      note: 'Відповідно до Технічного регламенту на косметичну продукцію (постанова КМУ № 65).',
      body: table(
        ['Назва', 'Бренд', 'Країна', 'Код нотифікації МОЗ', 'PAO, міс', 'Залишок'],
        x.materials.map((m) => [
          esc(m.name) + (m.is_cosmetic ? ' <span class="tag">косметика</span>' : ''),
          esc(m.brand ?? '—'), esc(m.country_of_origin ?? '—'),
          m.notification_code ? esc(m.notification_code) : '<span class="warn">не вказано</span>',
          m.pao_months ? String(m.pao_months) : '—',
          `${Number(m.current_stock)} ${esc(m.unit)}`,
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
            esc(b.materials?.name), esc(b.batch_number),
            esc(b.suppliers?.name ?? '—'), d(b.received_at),
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
          const st = { sealed: 'запечатана', opened: 'відкрита', finished: 'використана' }[c.status] ?? c.status
          return [
            esc(c.materials?.name), esc(c.code), esc(st), dt(c.opened_at),
            expired ? `<span class="warn">${d(c.use_by)}</span>` : d(c.use_by),
            c.volume ? `${Number(c.volume)} ${esc(c.unit ?? '')}` : '—',
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
          esc(r.agent_name), esc(r.registration ?? '—'), esc(r.concentration),
          `${Number(r.volume)} ${esc(r.unit)}`, dt(r.prepared_at), dt(r.expires_at), who(r.profiles),
        ]),
      ),
    },
    {
      n: '5', title: 'Журнал прибирання та кварцування',
      note: '',
      body: table(
        ['Захід', 'Виконано', 'Виконавець'],
        x.cleaning.map((r) => [esc(r.cleaning_tasks?.name), dt(r.performed_at), who(r.profiles)]),
      ),
    },
    {
      n: '6', title: 'Журнал стерилізації інструментів',
      note: 'Фіксуються всі цикли, зокрема невдалі — за показником індикатора.',
      body: table(
        ['Пристрій', 'Температура', 'Тривалість', 'Індикатор', 'Дата', 'Виконавець'],
        x.cycles.map((r) => [
          esc(r.device), `${r.temperature_c} °C`, `${r.duration_minutes} хв`,
          r.indicator_ok ? 'успішно' : '<span class="warn">провал</span>',
          dt(r.performed_at), who(r.profiles),
        ]),
      ),
    },
    {
      n: '7', title: 'Технологічні карти обробки',
      note: 'Затверджена версія карти незмінна; зміна регламенту створює нову версію.',
      body: x.cards.length === 0
        ? '<p class="empty">Карток немає.</p>'
        : x.cards.map((c) => `
          <div class="card">
            <h3>${esc(c.title)} <span class="tag">версія ${c.version}</span></h3>
            <ol>${(Array.isArray(c.steps) ? c.steps : []).map((st) => {
              const o = st as Record<string, unknown>
              return `<li><b>${esc(o.step)}</b>${o.solution ? ` — ${esc(o.solution)}` : ''}${
                o.proportion ? `, пропорція ${esc(o.proportion)}` : ''}${
                o.minutes ? `, ${esc(o.minutes)} хв` : ''}${
                o.note ? `. ${esc(o.note)}` : ''}</li>`
            }).join('')}</ol>
          </div>`).join(''),
    },
  ]

  return `<!doctype html>
<html lang="uk"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Звіт для перевірки — ${esc(s?.name ?? '')}</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  * { box-sizing: border-box; }
  body { font: 11px/1.5 -apple-system, "Segoe UI", Roboto, sans-serif;
         color: #16150f; background: #fff; margin: 0; padding: 24px; max-width: 1000px; }
  header { border-bottom: 2px solid #22443a; padding-bottom: 14px; margin-bottom: 20px; }
  h1 { font-size: 19px; margin: 0 0 4px; }
  h2 { font-size: 13px; margin: 26px 0 6px; padding-top: 12px;
       border-top: 1px solid #ddd7cb; page-break-after: avoid; }
  h3 { font-size: 12px; margin: 10px 0 4px; }
  .meta { color: #6a6355; font-size: 10.5px; }
  .meta b { color: #16150f; }
  .note { color: #6a6355; font-size: 10px; margin: 0 0 8px; font-style: italic; }
  table { width: 100%; border-collapse: collapse; margin: 6px 0 4px; font-size: 10px;
          page-break-inside: auto; }
  th { text-align: left; background: #f3f0ea; font-weight: 600; }
  th, td { border: 1px solid #ddd7cb; padding: 4px 6px; vertical-align: top; }
  tr { page-break-inside: avoid; }
  .warn { color: #a83a32; font-weight: 600; }
  .tag { display: inline-block; font-size: 9px; padding: 1px 6px; border-radius: 99px;
         background: #e8efe9; color: #22443a; vertical-align: middle; }
  .empty { color: #6a6355; font-style: italic; margin: 6px 0 12px; }
  .card { border: 1px solid #ddd7cb; border-radius: 6px; padding: 8px 12px; margin: 8px 0;
          page-break-inside: avoid; }
  footer { margin-top: 28px; padding-top: 10px; border-top: 1px solid #ddd7cb;
           color: #6a6355; font-size: 10px; }
  .actions { margin-bottom: 18px; }
  button { font: inherit; padding: 9px 16px; border-radius: 8px; border: 0;
           background: #22443a; color: #f6f4ef; cursor: pointer; }
  @media print { .actions { display: none; } body { padding: 0; } }
</style>
</head><body>

<div class="actions"><button onclick="window.print()">Зберегти як PDF / Друк</button></div>

<header>
  <h1>Звіт із санітарного обліку та обліку косметичної продукції</h1>
  <p class="meta">
    <b>${esc(s?.name ?? '')}</b>${s?.legal_name ? ` · ${esc(s.legal_name)}` : ''}${
      s?.tax_id ? ` · ЄДРПОУ/ІПН ${esc(s.tax_id)}` : ''}<br>
    ${[s?.address, s?.city].filter(Boolean).map(esc).join(', ')}${
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
  запису зафіксовано час та виконавця.
</footer>

</body></html>`
}
