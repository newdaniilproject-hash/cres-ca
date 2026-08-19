// Скелетон загрузки. Рисует ТОЛЬКО содержимое: шапка, заголовок
// и нижняя панель приходят из `app/app/layout.tsx` и во время
// загрузки уже стоят на экране (урок movements/loading.tsx: своя
// AppShell давала две нижние панели одна поверх другой).
// Форма повторяет экран: счётчики-плитки, кнопка действия, список.
export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      {/* Счётчики — той же сеткой, что и живые плитки `.metric`. */}
      <div className="rise-1 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <span key={i} className="skeleton h-16" />
        ))}
      </div>

      <div className="rise-1 flex flex-wrap items-center gap-2">
        <span className="skeleton h-11 w-48" />
      </div>

      <section className="card rise-2 !p-0">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="skeleton-row px-5">
            <span /><span /><span /><span />
          </div>
        ))}
      </section>
    </div>
  )
}
