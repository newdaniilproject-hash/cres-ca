'use client'

// Платформа, с которой пришла регистрация.
//
// Здесь же жили `ensureConsent()` и `consentSource()` — они дописывали
// журнал согласий ПОСЛЕ входа через провайдера, потому что Supabase
// не принимает `options.data` для OAuth и метаданные положить было
// некуда. Вход через Google удалён 18.08.2026 (решение владельца,
// правило 8), и вместе с ним ушли обе функции: единственный путь
// регистрации теперь почтой, а там версию документов кладёт в метаданные
// сама форма, и журнал заполняет триггер `handle_new_user`.

// Платформа для журнала согласий при регистрации почтой.
// Именно эти три значения разрешены ограничением user_consents.source —
// «app» база не примет.
//
// 13.08.2026: переехало из app/m/register/register-form.tsx. Форм
// регистрации стало две (веб и приложение), и обе обязаны слать
// одно и то же значение — иначе журнал согласий начнёт врать
// в зависимости от того, откуда человек пришёл.
export function signupSource(): 'web' | 'ios' | 'android' {
  if (typeof window === 'undefined') return 'web'
  const w = window as unknown as { Capacitor?: { getPlatform?: () => string } }
  try {
    const p = w.Capacitor?.getPlatform?.()
    if (p === 'ios' || p === 'android') return p
  } catch { /* мост чудит — опознаём приложение ниже */ }
  // На Android при удалённом server.url моста Capacitor нет — опознаём
  // приложение по интерфейсам, которые ставит MainActivity.
  const a = window as unknown as { AndroidBiometric?: unknown; AndroidOneSignal?: unknown }
  if (a.AndroidBiometric || a.AndroidOneSignal) return 'android'
  return 'web'
}
