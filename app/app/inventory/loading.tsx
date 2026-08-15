// Скелетон загрузки. Рисует ТОЛЬКО содержимое: шапка, заголовок
// и нижняя панель приходят из `app/app/layout.tsx` и во время
// загрузки уже стоят на экране. Раньше здесь была своя AppShell —
// и при каждом переходе на экране оказывались две нижние панели
// одна поверх другой. Не возвращать.
// Форма повторяет InventoryClient: сканер сверху, ряд быстрых ссылок,
// вкладки, список ёмкостей ниже — именно список меняет высоту от
// данных, поэтому только он получает переменное число строк.
export default function Loading() {
  return (
    <>
      <div className="flex flex-col gap-6">
        <section className="card rise-1">
          <div className="flex gap-2">
            <span className="skeleton h-11 flex-1" />
            <span className="skeleton h-11 w-24 shrink-0" />
            <span className="skeleton h-11 w-11 shrink-0" />
          </div>
        </section>

        <div className="rise-2 flex flex-wrap gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="skeleton h-11 w-32" />
          ))}
        </div>

        <div className="rise-2 flex flex-wrap items-center gap-2">
          {Array.from({ length: 3 }).map((_, i) => (
            <span key={i} className="skeleton h-9 w-28" />
          ))}
        </div>

        <section className="card rise-2 !p-0">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="skeleton-row px-5">
              <span /><span /><span /><span />
            </div>
          ))}
        </section>
      </div>
    </>
  )
}
