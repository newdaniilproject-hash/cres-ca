'use client'

import { useEffect, useMemo, useState } from 'react'
import { createClient } from '@/lib/supabase/client'
import { keepVisible } from '../ui'
import { Brand } from '@/components/auth-ui'
import { dbErrorText } from '@/lib/errors/db'
import { useT } from '@/lib/i18n/client'

type Kind = 'services' | 'goods' | 'both'

// `value` уезжает в `register_tenant` — это служебное значение и оно
// не переводится. В таблице лежат КЛЮЧИ подписей, а не сами подписи.
const KINDS = [
  { value: 'services', label: 'm.shop.kind.services.label', hint: 'm.shop.kind.services.hint' },
  { value: 'goods',    label: 'm.shop.kind.goods.label',    hint: 'm.shop.kind.goods.hint' },
  { value: 'both',     label: 'm.shop.kind.both.label',     hint: 'm.shop.kind.both.hint' },
] as const satisfies readonly { value: Kind; label: string; hint: string }[]

// Створення закладу — екран застосунку, а не сторінка сайту.
// Один крок, велика кнопка внизу, клавіатура нічого не перекриває.
export default function MobileShopPage() {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])

  const [ready, setReady] = useState(false)
  const [who, setWho] = useState('')
  const [name, setName] = useState('')
  const [kind, setKind] = useState<Kind>('services')
  const [city, setCity] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    let alive = true
    supabase.auth.getSession().then(({ data }) => {
      if (!alive) return
      if (!data.session) { window.location.replace('/m'); return }
      setWho(data.session.user.email ?? '')
      setReady(true)
    })
    return () => { alive = false }
  }, [supabase])

  // Экран не должен быть ловушкой: человек мог попасть сюда сразу после
  // запуска, потому что вход уже был. Он видит, под кем зашёл, и может выйти.
  async function signOut() {
    // scope: 'local' — по умолчанию supabase-js гасит сессии ГЛОБАЛЬНО,
    // и выход в приложении разлогинивал бы и веб на компьютере.
    await supabase.auth.signOut({ scope: 'local' })
    window.location.href = '/m'
  }

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true); setError('')
    const { error } = await supabase.rpc('register_tenant', {
      p_name: name.trim(),
      p_kind: kind,
      p_city: city.trim() || null,
    })
    // `register_tenant` — Postgres: ответ через dbErrorText, а не как есть.
    // Сырой текст базы печатает значения полей на экран (М25).
    if (error) { setBusy(false); setError(dbErrorText(t, error)); return }

    // ГРАБЛИ, из-за которых человека выбрасывало на вебовую форму «Крок 2 із 2»
    // и просило ввести всё заново: заклад создавался, но членство живёт
    // в JWT, а токен на руках остался старым — без него /app считает, что
    // заведения нет, и уводит на регистрацию продавца.
    //
    // refreshSession заставляет Supabase выпустить новый токен, а хук
    // custom_access_token_hook кладёт в него членства, права и модули.
    // Без этой строки шаг замыкается в кольцо.
    await supabase.auth.refreshSession()

    window.location.href = '/app'
  }

  if (!ready) {
    return (
      // Тот же знак и то же его приглушение, что на приветственном
      // экране (`app/m/page.tsx`): ожидание сессии выглядит одинаково
      // на всех экранах приложения.
      <main className="flex flex-1 items-center justify-center" style={{ opacity: 0.35 }}>
        <Brand />
      </main>
    )
  }


  return (
    // m-scroll: прокручиваемая область экрана. Рамка снаружи равна
    // видимой части (`--vvh`), поэтому при открытой клавиатуре здесь
    // появляется ровно та прокрутка, которой не хватает. Запасов
    // снизу больше нет — см. globals.css, раздел про клавиатуру.
    <main className="m-scroll flex flex-1 flex-col px-6 pb-6">
      {/* ⚠️ ЗДЕСЬ СТОЯЛ ЗНАК «Маркет.» — ВТОРАЯ МАРКА В ПРОДУКТЕ.
          Экран лежит ровно между `/m/register` и кабинетом, и на обоих
          соседях знак читается «CRESKO». Человек, дошедший до создания
          закладу, видел посреди потока чужое имя и золотую точку
          из ПЕРВОГО оформления (`--color-gold` в интерфейсе больше нигде
          не выводится). Знака здесь теперь нет вовсе: остальные экраны
          приложения его в шапке тоже не носят — там только стрелка
          «назад», а тут её место занимает выход. */}
      <div className="flex items-center justify-end" style={{ height: 56 }}>
        <button
          type="button"
          onClick={signOut}
          className="t-sm underline underline-offset-2"
          style={{ color: 'var(--color-muted)', minHeight: 'var(--tap-min)' }}
        >
          {t('m.shop.signOut')}
        </button>
      </div>

      <h1 className="display t-2xl mt-2">{t('m.shop.title')}</h1>
      <p className="t-md mt-2" style={{ color: 'var(--color-muted)', lineHeight: 1.5 }}>
        {/* Почта — данные человека, она не переводится; переводится
            предложение вокруг неё. */}
        {who ? <>{t('m.shop.who', { email: who })} </> : null}
        {t('m.shop.lead')}
      </p>

      <form onSubmit={create} className="mt-7 flex flex-col">
        <label className="field-label" htmlFor="shop-name">{t('m.shop.name.label')}</label>
        <input
          id="shop-name"
          required
          autoFocus
          // Ни высоты, ни кегля инлайном: `.input` в globals.css задаёт
          // `--h-input` и пол в 16px на касательных устройствах.
          className="input"
          value={name}
          onFocus={keepVisible}
          onChange={(e) => setName(e.target.value)}
          placeholder="Braids Studio"
        />

        <p className="field-label mt-5">{t('m.shop.kind.label')}</p>
        <div className="flex flex-col gap-2">
          {KINDS.map((k) => {
            const on = kind === k.value
            return (
              <button
                key={k.value}
                type="button"
                // Выбор рода занятий — не ввод текста. Клавиатура,
                // поднятая полем «Назва», должна уйти: иначе человек
                // тыкает в переключатели поверх половины экрана.
                onClick={() => {
                  ;(document.activeElement as HTMLElement | null)?.blur()
                  setKind(k.value)
                }}
                className="card-flat flex items-center justify-between gap-3 text-left"
                style={{
                  minHeight: 'var(--tap-min)',
                  borderColor: on ? 'var(--color-accent)' : undefined,
                  background: on ? 'var(--color-accent-soft)' : undefined,
                }}
              >
                <span>
                  <span className="t-md block">{t(k.label)}</span>
                  <span className="t-xs block" style={{ color: 'var(--color-faint)' }}>
                    {t(k.hint)}
                  </span>
                </span>
                <span
                  aria-hidden
                  style={{
                    width: 20, height: 20, borderRadius: 999, flexShrink: 0,
                    border: `2px solid ${on ? 'var(--color-accent)' : 'var(--color-border-strong)'}`,
                    background: on ? 'var(--color-accent)' : 'transparent',
                  }}
                />
              </button>
            )
          })}
        </div>

        <label className="field-label mt-5" htmlFor="shop-city">{t('m.shop.city.label')}</label>
        <input
          id="shop-city"
          className="input"
          value={city}
          onFocus={keepVisible}
          onChange={(e) => setCity(e.target.value)}
          placeholder={t('m.shop.city.placeholder')}
        />

        {error && <p className="field-error">{error}</p>}

        <p className="t-xs mt-5" style={{ color: 'var(--color-faint)', lineHeight: 1.5 }}>
          {t('m.shop.hint')}
        </p>

        {/* Полоса главного действия: плавает у нижней кромки экрана
            и поднимается над клавиатурой. Прокручиваемая область
            отступает на её высоту, поэтому поля под ней не прячутся. */}
        <div className="m-actionbar">
          <button className="btn-primary btn-tall" disabled={busy || name.trim().length < 2}>
            {busy ? t('m.shop.busy') : t('m.shop.submit')}
          </button>
        </div>
      </form>
    </main>
  )
}
