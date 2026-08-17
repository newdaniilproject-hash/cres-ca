'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { nextRoute } from './where'
import { Onboarding, onboardingSeen } from './onboarding'
import { Brand } from '@/components/auth-ui'
import { useT } from '@/lib/i18n/client'

// Первый экран приложения. Канон мобильного онбординга: одна мысль,
// два действия, юридические ссылки мелким шрифтом снизу — и ничего больше.
// Никакого переключателя темы и никакой навигации сайта.
//
// 13.08.2026: перед приветствием — знакомство (карусель, согласие
// с документами, три разрешения). Оно показывается один раз и живёт
// в ./onboarding.tsx, без собственных маршрутов: новый адрес пришлось
// бы учитывать и в proxy.ts, и в TWINS двух файлов сразу.
export default function MobileWelcome() {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const [checking, setChecking] = useState(true)
  const [onboarding, setOnboarding] = useState(false)

  // Уже вошедшего человека приветственный экран не должен встречать вовсе.
  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      if (data.session) {
        window.location.replace(await nextRoute(supabase))
        return
      }
      setOnboarding(!onboardingSeen())
      setChecking(false)
    })
    return () => { alive = false }
  }, [supabase])

  if (checking) {
    return (
      <main className="flex flex-1 items-center justify-center" style={{ opacity: 0.35 }}>
        <Brand />
      </main>
    )
  }

  if (onboarding) return <Onboarding onDone={() => setOnboarding(false)} />

  return (
    <main className="flex flex-1 flex-col px-6 pb-6">
      {/* Верхняя треть — воздух. Логотип не в самом верху: на телефоне
          это выглядит прижатым к вырезу. */}
      <div className="flex flex-1 flex-col justify-center">
        <Brand tagline />
        {/* Перенос строки — вёрстка, поэтому строк словаря две:
            разметки (`<br />`) в словаре не бывает. */}
        <h1 className="display t-2xl mt-8 text-center" style={{ lineHeight: 1.15 }}>
          {t('m.welcome.title.line1')}<br />{t('m.welcome.title.line2')}
        </h1>
        <p className="t-md mt-3 text-center" style={{ color: 'var(--color-muted)', lineHeight: 1.5 }}>
          {t('m.welcome.desc')}
        </p>
      </div>

      {/* Действия — внизу, под большой палец. */}
      <div className="flex flex-col gap-3">
        <Link href="/m/register" className="btn-primary btn-tall">
          {t('m.welcome.register')}
        </Link>
        <Link href="/m/login" className="btn-secondary btn-tall">{t('m.welcome.login')}</Link>

        {/* Согласие человек даёт галочкой в форме регистрации — здесь
            только ссылки, чтобы документы можно было прочитать
            до того, как заводить акаунт. */}
        <p
          className="t-xs mt-3 text-center"
          style={{ color: 'var(--color-faint)', lineHeight: 1.6 }}
        >
          <Link href="/terms" className="underline underline-offset-2">
            {t('m.welcome.legal.terms')}
          </Link>
          {' · '}
          <Link href="/privacy" className="underline underline-offset-2">
            {t('m.welcome.legal.privacy')}
          </Link>
          {' · '}
          <Link href="/cookies" className="underline underline-offset-2">
            {t('m.welcome.legal.cookies')}
          </Link>
        </p>
      </div>
    </main>
  )
}
