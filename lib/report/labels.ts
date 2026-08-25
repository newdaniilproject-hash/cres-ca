// Лист наклеек на ёмкости.
//
// ── ЯЗЫК: ТО ЖЕ РЕШЕНИЕ, ЧТО И У ОТЧЁТА (шаг локализации, 16.08.2026) ─────
//
// Наклейка ВСЕГДА украинская, языка интерфейса не спрашивает. Она клеится
// на банку и вместе с журналами является тем, что проверяющий читает
// глазами на месте: «Відкрито» и «Використати до» — это доказательство
// соблюдения PAO по Техрегламенту № 65, а не подпись на экране.
// Наклейка живёт на банке месяцами и переживает любое переключение языка
// в кабинете, поэтому «на каком языке печатал мастер» не может решать,
// на каком языке она прочитается на проверке.
//
// Отсюда: ни импорта из `lib/i18n`, ни параметра `lang`. Дата — через
// `DOC_LOCALE`, а не через `t.date`. Разбор решения целиком —
// в шапке `lib/report/sanitation-report.ts`.
// Цвета печати — из общего источника. Своя палитра здесь жила до
// 19.08.2026 и была сепией первого оформления: наклейка на банке
// печаталась в цветах, которых в продукте нет.
import { PRINT as P } from '@/lib/design/tokens'

const DOC_LOCALE = 'uk-UA'

