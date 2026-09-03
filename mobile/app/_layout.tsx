// Корневая раскладка приложения.
//
// Держит ровно три вещи: тему, безопасные отступы (вырез и полоса
// жестов) и стек навигации. Всё остальное — на экранах.
//
// Статус-бар отдельной строкой не случайно. Экраны рисуются ПОД часами
// и значками, поэтому их фон — это фон нашей страницы; при тёмной теме
// чёрные часы на чёрном исчезают. Значение берётся из выбранной темы,
// а не из системной: тему выбирает человек (`profiles.theme`), и часы
// обязаны следовать за его выбором, а не за настройкой телефона.

import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { ThemeProvider, usePalette } from '../lib/theme'

export default function RootLayout() {
  return (
    <SafeAreaProvider>
      <ThemeProvider>
        <Shell />
      </ThemeProvider>
    </SafeAreaProvider>
  )
}

// Отдельным компонентом, потому что `usePalette` обязан читаться ВНУТРИ
// провайдера: в самом `RootLayout` контекста ещё нет.
function Shell() {
  const { c, dark } = usePalette()

  return (
    <>
      <StatusBar style={dark ? 'light' : 'dark'} />
      <Stack
        screenOptions={{
          headerShown: false,
          contentStyle: { backgroundColor: c.bg },
          // Жест «назад» системный: в отличие от веб-вью, где его
          // пришлось рисовать самим (`components/swipe-back.tsx`),
          // здесь предыдущий экран уже отрисован и лежит под текущим.
          gestureEnabled: true,
        }}
      />
    </>
  )
}
