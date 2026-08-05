'use client'

import Link from 'next/link'
import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { nextRoute } from './where'

// Первый экран приложения. Канон мобильного онбординга: одна мысль,
// два действия, юридические ссылки мелким шрифтом снизу — и ничего больше.
// Никакого переключателя темы и никакой навигации сайта.
export default function MobileWelcome() {
  const supabase = useMemo(() => createClient(), [])
  const [checking, setChecking] = useState(true)

  // Уже вошедшего человека приветственный экран не должен встречать вовсе.
  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(async ({ data }) => {
      if (!alive) return
      if (data.session) {
        window.location.replace(await nextRoute(supabase))
        return
      }
      setChecking(false)
    })
    return () => { alive = false }
  }, [supabase])

  if (checking) {
    return (
      <main className="flex flex-1 items-center justify-center">
        <div className="display t-2xl" style={{ opacity: 0.35 }}>
          Маркет<span style={{ color: 'var(--color-gold)' }}>.</span>
        </div>
      </main>
    )
  }

  return (
    <main className="flex flex-1 flex-col px-6 pb-6">
      {/* Верхняя треть — воздух. Логотип не в самом верху: на телефоне
          это выглядит прижатым к вырезу. */}
      <div className="flex flex-1 flex-col justify-center">
        <div className="display t-3xl">
          Маркет<span style={{ color: 'var(--color-gold)' }}>.</span>
        </div>
        <h1 className="display t-2xl mt-6" style={{ lineHeight: 1.15 }}>
          Склад, терміни і журнали —<br />у телефоні
        </h1>
        <p className="t-md mt-3" style={{ color: 'var(--color-muted)', lineHeight: 1.5 }}>
          Відкрили банку — термін порахує застосунок. Прийшла перевірка —
          звіт одним документом.
        </p>
      </div>

      {/* Действия — внизу, под большой палец. Высота как у нативных кнопок. */}
      <div className="flex flex-col gap-3">
        <Link
          href="/m/register"
          className="btn-primary flex items-center justify-center"
          style={{ minHeight: 'var(--tap-min)', height: 52, fontSize: 16 }}
        >
          Створити акаунт
        </Link>
        <Link
          href="/m/login"
          className="btn-secondary flex items-center justify-center"
          style={{ minHeight: 'var(--tap-min)', height: 52, fontSize: 16 }}
        >
          Увійти
        </Link>

        {/* Согласие человек даёт галочкой в форме регистрации — здесь
            только ссылки, чтобы документы можно было прочитать
            до того, как заводить акаунт. */}
        <p
          className="t-xs mt-3 text-center"
          style={{ color: 'var(--color-faint)', lineHeight: 1.6 }}
        >
          <Link href="/terms" className="underline underline-offset-2">Умови</Link>
          {' · '}
          <Link href="/privacy" className="underline underline-offset-2">Конфіденційність</Link>
          {' · '}
          <Link href="/cookies" className="underline underline-offset-2">Cookie</Link>
        </p>
      </div>
    </main>
  )
}
