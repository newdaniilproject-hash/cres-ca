'use client'

import type { SupabaseClient } from '@supabase/supabase-js'
import { LEGAL_VERSION } from '@/lib/legal'

// Согласие для входа через Apple и Google.
//
// При регистрации почтой версия документов уходит в метаданные,
// и журнал заполняет триггер handle_new_user. При входе через
// провайдера метаданные положить некуда: Supabase не принимает
// options.data для OAuth. Поэтому строку журнала пишет клиент —
// сразу после того, как сессия появилась.
//
// Политика user_consents_insert_own разрешает человеку писать
// только про себя, а update и delete у таблицы нет вовсе, так что
// строка неизменяема так же, как и все остальные.

const DOCS = ['terms', 'privacy', 'cookies'] as const

export function consentSource(): 'web' | 'ios' | 'android' {
  if (typeof navigator === 'undefined') return 'web'
  if (/iPhone|iPad|iPod/.test(navigator.userAgent)) return 'ios'
  if (/Android/.test(navigator.userAgent)) return 'android'
  return 'web'
}

export async function ensureConsent(supabase: SupabaseClient): Promise<void> {
  try {
    const { data: sess } = await supabase.auth.getSession()
    const uid = sess.session?.user.id
    if (!uid) return

    // Уже соглашался на эту редакцию — второй строки не нужно.
    const { data: had } = await supabase
      .from('user_consents')
      .select('document')
      .eq('version', LEGAL_VERSION)
      .limit(1)
    if (had && had.length > 0) return

    const src = consentSource()
    await supabase.from('user_consents').insert(
      DOCS.map((d) => ({ user_id: uid, document: d, version: LEGAL_VERSION, source: src })),
    )
  } catch {
    // Журнал согласий не должен уметь сорвать вход. Ошибку глотаем
    // осознанно: человек уже вошёл, а строку допишет следующий вход.
  }
}
