// Тема мобильного приложения.
//
// ⚠️ ЗДЕСЬ НЕТ НИ ОДНОГО ЗНАЧЕНИЯ ЦВЕТА. Все они приходят из
// `lib/design/tokens.ts` — того же файла, из которого их берут печать,
// письма и нативная оболочка. Подобрать «похожий» цвет здесь значит
// завести ПЯТУЮ палитру: четыре в этом продукте уже были, и клиент
// носил на проверку документ в цветах, которых в приложении нет.
//
// В React Native нет CSS, каскада и переменных — поэтому палитра
// раздаётся объектом через хук. Это не второй источник, а другой способ
// доставки тех же чисел: сторож `npm run check:tokens` сверяет
// `globals.css` с `tokens.ts`, а сюда значения попадают импортом,
// то есть разойтись физически не могут.
//
// Тёмная палитра в `tokens.ts` описана короче светлой (там ровно те
// значения, что переопределены в `.dark`). Всё, что она не называет,
// берётся из светлой — ровно так же, как в CSS работает каскад.

import {
  createContext, useCallback, useContext, useEffect, useMemo, useState,
  type ReactNode,
} from 'react'
import { useColorScheme } from 'react-native'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { DARK, LIGHT, RADIUS } from '../../lib/design/tokens'
import { supabase } from './supabase'

// Ключи берём у светлой палитры, а тип значения расширяем до строки:
// `LIGHT` объявлена `as const`, и без этого её тип — не «цвет», а сам
// литерал '#f4f5f7', в который тёмное значение не положишь.
export type Palette = { [K in keyof typeof LIGHT]: string }

const DARK_FULL: Palette = {
  ...LIGHT,
  ...DARK,
  // Границы на тёмном — полупрозрачно-белые: сплошной серый грязнит
  // (CLAUDE.md, «Внешний вид»). В CSS это записано rgba, здесь — тем же
  // значением, потому что RN понимает ту же запись.
  border: 'rgba(255,255,255,0.10)',
  borderStrong: 'rgba(255,255,255,0.18)',
  muted: '#98a1b0',
  faint: '#6b7280',
  // Акцент как ТЕКСТ на тёмном фоне светлеет; акцент как ЗАЛИВКА —
  // нет, он остаётся насыщенным (`DARK.accent`). Путать их нельзя:
  // светлый кобальт на кнопке даёт бледную плашку, какой в макетах нет.
  accentInk: '#93b4fb',
}

export type ThemeMode = 'light' | 'dark'

// ── ТЕМА ХРАНИТСЯ В БАЗЕ, А НЕ НА УСТРОЙСТВЕ ────────────────────────────────
//
// Требование владельца 19.08.2026: «чтобы синхронизировалась между вебом
// и мобом и запоминалась». Колонка `profiles.theme` (миграция 0109) —
// то же место, откуда её читает веб.
//
// Хранилищем на устройстве это невыразимо в принципе: у приложения свой
// склад, у браузера свой, и переключение в одном не видно в другом.
// Поэтому здесь ТРИ уровня, и каждый закрывает свой провал:
//
//   1. `AsyncStorage` — КЕШ ради первого кадра. Запрос к базе занимает
//      сотни миллисекунд, и всё это время экран должен быть уже нужного
//      цвета: белая вспышка при запуске тёмного приложения читается как
//      дефект. Ровно та же роль, что у `localStorage` в вебе.
//   2. `profiles.theme` — ИСТОЧНИК ПРАВДЫ. Приезжает следом и правит
//      кеш, если человек переключил тему на другом устройстве.
//   3. системная тема — запасной путь для того, кто ещё не выбирал.
//
// ⚠️ Системную тему продукт НЕ слушает после выбора (CLAUDE.md,
// «Внешний вид»): тема — выбор человека, а не операционной системы.
// Здесь она берётся только пока выбора нет.
const ThemeCtx = createContext<{
  c: Palette
  dark: boolean
  mode: ThemeMode
  setMode: (m: ThemeMode) => void
} | null>(null)

const CACHE_KEY = 'cresca.theme'

export function ThemeProvider({ children }: { children: ReactNode }) {
  const system = useColorScheme()
  const [stored, setStored] = useState<ThemeMode | null>(null)

  // 1. Кеш — синхронно насколько это возможно в RN, то есть в первом
  //    же эффекте. До ответа рисуем системной темой.
  useEffect(() => {
    let alive = true
    AsyncStorage.getItem(CACHE_KEY)
      .then((v) => { if (alive && (v === 'light' || v === 'dark')) setStored(v) })
      .catch(() => { /* приватный режим, повреждённый склад — не беда */ })
    return () => { alive = false }
  }, [])

  // 2. База. Перечитывается при каждой смене сессии: вход другого
  //    человека на том же телефоне обязан принести ЕГО тему, а не
  //    оставить предыдущую.
  useEffect(() => {
    let alive = true

    const pull = async (userId: string | undefined) => {
      if (!userId) return
      const { data } = await supabase
        .from('profiles').select('theme').eq('id', userId).maybeSingle()
      const v = (data as { theme?: string } | null)?.theme
      if (!alive || (v !== 'light' && v !== 'dark')) return
      setStored(v)
      AsyncStorage.setItem(CACHE_KEY, v).catch(() => {})
    }

    supabase.auth.getSession().then(({ data }) => pull(data.session?.user.id))
    const { data: sub } = supabase.auth.onAuthStateChange((_e, session) => {
      void pull(session?.user.id)
    })
    return () => { alive = false; sub.subscription.unsubscribe() }
  }, [])

  const mode: ThemeMode = stored ?? (system === 'dark' ? 'dark' : 'light')

  const setMode = useCallback((m: ThemeMode) => {
    // Экран красится СРАЗУ, не дожидаясь базы: правило 6 — ответ
    // на нажатие не имеет права ждать сети. Запись догоняет молча,
    // а не удавшаяся запись оставляет выбор хотя бы на устройстве.
    setStored(m)
    AsyncStorage.setItem(CACHE_KEY, m).catch(() => {})
    supabase.auth.getSession().then(({ data }) => {
      const id = data.session?.user.id
      if (id) void supabase.from('profiles').update({ theme: m }).eq('id', id)
    })
  }, [])

  const value = useMemo(() => ({
    c: mode === 'dark' ? DARK_FULL : LIGHT,
    dark: mode === 'dark',
    mode,
    setMode,
  }), [mode, setMode])

  return <ThemeCtx.Provider value={value}>{children}</ThemeCtx.Provider>
}

