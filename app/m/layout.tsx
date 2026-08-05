import type { Metadata } from 'next'

// Оболочка мобильного приложения. Сюда указывает capacitor.config.ts,
// и это НЕ страницы сайта: ни шапки, ни переключателя темы, ни ссылки
// «на головну» — в приложении их быть не должно.
//
// Общая логика (Supabase, права, серверные действия) та же самая, что в вебе.
// Различается только раскладка — ровно как требует правило проекта
// «общий слой вместо паритета».
export const metadata: Metadata = {
  title: 'Маркет',
  // Приложение не масштабируется жестами: это не веб-страница.
  // viewport-fit=cover нужен, чтобы контент уходил под вырез, а отступы
  // задавались через env(safe-area-inset-*), а не гадались.
}

export const viewport = {
  themeColor: '#141417',
  viewportFit: 'cover' as const,
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
}

export default function MobileLayout({ children }: { children: React.ReactNode }) {
  return (
    <div
      className="flex flex-col"
      style={{
        // ГРАБЛИ: было minHeight: 100dvh — и при поднятой клавиатуре
        // нижняя треть формы вместе с кнопкой уходила под неё.
        // В веб-вью dvh про клавиатуру не знает: страница остаётся
        // высотой в целый экран, клавиатура ложится сверху.
        //
        // Height, а не minHeight: рамка обязана быть РОВНО в остаток
        // экрана, иначе прокручивать внутри неё нечего. Остаток даёт
        // --kb, которую меряет components/keyboard-fit.tsx.
        height: 'calc(100dvh - var(--kb, 0px))',
        background: 'var(--color-bg)',
        paddingTop: 'env(safe-area-inset-top)',
        // Отступ под вырез снизу нужен, только пока клавиатуры нет:
        // с клавиатурой системного индикатора жестов не видно.
        paddingBottom: 'max(0px, calc(env(safe-area-inset-bottom) - var(--kb, 0px)))',
        transition: 'height var(--dur-fast) linear',
        // Прокручивается содержимое внутри, а не сама рамка: иначе
        // экран «уезжает» целиком и шапка с кнопкой «Вийти» пропадает.
        overflow: 'hidden',
        // Свайп-назад по краю экрана не должен выделять текст.
        WebkitUserSelect: 'none',
        WebkitTapHighlightColor: 'transparent',
      }}
    >
      {children}
    </div>
  )
}
