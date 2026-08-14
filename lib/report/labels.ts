export type Label = {
  code: string
  material: string
  batch: string | null
  useBy: string | null
  openedAt: string | null
  volume: number | null
  unit: string | null
  /** Відповідальний майстер — реквизит ТЗ 3.2. Имя приходит из `staff`
   *  (см. app/app/inventory/labels/route.ts): у profiles политика
   *  «вижу только себя», и join к нему давал бы прочерк у всех чужих. */
  master: string | null
}

const esc = (s: unknown) =>
  String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))

// Лист А4: сетка 3×8 наклеек 65×37 мм — стандартный формат самоклейки,
// который продаётся в любой канцелярии. Раскладка в миллиметрах,
// чтобы печать совпадала с листом без подгонки масштаба.
export function labelsHtml(shop: string, labels: Label[]): string {
  const d = (s: string | null) => s ? new Date(s).toLocaleDateString('uk-UA') : '—'

  const cells = labels.map((l) => `
    <div class="label">
      <div class="qr" data-code="${esc(l.code)}"></div>
      <div class="txt">
        <div class="name">${esc(l.material)}</div>
        <div class="code">${esc(l.code)}</div>
        ${l.batch ? `<div class="row">Партія: ${esc(l.batch)}</div>` : ''}
        ${l.volume ? `<div class="row">${l.volume} ${esc(l.unit ?? '')}</div>` : ''}
        ${l.master ? `<div class="row">Майстер: <b>${esc(l.master)}</b></div>` : ''}
        <div class="row">Відкрито: <b>${d(l.openedAt)}</b></div>
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
         margin: 0; padding: 12px; background: #f3f0ea; color: #16150f; }
  .sheet { display: grid; grid-template-columns: repeat(3, 65mm);
           grid-auto-rows: 37mm; gap: 2mm; justify-content: center; }
  .label { border: 1px dashed #b9b2a3; border-radius: 2mm; padding: 2mm;
           display: flex; gap: 2mm; align-items: center; background: #fff;
           overflow: hidden; page-break-inside: avoid; }
  .qr { width: 24mm; height: 24mm; flex: 0 0 24mm; }
  .qr canvas { width: 100% !important; height: 100% !important; }
  .txt { min-width: 0; flex: 1; }
  .name { font-weight: 700; font-size: 8.5pt; line-height: 1.2;
          overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2;
          -webkit-box-orient: vertical; }
  .code { font-family: ui-monospace, monospace; font-size: 7.5pt; color: #6a6355; }
  .row { font-size: 7pt; color: #4a453b; }
  .useby { margin-top: 0.5mm; font-size: 7.5pt; color: #22443a; }
  .actions { max-width: 205mm; margin: 0 auto 12px; display: flex;
             align-items: center; gap: 12px; }
  button { font: inherit; font-size: 10pt; padding: 9px 16px; border-radius: 8px;
           border: 0; background: #22443a; color: #f6f4ef; cursor: pointer; }
  .hint { color: #6a6355; font-size: 9pt; }
  .empty { max-width: 205mm; margin: 40px auto; text-align: center; color: #6a6355; }
  @media print {
    .actions { display: none; }
    body { background: #fff; padding: 0; }
    .label { border-color: transparent; }
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
  // ЗАПАСНОЙ ПУТЬ. Генератор тянется с чужого CDN, и без сети он просто
  // не загрузится. До 14.08.2026 обработчик в этом случае падал на первой
  // строке (ReferenceError: QRCode), лист печатался с ПУСТЫМИ КВАДРАТАМИ,
  // и ни одного сообщения не показывалось: мастер клеил пустышки на банки
  // и узнавал об этом на проверке. Теперь отказ виден до печати.
  (function () {
    var cells = document.querySelectorAll('.qr');
    var ok = typeof QRCode !== 'undefined' && QRCode && typeof QRCode.toCanvas === 'function';
    if (!ok) {
      var warn = document.createElement('p');
      warn.className = 'empty';
      warn.textContent = 'QR-коди не згенеровано: генератор не завантажився '
        + '(немає мережі). Друкувати не варто — на наліпках будуть порожні '
        + 'квадрати. Перевірте зв’язок і оновіть сторінку.';
      document.body.insertBefore(warn, document.body.firstChild);
      cells.forEach(function (el) { el.textContent = '—'; });
      return;
    }
    cells.forEach(function (el) {
      var c = document.createElement('canvas');
      el.appendChild(c);
      try {
        QRCode.toCanvas(c, el.dataset.code, { margin: 0, width: 200,
          color: { dark: '#16150f', light: '#ffffff' } });
      } catch (e) {
        el.textContent = '—';
      }
    });
  })();
</script>

</body></html>`
}
