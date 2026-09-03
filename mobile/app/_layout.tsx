// Корневая раскладка приложения.
//
// Держит ровно три вещи: безопасные отступы (вырез и полоса жестов),
// стек навигации и цвет статус-бара. Всё остальное — на экранах.
//
// Статус-бар отдельной строкой не случайно. Веб-вью и нативные экраны
// рисуются ПОД часами и значками, поэтому их фон — это фон нашей
// страницы; при тёмной теме чёрные часы на чёрном исчезают. В вебе эту
// синхронизацию делает `components/theme.tsx` через мост Capacitor,
// здесь достаточно `style="auto"` — Expo сам выбирает контраст по теме
// системы.

import { Stack } from 'expo-router'
import { StatusBar } from 'expo-status-bar'
import { SafeAreaProvider } from 'react-native-safe-area-context'
import { usePalette } from '../lib/theme'

export default function RootLayout() {
  const { c } = usePalette()

  return (
    <SafeAreaProvider>
      <StatusBar style="auto" />
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
    </SafeAreaProvider>
  )
}
