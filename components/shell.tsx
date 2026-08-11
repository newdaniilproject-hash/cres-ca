import Link from 'next/link'
import { ThemeToggle } from '@/components/theme'

// Публичная шапка. Ссылок мало сознательно: поиск — главный вход.
//
// Здесь был второй хром — «родной», для обёртки Capacitor: он прятал
// переключатель темы и ссылки на сайт, чтобы приложение не выдавало
// в себе сайт в рамке. Переключал их атрибут `data-native`. Обёртки
// больше нет (CLAUDE.md → «Мобильная версия»), поэтому остался один
// хром — вебовый, а классы `.web-only` / `.native-only` удалены
// по правилу 8 вместе с механизмом, который их различал.
export function PublicHeader({ authed }: { authed: boolean }) {
  return (
    <header className="topbar">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:px-6">
        <Link href="/" className="display t-xl">
          Маркет<span style={{ color: 'var(--color-gold)' }}>.</span>
        </Link>
        <nav className="flex items-center gap-1 sm:gap-2">
          <Link href="/map" className="btn-ghost">Мапа</Link>
          <Link href="/search" className="btn-ghost hidden sm:inline-flex">Пошук</Link>
          <ThemeToggle className="hidden sm:inline-flex" />
          {authed ? (
            <Link href="/account" className="btn-secondary">Кабінет</Link>
          ) : (
            <>
              <Link href="/login" className="btn-ghost">Увійти</Link>
              {/* Регистрация покупателя нужна отдельной ссылкой: без неё
                  единственный вход в неё — со страницы логина, то есть
                  на клик глубже, чем регистрация продавца. */}
              <Link href="/register" className="btn-ghost hidden sm:inline-flex">
                Реєстрація
              </Link>
              <Link href="/register/seller" className="btn-primary hidden sm:inline-flex">
                Для бізнесу
              </Link>
            </>
          )}
        </nav>
      </div>
    </header>
  )
}

// Подвал сайта: «Відкрити бізнес», «Вхід», юридические ссылки.
export function PublicFooter() {
  return (
    <footer className="divider mt-20">
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
