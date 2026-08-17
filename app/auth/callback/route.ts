import { NextResponse } from 'next/server'

// Возврат от Apple и Google.
//
// Две разные развилки, и путать их нельзя.
//
// Веб: человек в обычном браузере, PKCE-верификатор лежит в его куках.
// Отправляем на /auth/finish, там сессия и собирается.
//
// Приложение (native=1): страница открыта в СИСТЕМНОМ (или внешнем)
// браузере, а куки веб-вью ему недоступны. Верификатора здесь нет
// и быть не может, поэтому обменять код на сессию отсюда невозможно
// физически. Отдаём код обратно в приложение ссылкой схемы cresca://
// — обмен сделает components/deep-link.tsx, уже внутри веб-вью.
//
// ⚠️ 12.08.2026: эта ветка была удалена 05.08 вместе со всей обёрткой
// («Обёртки больше нет… удалено по правилу 8») и не вернулась 11.08.
// Восстановлена по истории (коммит adb48796) и по КОНСПЕКТЫ.md, М4.
export const dynamic = 'force-dynamic'

export async function GET(request: Request) {
  const url = new URL(request.url)
  const code = url.searchParams.get('code')
  const err =
    url.searchParams.get('error_description') ??
    url.searchParams.get('error') ??
    null
  const native = url.searchParams.get('native') === '1'
  const next = url.searchParams.get('next') || ''

  if (native) {
    const target = new URL('cresca://auth')
    if (code) target.searchParams.set('code', code)
    if (err) target.searchParams.set('error', err)
    if (next) target.searchParams.set('next', next)
    return new NextResponse(handoff(target.toString()), {
      headers: {
        'content-type': 'text/html; charset=utf-8',
        'cache-control': 'no-store',
      },
    })
  }

  const finish = new URL('/auth/finish', url.origin)
  if (code) finish.searchParams.set('code', code)
  if (err) finish.searchParams.set('error', err)
  if (next) finish.searchParams.set('next', next)
  return NextResponse.redirect(finish)
}

// Страница-пересадка. Ей жить полторы секунды, поэтому ни React,
// ни шрифтов, ни CSS-переменных — только собственная разметка.
// Цвета совпадают с --color-bg и --color-muted намеренно: иначе
// на возврате в приложение мигает белым.
function handoff(target: string): string {
  const safe = target.replace(/&/g, '&amp;').replace(/"/g, '&quot;')

  // Значение для скрипта. Знак «меньше» гасится отдельно: JSON.stringify его
  // не трогает, и закрывающий тег внутри значения закрыл бы блок скрипта.
  // Сейчас такого значения не бывает — searchParams кодирует и его, и косую
  // черту, — но защита стоит здесь, а не в предположении о вызывающем.
  const inScript = JSON.stringify(target).replace(/</g, '\\u003c')
  return `<!doctype html>
<html lang="uk"><head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">
<meta name="theme-color" content="#141417">
<title>Повертаємось у застосунок…</title>
<style>
 html,body{margin:0;height:100%;background:#141417;color:#e8e8ec;
  font:500 16px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;
  -webkit-font-smoothing:antialiased}
 .w{display:flex;min-height:100%;flex-direction:column;align-items:center;
  justify-content:center;gap:18px;padding:24px;text-align:center}
 p{margin:0;color:#8b8b96;font-size:14px}
 a{display:inline-flex;align-items:center;justify-content:center;height:52px;
  padding:0 26px;border-radius:14px;background:#2563eb;color:#fff;
  font-weight:650;letter-spacing:-.02em;text-decoration:none}
 .s{width:26px;height:26px;border:2px solid rgba(255,255,255,.16);
  border-top-color:#60a5fa;border-radius:999px;animation:r .7s linear infinite}
 @keyframes r{to{transform:rotate(360deg)}}
 #b{display:none}
</style>
</head><body>
<div class="w">
 <div class="s"></div>
 <p>Повертаємось у застосунок…</p>
 <a id="b" href="${safe}">Відкрити застосунок</a>
</div>
<script>
 var t=${inScript};
 location.replace(t);
 // Если система не подхватила схему за полторы секунды — показываем
 // кнопку. Молча висящий спиннер человек читает как поломку.
 setTimeout(function(){document.getElementById('b').style.display='inline-flex'},1500);
</script>
</body></html>`
}
