import { publicT as t } from '@/components/shell'

export const metadata = { title: t('public.offline.meta.title') }

// Страница, которую service worker отдаёт вместо пустого экрана,
// когда сети нет и в кеше ничего подходящего не нашлось.
// Её задача — не извиниться, а сказать, что делать дальше.
//
// Язык закреплён украинским по той же причине, что и на всей витрине,
// плюс по своей собственной: страница обязана оставаться СТАТИЧЕСКОЙ.
// `getT()` зовёт `cookies()`, страница стала бы динамической, и отдать
// её без сети было бы нечем — офлайновый экран, который сам требует
// сервера, бессмыслен. Это тот же урок, что записан в `public/sw.js`
// разбором отказа 15.08.2026.
export default function OfflinePage() {
  return (
    <main className="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-5 py-12">
      <p className="eyebrow">{t('public.offline.eyebrow')}</p>
      <h1 className="display mt-3 t-3xl">{t('public.offline.title')}</h1>
      <p className="t-md mt-4 leading-relaxed prose-muted">{t('public.offline.desc')}</p>
      <p className="t-md mt-3 leading-relaxed prose-muted">{t('public.offline.queue')}</p>
      <div className="mt-8 flex flex-wrap gap-3">
        <a href="/app/inventory" className="btn-primary">{t('public.offline.toInventory')}</a>
        <a href="/app" className="btn-secondary">{t('public.offline.toApp')}</a>
      </div>
    </main>
  )
}
