import type { Key, Lang } from '@/lib/i18n/dict'
import { createT, type T } from '@/lib/i18n/translate'
import type { Denial } from './check'
import type { Scope } from './rules'

// Что человек видит при превышении.
//
// Не молчаливый отказ и не голый 429: страница на языке интерфейса, в которой
// сказано, что произошло и когда можно повторить, плюс заголовок `Retry-After`
// для всего, что читает ответ машиной.
//
// Тексты — из словаря (`lib/i18n/locales/uk.json`), а не строкой в коде:
// это отказ, который увидит покупатель витрины, то есть обычный текст
// интерфейса, а не служебное сообщение базы (правило из `lib/i18n/dict.ts`
// о том, что в словарь НЕ кладётся, сюда не относится — здесь текст наш).

const DESC: Record<Scope, Key> = {
  signin: 'limit.signin.desc',
  signup: 'limit.signup.desc',
  order: 'limit.order.desc',
  search: 'limit.any.desc',
  any: 'limit.any.desc',
}

/**
 * «через 40 секунд» / «через 15 хвилин».
 *
 * Секунды до минуты, дальше минуты с округлением ВВЕРХ: сказать «через
 * 0 хвилин» — значит предложить повторить прямо сейчас и получить второй
 * отказ. Формы числительного берёт `t.plural` (правило языка живёт
 * в `lib/i18n/format.ts` и здесь не повторяется).
 */
export function waitText(t: T, seconds: number): string {
  if (seconds < 60) return t.plural('limit.wait.seconds', Math.max(1, seconds))
  return t.plural('limit.wait.minutes', Math.ceil(seconds / 60))
}

function escape(s: string): string {
  return s.replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c] as string))
}

// Страница отказа собирается строкой, а не компонентом: `proxy.ts` работает
// до маршрутизации, React там нет. Стили инлайном по той же причине —
// таблица стилей приложения этому ответу недоступна, а ссылка на неё
// означала бы второй запрос ради страницы отказа.
function page(t: T, lang: Lang, title: string, desc: string): string {
  return `<!doctype html><html lang="${lang}"><head>`
    + '<meta charset="utf-8">'
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    + '<meta name="robots" content="noindex">'
    + `<title>${escape(title)}</title>`
    + '<style>'
    + 'html{color-scheme:dark light}'
    + 'body{margin:0;min-height:100dvh;display:flex;align-items:center;justify-content:center;'
    + 'padding:24px;background:#0f0f11;color:#f3f1ee;'
    + 'font:16px/1.5 system-ui,-apple-system,Segoe UI,Roboto,sans-serif}'
    + 'main{max-width:34rem;text-align:center}'
    + 'h1{margin:0 0 12px;font-size:1.5rem;font-weight:600}'
    + 'p{margin:0 0 20px;opacity:.8}'
    + 'a{color:#d8b26a}'
    + '</style></head><body><main>'
    + `<h1>${escape(title)}</h1>`
    + `<p>${escape(desc)}</p>`
    + `<a href="/">${escape(t('limit.home'))}</a>`
    + '</main></body></html>'
}

/**
 * Ответ 429.
 *
 * `Retry-After` стоит всегда — это единственное, по чему клиент (и обёртка
 * приложения, и чужой скрипт, который ведёт себя прилично) понимает, когда
 * повторять. Заголовков `X-RateLimit-*` здесь НЕТ намеренно: они говорят
 * подбирающему, сколько попыток у него осталось и когда обнулится счёт,
 * то есть помогают ровно тому, от кого мы защищаемся. Человеку хватает
 * времени повтора, а оно и так в ответе.
 */
export function tooMany(denial: Denial, lang: Lang, wantsHtml: boolean): Response {
  const t = createT(lang)
  const wait = waitText(t, denial.retryAfter)
  const title = t('limit.title')
  const desc = t(DESC[denial.scope], { wait })

  const headers: Record<string, string> = {
    'Retry-After': String(denial.retryAfter),
    // Закешированный 429 отдавался бы человеку и после того, как окно
    // кончилось, — и на витрине его закешировал бы ещё и Cloudflare.
    'Cache-Control': 'no-store, max-age=0',
  }

  if (wantsHtml) {
    return new Response(page(t, lang, title, desc), {
      status: 429,
      headers: { ...headers, 'Content-Type': 'text/html; charset=utf-8' },
    })
  }

  // Форма тела та же, что у остальных отказов проекта (`{ error }`),
  // — иначе клиентский код разбирал бы два разных вида ошибки.
  return new Response(JSON.stringify({ error: desc, retryAfter: denial.retryAfter }), {
    status: 429,
    headers: { ...headers, 'Content-Type': 'application/json; charset=utf-8' },
  })
}
