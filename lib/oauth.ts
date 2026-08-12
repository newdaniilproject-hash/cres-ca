'use client'

import { createClient } from '@/lib/supabase/client'
import { nativeish } from '@/components/native'

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
//   2. Открываем ссылку во ВНЕШНЕМ браузере.
//   3. Провайдер возвращает человека на /auth/callback?native=1,
//      а тот отдаёт код обратно в приложение ссылкой cresca://auth.
//   4. Код на сессию меняем ВНУТРИ приложения (components/deep-link.tsx).
//
// Почему обмен обязан быть внутри приложения: PKCE-верификатор лежит
// в куках веб-вью, а системный браузер кук с ним не делит. Обменять
// код там, где верификатора нет, невозможно в принципе. Это записано
// в КОНСПЕКТЫ.md, М4, и это причина, по которой возврат идёт схемой
// cresca://, а не обычной ссылкой на сайт.
//
// ⚠️ 12.08.2026: развилка была удалена 05.08 как часть отказа от
// обёртки («Обёртки больше нет… удалено по правилу 8») и не вернулась
// вместе с ней 11.08. Всё это время вход провайдером ОТКРЫВАЛСЯ ВНУТРИ
// ВЕБ-ВЬЮ и был обречён на disallowed_useragent. Восстановлено по
// истории (коммит adb48796, где поток был написан и работал) с одним
// отличием: определение «мы внутри приложения» унифицировано —
// используется тот же nativeish() из components/native.tsx, а не своя
// отдельная проверка, чтобы не завести два источника правды.
//
// ⚠️ КАК ОТКРЫВАЕТСЯ ВНЕШНИЙ БРАУЗЕР — И ЭТО ВАЖНО. Не через плагин
// @capacitor/browser: он сейчас не в сборке (снят 12.08 при сверке
// с эталоном DaKi, вернётся отдельным заходом). Вместо него —
// window.location.href на обычную ссылку. Это сработает ТОЛЬКО когда
// accounts.google.com и appleid.apple.com исключены из allowNavigation
// в capacitor.config.ts: тогда переход верхнего уровня на чужой домен
// не покрыт allowNavigation, и Capacitor сам передаёт его системе —
// проверено по исходнику WebViewDelegationHandler.swift,
// decidePolicyFor: UIApplication.shared.open(navURL, …). Сейчас домены
// провайдеров ЕЩЁ в allowNavigation (правка конфига требует пересборки
// и идёт отдельным заходом) — до неё вход в приложении не проверить,
// он останется внутри веб-вью, как и был. В браузере эта правка
// ничего не меняет: window.location.href всегда открывался как обычно.
//
// На Android свой путь: мост AndroidOAuth уже стоит в MainActivity
// (scripts/patch-android.sh) и открывает Chrome Custom Tabs — этот
// мост не удалялся и не требует правки конфига.

export type OAuthProvider = 'google' | 'apple'

export const OAUTH_SCHEME = 'cresca'

// Типы моста описаны локальным приведением, а не declare global —
// как и во всём остальном коде. Причина: @capacitor/core объявляет
// window.Capacitor по-своему, и второе объявление того же свойства
// ломает сборку в тот день, когда кто-нибудь его импортирует.
type NativeWindow = Window & {
  AndroidOAuth?: { open(url: string): void }
}

function nw(): NativeWindow {
  return window as unknown as NativeWindow
}

async function openExternal(url: string): Promise<void> {
  // Android: JS-мост Capacitor в удалённый server.url не инжектится
  // (урок DaKi), поэтому свой мост на Custom Tabs — в MainActivity.
  try {
    const w = nw()
    if (w.AndroidOAuth?.open) {
      w.AndroidOAuth.open(url)
      return
    }
  } catch { /* мост чудит — падаем на общий путь ниже */ }

  // iOS и запасной путь для Android: обычный переход верхнего уровня.
  // Как это превращается во внешний браузер — см. комментарий в шапке
  // файла про allowNavigation.
  window.location.href = url
}

export async function signInWithProvider(provider: OAuthProvider): Promise<void> {
  const supabase = createClient()

  // Мост может отсутствовать или чудить — отказ нативности гасит
  // возможность «открыть во внешнем окне», а не сам вход: в вебе
  // signInWithProvider обязан работать всегда.
  let native = false
  try { native = nativeish() } catch { /* веб — так и должно быть */ }

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
