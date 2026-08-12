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
        // ГРАБЛИ, дважды: сначала было minHeight: 100dvh — в веб-вью dvh
        // про клавиатуру не знает, и нижние поля уходили под неё. Потом
        // была поправка «100dvh минус вычисленная высота клавиатуры» —
        // а вычисление в этом веб-вью даёт ноль, и не менялось ничего.
        //
        // Теперь высота берётся напрямую из visualViewport: это и есть
        // видимая часть экрана, считать нечего. 100dvh — только запасной
        // вариант для движков без visualViewport.
        //
        // ТРЕТЬЯ ГРАБЛЯ, 12.08.2026: здесь стояло
        // transition: 'height var(--dur-fast) linear' — и это убивало
        // процесс веб-вью. Кольцо: --vvh меняется → высота ЕДЕТ
        // анимацией → пока едет, меняется область прокрутки →
        // visualViewport стреляет 'scroll' → keyboard-fit пишет --vvh
        // заново → transition перезапускается. Каждый кадр, вечно.
        // Хватало колебания в один пиксель после Math.round.
        // Снаружи это выглядело как «This page couldn't load» на всех
        // сборках сразу, включая старые: причина ехала с сервера.
        // В Safari не воспроизводилось — там visualViewport не дёргается,
        // потому что нет Keyboard.resize:'native' и contentInset:'never'.
        //
        // Анимировать высоту нельзя и по правилу проекта (план, шаг 12):
        // «ТОЛЬКО transform и opacity». Высота меняется мгновенно —
        // клавиатура и так выезжает своей анимацией, и рывка не видно.
        height: 'var(--vvh, 100dvh)',
        background: 'var(--color-bg)',
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
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
