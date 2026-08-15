// Скелетон загрузки. Рисует ТОЛЬКО содержимое: шапка, заголовок
// и нижняя панель приходят из `app/app/layout.tsx` и во время
// загрузки уже стоят на экране. Раньше здесь была своя AppShell —
// и при каждом переходе на экране оказывались две нижние панели
// одна поверх другой. Не возвращать.
// Кожна техкарта — окрема card з рядком заголовка (назва, підзаголовок,
// кнопка версії) — та сама форма, що й .skeleton-row.
export default function Loading() {
  return (
    <>
      <div className="flex flex-col gap-5">
        <div className="rise flex flex-wrap items-center gap-2">
          <span className="skeleton h-11 w-40" />
        </div>

        <div className="flex flex-col gap-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <section key={i} className="card rise-2">
              <div className="skeleton-row">
                <span /><span /><span /><span />
              </div>
            </section>
          ))}
        </div>
      </div>
    </>
  )
}
