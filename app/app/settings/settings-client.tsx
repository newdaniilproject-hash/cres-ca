'use client'

import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { BioLockRow } from '@/components/native'

type Shop = {
  id: string; name: string; slug: string; tagline: string | null
  description: string | null; kind: string; status: string
  storefront_enabled: boolean; city: string | null; address: string | null
  contact_phone: string | null
}
type Member = { userId: string; role: string; name: string | null; email: string | null }

const ROLE_LABEL: Record<string, string> = {
  owner: 'власник', admin: 'адміністратор', manager: 'менеджер',
  operator: 'майстер / склад', accountant: 'бухгалтер',
  viewer: 'перегляд', inspector: 'інспектор',
}

export function SettingsClient({ shop, canWrite, team }: {
  shop: Shop; canWrite: boolean; team: Member[]
}) {
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  const [name, setName] = useState(shop.name)
  const [tagline, setTagline] = useState(shop.tagline ?? '')
  const [description, setDescription] = useState(shop.description ?? '')
  const [city, setCity] = useState(shop.city ?? '')
  const [address, setAddress] = useState(shop.address ?? '')
  const [phone, setPhone] = useState(shop.contact_phone ?? '')
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'error'>('idle')
  const [error, setError] = useState('')

  // Видалення акаунта. Правило Apple 5.1.1(v): без цієї кнопки
  // застосунок не проходить ревʼю. Слово-підтвердження, а не «ви впевнені?»:
  // випадково натиснути двічі можна, випадково надрукувати слово — ні.
  const [danger, setDanger] = useState(false)
  const [confirmWord, setConfirmWord] = useState('')
  const [killing, setKilling] = useState(false)
  const [killError, setKillError] = useState('')
  const soleOwner = team.filter((t) => t.role === 'owner').length === 1

  async function deleteAccount() {
    setKilling(true); setKillError('')
    const { error } = await supabase.rpc('delete_my_account')
    if (error) { setKilling(false); setKillError(error.message); return }
    await supabase.auth.signOut()
    // Не router.push: після видалення користувача треба повне
    // перезавантаження, інакше клієнт живе зі знищеною сесією.
    window.location.href = '/'
  }

  const publicUrl = `${typeof location !== 'undefined' ? location.origin : ''}/t/${shop.slug}`

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setState('busy'); setError('')
    const { error } = await supabase.from('tenants').update({
      name, tagline: tagline || null, description: description || null,
      city: city || null, address: address || null, contact_phone: phone || null,
    }).eq('id', shop.id)
    if (error) { setState('error'); setError(error.message); return }
    setState('saved'); router.refresh()
    setTimeout(() => setState('idle'), 2000)
  }

  return (
    <div className="flex flex-col gap-5 pb-8">
      {/* Публичная ссылка — то, что уходит в шапку Instagram */}
      <section className="card rise-1">
        <h2 className="t-lg mb-1">Ваша сторінка</h2>
        <p className="t-md mb-3 prose-muted">
          Це посилання — у шапку Instagram: клієнти записуються самі.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <code className="card-flat t-md !px-3 !py-2">{publicUrl}</code>
          <button type="button" className="btn-secondary t-sm"
                  onClick={() => navigator.clipboard.writeText(publicUrl)}>
            Скопіювати
          </button>
          {shop.storefront_enabled ? (
            <span className="badge-success">опубліковано</span>
          ) : (
            <span className="badge-warn">чернетка — відкриється після перевірки</span>
          )}
        </div>
      </section>

      {/* Данные заведения */}
      <form onSubmit={save} className="card rise-2 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="field-label">Назва</label>
          <input required className="input" value={name} disabled={!canWrite}
                 onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="field-label">Підпис (одним рядком)</label>
          <input className="input" value={tagline} disabled={!canWrite}
                 onChange={(e) => setTagline(e.target.value)}
                 placeholder="Брейди та афрокоси · центр міста" />
        </div>
        <div>
          <label className="field-label">Місто</label>
          <input className="input" value={city} disabled={!canWrite}
                 onChange={(e) => setCity(e.target.value)} />
        </div>
        <div>
          <label className="field-label">Адреса</label>
          <input className="input" value={address} disabled={!canWrite}
                 onChange={(e) => setAddress(e.target.value)}
                 placeholder="вул. Сумська, 1" />
        </div>
        <div>
          <label className="field-label">Телефон для клієнтів</label>
          <input type="tel" className="input" value={phone} disabled={!canWrite}
                 onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="field-label">Про заклад</label>
          <textarea className="textarea" value={description} disabled={!canWrite}
                    onChange={(e) => setDescription(e.target.value)} />
        </div>

        {state === 'error' && <p className="field-error sm:col-span-2">{error}</p>}

        {canWrite && (
          <div className="flex items-center gap-3 sm:col-span-2">
            <button className="btn-primary" disabled={state === 'busy'}>
              {state === 'busy' ? 'Зберігаємо…' : 'Зберегти'}
            </button>
            {state === 'saved' && (
              <span className="t-md rise" style={{ color: 'var(--color-success)' }}>Збережено ✓</span>
            )}
          </div>
        )}
      </form>

      {/* Команда */}
      <section className="card rise-3 !p-0">
        <div className="flex items-center justify-between p-5 pb-3">
          <h2 className="t-lg">Команда</h2>
        </div>
        {team.map((t) => (
          <div key={t.userId} className="row px-5">
            <div className="min-w-0">
              <p className="t-md truncate">{t.name ?? t.email ?? 'Без імені'}</p>
              {t.name && t.email && <p className="t-xs prose-muted">{t.email}</p>}
            </div>
            <span className={t.role === 'owner' ? 'badge-accent' : 'badge'}>
              {ROLE_LABEL[t.role] ?? t.role}
            </span>
          </div>
        ))}
        <p className="field-hint px-5 pb-4">
          Запрошення співробітників і роль «інспектор» для перевіряючого —
          скоро тут. Ролі вже працюють: майстер бачить склад і записи,
          але не бачить фінансів.
        </p>
      </section>

      {/* Безпека: видалення акаунта */}
      <section className="card rise-3">
        <h2 className="t-lg mb-1">Безпека</h2>
        <p className="t-md mb-3 prose-muted">
          Ваші дані належать вам. Ви можете видалити акаунт у будь-який момент —
          без листів, дзвінків і пояснень.
        </p>

        {/* Вход по Face ID / отпечатку. Обёртка вернулась 11.08.2026,
            вместе с ней вернулся и замок — прежний комментарий здесь
            утверждал обратное и устарел.

            Компонент из модуля обёртки: вся логика (ключи хранения,
            проверка доступности биометрии, мост) живёт там, экран
            настроек только даёт ему место. В браузере не рисуется
            ничего — там биометрия доступна лишь через WebAuthn,
            а это другой способ входа, а не замок поверх него. */}
        <BioLockRow />

        {!danger ? (
          <button type="button" className="btn-secondary t-sm"
                  onClick={() => setDanger(true)}>
            Видалити акаунт
          </button>
        ) : (
          <div className="card-flat flex flex-col gap-3">
            <p className="t-md">
              Буде видалено:{' '}
              {soleOwner
                ? <>ваш акаунт <b>і заклад «{shop.name}»</b> з усіма товарами,
                    складом, замовленнями, записами та журналами</>
                : <>ваш акаунт і доступ до закладу «{shop.name}».
                    Сам заклад залишиться — у нього є інший власник</>}
              .
            </p>
            <p className="t-sm prose-muted">
              Дію не можна скасувати. Якщо потрібні дані — спершу вивантажте їх.
            </p>

            <div>
              <label className="field-label">
                Щоб підтвердити, надрукуйте <b>ВИДАЛИТИ</b>
              </label>
              <input className="input" value={confirmWord} autoComplete="off"
                     onChange={(e) => setConfirmWord(e.target.value)} />
            </div>

            {killError && <p className="field-error">{killError}</p>}

            <div className="flex flex-wrap items-center gap-2">
              <button type="button" className="btn-danger"
                      disabled={confirmWord.trim() !== 'ВИДАЛИТИ' || killing}
                      onClick={deleteAccount}>
                {killing ? 'Видаляємо…' : 'Видалити назавжди'}
              </button>
              <button type="button" className="btn-secondary t-sm"
                      disabled={killing}
                      onClick={() => { setDanger(false); setConfirmWord(''); setKillError('') }}>
                Скасувати
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
