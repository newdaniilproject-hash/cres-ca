// Повторяющиеся куски экранов — ОДНИМ компонентом, а не тремя копиями.
//
// Правило 9 из «Одиннадцати проверок»: копии разъезжаются не оформлением.
// Экран отказа, лежащий в трёх файлах, теряет в одном из них подсказку
// про устаревший токен — и человек остаётся с «мне сюда нельзя» навсегда,
// хотя лечится это повторным входом.

import type { ReactNode } from 'react'
import { ActivityIndicator, Pressable, Text, View } from 'react-native'
import type { Membership } from '../../shared/access'
import { t } from '../lib/i18n'
import { supabase } from '../lib/supabase'
import { PRESS_DIM, RADIUS, TAP_MIN, TEXT, usePalette } from '../lib/theme'

export function Centered({ children }: { children: ReactNode }) {
  const { c } = usePalette()
  return (
    <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: c.bg }}>
      {children}
    </View>
  )
}

export function Spinner() {
  const { c } = usePalette()
  return <ActivityIndicator color={c.accent} />
}

/** Карточка — общая рамка для всего, что лежит на фоне списка. */
export function Card({ children, style }: { children: ReactNode; style?: object }) {
  const { c } = usePalette()
  return (
    <View
      style={[{
        backgroundColor: c.surface,
        borderRadius: RADIUS.card,
        borderWidth: 1,
        borderColor: c.border,
        padding: 14,
      }, style]}
    >
      {children}
    </View>
  )
}

/** Заголовок экрана. Один кегль на все разделы — шкала закрыта. */
export function ScreenTitle({ children }: { children: ReactNode }) {
  const { c } = usePalette()
  return <Text style={{ color: c.text, ...TEXT['3xl'] }}>{children}</Text>
}

/**
 * Пустое состояние. Их ДВА и они разные: «здесь ещё ничего нет» с
 * подсказкой, что делать, и «в этом фильтре пусто». Путать нельзя —
 * первое про заведение, второе про сегодняшний выбор человека.
 */
export function Empty({ title, desc }: { title: string; desc?: string }) {
  const { c } = usePalette()
  return (
    <View style={{ paddingVertical: 32, gap: 6 }}>
      <Text style={{ color: c.text, ...TEXT.xl }}>{title}</Text>
      {desc ? <Text style={{ color: c.muted, ...TEXT.md }}>{desc}</Text> : null}
    </View>
  )
}

/** Полоса ошибки загрузки. Нажатие повторяет запрос. */
export function LoadError({ onRetry }: { onRetry: () => void }) {
  const { c } = usePalette()
  return (
    <Pressable
      onPress={onRetry}
      style={({ pressed }) => ({
        minHeight: TAP_MIN, justifyContent: 'center', paddingHorizontal: 14,
        borderRadius: RADIUS.card,
        backgroundColor: pressed ? c.surface2 : c.surface,
        borderWidth: 1, borderColor: c.danger,
      })}
    >
      <Text style={{ color: c.danger, ...TEXT.md }}>{t('mobile.loadError')}</Text>
      <Text style={{ color: c.muted, ...TEXT.base }}>{t('mobile.retry')}</Text>
    </Pressable>
  )
}

/**
 * Отказ по одной из двух осей доступа. Экран, а не молчаливый возврат:
 * «нажал — и меня выкинуло» человек читает как поломку.
 */
export function Gate({
  title, desc, m,
}: {
  title: string
  desc: string
  m: Membership | null
}) {
  const { c } = usePalette()
  return (
    <Centered>
      <View style={{ gap: 8, padding: 24 }}>
        <Text style={{ color: c.text, ...TEXT['2xl'] }}>{title}</Text>
        <Text style={{ color: c.muted, ...TEXT.md }}>{desc}</Text>
        {/* Токен без клейма модулей — это устаревший токен, а не заведение
            без модулей, и лечится он повторным входом. Отличать эти два
            случая умеет `modulesFromToken`; молчать о втором значит
            оставить человека с «мне сюда нельзя» навсегда. */}
        {m && !m.modulesFromToken ? (
          <Text style={{ color: c.faint, ...TEXT.base }}>{t('mobile.gate.stale')}</Text>
        ) : null}
        <Pressable
          onPress={() => supabase.auth.signOut()}
          style={({ pressed }) => ({
            minHeight: TAP_MIN, marginTop: 12, alignItems: 'center', justifyContent: 'center',
            borderRadius: RADIUS.control, borderWidth: 1, borderColor: c.border,
            backgroundColor: pressed ? c.surface2 : 'transparent',
            opacity: pressed ? PRESS_DIM : 1,
          })}
        >
          <Text style={{ color: c.text, ...TEXT.md }}>{t('mobile.signOut')}</Text>
        </Pressable>
      </View>
    </Centered>
  )
}
