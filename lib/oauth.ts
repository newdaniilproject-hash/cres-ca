'use client'

import { createClient } from '@/lib/supabase/client'

// Вход через Apple и Google — веб.
//
// Раньше здесь жила развилка «веб или приложение»: приложение было
// обёрткой Capacitor вокруг этого же сайта, и вход в нём приходилось
// уводить в СИСТЕМНЫЙ браузер (ни Google, ни Apple не пускают ввод
// пароля внутри веб-вью), а код возвращать в приложение ссылкой
// cresca:// — потому что PKCE-верификатор лежит в куках веб-вью
// и обменять код снаружи невозможно в принципе.
//
// Обёртки больше нет (решение 05.08.2026, CLAUDE.md → «Мобильная
// версия»), приложение пишется на Flutter в `mobile/` и вход в нём
// будет свой, нативный. Здесь остаётся ровно то, что нужно браузеру:
// собрали ссылку — перешли по ней. Развилка, мосты `AndroidOAuth`
// и схема `cresca` удалены по правилу 8, а не оставлены «на всякий
// случай»: неработающая ветка кода опаснее отсутствующей, потому что
// выглядит рабочей.
//
// Само правило провайдеров при этом никуда не делось и пригодится
// во Flutter: окно ввода пароля обязано жить в системном браузере.
// Грабли записаны в КОНСПЕКТЫ.md, М4.

export type OAuthProvider = 'google' | 'apple'

export async function signInWithProvider(provider: OAuthProvider): Promise<void> {
  const supabase = createClient()

  const { data, error } = await supabase.auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: `${window.location.origin}/auth/callback`,
      // Без select_account Google молча входит первым аккаунтом
      // из тех, что уже открыты в браузере, и человек не понимает,
      // почему в кабинете чужая почта.
      queryParams: provider === 'google' ? { prompt: 'select_account' } : undefined,
    },
  })

  if (error) throw error
  if (!data?.url) throw new Error('Не вдалося відкрити вхід')

  window.location.href = data.url
}
