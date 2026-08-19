// Скелетон загрузки. Рисует ТОЛЬКО содержимое: шапка, заголовок
// и нижняя панель приходят из `app/app/layout.tsx` и во время
// загрузки уже стоят на экране (урок movements/loading.tsx: своя
// AppShell давала две нижние панели одна поверх другой).
// Форма повторяет экран: шапка документа, строка сканера, чипы, строки.
export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      <section className="card rise-1 skeleton-card">
        <span /><span /><span /><span /><span />
      </section>

      <div className="rise-2 flex items-center gap-2">
        <span className="skeleton h-11 flex-1" />
        <span className="skeleton h-11 w-24" />
        <span className="skeleton h-11 w-11" />
      </div>

      <div className="rise-2 flex gap-2">
        {Array.from({ length: 3 }).map((_, i) => (
          <span key={i} className="skeleton h-9 w-28" />
        ))}
      </div>

      <section className="card rise-3 !p-0">
        {Array.from({ length: 7 }).map((_, i) => (
          <div key={i} className="skeleton-row px-5">
            <span /><span /><span /><span />
          </div>
        ))}
      </section>
    </div>
  )
}
