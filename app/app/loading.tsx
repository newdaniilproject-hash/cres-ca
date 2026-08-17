'use client'

// Скелетон загрузки кабинета — общий для всех экранов сегмента.
//
// Рисует ТОЛЬКО содержимое: шапка, заголовок и нижняя панель приходят
// из `app/app/layout.tsx` и во время загрузки уже стоят на экране.
// Раньше здесь была своя AppShell — и при каждом переходе на экране
// оказывались две нижние панели одна поверх другой. Не возвращать.
//
// И он НЕЙТРАЛЬНЫЙ, без заголовков вроде «Записи сьогодні». Этот файл
// подставляется при переходе на любой экран кабинета, у которого нет
// своего скелетона: на «Послугах» и «Профілі» подписи дашборда читались
// как содержимое чужого раздела. Пустые полосы честнее — они говорят
// «идёт загрузка», а не называют то, чего здесь не будет.
//
// ЕДИНСТВЕННАЯ строка здесь — подпись для скринридера, и она из словаря.
// Отсюда `'use client'` и `useT()`, а не `await getT()`: этот компонент
// подставляется как `fallback` границы Suspense, а fallback не имеет права
// сам приостанавливаться — асинхронный серверный компонент на этом месте
// отдал бы пустоту вместо скелетона. Язык приходит контекстом из
// `app/app/layout.tsx`, который стоит выше этой границы.

import { useT } from '@/lib/i18n/client'

export default function Loading() {
  const t = useT()
  return (
    <div className="flex flex-col gap-4" aria-busy aria-label={t('app.loading.aria')}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="card-flat !p-3">
            <span className="skeleton mx-auto block h-7 w-12" />
            <span className="skeleton mx-auto mt-2 block h-3 w-16" />
          </div>
        ))}
      </div>

      <section className="card !p-0">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="row px-5">
            <span className="min-w-0 flex-1">
              <span className="skeleton block h-4 w-1/2" />
              <span className="skeleton mt-2 block h-3 w-1/3" />
            </span>
            <span className="skeleton h-6 w-16 shrink-0" />
          </div>
        ))}
      </section>
    </div>
  )
}
