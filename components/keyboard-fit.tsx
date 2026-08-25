'use client'

import { useEffect } from 'react'

// Клавиатура. Требование владельца 18.08.2026, сформулированное дословно:
// «не должно появляться чёрной подложки под клавиатурой, и при открытой
// клавиатуре ничего не должно подниматься на несколько пикселей вверх,
// страница не должна вообще дёргаться».
//
// ── ПОЧЕМУ ОБА ДЕФЕКТА — ЭТО ОДНА ПРИЧИНА ───────────────────────────────────
//
// `Keyboard.resize: 'native'` в capacitor.config.ts ФИЗИЧЕСКИ УЖИМАЕТ
// веб-вью, когда выезжает клавиатура. Отсюда ровно две беды, и обе те,
// на которые жаловались:
//
//   • страница ПЕРЕКЛАДЫВАЕТСЯ. Высота экрана меняется на треть, всё,
//     что считалось от неё, пересчитывается — и это видно рывком;
//   • место, которое веб-вью освободило, рисует НАТИВНЫЙ ВИД под ним.
//     Его цвет лежит в бинаре приложения, а не в вебе, поэтому в уже
//     установленной сборке он оставался тёмным. Это и есть «чёрное
//     полотно», которое «дёргает»: оно появляется и исчезает на
//     анимации клавиатуры.
//
// ── РЕШЕНИЕ: ВЕБ-ВЬЮ НЕ УЖИМАЕТСЯ ВООБЩЕ ────────────────────────────────────
//
// `resize: 'none'` — клавиатура просто ложится ПОВЕРХ страницы, как
// в настоящем приложении. Высота экрана не меняется ни на пиксель,
// перекладывать нечего, освобождать нечего, чёрному полотну взяться
// неоткуда физически.
//
// Взамен мы сами считаем, СКОЛЬКО снизу закрыто, и кладём это в `--kb`.
// Прокручиваемая область получает такой отступ снизу, липкая кнопка
// поднимается на ту же величину. Раскладка при этом не меняется —
// меняется только то, докуда можно доскроллить.
//
// ⚠️ НЕ ПУТАТЬ С `resize: 'body'`. С ним обжигались (КОНСПЕКТЫ, М13):
// там веб-вью остаётся во весь экран, но плагин ужимает `body`, и тогда
// `innerHeight` и `visualViewport.height` уменьшаются ОДИНАКОВО —
// разность выходит нулём, и посчитать клавиатуру нельзя. При `'none'`
// не трогают ни то, ни другое: `innerHeight` остаётся полным,
// `visualViewport.height` уменьшается на клавиатуру, и разность честная.
//
// Побочно это выравнивает приложение и браузер: в обычном браузере
// плагина нет, веб-вью тоже никто не ужимает, и здесь работает ровно
// тот же расчёт. Одна ветка вместо двух — правило «общий слой вместо
// паритета».
export function KeyboardFit() {
  useEffect(() => {
    const root = document.documentElement
    const vv = window.visualViewport

    // Базовая высота окна — снятая ДО того, как клавиатура вообще
    // появилась. Нужна как точка отсчёта: по ней видно, ужалось ли
    // веб-вью само (см. `fromPlugin` ниже).
    const baseH = window.innerHeight

    let raf = 0
    // Последнее ЗАПИСАННОЕ значение. Без него запись шла на каждое событие,
    // в том числе когда число не изменилось.
    //
    // ГРАБЛЯ 12.08.2026, стоила отказа обёртки: `m/layout.tsx` держал на
    // этой переменной высоту С АНИМАЦИЕЙ. Повторная запись перезапускала
    // переход, едущая высота меняла область прокрутки, visualViewport
    // стрелял 'scroll', сюда приходило новое событие — кольцо на каждый
    // кадр, WebContent-процесс съедал память, iOS его убивал. Высоту
    // с тех пор никто не анимирует, но сторож остаётся: следующий, кто
    // повесит на `--kb` что-то тяжёлое, не должен платить тот же урок.
    let last = -1

    const write = (kb: number) => {
      const v = kb > 80 ? Math.round(kb) : 0
      if (v === last) return
      last = v
      root.style.setProperty('--kb', `${v}px`)
      document.body.classList.toggle('kb-open', v > 0)
    }

    // ── ПУТЬ 1: visualViewport ──────────────────────────────────────
    // Работает в браузере и в веб-вью, которое НЕ ужимают. Порог 80px:
    // меньшее — это прячущаяся адресная строка и «резинка» прокрутки,
    // а не клавиатура; реагировать на них значит дёргать раскладку
    // на каждом касании.
    const fromViewport = () => {
      if (!vv) return
      cancelAnimationFrame(raf)
      raf = requestAnimationFrame(() => {
        write(window.innerHeight - (vv.height + vv.offsetTop))
      })
    }

    // ── ПУТЬ 2: плагин клавиатуры ───────────────────────────────────
    //
    // ЗАЧЕМ ВТОРОЙ ПУТЬ. Первого мало, и это оплачено отказом
    // 18.08.2026: «под клавиатурой не видно и страница не скролится».
    // В приложении, собранном со СТАРЫМ `resize: 'native'`, веб-вью
    // ужимается само — тогда `innerHeight` уменьшается ровно на
    // клавиатуру, разность выходит нулём, отступ не появляется,
    // и низ экрана оказывается недостижим.
    //
    // А ещё нельзя рассчитывать, что все ходят с новым бинарём: конфиг
    // Capacitor живёт в СБОРКЕ, и у человека на телефоне месяцами может
    // стоять старая. Веб обязан быть верным при обоих.
    //
    // Плагин говорит высоту клавиатуры прямо, независимо от режима.
    // Вычитаем из неё то, на сколько веб-вью ужалось само: ужалось
    // целиком — добавлять нечего, не ужалось — добавляем всю высоту.
    // Одна формула на оба бинаря.
    //
    // Мост берётся так же, как в `components/theme.tsx`: через
    // `window.Capacitor.Plugins`, без импорта нативного пакета — иначе
    // сборка Vercel потребует то, что нужно только Codemagic. Всё под
    // try: компонент живёт в корневом макете, и бросок отсюда снёс бы
    // дерево целиком.
    type Handle = { remove?: () => void }
    const handles: Handle[] = []
    const fromPlugin = (height: number) => {
      const shrunk = Math.max(0, baseH - window.innerHeight)
      write(Math.max(0, height - shrunk))
    }

    try {
      const w = window as unknown as {
        Capacitor?: {
          isNativePlatform?: () => boolean
          Plugins?: Record<string, unknown>
        }
      }
      if (w.Capacitor?.isNativePlatform?.()) {
        const kbd = w.Capacitor.Plugins?.Keyboard as {
          addListener?: (
            ev: string,
            cb: (info: { keyboardHeight?: number }) => void,
          ) => Handle
        } | undefined
        // Мост Capacitor отдаёт handle СИНХРОННО, а не промисом
        // (правило М6, оплачено неделей простоя): `.then` на нём
        // снесёт дерево React до первой отрисовки.
        const on = (ev: string, cb: (i: { keyboardHeight?: number }) => void) => {
          const h = kbd?.addListener?.(ev, cb)
          if (h) handles.push(h)
        }
        on('keyboardWillShow', (i) => fromPlugin(i.keyboardHeight ?? 0))
        on('keyboardDidShow', (i) => fromPlugin(i.keyboardHeight ?? 0))
        on('keyboardWillHide', () => write(0))
        on('keyboardDidHide', () => write(0))
      }
    } catch { /* моста нет — остаётся путь 1 */ }

    // ── ПОЛЕ ПОД КЛАВИАТУРОЙ: ДОВЕСТИ ДО КРОМКИ И НЕ ДАЛЬШЕ ─────────
    //
    // Когда клавиатура ложится ПОВЕРХ, браузер не считает, что видимая
    // область изменилась, и сам поле не подвинет. Без этой страховки
    // нижние поля формы становятся недостижимыми.
    //
    // Но это НЕ возврат прежнего «тащить поле наверх». Условие жёсткое:
    // трогаем экран, только если поле реально закрыто, и двигаем
    // на минимум (`block: 'nearest'`). Поле видно — не двигается ничего,
    // как и требовал владелец.
    //
    // Задержка 350мс — клавиатура едет около трети секунды, раньше
    // измерять нечего.
    let liftTimer = 0
    const covered = (el: HTMLElement) => {
      const r = el.getBoundingClientRect()
      const kb = parseInt(getComputedStyle(root).getPropertyValue('--kb')) || 0
      const bottom = window.innerHeight - kb
      return r.bottom > bottom - 8 || r.top < 8
    }
    const onIn = (e: FocusEvent) => {
      const el = e.target as HTMLElement | null
      if (!el) return
      const tag = el.tagName
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && !el.isContentEditable) return
      clearTimeout(liftTimer)
      liftTimer = window.setTimeout(() => {
        if (document.activeElement !== el) return
        if (!covered(el)) return
        el.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
      }, 350)
    }
    document.addEventListener('focusin', onIn)

    fromViewport()
    vv?.addEventListener('resize', fromViewport)
    vv?.addEventListener('scroll', fromViewport)

    return () => {
      cancelAnimationFrame(raf)
      clearTimeout(liftTimer)
      document.removeEventListener('focusin', onIn)
      vv?.removeEventListener('resize', fromViewport)
      vv?.removeEventListener('scroll', fromViewport)
      handles.forEach((h) => { try { h.remove?.() } catch { /* уже снят */ } })
      root.style.removeProperty('--kb')
      document.body.classList.remove('kb-open')
    }
  }, [])

  return null
}
