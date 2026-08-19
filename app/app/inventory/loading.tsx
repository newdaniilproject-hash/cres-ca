// Скелетон загрузки. Рисует ТОЛЬКО содержимое: шапка, заголовок
// и нижняя панель приходят из `app/app/layout.tsx` и во время
// загрузки уже стоят на экране. Раньше здесь была своя AppShell —
// и при каждом переходе на экране оказывались две нижние панели
// одна поверх другой. Не возвращать.
//
// ⚠️ Форма скелетона обязана повторять форму ЭКРАНА, и это не
// украшение: скелетон другой формы — это лишний скачок раскладки
// в момент, когда данные приехали. Это уже ловилось дважды: до
// 18.08.2026 здесь рисовалась прежняя раскладка склада, а после М32
// скелетон показывал плитки `.stat-tile` со значками и на две колонки,
// хотя экран давно рисует `.metric` без значков и в четыре, и ВЫШЕ
// вкладок стояли счётчики, хотя экран начинает со вкладок. Правило:
// переделал экран — переделай его скелетон тем же коммитом.
//
// Порядок повторяет InventoryClient: вкладки → счётчики .metric →
// «Швидкі дії» → список → «Ще у складі». Переменное число строк
// получает только список — именно он меняет высоту от данных.
export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      {/* Вкладки */}
      <div className="flex gap-2">
        {['w-14', 'w-28', 'w-24', 'w-20'].map((w, i) => (
          <span key={i} className={`skeleton h-11 shrink-0 ${w}`} />
        ))}
      </div>

      {/* Счётчики .metric: число + подпись, без значка */}
      <section className="grid grid-cols-4 gap-2">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="metric">
            <span className="skeleton mb-1.5 block h-6 w-8" />
            <span className="skeleton block h-3 w-14" />
          </div>
        ))}
      </section>

      {/* Швидкі дії */}
      <section>
        <span className="skeleton mb-2 block h-3 w-24" />
        <div className="quick-row">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="quick-tile">
              <span className="skeleton h-8 w-8 rounded-lg" />
              <span className="skeleton h-2.5 w-12" />
            </div>
          ))}
        </div>
      </section>

      {/* Список */}
      <section className="card !p-0">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton-row px-5">
            <span /><span /><span /><span />
          </div>
        ))}
      </section>

      {/* Ще у складі */}
      <section>
        <span className="skeleton mb-2 block h-3 w-28" />
        <div className="card !p-0">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="skeleton-row px-5">
              <span /><span /><span /><span />
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
