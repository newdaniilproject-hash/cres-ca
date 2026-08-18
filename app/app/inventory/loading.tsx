// Скелетон загрузки. Рисует ТОЛЬКО содержимое: шапка, заголовок
// и нижняя панель приходят из `app/app/layout.tsx` и во время
// загрузки уже стоят на экране. Раньше здесь была своя AppShell —
// и при каждом переходе на экране оказывались две нижние панели
// одна поверх другой. Не возвращать.
//
// ⚠️ Форма скелетона обязана повторять форму ЭКРАНА, и это не
// украшение: скелетон другой формы — это лишний скачок раскладки
// в момент, когда данные приехали. До 18.08.2026 здесь рисовалась
// прежняя раскладка склада (карточка сканера сверху, ряд из шести
// широких кнопок), которой на экране нет с М31, — то есть скелетон
// показывал одно, а через секунду приезжало другое. Правило:
// переделал экран — переделай его скелетон тем же коммитом.
//
// Порядок повторяет InventoryClient: четыре плитки-счётчика, строка
// вкладок, список, карточка «Ще у складі». Переменное число строк
// получает только список — именно он меняет высоту от данных.
export default function Loading() {
  return (
    <div className="flex flex-col gap-5">
      {/* Счётчики */}
      <section className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="stat-tile">
            <span className="skeleton h-[34px] w-[34px] shrink-0" />
            <span className="block">
              <span className="skeleton mb-1.5 block h-5 w-10" />
              <span className="skeleton block h-3 w-20" />
            </span>
          </div>
        ))}
      </section>

      {/* Вкладки */}
      <div className="flex gap-2">
        {[56, 116, 104, 88].map((w, i) => (
          <span key={i} className="skeleton h-11 shrink-0" style={{ width: w }} />
        ))}
      </div>

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
