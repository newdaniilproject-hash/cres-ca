'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'

type Shop = {
  id: string; name: string; slug: string; tagline: string | null
  description: string | null; kind: string; status: string
  storefront_enabled: boolean; city: string | null; address: string | null
  contact_phone: string | null
}
type Member = {
  userId: string; role: string; name: string | null; email: string | null
  /** Немає доступу до кабінету (`tenant_members.blocked_at`, 0081/0082). */
  blocked: boolean
}

// Подписи ролей — общий словарь `role.*`: одни и те же семь слов показывает
// и этот экран, и `/app/team`. Само значение (`owner`) не переводится: это
// служебное значение перечисления, по нему сверяется база. Неизвестная роль
// выводится как есть — новая роль появится в базе раньше, чем в словаре.
const ROLES = [
  'owner', 'admin', 'manager', 'accountant', 'operator', 'viewer', 'inspector',
] as const
type Role = (typeof ROLES)[number]
const roleLabel = (t: T, r: string): string =>
  ((ROLES as readonly string[]).includes(r) ? t(`role.${r as Role}`) : r)

// Витрина — отдельный модуль (`storefront`), а страница настроек модуля
// не требует: в панели «Магазин» им не помечен, потому что здесь же
// лежат данные закладу, состав команды и удаление аккаунта — это есть
// у всех. Модулю принадлежит не экран, а публічна сторінка: ссылка в шапку
// Instagram и её состояние публикации.
//
// Признак приезжает пропом из серверной страницы, а не считается здесь:
// клиент за модулями не ходит (правило 3), да и не может — `hasModule`
// работает по членству из токена на сервере.
//
// Умолчание — `false`, то есть «не показывать». Витринного блока при этом
// не увидит и тот, у кого модуль есть, — но это чинится одной строкой
// в `page.tsx`, а обратное умолчание чинить нечем: `true` молча вернул бы
// заведению без витрины публичную ссылку на страницу, которой у него нет,
// и приглашение положить её в шапку Instagram. Лишний отказ виден,
// лишний доступ — нет.
export function SettingsClient({
  shop, canWrite, team, canSeeTeam, hasStorefront = false,
}: {
  shop: Shop; canWrite: boolean; team: Member[]
  /**
   * Виден ли состав команды. Право на этот экран — `settings.read`,
   * а имена и почты отдаёт `team_overview` по `team.read` (0082), и это
   * РАЗНЫЕ права. Без признака экран не отличил бы «в закладі один
   * учасник» от «вам не показують склад команди» — а список тут пустым
   * не бывает никогда: смотрящий сам в нём есть.
   */
  canSeeTeam: boolean
  hasStorefront?: boolean
}) {
  const t = useT()
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
  // Единственный ли владелец — от этого зависит, что предупреждение обещает
  // удалить: только доступ или весь заклад с журналами. Без состава команды
  // ответа НЕТ, и подставлять сюда `false` нельзя: пустой список давал
  // «сам заклад залишиться — у нього є інший власник» тому, кто владелец
  // один и снесёт заведение целиком. Три состояния, не два.
  const soleOwner: boolean | null =
    canSeeTeam ? team.filter((x) => x.role === 'owner').length === 1 : null

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
      {/* Публичная ссылка — то, что уходит в шапку Instagram.
          Весь блок принадлежит модулю `storefront`: и адрес сторінки,
          и отметка «опубліковано / чернетка» — это состояние витрины. */}
      {hasStorefront && (
      <section className="card rise-1">
        <h2 className="t-lg mb-1">{t('settings.public.title')}</h2>
        <p className="t-md mb-3 prose-muted">{t('settings.public.desc')}</p>
        <div className="flex flex-wrap items-center gap-2">
          {/* Адрес витрины — данные, а не текст. */}
          <code className="card-flat t-md !px-3 !py-2">{publicUrl}</code>
          <button type="button" className="btn-secondary t-sm"
                  onClick={() => navigator.clipboard.writeText(publicUrl)}>
            {t('common.copy')}
          </button>
          {shop.storefront_enabled ? (
            <span className="badge-success">{t('settings.public.published')}</span>
          ) : (
            <span className="badge-warn">{t('settings.public.draft')}</span>
          )}
        </div>
      </section>
      )}

      {/* Данные заведения */}
      <form onSubmit={save} className="card rise-2 grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <label className="field-label">{t('settings.shop.name.label')}</label>
          <input required className="input" value={name} disabled={!canWrite}
                 onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="field-label">{t('settings.shop.tagline.label')}</label>
          <input className="input" value={tagline} disabled={!canWrite}
                 onChange={(e) => setTagline(e.target.value)}
                 placeholder={t('settings.shop.tagline.placeholder')} />
        </div>
        <div>
          <label className="field-label">{t('settings.shop.city.label')}</label>
          <input className="input" value={city} disabled={!canWrite}
                 onChange={(e) => setCity(e.target.value)} />
        </div>
        <div>
          <label className="field-label">{t('settings.shop.address.label')}</label>
          <input className="input" value={address} disabled={!canWrite}
                 onChange={(e) => setAddress(e.target.value)}
                 placeholder={t('settings.shop.address.placeholder')} />
        </div>
        <div>
          <label className="field-label">{t('settings.shop.phone.label')}</label>
          <input type="tel" className="input" value={phone} disabled={!canWrite}
                 onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <label className="field-label">{t('settings.shop.about.label')}</label>
          <textarea className="textarea" value={description} disabled={!canWrite}
                    onChange={(e) => setDescription(e.target.value)} />
        </div>

        {/* Отказ базы показывается как есть: это её текст, а не наш.
            В словарь он не едет (CLAUDE.md → «Локализация»). */}
        {state === 'error' && <p className="field-error sm:col-span-2">{error}</p>}

        {canWrite && (
          <div className="flex items-center gap-3 sm:col-span-2">
            <button className="btn-primary" disabled={state === 'busy'}>
              {state === 'busy' ? t('common.saving') : t('common.save')}
            </button>
            {state === 'saved' && (
              <span className="t-md rise" style={{ color: 'var(--color-success)' }}>
                {t('common.saved')}
              </span>
            )}
          </div>
        )}
      </form>

      {/* Команда */}
      <section className="card rise-3 !p-0">
        <div className="flex items-center justify-between p-5 pb-3">
          <h2 className="t-lg">{t('settings.team.title')}</h2>
        </div>
        {!canSeeTeam ? (
          // Не пустой список и не «Без імені» на всю команду. Человеку
          // говорят, ЧТО он смотрит и почему этого нет, — отсутствие
          // права не должно выглядеть как отсутствие коллег.
          <div className="empty">
            <p>{t('settings.team.hidden.title')}</p>
            <p className="prose-muted">{t('settings.team.hidden.desc')}</p>
          </div>
        ) : team.map((member) => (
          // Параметр назван `member`, а не `t`: `t` — переводчик.
          <div key={member.userId} className="row px-5">
            <div className="min-w-0">
              {/* Имя и почта приходят из `team_overview` (0082) и есть
                  у всех строк. «Без імені» тут означает ровно то, что
                  человек не заполнил профиль, — а не то, что нам его
                  не показали, как было до перехода с `profiles`. */}
              <p className="t-md truncate">
                {member.name ?? member.email ?? t('common.noName')}
              </p>
              {member.name && member.email && (
                <p className="t-xs prose-muted">{member.email}</p>
              )}
            </div>
            <span className="flex shrink-0 items-center gap-2">
              {member.blocked && (
                <span className="badge-danger">{t('settings.badge.blocked')}</span>
              )}
              <span className={member.role === 'owner' ? 'badge-accent' : 'badge'}>
                {roleLabel(t, member.role)}
              </span>
            </span>
          </div>
        ))}
        {/* Здесь стояло «запрошення співробітників — скоро тут». Экран
            команды появился, и обещание стало неправдой раньше, чем
            его успели прочитать. Список оставлен как срез состава;
            всё управление — на своём экране.

            Ссылка живёт под тем же правом, что и сам экран команды
            (`team.read`, см. `app/app/team/page.tsx`): кнопка, которая
            гарантированно уводит редиректом обратно, — это не защита,
            а сломанная навигация. */}
        {canSeeTeam && (
          <div className="px-5 pb-4">
            <Link href="/app/team" className="btn-secondary t-sm">
              {t('settings.team.manage')}
            </Link>
          </div>
        )}
      </section>

      {/* Ваши данные: выгрузка заведения.

          Стоит ПЕРЕД блоком удаления аккаунта намеренно: человек, дошедший
          до удаления, чаще всего сначала хочет забрать данные, а не потерять
          их. Порядок блоков здесь — это и есть подсказка.

          Отдельного права у экрана нет: он открывается по `settings.read`,
          как и сами настройки, а что именно уедет в файл, решают права
          РАЗДЕЛОВ внутри `tenant_export` (0102). */}
      <section className="card rise-3">
        <h2 className="t-lg mb-1">{t('settings.export.title')}</h2>
        <p className="t-md mb-3 prose-muted">{t('settings.export.desc')}</p>
        <Link href="/app/settings/export" className="btn-secondary t-sm">
          {t('settings.export.open')}
        </Link>
      </section>

      {/* Безпека: видалення акаунта */}
      <section className="card rise-3">
        <h2 className="t-lg mb-1">{t('settings.security.title')}</h2>
        <p className="t-md mb-3 prose-muted">{t('settings.security.desc')}</p>

        {/* Вход по Face ID / отпечатку жил на мосту нативной обёртки
            и ушёл вместе с ней (CLAUDE.md → «Мобильная версия»).
            В браузере замка нет и быть не может: биометрия там доступна
            только через WebAuthn, а это уже не «замок на вход», а другой
            способ входа. Вернётся в приложении на Flutter. */}
        {!danger ? (
          <button type="button" className="btn-secondary t-sm"
                  onClick={() => setDanger(true)}>
            {t('settings.delete.open')}
          </button>
        ) : (
          <div className="card-flat flex flex-col gap-3">
            {/* Три развилки — три отдельные строки словаря целиком, а не
                общее начало плюс хвост: в другом языке эти предложения
                строятся по-разному, и склейка из кусков даёт неграмотную
                фразу. Жирная часть вынесена своим ключом — разметки
                в словаре не бывает. Имя заведения приходит подстановкой
                `{shop}`: оно данные и не переводится. */}
            <p className="t-md">
              {t('settings.delete.lead')}{' '}
              {soleOwner === true
                ? <>{t('settings.delete.sole.pre')}{' '}
                    <b>{t('settings.delete.sole.bold', { shop: shop.name })}</b>{' '}
                    {t('settings.delete.sole.post')}</>
                : soleOwner === false
                ? <>{t('settings.delete.shared', { shop: shop.name })}</>
                /* Состава команды не видно — значит неизвестно, есть ли
                   второй владелец. Обещать сохранность закладу наугад
                   нельзя: удаление необратимо. Называем обе развилки. */
                : <>{t('settings.delete.unknown.pre', { shop: shop.name })}{' '}
                    <b>{t('settings.delete.unknown.bold')}</b>{' '}
                    {t('settings.delete.unknown.post')}</>}
              .
            </p>
            <p className="t-sm prose-muted">{t('settings.delete.irreversible')}</p>

            <div>
              <label className="field-label">
                {t('settings.delete.confirm.pre')}{' '}
                <b>{t('settings.delete.confirm.word')}</b>
              </label>
              <input className="input" value={confirmWord} autoComplete="off"
                     onChange={(e) => setConfirmWord(e.target.value)} />
            </div>

            {/* Отказ `delete_my_account` — текст базы, не наш. */}
            {killError && <p className="field-error">{killError}</p>}

            <div className="flex flex-wrap items-center gap-2">
              {/* Слово-подтверждение сверяется С ТЕМ ЖЕ КЛЮЧОМ, которым
                  оно показано. Захардкоженное «ВИДАЛИТИ» в проверке дало бы
                  русский интерфейс с украинским словом в поле — кнопка
                  не разблокировалась бы никогда. */}
              <button type="button" className="btn-danger"
                      disabled={confirmWord.trim() !== t('settings.delete.confirm.word') || killing}
                      onClick={deleteAccount}>
                {killing ? t('settings.delete.submitBusy') : t('settings.delete.submit')}
              </button>
              <button type="button" className="btn-secondary t-sm"
                      disabled={killing}
                      onClick={() => { setDanger(false); setConfirmWord(''); setKillError('') }}>
                {t('common.cancel')}
              </button>
            </div>
          </div>
        )}
      </section>
    </div>
  )
}
