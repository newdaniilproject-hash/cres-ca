'use client'

import { useEffect } from 'react'
import { useToast } from '@/components/toast'
import { useT } from '@/lib/i18n/client'
import { list } from '@/lib/offline/queue'

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

  // ── НОВАЯ ВЕРСИЯ ПОДХВАТЫВАЕТСЯ САМА ────────────────────────────────
  //
  // Требование владельца 25.08.2026: «чтобы любое изменение было
  // мгновенное и не требовало дополнительно обновлять страницу или
  // перезаходить в приложение».
  //
  // Половину этого продукт уже умел: оболочка тихо перезапрашивает
  // СОДЕРЖИМОЕ при возврате в приложение (`components/app-shell.tsx`).
  // Но содержимое — это данные, а не КОД. Бандл остаётся тот, что приехал
  // при открытии, и выкаченная новая версия человеку не видна, пока он
  // не закроет приложение начисто. Ровно это и произошло сегодня.
  //
  // Прежний путь через `updatefound` service worker'а сработать НЕ МОГ:
  // `public/sw.js` — статический файл, байт в байт одинаковый во всех
  // сборках, а браузер сравнивает именно файл воркера. Механизм стоял
  // и был мёртв по построению. Разбор — в шапке `app/api/version/route.ts`.
  //
  // Теперь сравниваются две строки: вшитая в работающий бандл
  // (`NEXT_PUBLIC_BUILD_ID`) и та, что отдаёт сервер прямо сейчас.
  //
  // ── КОГДА ПЕРЕЗАГРУЖАЕМ МОЛЧА, А КОГДА СПРАШИВАЕМ ───────────────────
  //
  // Молча — только когда терять нечего: человек вернулся в приложение,
  // на экране нет открытой шторки, он ничего не набирает, и в очереди
  // офлайна пусто. Тогда он видит просто новую версию, и это ровно та
  // бесшовность, которую просили.
  //
  // Во всех остальных случаях — предложение с кнопкой. Перезагрузить
  // страницу под пальцем мастера, который заполняет журнал, значит стереть
  // ему введённое; «мгновенно» такой ценой не покупается.
  useEffect(() => {
    const mine = process.env.NEXT_PUBLIC_BUILD_ID ?? 'dev'
    // В разработке обе стороны дают `dev` — сравнивать нечего.
    if (mine === 'dev') return

    let asked = false

    // Занято ли чем-то, что нельзя терять. Проверяем РАЗМЕТКУ, а не свой
    // флаг: слоёв уже несколько (шторка, стос действий, сканер), они
    // открываются из разных мест, и первый забытый флаг вернул бы ошибку
    // молча — тот же довод, что в `components/native-feel.tsx`.
    const busy = () => {
      if (document.querySelector('.sheet-layer, .fab-scrim, [role="dialog"]')) return true
      const el = document.activeElement as HTMLElement | null
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable)) {
        return true
      }
      return false
    }

    const offer = () => {
      if (asked) return
      asked = true
      toast.push({
        kind: 'info',
        text: t('pwa.update.text'),
        detail: t('pwa.update.detail'),
        timeout: 0,
        action: {
          label: t('pwa.update.action'),
          run: () => window.location.reload(),
        },
      })
    }

    const check = async () => {
      if (document.visibilityState !== 'visible') return
      try {
        const res = await fetch('/api/version', { cache: 'no-store' })
        if (!res.ok) return
        const { id } = (await res.json()) as { id?: string }
        if (!id || id === mine) return
        // Незакрытая очередь офлайна — это несохранённая работа мастера.
        // Перезагрузка её не потеряет (очередь в IndexedDB), но досылка
        // прервётся на середине, а это хуже, чем подождать.
        const pending = await list().catch(() => [])
        if (busy() || pending.length > 0) { offer(); return }
        window.location.reload()
      } catch {
        // Нет сети — нет и новой версии. Молчим: это не поломка.
      }
    }

    // Возврат в приложение — главный момент проверки: человек только что
    // не работал, и именно тогда подмена безболезненна.
    const onVis = () => { if (document.visibilityState === 'visible') void check() }
    document.addEventListener('visibilitychange', onVis)
    // И раз в четверть часа для тех, кто держит приложение открытым весь
    // день, не сворачивая. Чаще незачем: выкат — редкое событие, а лишний
    // запрос с телефона мастера стоит трафика.
    const timer = setInterval(() => void check(), 15 * 60_000)
    return () => {
      document.removeEventListener('visibilitychange', onVis)
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (!('serviceWorker' in navigator)) return
    // Регистрируем ради запасного экрана «немає мережі» — и только.
    // Слушателя `updatefound` здесь БОЛЬШЕ НЕТ: он не мог сработать
    // (см. выше), а мёртвый обработчик рядом с работающим заставляет
    // следующего читателя гадать, какой из двух действует.
    const onLoad = () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {
        // Регистрация падает на http и в приватном режиме — это не ошибка
        // приложения, и пугать ею мастера не нужно.
      })
    }
    if (document.readyState === 'complete') onLoad()
    else window.addEventListener('load', onLoad)
    return () => window.removeEventListener('load', onLoad)
  }, [])

  return null
}
