// Нижняя панель. Строится ИЗ РЕЕСТРА МОДУЛЕЙ, а не из массива в коде.
//
// Это то же правило, ради которого в вебе удалили `TABS` и `MENU`
// (миграция 0110): набор вкладок — данные, а не код. Поменять состав
// панели — это UPDATE `in_tabs` в `public.modules`, без выката
// приложения. Ровно так «Записи» ушли из панели, а «Журнали» встали
// на их место 19.08.2026 — одной строкой SQL.
//
// ⚠️ ФАЙЛЫ ЭКРАНОВ ВСЁ РАВНО НУЖНЫ. Реестр решает, ПОКАЗЫВАТЬ ли вкладку
// и как её подписать; отрисовать он ничего не может. Поэтому вкладки
// объявлены все, а невидимая получает `href: null` — expo-router убирает
// её из панели, оставляя экран достижимым по прямой ссылке. Так и надо:
// граница доступа стоит на самой странице (обе оси), а не в навигации.
//
// «Профіль» — не модуль и в реестре его нет. Он и в вебе фиксированный:
// это не то, что заведение покупает, а вход в собственные настройки.
// Больше четырёх на 390px не помещается так, чтобы подпись читалась,
// а зона нажатия осталась 44px.

import { Tabs } from 'expo-router'
import { Icon } from '../../lib/icons'
import { useModules, moduleByRoute, moduleVisible } from '../../lib/modules'
import { useSession } from '../../lib/session'
import { t } from '../../lib/i18n'
import { TAP_MIN, TEXT, usePalette } from '../../lib/theme'

/** Порядок вкладок задаёт реестр (`position`); здесь только их файлы. */
const SCREENS = ['inventory', 'catalog', 'journals'] as const

export default function TabsLayout() {
  const { c } = usePalette()
  const { membership } = useSession()
  const rows = useModules()

  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: c.accentInk,
        tabBarInactiveTintColor: c.muted,
        tabBarStyle: {
          backgroundColor: c.surface,
          borderTopColor: c.border,
          // Высота панели НЕ задаётся числом: её считает система из
          // безопасной зоны (полоса жестов на iPhone, кнопки на Android).
          // Заданная руками, она либо режет подписи, либо оставляет
          // пустую полосу на устройствах без выреза.
          minHeight: TAP_MIN,
        },
        tabBarLabelStyle: { ...TEXT.xs },
      }}
    >
      {SCREENS.map((route) => {
        const row = moduleByRoute(rows, route)
        // Пока реестр не приехал, вкладки не рисуем вовсе: показать их
        // и тут же спрятать лишние — это мигание панели на запуске.
        const visible = rows !== null && row !== null && moduleVisible(membership, row)
        return (
          <Tabs.Screen
            key={route}
            name={route}
            options={{
              // Подпись — из реестра (`modules.title`), а не из словаря:
              // название раздела заводится вместе с модулем строкой в базе.
              title: row?.title ?? '',
              href: visible ? undefined : null,
              tabBarIcon: ({ color, size }) => (
                <Icon name={row?.icon ?? null} color={color} size={size} />
              ),
            }}
          />
        )
      })}

      <Tabs.Screen
        name="profile"
        options={{
          title: t('app.nav.profile'),
          tabBarIcon: ({ color, size }) => (
            <Icon name="IconUser" color={color} size={size} />
          ),
        }}
      />
    </Tabs>
  )
}
