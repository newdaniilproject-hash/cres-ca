// Профиль. Всё личное живёт здесь — как и в вебе после решения владельца
// 25.08.2026: у каждого знака одно значение, и фото в нижней панели ведёт
// в личное, а не в меню разделов.
//
// Раскладка взята с веба: кто я и в каком заведении сверху, ниже список
// строк, выход одной кнопкой, редкие действия — за свёрнутым. Плитки
// со счётчиками сюда НЕ переносятся: в вебе они появляются только когда
// карточка мастера привязана к учётной записи (`staff.user_id`), а иначе
// «мои записи» — величина, которой мы не знаем. Пустая плитка читается
// как «у меня ноль записей», и это неправда.

import { ScrollView, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Card, ScreenTitle } from '../../components/ui'
import { t } from '../../lib/i18n'
import { useSession } from '../../lib/session'
import { supabase } from '../../lib/supabase'
import { PRESS_DIM, RADIUS, TAP_MIN, TEXT, usePalette } from '../../lib/theme'

export default function ProfileTab() {
  const { c, mode, setMode } = usePalette()
  const insets = useSafeAreaInsets()
  const { session, membership } = useSession()

  return (
    <ScrollView
      style={{ backgroundColor: c.bg }}
      contentContainerStyle={{
        padding: 16, paddingTop: insets.top + 12, paddingBottom: 24, gap: 12,
      }}
    >
      <ScreenTitle>{t('app.screen.profile.title')}</ScreenTitle>

      <Card style={{ gap: 4 }}>
        <Text style={{ color: c.text, ...TEXT.xl }} numberOfLines={1}>
          {session?.user.email ?? ''}
        </Text>
        {membership ? (
          <Text style={{ color: c.muted, ...TEXT.base }}>{membership.role}</Text>
        ) : null}
      </Card>

      {/* Тема — та же, что в вебе: она живёт в `profiles.theme` и потому
          переключение здесь видно там же. Вид переключателя минимальный
          (решение владельца 19.08.2026): мягкая дорожка и приподнятая
          плашка на выбранном, без заливки акцентом. Акцент — дефицитный
          ресурс: настройка, которую трогают раз в жизни, не имеет права
          кричать громче кнопки действия.
          Подписи СЛОВАМИ, а не значками ☀/☾: это эмодзи-глифы, и на части
          прошивок они приезжают квадратами. */}
      <Card style={{ gap: 10 }}>
        <Text style={{ color: c.muted, ...TEXT.base }}>{t('mobile.profile.theme')}</Text>
        <View style={{
          flexDirection: 'row', gap: 4, padding: 4,
          backgroundColor: c.surface2, borderRadius: RADIUS.control,
        }}>
          <Seg label={t('mobile.profile.theme.light')} on={mode === 'light'}
               onPress={() => setMode('light')} />
          <Seg label={t('mobile.profile.theme.dark')} on={mode === 'dark'}
               onPress={() => setMode('dark')} />
        </View>
      </Card>

      <Pressable
        onPress={() => supabase.auth.signOut()}
        style={({ pressed }) => ({
          minHeight: TAP_MIN, alignItems: 'center', justifyContent: 'center',
          borderRadius: RADIUS.control, borderWidth: 1, borderColor: c.border,
          backgroundColor: pressed ? c.surface2 : c.surface,
          opacity: pressed ? PRESS_DIM : 1,
        })}
      >
        <Text style={{ color: c.text, ...TEXT.md }}>{t('mobile.signOut')}</Text>
      </Pressable>
    </ScrollView>
  )
}

function Seg({
  label, on, onPress,
}: {
  label: string
  on: boolean
  onPress: () => void
}) {
  const { c } = usePalette()
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => ({
        flex: 1,
        minHeight: TAP_MIN - 8,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: RADIUS.plate,
        backgroundColor: on ? c.surface : 'transparent',
        opacity: pressed ? PRESS_DIM : 1,
      })}
    >
      <Text style={{ color: on ? c.text : c.muted, ...TEXT.md }}>{label}</Text>
    </Pressable>
  )
}
