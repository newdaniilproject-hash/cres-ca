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
export default function Loading() {
  return (
    <div className="flex flex-col gap-4" aria-busy aria-label="Завантаження">
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
