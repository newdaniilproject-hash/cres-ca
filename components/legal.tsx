'use client'

import { useRouter } from 'next/navigation'
import { useT } from '@/lib/i18n/client'

// Оболочка юридического документа. Одна на оферту, политику
// конфиденциальности и cookie — иначе три документа разъезжаются
// по виду, и это первое, что замечает проверяющий из App Store.
//
// Возврат — history.back(), а не ссылка на главную: документ
// открывают и из формы регистрации в приложении, и из подвала сайта,
// и вернуть человека надо туда, откуда он пришёл.
export function LegalDoc({
  title,
  version,
  children,
}: {
  title: string
  version: string
  children: React.ReactNode
}) {
  const t = useT()
  const router = useRouter()
  return (
    <main className="mx-auto w-full max-w-3xl px-5 pb-20 sm:px-8">
      <div className="flex items-center" style={{ height: 56, marginLeft: -10 }}>
        <button type="button" onClick={() => router.back()} aria-label={t('legal.back.aria')} className="navback">
          <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor"
               strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M15 18l-6-6 6-6" />
          </svg>
        </button>
      </div>

      <h1 className="display t-3xl mt-2">{title}</h1>
      {/* Дата редакции — данные документа, а не текст интерфейса:
          подставляется как есть. Переводится предложение вокруг неё. */}
      <p className="t-sm mt-2" style={{ color: 'var(--color-faint)' }}>
        {t('legal.version', { version })}
      </p>

      <div className="legal mt-8">{children}</div>
    </main>
  )
}