// ⚠️ ПЯТЬ РЕКВИЗИТОВ ТЗ 3.2, И ОНИ ЗДЕСЬ ПЕРЕЧИСЛЕНЫ ЦЕЛИКОМ.
//
// ТЗ называет их дословно: «назви, партії, дати розливу, відповідального
// майстра та кінцевого терміну». До 25.08.2026 на бумагу ехали ЧЕТЫРЕ:
// у этого типа не было поля мастера вовсе, роут его вычислял и передавал,
// а `.map()` молча выбрасывал лишнее свойство — избыточные поля через
// `.map()` `tsc` не ловит, в отличие от литерала.
//
// Расхождение жило между ДВУМЯ сборками одной наклейки: `container_label()`
// в базе собирает все пять и показывается в шторке на экране, а на печать
// шёл этот файл. Экран выглядел правильно, бумага — нет, и увидеть это
// можно было только распечатав.
//
// Правило на будущее: наклейка — это документ проверки, и состав её полей
// меняется вместе с ТЗ, а не вместе с вёрсткой. Убирая поле отсюда,
// проверь `container_label()` — либо они совпадают, либо расходятся молча.
export type Label = {
  code: string
  material: string
  batch: string | null
  useBy: string | null
  openedAt: string | null
  volume: number | null
  unit: string | null
  /** Ответственный мастер — пятый реквизит ТЗ 3.2. */
  master: string | null
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

// Лист А4: сетка 3×8 наклеек 65×37 мм — стандартный формат самоклейки,
// который продаётся в любой канцелярии. Раскладка в миллиметрах,
// чтобы печать совпадала с листом без подгонки масштаба.
export function labelsHtml(shop: string, labels: Label[]): string {
  const d = (s: string | null) => s ? new Date(s).toLocaleDateString(DOC_LOCALE) : '—'

  // Строка мастера печатается ВСЕГДА, даже пустая. Отсутствующая строка
  // читается проверяющим как «система этого не ведёт», а «не вказаний» —
  // как «ведёт, но здесь не заполнено». Разница между этими двумя
  // прочтениями и есть предмет проверки. Запасной текст тот же, что
  // у container_label() в базе.
  //
  // Комментарий стоит ЗДЕСЬ, а не внутри шаблона: во-первых, он поехал бы
  // в разметку, уходящую в принтер; во-вторых, обратные кавычки внутри
  // шаблонной строки закрывают её и роняют сборку.
  const cells = labels.map((l) => `
    <div class="label">
      <div class="qr" data-code="${esc(l.code)}"></div>
      <div class="txt">
        <div class="name">${esc(l.material)}</div>
        <div class="code">${esc(l.code)}</div>
        ${l.batch ? `<div class="row">Партія: ${esc(l.batch)}</div>` : ''}
        ${l.volume ? `<div class="row">${l.volume} ${esc(l.unit ?? '')}</div>` : ''}
        <div class="row">Розлив: <b>${d(l.openedAt)}</b></div>
        <div class="row">Майстер: ${esc(l.master ?? 'не вказаний')}</div>
        <div class="useby">Використати до: <b>${d(l.useBy)}</b></div>
      </div>
    </div>`).join('')

  return `<!doctype html>
<html lang="uk"><head>
<meta charset="utf-8">
<title>Наліпки — ${esc(shop)}</title>
<script src="https://cdn.jsdelivr.net/npm/qrcode@1.5.4/build/qrcode.min.js"></script>
<style>
  @page { size: A4; margin: 8mm 5mm; }
  * { box-sizing: border-box; }
  body { font: 8pt/1.35 -apple-system, "Segoe UI", Roboto, sans-serif;
         margin: 0; padding: 12px; background: ${P.tint}; color: ${P.ink}; }
  .sheet { display: grid; grid-template-columns: repeat(3, 65mm);
           grid-auto-rows: 37mm; gap: 2mm; justify-content: center; }
  .label { border: 1px dashed ${P.lineStrong}; border-radius: 2mm; padding: 2mm;
           display: flex; gap: 2mm; align-items: center; background: ${P.paper};
           overflow: hidden; page-break-inside: avoid; }
  .qr { width: 24mm; height: 24mm; flex: 0 0 24mm; }
  .qr canvas { width: 100% !important; height: 100% !important; }
  .txt { min-width: 0; flex: 1; }
  .name { font-weight: 700; font-size: 8.5pt; line-height: 1.2;
          overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2;
          -webkit-box-orient: vertical; }
  .code { font-family: ui-monospace, monospace; font-size: 7.5pt; color: ${P.muted}; }
  .row { font-size: 7pt; color: ${P.ink}; }
  .useby { margin-top: 0.5mm; font-size: 7.5pt; color: ${P.head}; }
  .actions { max-width: 205mm; margin: 0 auto 12px; display: flex;
             align-items: center; gap: 12px; }
  button { font: inherit; font-size: 10pt; padding: 9px 16px; border-radius: 8px;
           border: 0; background: ${P.head}; color: ${P.paper}; cursor: pointer; }
  .hint { color: ${P.muted}; font-size: 9pt; }
  .empty { max-width: 205mm; margin: 40px auto; text-align: center; color: ${P.muted}; }
  /* Отказ генератора QR. Цвета — те же печатные токены, что и всё
     остальное на листе: своего значения здесь нет ни одного. */
  .qr-fail { max-width: 205mm; margin: 0 auto 12px; padding: 10px 14px;
             border-radius: 8px; font-size: 9.5pt; line-height: 1.4;
             background: ${P.paper}; border: 1px solid ${P.danger};
             color: ${P.danger}; }
  .qr-empty { display: flex; align-items: center; justify-content: center;
              border: 1px dashed ${P.danger}; border-radius: 1mm;
              font-size: 7pt; color: ${P.danger}; }
  button:disabled { background: ${P.muted}; cursor: not-allowed; }
  @media print {
    .actions { display: none; }
    body { background: ${P.paper}; padding: 0; }
    .label { border-color: transparent; }
    /* Полоса и метка «без QR» уходят НА БУМАГУ, а не прячутся вместе
       с кнопкой: печать могли запустить с клавиатуры. */
  }
</style>
</head><body>

<div class="actions">
  <button onclick="window.print()">Друк наліпок</button>
  <span class="hint">Аркуш A4, 3 × 8 наліпок 65 × 37 мм — стандартна самоклейка.</span>
</div>

${labels.length === 0
  ? '<p class="empty">Немає ємностей для друку. Заведіть ємність у складі — і поверніться сюди.</p>'
  : `<div class="sheet">${cells}</div>`}

<script>
  // ── ОТКАЗ ГЕНЕРАТОРА QR ОБЯЗАН БЫТЬ ГРОМКИМ ──────────────────────────
  //
  // Найдено 25.08.2026 при проверке листа рендером. Библиотека приезжает
  // из внешнего CDN, и когда он недоступен — салон печатает с планшета
  // на слабом Wi-Fi, сеть отвалилась, провайдер режет CDN — переменная
  // QRCode не объявлена, обработчик падает на первой же ячейке, и место
  // под код остаётся ПУСТЫМ КВАДРАТОМ 24 мм. Пустой квадрат на макете
  // читается как элемент оформления: наклейки уходят в принтер, клеятся
  // на дозаторы, и обнаруживается это в тот день, когда мастер впервые
  // подносит к банке сканер.
  //
  // Сам QR — это и есть требование ТЗ 3.2 («Друк / Генерація QR-кодів»)
  // и единственное, ради чего наклейку печатают: код на ней связывает
  // физическую банку с карточкой. Наклейка без кода — просто бумажка
  // с датой.
  //
  // Поэтому: печать блокируется, сверху встаёт красная полоса, и каждая
  // ячейка называет причину словами. Молчаливого отказа не остаётся.
  (function () {
    var fail = typeof QRCode === 'undefined';
    if (!fail) {
      try {
        document.querySelectorAll('.qr').forEach(function (el) {
          var c = document.createElement('canvas');
          el.appendChild(c);
          QRCode.toCanvas(c, el.dataset.code, { margin: 0, width: 200,
            color: { dark: '${P.ink}', light: '${P.paper}' } });
        });
      } catch (e) { fail = true; }
    }
    if (!fail) return;

    var bar = document.createElement('p');
    bar.className = 'qr-fail';
    bar.textContent = 'QR-коди не згенерувались: немає звʼязку з бібліотекою'
      + ' кодів. Друкувати НЕ МОЖНА — наліпка без коду не звʼяже банку'
      + ' з карткою. Перевірте мережу і оновіть сторінку.';
    document.body.insertBefore(bar, document.body.firstChild);

    var btn = document.querySelector('.actions button');
    if (btn) { btn.disabled = true; btn.textContent = 'Друк недоступний'; }

    document.querySelectorAll('.qr').forEach(function (el) {
      el.classList.add('qr-empty');
      el.textContent = 'без QR';
    });
  })();
</script>

</body></html>`
}