export function usePalette() {
  const v = useContext(ThemeCtx)
  // Провайдер стоит в корневой раскладке и покрывает всё дерево.
  // Отсутствие контекста означает, что компонент рисуют вне приложения —
  // молча подставлять светлую палитру нельзя, это спрячет ошибку сборки.
  if (!v) throw new Error('usePalette вне ThemeProvider')
  return v
}

export { RADIUS }

/**
 * Минимальная зона нажатия. Та же величина, что `--tap-min` в вебе:
 * 44 — это Apple HIG, и она же лежит в основе Material (48dp).
 * Берётся СТРОКОЙ или кнопкой целиком, а не размером значка внутри.
 */
export const TAP_MIN = 44

export const WEIGHT = {
  /**
   * Вес заголовка. Хендофф CRESKO задаёт 750, но React Native принимает
   * только сотни — 750 там не существует и роняет проверку типов.
   *
   * Это ВЫНУЖДЕННОЕ отступление от макета, а не вкус, и оно того же рода,
   * что пол в 16px у полей ввода: ограничение платформы старше макета.
   * Подбирать «похожее» в компонентах нельзя — вес живёт здесь.
   */
  head: '700',
  strong: '600',
} as const

/**
 * Типографическая шкала ЗАКРЫТА (хендофф CRESKO: «інших значень
 * не існує»). Новый кегль не заводится: как только появляется 18-й,
 * шкала перестаёт быть шкалой и растёт по размеру на экран.
 *
 * ⚠️ ШАГ — ЭТО ТРОЙКА «кегль + интерлиньяж + трекинг», а не одно число.
 * Первая версия этого файла отдавала только размер, и текст на телефоне
 * получался с трекингом ноль на всех кеглях — включая заголовок в 30px,
 * где буквы расходятся и заголовок читается рыхлым. В вебе так никогда
 * не было: классы `.t-*` в `globals.css` задают все три величины сразу
 * и ужимают трекинг по мере роста кегля (−0.01em на 15px → −0.02em
 * на 30px). Здесь те же самые числа, просто трекинг переведён из `em`
 * в пункты — React Native другого не понимает.
 *
 * Пользоваться спредом: `style={{ ...TEXT['4xl'], color: c.text }}`.
 * Отдельно задавать `fontSize` в компоненте нельзя — так шаг снова
 * распадётся на три несогласованных значения.
 */
export const TEXT = {
  xs: { fontSize: 10, lineHeight: 13, letterSpacing: 0, fontWeight: '600' },
  sm: { fontSize: 12, lineHeight: 16, letterSpacing: 0, fontWeight: '500' },
  base: { fontSize: 13, lineHeight: 18, letterSpacing: 0, fontWeight: '500' },
  md: { fontSize: 14, lineHeight: 20, letterSpacing: 0, fontWeight: '600' },
  lg: { fontSize: 15, lineHeight: 20, letterSpacing: -0.15, fontWeight: '700' },
  xl: { fontSize: 17, lineHeight: 22, letterSpacing: -0.26, fontWeight: '700' },
  '2xl': { fontSize: 22, lineHeight: 28, letterSpacing: -0.44, fontWeight: '700' },
  '3xl': { fontSize: 24, lineHeight: 30, letterSpacing: -0.48, fontWeight: '700' },
  '4xl': { fontSize: 30, lineHeight: 36, letterSpacing: -0.6, fontWeight: '700' },
} as const

/**
 * Пол кегля у полей ввода — 16, и это НЕ шаг шкалы, а мера против
 * поведения системы: поле мельче iOS зумит на фокусе и обратно
 * не отъезжает. В вебе то же самое сделано через `max(16px, …)`
 * у `.input`. Ограничение платформы старше макета.
 */
export const INPUT_SIZE = 16

/**
 * Тональный отклик на нажатие. В тот же кадр, а не по отпусканию —
 * правило 6 «Восьми правил»: ответ на нажатие и загрузка данных
 * это разные сроки, и первый не имеет права ждать второго.
 *
 * ⚠️ ИМЕННО ТОНОМ, А НЕ МАСШТАБОМ. Решение владельца 25.08.2026 —
 * «не надо анимацию зума и отклика тактильного, это не удобно»:
 * обработчик зума и `lib/haptic.ts` удалены из веба целиком. Мастер
 * работает в спешке между клиентами, и подпрыгивающая кнопка мешает.
 * Веб отзывается сменой тона (`.btn-secondary:active` — фон
 * `surface-2`), и мобильное обязано вести себя так же.
 *
 * Прозрачность здесь допустима, а у ВЫКЛЮЧЕННОЙ кнопки — нет: там она
 * даёт белый текст на светло-синем и читается как «кнопка сломалась».
 * Нажатие длится мгновение и с выключенным состоянием не путается.
 */
export const PRESS_DIM = 0.85
