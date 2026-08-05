'use client'

import { createClient } from '@/lib/supabase/client'

// Вход через Apple и Google.
//
// Главное, что здесь нужно понимать, иначе не работает вообще ничего:
// ни Google, ни Apple не пускают вход внутри веб-вью приложения.
// Google отвечает disallowed_useragent, Apple — молча ломает поток.
// Правило у них общее и давнее: окно ввода пароля должно жить
// в системном браузере, где человек видит адресную строку и понимает,
// кому отдаёт пароль.
//
// Отсюда вся конструкция:
//   1. Просим Supabase собрать ссылку, но НЕ переходить по ней
//      (skipBrowserRedirect) — переход сделаем сами.
//   2. Открываем ссылку в системном браузере: на iOS это
//      SFSafariViewController, на Android — Chrome Custom Tabs.
//   3. Провайдер возвращает человека на /auth/callback?native=1,
//      а тот отдаёт код обратно в приложение ссылкой cresca://auth.
//   4. Код на сессию меняем ВНУТРИ приложения (components/deep-link).
//
// Почему обмен обязан быть внутри приложения: PKCE-верификатор лежит
// в куках веб-вью, а системный браузер кук с ним не делит. Обменять
// код там, где верификатора нет, невозможно в принципе.

export type OAuthProvider = 'google' | 'apple'

export const OAUTH_SCHEME = 'cresca'

// Типы моста описаны локальным приведением, а не declare global —
// как и во всём остальном коде. Причина: @capacitor/core объявляет
// window.Capacitor по-своему, и второе объявление того же свойства
// ломает сборку в тот день, когда кто-нибудь его импортирует.
type NativeWindow = Window & {
  AndroidOAuth?: { open(url: string): void }
  AndroidBiometric?: unknown
  AndroidOneSignal?: unknown
  Capacitor?: {
    isNativePlatform?: () => boolean
    Plugins?: Record<string, Record<string, (a?: unknown) => Promise<unknown>> | undefined>
  }
}

function nw(): NativeWindow {
  return window as unknown as NativeWindow
}

// «Настоящее» приложение, а не похожий на него веб-вью.
//
// Отличать важно: data-native ставится в том числе по повадкам
// браузера и залипает в localStorage, а гнать человека по схеме
// cresca:// из обычного мобильного Safari — значит показать ему
// диалог «приложение не найдено» и потерять вход.
export function hardNative(): boolean {
  if (typeof window === 'undefined') return false
  const w = nw()
  if (w.Capacitor?.isNativePlatform?.()) return true
  return !!(w.AndroidOAuth || w.AndroidBiometric || w.AndroidOneSignal)
}

async function openExternal(url: string): Promise<void> {
  // Android: JS-мост Capacitor в удалённый server.url не инжектится
  // (урок DaKi), поэтому свой мост на Custom Tabs — в MainActivity.
  const w = nw()
  if (w.AndroidOAuth?.open) {
    w.AndroidOAuth.open(url)
    return
  }
  const browser = w.Capacitor?.Plugins?.Browser
  if (browser?.open) {
    await browser.open({ url, presentationStyle: 'popover' })
    return
  }
  // Последний рубеж: плагина нет — уходим в тот же веб-вью. Это
  // сработает только у Apple и только иногда, но лучше, чем кнопка,
  // которая не делает ничего.
  window.location.href = url
}

export async function signInWithProvider(provider: OAuthProvider): Promise<void> {
  const supabase = createClient()
  const native = hardNative()

  // native=1 — метка для /auth/callback: вернуть код в приложение,
  // а не пытаться завершить вход в браузере.
  const redirectTo = `${window.location.origin}/auth/callback${native ? '?native=1' : ''}`

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo,
      skipBrowserRedirect: native,
      // Без select_account Google молча входит первым аккаунтом
      // из тех, что уже открыты в браузере, и человек не понимает,
      // почему в кабинете чужая почта.
      queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
    },
  })

  if (error) throw error
  if (!data?.url) throw new Error('Не вдалося відкрити вхід')

  if (native) await openExternal(data.url)
  else window.location.href = data.url
}
