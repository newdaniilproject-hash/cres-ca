// Скелетон загрузки. Рисует ТОЛЬКО содержимое: шапка, заголовок
// и нижняя панель приходят из `app/app/layout.tsx` и во время
// загрузки уже стоят на экране. Своей AppShell здесь быть не должно —
// при каждом переходе на экране оказывались бы две нижние панели
// одна поверх другой. Не заводить.
//
// Причина появления — та же, что у каталога (см. его `loading.tsx`):
// без скелетона Next держит на экране прежнюю страницу всё время
// серверной отрисовки, и нажатие на вкладку не меняет ничего.
//
// Форма повторяет ProfileClient: карточка человека, карточка заведения,
// список переходов строками, подвал.
export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      <section className="card flex items-center gap-4">
        <span className="skeleton h-14 w-14 shrink-0" style={{ borderRadius: 999 }} />
        <span className="min-w-0 flex-1">
          <span className="skeleton mb-2 block h-4 w-40" />
          <span className="skeleton block h-3 w-56" />
        </span>
      </section>

      <section className="card">
        <span className="skeleton mb-2 block h-4 w-32" />
        <span className="skeleton block h-3 w-48" />
      </section>

      <section className="card !p-0">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="skeleton-row px-5">
            <span /><span /><span /><span />
          </div>
        ))}
      </section>

      <section className="card flex items-center justify-between gap-3">
        <span className="skeleton h-4 w-28" />
        <span className="skeleton h-9 w-24" />
      </section>
    </div>
  )
}
