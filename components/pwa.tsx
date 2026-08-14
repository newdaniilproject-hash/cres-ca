'use client'

import { useEffect, useState } from 'react'
import { useToast } from '@/components/toast'

// Установка на телефон и обновление приложения.
//
// Android/Chrome сам присылает событие beforeinstallprompt — там кнопка
// работает по-настоящему. iOS его не присылает и никогда не присылал:
// там установка идёт через «Поділитися → На екран Домів», и единственное,
// что можно сделать честно — показать эту инструкцию словами. Молча
// не показывать ничего означало бы, что половина мастеров не узнает,
// что приложение вообще ставится.

type InstallEvent = Event & {
  prompt: () => Promise<void>
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed' }>
}

export function PwaProvider() {
  const toast = useToast()
  const [deferred, setDeferred] = useState<InstallEvent | null>(null)
  const [iosHint, setIosHint] = useState(false)

  // Регистрация service worker.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').then((reg) => {
        // Появилась новая сборка — предлагаем перезагрузиться, а не
        // подсовываем её молча посреди работы.
        reg.addEventListener('updatefound', () => {
          const sw = reg.installing
          if (!sw) return
          sw.addEventListener('statechange', () => {
            if (sw.state === 'installed' && navigator.serviceWorker.controller) {
              toast.push({
                kind: 'info',
                text: 'Вийшла нова версія',
                detail: 'Оновимо, коли вам буде зручно.',
                timeout: 0,
                action: {
                  label: 'Оновити зараз',
                  run: () => { sw.postMessage('skip-waiting'); window.location.reload() },
                },
              })
            }
          })
        })
      }).catch(() => {
        // Регистрация падает на http и в приватном режиме — это не ошибка
        // приложения, и пугать ею мастера не нужно.
      })
    }
    if (document.readyState === 'complete') onLoad()
    else window.addEventListener('load', onLoad)
    return () => window.removeEventListener('load', onLoad)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    // Внутри приложения из магазина предложение «встановити на телефон»
    // выглядит как признак того, что перед человеком сайт. Признак
    // приложения ставится на <html> до первой отрисовки, поэтому здесь
    // он уже есть — Capacitor на Android при удалённом server.url
    // проверить нечем.
    if (document.documentElement.hasAttribute('data-native')) return
    const onPrompt = (e: Event) => {
      e.preventDefault()
      setDeferred(e as InstallEvent)
    }
    window.addEventListener('beforeinstallprompt', onPrompt)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt)
  }, [])

  // iOS: события нет, определяем по браузеру и по тому, что мы ещё
  // не запущены как установленное приложение.
  useEffect(() => {
    // Внутри приложения из магазина PWA-подсказки бессмысленны и вредны.
    // Мост и localStorage — под try: компонент живёт в корневом макете,
    // и бросок отсюда снёс бы всё дерево (см. правило в deep-link.tsx).
    try {
      if (document.documentElement.hasAttribute('data-native')) return
      const w = window as unknown as { Capacitor?: { isNativePlatform?: () => boolean } }
      if (w.Capacitor?.isNativePlatform?.()) return
      const ua = navigator.userAgent
      const isIos = /iPad|iPhone|iPod/.test(ua)
      const standalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true
      if (isIos && !standalone && !localStorage.getItem('pwa-ios-hint')) setIosHint(true)
    } catch { /* подсказка об установке не обязательна */ }
  }, [])

  if (deferred) {
    return (
      <InstallBar
        text="Встановити на телефон"
        hint="Відкриватиметься з іконки й працюватиме без мережі"
        cta="Встановити"
        onCta={async () => {
          await deferred.prompt()
          const { outcome } = await deferred.userChoice
          setDeferred(null)
          if (outcome === 'accepted') toast.success('Готово', 'Іконка зʼявилася на екрані телефона.')
        }}
        onClose={() => setDeferred(null)}
      />
    )
  }

  if (iosHint) {
    return (
      <InstallBar
        text="Додайте на екран «Домів»"
        hint="Кнопка «Поділитися» внизу браузера → «На екран Домів»"
        cta="Зрозуміло"
        onCta={() => { localStorage.setItem('pwa-ios-hint', '1'); setIosHint(false) }}
        onClose={() => { localStorage.setItem('pwa-ios-hint', '1'); setIosHint(false) }}
      />
    )
  }

  return null
}

function InstallBar({
  text, hint, cta, onCta, onClose,
}: {
  text: string; hint: string; cta: string
  onCta: () => void | Promise<void>; onClose: () => void
}) {
  return (
    <div
      className="pointer-events-auto border p-3 rise"
      style={{
        borderRadius: 'var(--radius-card)',
        borderColor: 'var(--color-border-strong)',
        background: 'var(--color-surface)',
        boxShadow: 'var(--shadow-lift)',
      }}
    >
      <div className="flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <p className="t-md">{text}</p>
          <p className="t-sm mt-0.5 prose-muted">{hint}</p>
        </div>
        <button type="button" onClick={() => void onCta()} className="btn-primary h-9 shrink-0 t-sm">
          {cta}
        </button>
        {/* Зона нажатия — из .btn-icon (var(--tap-min), 44px). Инлайновой
            поправки здесь быть не должно: она стояла на 32px и резала
            крестик ниже минимума Apple HIG — по нему промахивались,
            а промах по «закрыть» человек читает как «полоса не убирается». */}
        <button type="button" onClick={onClose} aria-label="Закрити" className="btn-icon shrink-0">
          ✕
        </button>
      </div>
    </div>
  )
}
