// Каркас письма. Один на все письма: меняется только содержимое.
//
// Почему таблицами и инлайновым стилем, а не тем же CSS, что на сайте:
// почтовые клиенты вырезают <style> из <head> (Gmail — выборочно,
// Outlook — почти всегда), не понимают flex и grid, и по-своему трактуют
// max-width. Таблица с фиксированной шириной и стилем в атрибуте —
// единственное, что рисуется одинаково везде. Это не архаика, а формат.
//
// Тёмная тема письма не делается: Gmail и Outlook инвертируют цвета сами
// и непредсказуемо. Светлый фон с тёмным текстом переживает инверсию
// лучше всего.

const BRAND = '#141417'
const ACCENT = '#2563eb'
const TEXT = '#141417'
const MUTED = '#5b5b66'
const LINE = '#e6e6ea'
const BG = '#f4f4f6'

export type EmailButton = { label: string; url: string }

export function emailLayout(opts: {
  preheader: string
  heading: string
  body: string
  button?: EmailButton
  footNote?: string
}): string {
  const { preheader, heading, body, button, footNote } = opts

  return `<!doctype html>
<html lang="uk">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<meta name="color-scheme" content="light">
<title>${escapeHtml(heading)}</title>
</head>
<body style="margin:0;padding:0;background:${BG};">

<!-- Превью в списке писем. Скрыто в теле, но показывается почтовиком
     рядом с темой — без него туда попадает первая строка вёрстки. -->
<div style="display:none;max-height:0;overflow:hidden;opacity:0;">${escapeHtml(preheader)}</div>

<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${BG};padding:32px 12px;">
<tr><td align="center">

  <table role="presentation" width="100%" cellpadding="0" cellspacing="0"
         style="max-width:520px;background:#ffffff;border-radius:16px;border:1px solid ${LINE};overflow:hidden;">

    <!-- Шапка: знак на тёмном. Картинок нет намеренно — они блокируются
         до нажатия «показать изображения», и письмо приезжает пустым. -->
    <tr><td style="background:${BRAND};padding:22px 28px;">
      <span style="font:700 19px/1 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;
                   letter-spacing:-0.02em;color:#ffffff;">CRES-CA</span><span
            style="color:#d9b262;font:700 19px/1 -apple-system,Arial,sans-serif;">.</span>
    </td></tr>

    <tr><td style="padding:32px 28px 8px;">
      <h1 style="margin:0 0 12px;font:650 23px/1.25 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;
                 letter-spacing:-0.02em;color:${TEXT};">${escapeHtml(heading)}</h1>
      <div style="font:400 15px/1.6 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:${TEXT};">
        ${body}
      </div>
    </td></tr>

    ${button ? `
    <tr><td style="padding:20px 28px 4px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td style="background:${ACCENT};border-radius:12px;">
          <a href="${escapeAttr(button.url)}"
             style="display:inline-block;padding:13px 26px;color:#ffffff;text-decoration:none;
                    font:600 15px/1 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;">${escapeHtml(button.label)}</a>
        </td>
      </tr></table>
    </td></tr>` : ''}

    ${footNote ? `
    <tr><td style="padding:20px 28px 0;">
      <p style="margin:0;font:400 13px/1.5 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:${MUTED};">
        ${footNote}
      </p>
    </td></tr>` : ''}

    <tr><td style="padding:28px;">
      <div style="border-top:1px solid ${LINE};padding-top:18px;
                  font:400 12px/1.6 -apple-system,'Segoe UI',Roboto,Arial,sans-serif;color:${MUTED};">
        CRES-CA — вітрина, склад і облік для українських підприємців.<br>
        <a href="https://cres-ca.com" style="color:${MUTED};">cres-ca.com</a>
      </div>
    </td></tr>

  </table>

</td></tr>
</table>
</body></html>`
}

// Крупный код цифрами. Моноширинный и с разрядкой: шестизначное число
// переписывают глазами с экрана на экран, и слипшиеся цифры путают.
export function codeBlock(code: string): string {
  return `<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0;">
  <tr><td style="background:#f4f4f6;border:1px solid ${LINE};border-radius:12px;padding:16px 24px;">
    <span style="font:700 30px/1 ui-monospace,'SF Mono',Menlo,Consolas,monospace;
                 letter-spacing:0.22em;color:${TEXT};">${escapeHtml(code)}</span>
  </td></tr></table>`
}

export function escapeHtml(s: string): string {
  return String(s ?? '').replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

function escapeAttr(s: string): string {
  return escapeHtml(s).replace(/'/g, '&#39;')
}
