'use client'

import { useEffect } from 'react'
import { useToast } from '@/components/toast'
import { useT } from '@/lib/i18n/client'

// Service worker и предложение обновиться.
//
// ── ПРЕДЛОЖЕНИЯ «ВСТАНОВИТИ НА ТЕЛЕФОН» ЗДЕСЬ БОЛЬШЕ НЕТ ─────────────────────
//
// Убрано решением владельца 18.08.2026, и не «спрятано под флаг», а удалено
// вместе с полосой, обработчиком `beforeinstallprompt`, подсказкой для iOS
// и своими ключами словаря (правило 8: выключено — значит удалено).
//
// Причина не вкусовая. Полоса всплывала поверх формы входа и перекрывала её
// нижнюю часть — на снимке экрана 18.08.2026 она закрывала «Забули пароль?»
// и «Створити». Предлагать установку человеку, который ещё не вошёл, значит
// мешать ему сделать единственное, зачем он пришёл. У продавцов есть
// настоящее приложение из магазина; PWA-установка была подстраховкой,
// которая стоила дороже, чем давала.
//
// Сам service worker остаётся: без него не будет запасного экрана «немає
// мережі», а он в ТЗ. Манифест и иконки тоже остаются — установка через
// меню браузера продолжает работать, мы просто перестали её навязывать.

export function PwaProvider() {
  const t = useT()
  const toast = useToast()

  // ── Держим экран вертикальным, насколько это может веб ──────────────
  //
  // Решение владельца 25.08.2026: «наше приложение только вертикальное
  // на телефоне». Настоящий замок стоит в бинаре — `screenOrientation`
  // в манифесте Android и `UISupportedInterfaceOrientations` в Info.plist,
  // и он вступает в силу ТОЛЬКО с новой сборкой в Codemagic: уже
  // установленное приложение продолжает вертеться со старым бинарём.
  //
  // Эта строка — то, что может сам сайт, и покрывает она не всё:
  //   • обёртка Android и установленный PWA — замок срабатывает;
  //   • вкладка обычного браузера — API требует полноэкранного режима
  //     и бросает; ловим и молчим, это не поломка;
  //   • iOS Safari и веб-вью на iOS — `screen.orientation.lock` там
  //     не реализован ВООБЩЕ, ни одной версией. На айфоне вертикальность
  //     даёт только новая сборка приложения, и обещать иное нельзя.
  //
  // Повторяем при каждом повороте: система может снять замок, когда
  // приложение уходило в фон.
  useEffect(() => {
    const lock = () => {
      try {
        const so = screen.orientation as ScreenOrientation & {
          lock?: (o: string) => Promise<void>
        }
        void so?.lock?.('portrait').catch(() => { /* не поддержано */ })
      } catch { /* не поддержано */ }
    }
    lock()
    screen.orientation?.addEventListener?.('change', lock)
    return () => screen.orientation?.removeEventListener?.('change', lock)
  }, [])

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
                text: t('pwa.update.text'),
                detail: t('pwa.update.detail'),
                timeout: 0,
                action: {
                  label: t('pwa.update.action'),
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

  return null
}
