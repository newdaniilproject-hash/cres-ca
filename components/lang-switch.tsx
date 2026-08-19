'use client'

import { useRouter } from 'next/navigation'
import { useState, useTransition } from 'react'
import { LANG_COOKIE, LANG_COOKIE_MAX_AGE } from '@/lib/i18n/cookie'
import { LANGS, type Lang } from '@/lib/i18n/dict'
import { useLang, useT } from '@/lib/i18n/client'

// Переключатель языка.
//
// ГДЕ ЖИВЁТ: рядом с переключателем темы — в шторке под аватаром и в боковой
// панели десктопа (CLAUDE.md → «Мобильная версия»: разделы, тема и выход
// живут под аватаром, бургера слева нет). Своего места в шапке он не
// получает: наверху три элемента, которые нужны каждую минуту (поиск,
// сканер, аватар), а язык выбирают один раз за всё время.
//
// КАК ЗАПОМИНАЕТСЯ: кука `lang` на год. Не localStorage — его не видит
// сервер, а кабинет рисуется на сервере, и первый кадр приехал бы на чужом
// языке (см. `lib/i18n/cookie.ts`). Тема хранится в localStorage законно:
// класс на `<html>` ставит синхронный скрипт до отрисовки, и серверу знать
// про тему незачем. Второго способа хранения здесь не заводится — просто
// у двух настроек разные читатели.
//
// ДО ПЕРВОЙ ОТРИСОВКИ: мигать нечему. Сервер прочитал куку и отдал разметку
// уже на нужном языке; `<html lang>` поправит синхронный `langBootScript`
// из корневого макета — тем же приёмом, что и тема.
//
// ПОСЛЕ НАЖАТИЯ: `router.refresh()`, а не перезагрузка страницы. Серверные
// компоненты перерисовываются с новым языком, а набранное в полях остаётся
// на месте: человек, переключивший язык посреди заполнения формы, не должен
// начинать заново.

// Имя языка всегда на нём самом: русский называется «Русский» и в английском
// интерфейсе тоже. Поэтому здесь и не словарь — переводить тут нечего.
const NAME: Record<Lang, string> = {
  uk: 'Українська',
  ru: 'Русский',
  en: 'English',
}
const SHORT: Record<Lang, string> = {
  uk: 'Укр',
  ru: 'Рус',
  en: 'Eng',
}

export function LangSwitch({ className = '' }: { className?: string }) {
  const t = useT()
  const lang = useLang()
  const router = useRouter()
  const [, startTransition] = useTransition()
  // Нажатие обязано подсветиться сразу. Язык из контекста приезжает только
  // после ответа сервера, и без этого значения кнопка секунду выглядела бы
  // ненажатой — человек жмёт второй раз.
  const [picked, setPicked] = useState<Lang | null>(null)
  const current = picked ?? lang

  function pick(next: Lang) {
    if (next === current) return
    // Кука пишется до обновления: сервер должен увидеть её уже на этом
    // запросе. `samesite=lax` — переход по внешней ссылке в кабинет
    // сохраняет выбор; `secure` не ставим, иначе выбор не работает
    // на локальной сборке по http.
    document.cookie =
      `${LANG_COOKIE}=${next}; path=/; max-age=${LANG_COOKIE_MAX_AGE}; samesite=lax`
    document.documentElement.lang = next
    setPicked(next)
    startTransition(() => router.refresh())
  }

  return (
    <div className={`seg ${className}`} role="group" aria-label={t('app.lang.aria')}>
      {LANGS.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => pick(l)}
          title={NAME[l]}
          aria-label={NAME[l]}
          aria-pressed={current === l}
          data-active={current === l}
          lang={l}
          className="seg-item"
        >
          {SHORT[l]}
        </button>
      ))}
    </div>
  )
}
