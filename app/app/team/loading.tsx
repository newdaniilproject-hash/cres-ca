// Скелетон загрузки. Рисует ТОЛЬКО содержимое: шапка, заголовок
// и нижняя панель приходят из `app/app/layout.tsx` и во время
// загрузки уже стоят на экране. Своя AppShell здесь дала бы вторую
// нижнюю панель поверх первой — не возвращать.
//
// Экран команды делает восемь параллельных запросов, среди них два
// SECURITY DEFINER (`team_overview`, `team_sessions`) и журнал прав
// на двести строк. Без этого файла переход выглядит как зависшая
// кнопка: правило 6 — экран без состояния загрузки не принимается.
//
// Форма повторяет TeamClient и его ступени тени: приглашение (rise-1),
// список участников (rise-3, он один меняет высоту от данных — поэтому
// только у него переменное число строк), шаблоны, сеансы и журнал.
// Незакрытых приглашений в скелетоне нет намеренно: этой карточки
// на экране чаще не бывает, чем бывает, и пустое место под ней читается
// как «что-то не догрузилось».
export default function Loading() {
  return (
    <div className="flex flex-col gap-5 pb-8">
      <section className="card rise-1 flex flex-col gap-3">
        <span className="skeleton h-5 w-44" />
        <span className="skeleton h-4 w-full max-w-md" />
        <div className="flex flex-wrap gap-2">
          <span className="skeleton h-11 min-w-40 flex-1" />
          <span className="skeleton h-11 w-36 shrink-0" />
          <span className="skeleton h-11 w-28 shrink-0" />
          <span className="skeleton h-11 w-28 shrink-0" />
        </div>
      </section>

      <section className="card rise-3 !p-0">
        <div className="p-5 pb-3">
          <span className="skeleton h-5 w-32" />
        </div>
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="skeleton-row px-5">
            <span /><span /><span /><span />
          </div>
        ))}
      </section>

      <section className="card rise-3 flex flex-col gap-3">
        <span className="skeleton h-5 w-40" />
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="skeleton-row">
            <span /><span /><span /><span />
          </div>
        ))}
      </section>

      <section className="card rise-3 flex flex-col gap-3">
        <span className="skeleton h-5 w-36" />
        <span className="skeleton h-4 w-56" />
      </section>

      <section className="card rise-3 flex flex-col gap-3">
        <span className="skeleton h-5 w-40" />
        <span className="skeleton h-4 w-64" />
      </section>
    </div>
  )
}
