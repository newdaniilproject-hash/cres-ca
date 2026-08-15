// Канонический адрес сайта — одно место на весь проект.
//
// Нужен там, где относительной ссылки недостаточно и адрес обязан быть
// абсолютным: robots.txt, карта сайта, канонические ссылки, ссылки в письмах.
// Собирать его из заголовков запроса нельзя: тогда бот, пришедший на
// www-версию, получит карту сайта с www-адресами, а пришедший на голый
// домен — с голыми, и поисковик увидит два сайта с одинаковым содержимым.
//
// Порядок: явная переменная → адрес продакшена, который Vercel подставляет
// сам → домен проекта. Последнее — не «на всякий случай», а рабочее значение
// для локальной сборки, где первых двух нет.
export const SITE_URL: string = (() => {
  const explicit = process.env.NEXT_PUBLIC_SITE_URL
  if (explicit) return explicit.replace(/\/+$/, '')

  const vercel = process.env.VERCEL_PROJECT_PRODUCTION_URL
  if (vercel) return `https://${vercel.replace(/\/+$/, '')}`

  return 'https://cres-ca.com'
})()

/** Абсолютный адрес из внутреннего пути: `abs('/t/salon')`. */
export function abs(path: string): string {
  return `${SITE_URL}${path.startsWith('/') ? path : `/${path}`}`
}
