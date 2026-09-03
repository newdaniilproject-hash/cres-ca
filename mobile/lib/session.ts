// Кто вошёл и что ему можно.
//
// Права и модули берутся ИЗ ТОКЕНА тем же кодом, что и в вебе
// (`shared/access.ts`) — правило 3: ни одного запроса к базе ради того,
// чтобы решить, рисовать ли экран. Плата та же, что и в вебе: новые
// права вступают в силу при обновлении токена.
//
// Граница доступа здесь НЕ проходит. Этот хук решает только, что
// показать; данные отдаёт база по RLS. Поэтому подделать membership
// в памяти телефона бессмысленно — запросы всё равно вернут пусто.

import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { parseMemberships, type Membership } from '../../shared/access'
import { supabase } from './supabase'

export type SessionState = {
  loading: boolean
  session: Session | null
  /**
   * Первое заведение человека — рабочий контекст, как и в вебе.
   * Переключатель появится вместе с клиентом, у которого их два.
   */
  membership: Membership | null
}

export function useSession(): SessionState {
  const [state, setState] = useState<SessionState>({
    loading: true, session: null, membership: null,
  })

  useEffect(() => {
    let alive = true

    const apply = (session: Session | null) => {
      if (!alive) return
      const list = session ? parseMemberships(session.access_token) : []
      setState({ loading: false, session, membership: list[0] ?? null })
    }

    supabase.auth.getSession().then(({ data }) => apply(data.session))

    // Подписка обязательна, а не «на всякий случай»: без неё экран
    // остаётся на форме входа после успешного входа и на списке склада
    // после выхода — состояние в памяти живёт своей жизнью, пока его
    // не перечитают.
    const { data: sub } = supabase.auth.onAuthStateChange((_event, session) => {
      apply(session)
    })

    return () => {
      alive = false
      sub.subscription.unsubscribe()
    }
  }, [])

  return state
}
