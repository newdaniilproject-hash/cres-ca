// Клиент Supabase для телефона.
//
// Отличий от веб-клиента ровно три, и все три обязательные.
//
//  1. ХРАНИЛИЩЕ СЕССИИ. В браузере её держат куки, на телефоне их нет —
//     нужен явный склад. Взят AsyncStorage, а не SecureStore: у второго
//     жёсткий предел 2048 байт на запись, а JWT этого проекта с клеймами
//     членств, прав и модулей его перерастает, и сессия молча перестаёт
//     сохраняться — человек оказывается разлогинен при каждом запуске.
//     Плата названа честно: на устройстве с root-доступом файл читаем.
//     Перевод на SecureStore с ручной нарезкой на куски — отдельная
//     работа, она названа в КОНСПЕКТЫ.md, М56.
//
//  2. `detectSessionInUrl: false`. Разбор токена из адресной строки —
//     браузерная механика; в приложении адресной строки нет, а включённый
//     разбор ломает возврат по глубокой ссылке.
//
//  3. ПРОДЛЕНИЕ ТОКЕНА ПРИВЯЗАНО К ЖИЗНИ ПРИЛОЖЕНИЯ. Свёрнутое приложение
//     таймеры не крутит: iOS их замораживает. Без подписки на AppState
//     мастер, вернувшийся к телефону через час, получает протухший токен
//     и пустой экран вместо остатков.

import 'react-native-url-polyfill/auto'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { createClient } from '@supabase/supabase-js'
import { AppState } from 'react-native'
import { SUPABASE_PUBLISHABLE_KEY, SUPABASE_URL } from '../../shared/supabase-config'

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: {
    storage: AsyncStorage,
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
})

AppState.addEventListener('change', (state) => {
  if (state === 'active') supabase.auth.startAutoRefresh()
  else supabase.auth.stopAutoRefresh()
})
