// Скелетон загрузки. Рисует ТОЛЬКО содержимое: шапка, заголовок
// и нижняя панель приходят из `app/app/layout.tsx` и во время
// загрузки уже стоят на экране. Раньше здесь была своя AppShell —
// и при каждом переходе на экране оказывались две нижние панели
// одна поверх другой. Не возвращать.
// MovementsClient рендерит рухи тем же .row, что и всюду в кабінеті
// (заголовок+мета зліва, кількість+бейдж справа) — не таблицею.
export default function Loading() {
  return (
    <>
      <div className="flex flex-col gap-5">
        <div className="rise flex flex-wrap items-center gap-2">
          <span className="skeleton h-11 w-40" />
        </div>

        <div className="rise-1 flex flex-wrap items-center gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <span key={i} className="skeleton h-9 w-24" />
          ))}
        </div>

        <section className="card rise-2 !p-0">
          {Array.from({ length: 7 }).map((_, i) => (
            <div key={i} className="skeleton-row px-5">
              <span /><span /><span /><span />
            </div>
          ))}
        </section>
      </div>
    </>
  )
}
