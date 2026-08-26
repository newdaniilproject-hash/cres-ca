'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import { useToast } from '@/components/toast'
import { dbErrorText } from '@/lib/errors/db'
import { Sheet } from '@/components/sheet'
import { IconTrash } from '@/components/icons'

// Прибрати запис. ОДНА кнопка на весь кабінет.
//
// ── ЩО ПРОСИЛИ ─────────────────────────────────────────────────────────────
//
// Власник 26.08.2026: «додай функцію видалити — витратний засіб, товар,
// клієнта — все, щоб у користувачів була така можливість». До цього дня
// прибрати з кабінету не можна було НІЧОГО: помилково заведений рядок
// лишався в реєстрі назавжди.
//
// ── ЧОМУ ОДИН КОМПОНЕНТ, А НЕ КНОПКА НА КОЖНОМУ ЕКРАНІ ─────────────────────
//
// Правило проходу екранів, пункт 9: повторюваний узор — один компонент,
// а не три копії. Копії тут розійшлися б не оформленням: у видалення є
// підтвердження, є три різні відповіді бази і є пояснення, чому запис
// не стерли, а прибрали. Забути щось одне в одній із копій — питання
// одного вечора, а помітить це людина, яка натисне саме там.
//
// ── ЧОМУ ВІДПОВІДЬ ПРИХОДИТЬ ІЗ БАЗИ, А НЕ РАХУЄТЬСЯ ТУТ ───────────────────
//
// Половину записів стерти неможливо: за ними стоять журнал рухів,
// замовлення, записи клієнтів — те, що база захищає зовнішніми ключами
// `on delete restrict` (розбір — у шапці міграції 0134). Що саме сталося,
// вирішує функція `remove_entity`, і вона ж повертає слово:
//
//   deleted   — стерто повністю;
//   archived  — прибрано з реєстру, історія ціла;
//   forgotten — клієнт: контакти стерто, замовлення лишились.
//
// Інтерфейс ці правила не повторює навмисно. Знати тут, які зовнішні ключі
// стоять на таблиці, означало б завести другий опис звʼязків — він
// розійшовся б зі схемою мовчки, і людина отримала б обіцянку «зараз
// зітремо» замість того, що станеться насправді.

export type RemoveKind =
  | 'material' | 'offering' | 'customer'
  | 'supplier' | 'location' | 'finance_category' | 'cleaning_task'

export function RemoveEntity({
  kind, id, name, onDone, className,
}: {
  kind: RemoveKind
  id: string
  /** Назва рядка — вона стоїть у питанні, щоб не прибрати не те. */
  name: string
  /**
   * Що зробити після. Картка — `router.back()`, рядок списку —
   * `router.refresh()`. Умовчання підходить рядку списку.
   */
  onDone?: () => void
  className?: string
}) {
  const t = useT()
  const router = useRouter()
  const toast = useToast()
  const supabase = useMemo(() => createClient(), [])
  const [ask, setAsk] = useState(false)
  const [busy, setBusy] = useState(false)

  async function run() {
    setBusy(true)
    const { data, error } = await supabase.rpc('remove_entity', {
      p_kind: kind, p_id: id,
    })
    setBusy(false)
    if (error) {
      // `dbErrorText` — один розбір відповідей Postgres на весь кабінет
      // (М25): сире `error.message` друкує ЗНАЧЕННЯ поля, тобто може
      // винести телефон клієнта на екран.
      toast.error(t('remove.failed'), dbErrorText(t, error))
      return
    }
    setAsk(false)
    // Три різні відповіді — три різні тексти. Сказати «видалено» там,
    // де запис лишився в базі, значить збрехати людині про її ж дані.
    if (data === 'deleted') toast.success(t('remove.done.deleted', { name }))
    else if (data === 'forgotten') toast.success(t('remove.done.forgotten', { name }))
    else {
      // ── ВІДМІНА ПРЯМО ТУТ ───────────────────────────────────────
      //
      // Архівація — єдина з трьох відповідей, яку можна відкотити:
      // стерте не воскресити, забуте не повернути. І без цієї кнопки
      // вона була б дверима в один бік: рядок зникає зі списків, а
      // жодного екрана «прибране» в кабінеті немає — тобто випадкове
      // натискання не виправити нічим.
      //
      // Строк життя повідомлення тут довший за звичайний (12 с проти
      // 4): людина спершу читає, ЧОМУ запис не стерли, і лише потім
      // вирішує, чи це те, чого вона хотіла.
      toast.push({
        kind: 'info',
        text: t('remove.done.archived', { name }),
        detail: t('remove.done.archived.why'),
        timeout: 12000,
        action: {
          label: t('remove.restore'),
          run: () => {
            void (async () => {
              const { error: back } = await supabase.rpc('restore_entity', {
                p_kind: kind, p_id: id,
              })
              if (back) { toast.error(t('remove.failed'), dbErrorText(t, back)); return }
              toast.success(t('remove.restored'))
              router.refresh()
            })()
          },
        },
      })
    }
    if (onDone) onDone()
    else router.refresh()
  }

  return (
    <>
      <button type="button" onClick={() => setAsk(true)}
              className={className ?? 'btn-ghost flex items-center justify-center gap-2'}
              style={{ color: 'var(--color-danger)' }}>
        <IconTrash size={18} /> {t('remove.action')}
      </button>

      {/* Питаємо ЗАВЖДИ, навіть коли рядок порожній: людина не бачить,
          що саме за ним стоїть, і дізнається про наслідки вже після.
          Шторка, а не `confirm()`: системне вікно не перекладається,
          виглядає як помилка браузера і на телефоні викидає з контексту
          (та сама причина, що й у `components/toast.tsx`). */}
      <Sheet open={ask} onClose={() => setAsk(false)} title={t('remove.confirm.title')}
             footer={
               <div className="flex gap-2">
                 <button type="button" className="btn-secondary flex-1"
                         onClick={() => setAsk(false)} disabled={busy}>
                   {t('common.cancel')}
                 </button>
                 <button type="button" className="btn-danger flex-1"
                         onClick={() => void run()} disabled={busy}>
                   {busy ? t('common.saving') : t('remove.confirm.yes')}
                 </button>
               </div>
             }>
        {/* Назва — САМА, без «Прибрати …?» перед нею: питання вже стоїть
            у заголовку шторки, і другий раз воно тут ні про що не
            повідомляє. Правило проходу екранів, пункт 3: порахувати,
            скільки разів одна величина показана. */}
        <p className="t-base font-semibold">{name}</p>
        <p className="t-sm prose-muted mt-2">{t('remove.confirm.note')}</p>
      </Sheet>
    </>
  )
}
