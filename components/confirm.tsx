'use client'

import { useState } from 'react'
import { Sheet } from '@/components/sheet'
import { useT } from '@/lib/i18n/client'

// Подтверждение необратимого действия — шторкой, а не window.confirm.
//
// Почему не системный confirm: он рисуется чужим стилем поверх приложения,
// в обёртке Capacitor выглядит как сбой (системное окно с адресом сайта
// в заголовке), не переводится словарём и не проходит ни одним из наших
// правил вида. Проведение инвентаризации и приёмки — необратимые действия
// экрана, и их подтверждение обязано выглядеть как часть экрана.
//
// Использование:
//   const confirm = useConfirm()
//   ...
//   const ok = await confirm({
//     title: t('inventory.count.apply.title'),
//     body: warn,                       // строка или JSX с деталями
//     action: t('inventory.count.apply.go'),
//     tone: 'danger',                   // красная кнопка у разрушающих
//   })
//   if (!ok) return
//   ...продолжение...
//
// Возвращает Promise<boolean>: закрытие шторки любым способом — false.
// Элемент <confirm.element /> кладётся один раз в конец разметки экрана.

export type ConfirmAsk = {
  title: string
  body?: React.ReactNode
  /** Подпись кнопки действия. */
  action: string
  /** 'danger' — красная кнопка: утилизация, отмена документа. */
  tone?: 'default' | 'danger'
}

type Pending = ConfirmAsk & { resolve: (ok: boolean) => void }

export function useConfirm() {
  const [ask, setAsk] = useState<Pending | null>(null)

  function confirm(a: ConfirmAsk): Promise<boolean> {
    return new Promise((resolve) => setAsk({ ...a, resolve }))
  }

  confirm.element = <ConfirmSheet ask={ask} done={(ok) => {
    ask?.resolve(ok)
    setAsk(null)
  }} />

  return confirm
}

function ConfirmSheet({ ask, done }: { ask: Pending | null; done: (ok: boolean) => void }) {
  const t = useT()
  return (
    <Sheet open={ask !== null} onClose={() => done(false)} title={ask?.title}
           footer={ask && (
             <div className="flex gap-2">
               <button type="button" className="btn-secondary flex-1"
                       onClick={() => done(false)}>
                 {t('common.cancel')}
               </button>
               <button type="button"
                       className={ask.tone === 'danger' ? 'btn-danger flex-1' : 'btn-primary flex-1'}
                       onClick={() => done(true)}>
                 {ask.action}
               </button>
             </div>
           )}>
      {ask?.body && (
        typeof ask.body === 'string'
          ? <p className="t-md" style={{ whiteSpace: 'pre-wrap' }}>{ask.body}</p>
          : ask.body
      )}
    </Sheet>
  )
}
