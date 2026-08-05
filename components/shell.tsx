import Link from 'next/link'
import { ThemeToggle } from '@/components/theme'

// Публичная шапка. Ссылок мало сознательно: поиск — главный вход.
//
// Каталог живёт на ДВУХ площадках: в браузере он сайт, в приложении —
// приложение. Содержимое одно, оболочка разная — как у Rozetka.
// Поэтому здесь два хрома в одной разметке: вебовый и родной. Какой
// показать, решает атрибут data-native на <html>, который ставится
// до первой отрисовки. Второго дерева компонентов не заводим —
// правило «общий слой вместо паритета».
export function PublicHeader({ authed }: { authed: boolean }) {
  return (
    <header className="topbar">
      {/* ── Сайт ─────────────────────────────────────────────── */}
      <div className="web-only mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="display t-xl">
          Маркет<span style={{ color: 'var(--color-gold)' }}>.</span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link href="/map" className="btn-ghost">Мапа</Link>
          <Link href="/search" className="btn-ghost hidden sm:inline-flex">Пошук</Link>
          <ThemeToggle className="hidden sm:inline-flex" />
          {authed ? (
            <Link href="/account" className="btn-secondary h-10">Кабінет</Link>
          ) : (
            <>
              <Link href="/login" className="btn-ghost">Увійти</Link>
              {/* Регистрация покупателя нужна отдельной ссылкой: без неё
                  единственный вход в неё — со страницы логина, то есть
                  на клик глубже, чем регистрация продавца. */}
              <Link href="/register" className="btn-ghost hidden sm:inline-flex">
                Реєстрація
              </Link>
              <Link href="/register/seller" className="btn-primary h-10 hidden sm:inline-flex">
                Для бізнесу
              </Link>
            </>
          )}
        </nav>
      </div>

      {/* ── Приложение ───────────────────────────────────────── */}
      {/* Ни переключателя темы, ни «Для бізнесу», ни ссылки на главную
          сайта: в приложении это чужие элементы. Остаётся то, ради чего
          человек сюда пришёл, — название и поиск. */}
      <div className="native-only items-center justify-between gap-3 px-4"
           style={{ height: 52 }}>
        <span className="display t-lg">
          Маркет<span style={{ color: 'var(--color-gold)' }}>.</span>
        </span>
        <Link
          href="/search"
          aria-label="Пошук"
          className="flex items-center justify-center"
          style={{ width: 'var(--tap-min)', height: 'var(--tap-min)', marginRight: -10 }}
        >
          <svg width="21" height="21" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round">
            <circle cx="11" cy="11" r="7" />
            <path d="M20 20l-3.5-3.5" />
          </svg>
        </Link>
      </div>
    </header>
  )
}

// Подвал сайта: «Відкрити бізнес», «Вхід», юридические ссылки. В приложении
// его нет — там эти пути живут в кабинете и на экране входа, а подвал
// с ссылками на сайт выдаёт обёртку с головой.
export function PublicFooter() {
  return (
    <footer className="web-only divider mt-20">
      <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-10 t-sm sm:flex-row sm:items-center sm:justify-between sm:px-6 prose-muted">
        <p>© {new Date().getFullYear()} · Платформа для українських підприємців</p>
        {/* Ссылки на политику и удаление данных обязаны быть видны с любой
            страницы: этого требуют и Meta при верификации бизнеса, и обе
            магазинные проверки. Прятать их в подвале второго уровня —
            повод для отказа. */}
        <div className="flex flex-wrap gap-x-5 gap-y-2">
          <Link href="/register/seller" className="hover:underline">Відкрити бізнес</Link>
          <Link href="/login" className="hover:underline">Вхід</Link>
          <Link href="/privacy" className="hover:underline">Конфіденційність</Link>
          <Link href="/privacy/delete" className="hover:underline">Видалення даних</Link>
        </div>
      </div>
    </footer>
  )
}

// Кабинет переехал в отдельный клиентский файл: у него появились
// шторка разделов и нижние табы раздела — состояние, которого
// серверному компоненту иметь нельзя. Ре-экспорт сохраняет все
// существующие импорты `from '@/components/shell'`.
export { AppShell } from './app-shell'
