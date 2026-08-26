'use client'

import Link from 'next/link'
import { useMemo, useState } from 'react'
import { useRouter } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'
import { useT } from '@/lib/i18n/client'
import type { T } from '@/lib/i18n/translate'
import { dbErrorText } from '@/lib/errors/db'
import { abs } from '@/lib/site'
import {
  IconGear, IconBag, IconDoc, IconUsers, IconDownload, IconLock,
  IconBell, IconChevronRight, IconClose, IconLayers, IconAlert,
} from '@/components/icons'

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

// Разделы экрана. Ключ — то, что кладётся в состояние выбора на широком
// экране; на телефоне те же разделы лежат секциями одна под другой.
//
// Список СОБИРАЕТСЯ ниже по тому, что реально есть у смотрящего (витрина
// приходит модулем), а не задан константой: раздел в списке, за которым
// на этом экране ничего не стоит, — это сломанная навигация, ровно как
// колокол, который ничего не открывает.
type SectionKey = 'public' | 'shop' | 'presets' | 'notify' | 'team' | 'export' | 'security'

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
  shop, canWrite, team, canSeeTeam, hasStorefront = false, presets = [], brand = null,
  notify = null, offeringCount = 0,
}: {
  shop: Shop; canWrite: boolean; team: Member[]
  /**
   * Налаштування сповіщень (0129) або null, якщо рядка ще немає —
   * а його немає доти, доки людина нічого не змінювала. null означає
   * ті самі умовчання, що зашиті в `enqueue_expiry_for`.
   */
  notify?: { expiryEmail: boolean; expiryPush: boolean; recipients: string } | null
  /**
   * Готові набори довідників (0122). Приходять пропом із серверної
   * сторінки: список пресетів — це продукт, а не дані закладу, і клієнт
   * за ним не ходить сам.
   */
  presets?: { code: string; title: string; description: string | null }[]
  /** Обраний відтінок бренду (0123) або null. */
  brand?: string | null
  /**
   * Виден ли состав команды. Право на этот экран — `settings.read`,
   * а имена и почты отдаёт `team_overview` по `team.read` (0082), и это
   * РАЗНЫЕ права. Без признака экран не отличил бы «в закладі один
   * учасник» от «вам не показують склад команди» — а список тут пустым
   * не бывает никогда: смотрящий сам в нём есть.
   */
  canSeeTeam: boolean
  hasStorefront?: boolean
  /**
   * Скільки позицій заклад показує покупцеві. Потрібно, щоб сказати
   * чесно, чому вітрина ще порожня: сторінка без жодної позиції
   * відкривається, але робити на ній нічого.
   */
  offeringCount?: number
}) {
  const t = useT()
  const supabase = useMemo(() => createClient(), [])
  const router = useRouter()

  const [published, setPublished] = useState(shop.storefront_enabled)
  const [pubBusy, setPubBusy] = useState(false)
  const [igCopied, setIgCopied] = useState(false)
  const [name, setName] = useState(shop.name)
  const [tagline, setTagline] = useState(shop.tagline ?? '')
  const [description, setDescription] = useState(shop.description ?? '')
  const [city, setCity] = useState(shop.city ?? '')
  const [address, setAddress] = useState(shop.address ?? '')
  const [phone, setPhone] = useState(shop.contact_phone ?? '')
  const [state, setState] = useState<'idle' | 'busy' | 'saved' | 'error'>('idle')
  const [notifyBusy, setNotifyBusy] = useState(false)
  const [error, setError] = useState('')
  const [copied, setCopied] = useState(false)
  const [brandColor, setBrandColor] = useState(brand ?? '')
  const [brandBusy, setBrandBusy] = useState(false)
  const [presetBusy, setPresetBusy] = useState<string | null>(null)
  const [presetDone, setPresetDone] = useState('')
  const [presetError, setPresetError] = useState('')

  // Выбранный раздел — ТОЛЬКО для широкого экрана. Умолчание `null`:
  // панель не рисуется, список занимает всю ширину. Открывать первый
  // раздел заранее нельзя — человек пришёл сюда за одним из пяти,
  // и предвыбранный шестой отвечает не на его вопрос.
  const [picked, setPicked] = useState<SectionKey | null>(null)

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
    if (error) { setKilling(false); setKillError(dbErrorText(t, error)); return }
    // scope: 'local' — акаунт уже удалён, глобальный signOut пошёл бы на
    // сервер с мёртвой сессией; чистим только токены этого устройства.
    await supabase.auth.signOut({ scope: 'local' })
    // Не router.push: після видалення користувача треба повне
    // перезавантаження, інакше клієнт живе зі знищеною сесією.
    window.location.href = '/'
  }

  // Адреса вітрини — З КАНОНІЧНОГО `lib/site.ts`, а не з `location.origin`.
  //
  // Тут стояло `typeof location !== 'undefined' ? location.origin : ''`,
  // і це дефект із двома різними наслідками:
  //
  //   1. Сервер малював `/t/<slug>`, клієнт — `https://…/t/<slug>`,
  //      тобто гідратація падала з розбіжністю тексту. React у цьому разі
  //      перемальовує все піддерево заново; знайдено рендером 25.08.2026,
  //      бо ні `next build`, ні `tsc` таке не бачать.
  //   2. Гірше: людина копіює той адрес, на якому стоїть САМА. З прев'ю-
  //      складання Vercel вона поклала б у шапку Instagram посилання на
  //      тимчасовий домен, з `www.` — версію з `www`. Посилання ж це те,
  //      за яким рахується «продавець привів сам»: помилка в ньому коштує
  //      не косметики, а комісії.
  const publicUrl = abs(`/t/${shop.slug}`)
  // Адрес для шапки Instagram. Метка `?from=ig` — это НЕ украшение
  // и не аналитика «для интереса»: переход по ней помечает заказ или
  // запись как «продавец привёл сам» (0105, КОНСПЕКТЫ М24), а с таких
  // заказов комиссия не берётся. То есть это буквально то, ради чего
  // витрина продавцу и нужна, — и до сих пор этой ссылки в продукте
  // не было НИГДЕ: механика была построена, а положить ссылку в шапку
  // человеку предлагалось угадать самому.
  const igUrl = `${publicUrl}?from=ig`

  // ── ЧЕГО НЕ ХВАТАЕТ, ЧТОБЫ ВИТРИНА РАБОТАЛА ─────────────────────────
  //
  // Публикация — это не один флаг. Функция `storefront` отдаёт страницу
  // только при `status = 'active' AND storefront_enabled`, а страница
  // без единой позиции открывается, но покупателю на ней делать нечего.
  // Поэтому препятствия названы ЯВНО и по одному, а не сведены в общее
  // «щось не так»: человек должен видеть, что именно чинить.
  const blockers: string[] = []
  // `draft` СЮДЫ НЕ ВХОДИТ намеренно: переключатель ниже сам поднимает
  // заведение из черновика (0131), то есть это не препятствие, а часть
  // того же действия. Называть препятствием то, что чинится тем же
  // нажатием, — значит пугать человека собственной кнопкой.
  //
  // А вот `suspended` и `archived` человек не снимет ничем: это состояния
  // платформы, и 0131 запрещает выходить из них изнутри. Их назвать надо —
  // иначе включённый тумблер и пустая страница выглядят как поломка.
  if (shop.status === 'suspended' || shop.status === 'archived') {
    blockers.push(t('settings.public.block.suspended'))
  }
  if (offeringCount === 0) blockers.push(t('settings.public.block.empty'))
  if (!shop.tagline && !shop.description) blockers.push(t('settings.public.block.about'))

  // Переключатель публикации. Прямой UPDATE: RLS уже требует
  // `settings.write` (`tenants_member_update`), и своей функции здесь
  // не нужно — публикация не рождает движений и ничего не закрывает
  // навсегда, в отличие от блокировки участника.
  async function togglePublished(next: boolean) {
    setPubBusy(true)
    // ЗАОДНО ПОДНИМАЕМ ЗАВЕДЕНИЕ ИЗ ЧЕРНОВИКА, и это не «заодно».
    // `register_tenant` создаёт заклад со статусом `draft`, а
    // `create_order`, `create_booking` и `storefront` отказывают всем,
    // кроме `active`. Статус не менял НИ ОДИН файл приложения — то есть
    // новый продавец получал заведение, в котором витрина не работает
    // и заказы не принимаются, и починить это из продукта было нечем.
    //
    // Для человека это ОДНО действие: «показувати покупцям». Два тумблера
    // («активувати» и «опублікувати») там, где смысл один, — это ребус.
    // Обратный переход `active → draft` запрещён сторожем 0131: скрыть
    // витрину надо флагом, для того он и заведён.
    const { error } = await supabase.from('tenants')
      .update(next && shop.status === 'draft'
        ? { storefront_enabled: true, status: 'active' }
        : { storefront_enabled: next })
      .eq('id', shop.id)
    setPubBusy(false)
    if (error) { setError(dbErrorText(t, error)); return }
    setPublished(next)
    router.refresh()
  }

  async function save(e: React.FormEvent) {
    e.preventDefault()
    setState('busy'); setError('')
    const { error } = await supabase.from('tenants').update({
      name, tagline: tagline || null, description: description || null,
      city: city || null, address: address || null, contact_phone: phone || null,
    }).eq('id', shop.id)
    if (error) { setState('error'); setError(dbErrorText(t, error)); return }
    setState('saved'); router.refresh()
    setTimeout(() => setState('idle'), 2000)
  }

  // ═══ Тела разделов ══════════════════════════════════════════════════
  //
  // Каждое тело — ОДНА функция, которую зовут обе раскладки: секция
  // на телефоне и панель деталей на широком экране. Вторая копия формы
  // означала бы, что правка (новое поле закладу, другой текст отказа)
  // приезжает ровно в одну из них, и разъедутся они молча — это тот же
  // урок, что и с четырьмя палитрами.
  //
  // Заголовок и поясняющая строка в тела НЕ входят: на телефоне их
  // рисует карточка секции, на широком — шапка панели, и раскладка
  // у них разная. Дублируется только вызов `t()` с тем же ключом,
  // то есть текст всё равно живёт в словаре в одном месте.
  //
  // `dense` — единственное отличие: панель 420px уже, чем брейкпоинт
  // `sm` Tailwind, а он считает ширину ОКНА, а не контейнера. Поэтому
  // двухколоночную сетку формы в панели приходится гасить явно —
  // иначе поле «Місто» получает сто пикселей.

  /**
   * Витрина: адрес публичной страницы и состояние публикации.
   *
   * `withState` — потому что признак публикации живёт РОВНО В ОДНОМ месте
   * на каждой раскладке: на телефоне это метка в шапке-герое (макет
   * `shop`), на широком экране — вот эта строка в панели. Показать оба
   * значило бы дважды сообщить одно и то же в одном экране.
   */
  function publicBody(withState = true) {
    return (
      <div className="flex flex-col gap-4">
        {/* ── ЧТО ЭТО ВООБЩЕ ТАКОЕ ─────────────────────────────────
            Отзыв владельца 25.08.2026: «страницы магазин… не понятно
            какую цель и пользу несут». Экран показывал адрес, кнопку
            «копіювати» и метку «чернетка» — и ни слова о том, что за
            этим адресом лежит и зачем его копировать. */}
        <p className="t-sm prose-muted">{t('settings.public.what')}</p>

        <div className="flex flex-wrap items-center gap-2">
          {/* Адрес витрины — данные, а не текст. */}
          <code className="card-flat t-md !px-3 !py-2 break-all">{publicUrl}</code>
          {/* Кнопка без ответа читается как сломанная: буфер обмена ничего
              не показывает сам. Отсюда состояние `copied`. */}
          <button type="button" className="btn-secondary t-sm"
                  onClick={() => {
                    void navigator.clipboard.writeText(publicUrl)
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }}>
            {copied ? t('common.copied') : t('common.copy')}
          </button>
          {/* «Переглянути сторінку» из §18. Не дубль копирования: адрес
              рядом лежит ТЕКСТОМ и не открывается нажатием, то есть
              посмотреть на свою витрину отсюда было нельзя вовсе —
              приходилось копировать и вставлять в адресную строку. */}
          <a href={publicUrl} target="_blank" rel="noreferrer"
             className="btn-secondary t-sm">
            {t('settings.public.open')}
          </a>
          {withState && (published ? (
            <span className="badge-success">{t('settings.public.published')}</span>
          ) : (
            <span className="badge-warn">{t('settings.public.draft')}</span>
          ))}
        </div>

        {/* ── ПУБЛИКАЦИЯ ───────────────────────────────────────────
            ⚠️ ЭТОГО ПЕРЕКЛЮЧАТЕЛЯ НЕ БЫЛО ВООБЩЕ. `storefront_enabled`
            не писал НИ ОДИН файл приложения (проверено поиском
            25.08.2026): флаг ставили руками через панель базы, а
            в продукте он только ЧИТАЛСЯ. То есть витрину нельзя было
            опубликовать из кабинета никак — экран показывал ссылку,
            по которой покупатель видел «магазин не знайдено», и метку
            «чернетка» без единого способа её снять.

            Своей функции здесь не нужно: RLS уже требует
            `settings.write` (`tenants_member_update`), публикация
            не рождает движений и ничего не закрывает навсегда —
            в отличие от блокировки участника, которая идёт функцией
            ради неизменяемого журнала. */}
        {canWrite && (
          <div>
            {/* Тем же переключателем, что и каналы уведомлений ниже:
                два вида тумблера на одном экране читаются как два
                разных механизма. Зона нажатия — СТРОКОЙ, а не
                размером квадратика (проверка 1). */}
            <label className="flex items-start gap-2"
                   style={{ minHeight: 'var(--tap-min)' }}>
              <input type="checkbox" className="mt-1 shrink-0"
                     checked={published} disabled={pubBusy}
                     onChange={(e) => void togglePublished(e.target.checked)} />
              <span className="min-w-0">
                <span className="t-md block">{t('settings.public.publish')}</span>
                <span className="field-hint block">{t('settings.public.publishHint')}</span>
              </span>
            </label>
          </div>
        )}

        {/* ── ЧЕГО НЕ ХВАТАЕТ ──────────────────────────────────────
            Показывается, только пока есть что чинить, и перечисляет
            препятствия ПОИМЁННО. Общее «щось не так» отправило бы
            человека искать причину самому. */}
        {blockers.length > 0 && (
          <div className="nudge">
            <span aria-hidden className="nudge-icon"><IconAlert size={18} /></span>
            <span className="t-sm min-w-0 flex-1">
              <b>{t('settings.public.block.title')}</b>
              <span className="mt-1 block">{blockers.join('; ')}.</span>
            </span>
          </div>
        )}

        {/* ── ССЫЛКА ДЛЯ ШАПКИ INSTAGRAM ───────────────────────────
            Механика атрибуции (0105, М24) построена и работает,
            а САМОЙ ССЫЛКИ в продукте не было: человеку предлагалось
            догадаться дописать `?from=ig` руками. Здесь она названа
            и объяснена в одну строку — переход по ней делает заказ
            «своим», то есть бескомиссионным. Это и есть польза
            витрины, о которой спрашивал владелец. */}
        <div className="card-flat flex flex-col gap-2">
          <p className="t-md" style={{ fontWeight: 650 }}>{t('settings.public.ig.title')}</p>
          <div className="flex flex-wrap items-center gap-2">
            <code className="t-sm break-all">{igUrl}</code>
            <button type="button" className="btn-secondary t-sm"
                    onClick={() => {
                      void navigator.clipboard.writeText(igUrl)
                      setIgCopied(true)
                      setTimeout(() => setIgCopied(false), 2000)
                    }}>
              {igCopied ? t('common.copied') : t('common.copy')}
            </button>
          </div>
          <p className="field-hint">{t('settings.public.ig.why')}</p>
        </div>
      </div>
    )
  }

  /** Данные заведения. Сама форма — она же карточка на телефоне. */
  function shopForm(dense = false) {
    // На телефоне карточка с появлением, в панели — голая сетка:
    // карточка внутри карточки даёт двойную рамку.
    const wrap = dense
      ? 'grid gap-4'
      : 'card rise-2 grid gap-4 sm:grid-cols-2'
    const full = dense ? '' : 'sm:col-span-2'

    return (
      <form onSubmit={save} className={wrap}>
        {/* Подзаголовки групп — из §18 «Публічна сторінка бізнесу»:
            семь полей подряд без разделения читаются как анкета, а не
            как «вот это про заклад, а вот это его контакты». Отдельного
            экрана витрины у нас нет и заводить его не надо: те же три
            группы хендоффа лежат здесь. */}
        <p className={`t-lg webh2 ${full}`}>{t('settings.shop.group.main')}</p>
        <div className={full}>
          <label className="field-label">{t('settings.shop.name.label')}</label>
          <input required className="input" value={name} disabled={!canWrite}
                 onChange={(e) => setName(e.target.value)} />
        </div>
        <div className={full}>
          <label className="field-label">{t('settings.shop.tagline.label')}</label>
          <input className="input" value={tagline} disabled={!canWrite}
                 onChange={(e) => setTagline(e.target.value)}
                 placeholder={t('settings.shop.tagline.placeholder')} />
        </div>
        <div className={full}>
          <label className="field-label">{t('settings.shop.about.label')}</label>
          <textarea className="textarea" value={description} disabled={!canWrite}
                    onChange={(e) => setDescription(e.target.value)} />
        </div>

        <p className={`t-lg webh2 mt-1 ${full}`}>{t('settings.shop.group.contacts')}</p>
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

        {/* Отказ базы показывается как есть: это её текст, а не наш.
            В словарь он не едет (CLAUDE.md → «Локализация»). */}
        {state === 'error' && <p className={`field-error ${full}`}>{error}</p>}

        {canWrite && (
          <div className={`flex items-center gap-3 ${full}`}>
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
    )
  }

  /** Состав команды: срез, всё управление — на своём экране. */
  function teamBody(dense = false) {
    // На телефоне список живёт в карточке `!p-0`, и строки набирают
    // свой отступ сами. В панели отступ уже дан самой панелью.
    const pad = dense ? '' : 'px-5'

    return (
      <>
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
          <div key={member.userId} className={`row ${pad}`}>
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
          <div className={dense ? 'pt-3' : 'px-5 pb-4'}>
            <Link href="/app/team" className="btn-secondary t-sm">
              {t('settings.team.manage')}
            </Link>
          </div>
        )}
      </>
    )
  }

  /** Выгрузка заведения — свой экран, отсюда только вход. */
  function exportBody() {
    return (
      <Link href="/app/settings/export" className="btn-secondary t-sm">
        {t('settings.export.open')}
      </Link>
    )
  }

  /**
   * Відтінок бренду (0123).
   *
   * Вибирається ВІДТІНОК, а не колір: світлота й насиченість зафіксовані
   * в globals.css, інакше блідий вибір дає нечитабельну кнопку. Тому тут
   * готові зразки, а не піпетка на весь спектр — зразок показує рівно те,
   * що людина отримає, а піпетка обіцяла б більше, ніж ми даємо.
   *
   * Зберігається одразу, без кнопки «Зберегти»: значення одне, і результат
   * видно на екрані в ту ж мить — підтверджувати нема чого.
   */
  const BRAND_SWATCHES = [
    '#2563eb', '#0ea5e9', '#0d9488', '#16a34a',
    '#ca8a04', '#ea580c', '#dc2626', '#db2777',
    '#7c3aed', '#4f46e5', '#475569', '#0f766e',
  ]

  function brandBody() {
    return (
      <div className="flex flex-col gap-3">
        {/* §18 «Оформлення сторінки». У нас настраивается ОДНА величина —
            оттенок; шрифтов в хендоффе два селекта, и их здесь нет
            намеренно: шрифт кабинета один на весь продукт. */}
        <p className="t-lg webh2">{t('settings.brand.title')}</p>
        <span className="t-sm" style={{ color: 'var(--color-muted)' }}>
          {t('settings.brand.desc')}
        </span>
        <div className="flex flex-wrap gap-2">
          {BRAND_SWATCHES.map((c) => (
            <button key={c} type="button" aria-label={c}
                    aria-pressed={brandColor.toLowerCase() === c}
                    disabled={!canWrite || brandBusy}
                    onClick={() => saveBrand(c)}
                    className="btn-icon"
                    style={{
                      background: c,
                      borderRadius: 'var(--radius-plate)',
                      outline: brandColor.toLowerCase() === c
                        ? '2px solid var(--color-text)' : 'none',
                      outlineOffset: 2,
                    }} />
          ))}
        </div>
        {brandColor ? (
          <div>
            <button type="button" className="btn-secondary t-sm"
                    disabled={!canWrite || brandBusy}
                    onClick={() => saveBrand(null)}>
              {t('settings.brand.reset')}
            </button>
          </div>
        ) : null}
      </div>
    )
  }

  async function saveBrand(color: string | null) {
    setBrandBusy(true)
    const { error } = color
      ? await supabase.from('tenant_branding')
          .upsert({ tenant_id: shop.id, brand_color: color }, { onConflict: 'tenant_id' })
      : await supabase.from('tenant_branding')
          .update({ brand_color: null }).eq('tenant_id', shop.id)
    setBrandBusy(false)
    if (error) { setError(dbErrorText(t, error)); return }
    setBrandColor(color ?? '')
    // Відтінок віддає РОЗМІТКА макета кабінету, а не цей компонент, тому
    // без оновлення сторінки новий акцент не поїде по решті екрана.
    router.refresh()
  }

  /**
   * Швидке заповнення довідників готовим набором (0122).
   *
   * Це і є впровадження: людина, яка щойно завела заклад, бачить не
   * десяток порожніх довідників, а робочу систему. Кнопка лишається
   * і після заповнення — повторний виклик нічого не подвоює, і саме це
   * написано під нею: інакше її бояться натиснути вдруге.
   */
  // ── НАЛАШТУВАННЯ СПОВІЩЕНЬ (ТЗ 2, право адміністратора) ──────────────────
  //
  // ТЗ перелічує серед прав адміністратора «налаштування сповіщень», і до
  // 25.08.2026 такого екрана не існувало: отримувачі обчислювались
  // усередині функції як «всі, у кого stock.read», канали були прибиті
  // намертво. У салоні з чотирма майстрами попередження о шостій ранку
  // дзвонило в чотирьох телефонах разом, і сказати «шліть тільки мені»
  // не було чим.
  //
  // ⚠️ ПОРОГІВ 14 І 7 ТУТ НЕМАЄ, І ЦЕ РІШЕННЯ. Вони названі в ТЗ 3.2 і є
  // частиною того, що ми обіцяємо перевірці. Заклад, який поставить собі
  // «за 1 день», отримає формально працюючу систему і зіпсований сенс —
  // попередження, коли зробити вже нічого не можна. Відповідати за це
  // будемо ми, бо поле дали ми. Даними тут стає справа закладу (кому
  // і куди), кодом лишається вимога регламенту (коли).
  function notifyBody() {
    // Відсутній рядок = ті самі умовчання, що зашиті в `enqueue_expiry_for`.
    // Показуємо їх як обране, а не як порожнечу: людина має бачити, що
    // система робить СЬОГОДНІ, а не гадати.
    const cur = notify ?? { expiryEmail: true, expiryPush: true, recipients: 'stock_read' }

    async function save(patch: Partial<typeof cur>) {
      const next = { ...cur, ...patch }
      setNotifyBusy(true)
      const { error } = await supabase.from('notification_settings').upsert({
        tenant_id: shop.id,
        expiry_email: next.expiryEmail,
        expiry_push: next.expiryPush,
        expiry_recipients: next.recipients,
      }, { onConflict: 'tenant_id' })
      setNotifyBusy(false)
      if (error) { setError(dbErrorText(t, error)); return }
      // Значення приходить пропом із сервера — без оновлення екран показав
      // би старе, і наступне натискання відправило б застарілий набір.
      router.refresh()
    }

    return (
      <div className="flex flex-col gap-4">
        <p className="field-hint">{t('settings.notify.hint')}</p>

        <div>
          <p className="field-label">{t('settings.notify.channels')}</p>
          {/* Зона натискання — РЯДКОМ, а не розміром квадратика. */}
          <label className="t-sm flex items-center gap-2"
                 style={{ minHeight: 'var(--tap-min)' }}>
            <input type="checkbox" checked={cur.expiryEmail} disabled={notifyBusy}
                   onChange={(e) => void save({ expiryEmail: e.target.checked })} />
            {t('settings.notify.email')}
          </label>
          <label className="t-sm flex items-center gap-2"
                 style={{ minHeight: 'var(--tap-min)' }}>
            <input type="checkbox" checked={cur.expiryPush} disabled={notifyBusy}
                   onChange={(e) => void save({ expiryPush: e.target.checked })} />
            {t('settings.notify.push')}
          </label>
          {!cur.expiryEmail && !cur.expiryPush && (
            // Мовчазне «нічого не обрано» тут коштує дорого: попередження
            // про термін придатності — те, заради чого куплено систему.
            <p className="field-error">{t('settings.notify.allOff')}</p>
          )}
        </div>

        <div>
          <p className="field-label">{t('settings.notify.who')}</p>
          {(['stock_read', 'owner_only'] as const).map((v) => (
            <label key={v} className="flex items-start gap-2 py-1"
                   style={{ minHeight: 'var(--tap-min)' }}>
              <input type="radio" name="notify-who" className="mt-1 shrink-0"
                     checked={cur.recipients === v} disabled={notifyBusy}
                     onChange={() => void save({ recipients: v })} />
              <span>
                <span className="t-sm font-semibold">{t(`settings.notify.who.${v}`)}</span>
                <span className="field-hint block">{t(`settings.notify.who.${v}.hint`)}</span>
              </span>
            </label>
          ))}
        </div>

        {/* Пороги названі вголос і як НЕзмінні: інакше перше питання
            власника буде «а де тут поміняти на три дні». */}
        <p className="field-hint">{t('settings.notify.days')}</p>
      </div>
    )
  }

  function presetsBody() {
    if (presets.length === 0) {
      return <p className="t-sm" style={{ color: 'var(--color-muted)' }}>
        {t('settings.presets.empty')}
      </p>
    }
    return (
      <div className="flex flex-col gap-3">
        {presets.map((p) => (
          <div key={p.code} className="card-flat flex flex-col gap-2">
            <b className="t-md">{p.title}</b>
            {p.description ? (
              <span className="t-sm" style={{ color: 'var(--color-muted)' }}>
                {p.description}
              </span>
            ) : null}
            <div>
              <button type="button" className="btn-secondary t-sm"
                      disabled={!canWrite || presetBusy === p.code}
                      onClick={() => applyPreset(p.code)}>
                {presetBusy === p.code ? t('common.saving') : t('settings.presets.apply')}
              </button>
            </div>
          </div>
        ))}
        <p className="t-sm" style={{ color: 'var(--color-muted)' }}>
          {t('settings.presets.note')}
        </p>
        {presetDone ? (
          <p className="t-sm" style={{ color: 'var(--tone-emerald)' }}>{presetDone}</p>
        ) : null}
        {presetError ? (
          <p className="t-sm" style={{ color: 'var(--color-danger)' }}>{presetError}</p>
        ) : null}
      </div>
    )
  }

  async function applyPreset(code: string) {
    setPresetBusy(code); setPresetDone(''); setPresetError('')
    const { data, error } = await supabase.rpc('apply_preset', {
      p_tenant_id: shop.id, p_preset: code,
    })
    setPresetBusy(null)
    if (error) { setPresetError(dbErrorText(t, error)); return }
    // Сумма по всем сущностям, а не перечень: человеку важно «сработало
    // и сколько», а не разбивка по таблицам, названий которых он не знает.
    const added = Object.values((data ?? {}) as Record<string, number>)
      .reduce((a, b) => a + Number(b || 0), 0)
    setPresetDone(t('settings.presets.done', { n: t.number(added) }))
    router.refresh()
  }

  /** Безпека: удаление аккаунта. */
  function securityBody() {
    return (
      <>
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
      </>
    )
  }

  // ═══ Описание разделов для списка на широком экране ═════════════════
  //
  // Хендофф §17 называет девять рядов, но рисуется РОВНО то, что за этим
  // экраном стоит: пять разделов, из них витрина — по модулю. Ряд
  // «Тарифи» или «Сповіщення», за которым сегодня пусто, это обещание
  // с датой протухания, а не заготовка: тема, язык и размер текста живут
  // в профиле, биллинга нет вовсе (CLAUDE.md → «Что НЕ решено»).
  //
  // Тон плашки — токенами, а не подобранным цветом: значок в каждой
  // строке своим тоном, иначе пять серых кружков подряд читаются как
  // один пункт, разбитый переносами.
  const sections: {
    key: SectionKey; title: string; desc: string
    icon: React.ReactNode; bg: string; fg: string
    body: () => React.ReactNode
  }[] = [
    ...(hasStorefront ? [{
      key: 'public' as const,
      title: t('settings.public.title'), desc: t('settings.public.desc'),
      icon: <IconBag size={20} />,
      bg: 'var(--tone-violet-soft)', fg: 'var(--tone-violet)',
      body: () => publicBody(),
    }] : []),
    {
      key: 'shop',
      title: t('settings.shop.title'), desc: t('settings.shop.desc'),
      icon: <IconDoc size={20} />,
      bg: 'var(--tone-blue-soft)', fg: 'var(--tone-blue)',
      body: () => (<div className="flex flex-col gap-5">{shopForm(true)}{brandBody()}</div>),
    },
    ...(canWrite ? [{
      key: 'presets' as const,
      title: t('settings.presets.title'), desc: t('settings.presets.desc'),
      icon: <IconLayers size={20} />,
      // Акцент, а не шостий тон: шкала тонів закрита пʼятьма, а заповнення
      // довідників — головна дія при заведенні закладу, їй акцент і личить.
      bg: 'var(--color-accent-soft)', fg: 'var(--color-accent-ink)',
      body: () => presetsBody(),
    }] : []),
    ...(canWrite ? [{
      key: 'notify' as const,
      title: t('settings.notify.title'), desc: t('settings.notify.desc'),
      icon: <IconBell size={20} />,
      bg: 'var(--tone-amber-soft)', fg: 'var(--tone-amber)',
      body: () => notifyBody(),
    }] : []),
    {
      key: 'team',
      title: t('settings.team.title'), desc: t('settings.team.desc'),
      icon: <IconUsers size={20} />,
      bg: 'var(--tone-emerald-soft)', fg: 'var(--tone-emerald)',
      body: () => teamBody(true),
    },
    {
      key: 'export',
      title: t('settings.export.title'), desc: t('settings.export.desc'),
      icon: <IconDownload size={20} />,
      bg: 'var(--tone-amber-soft)', fg: 'var(--tone-amber)',
      body: () => exportBody(),
    },
    {
      key: 'security',
      title: t('settings.security.title'), desc: t('settings.security.desc'),
      icon: <IconLock size={20} />,
      bg: 'var(--tone-rose-soft)', fg: 'var(--tone-rose)',
      body: () => securityBody(),
    },
  ]

  const pickedSection = sections.find((s) => s.key === picked) ?? null

  return (
    <div className="flex flex-col gap-5 pb-8">
      {/* ═══ CRESKO Web, §17 «Налаштування» — хедер экрана (только lg) ═══
          Плашка со значком, имя экрана тем же ключом, которым его называет
          панель и вкладка браузера, и подпись под ним. Кнопки действия
          справа нет: у экрана нет действия уровня экрана — сохранение
          принадлежит форме закладу и стоит в ней самой. */}
      <div className="hidden items-center gap-3 lg:flex">
        <span aria-hidden className="flex shrink-0 items-center justify-center"
              style={{
                width: 44, height: 44,
                borderRadius: 'var(--radius-plate)',
                background: 'var(--color-accent-soft)',
                color: 'var(--color-accent-ink)',
              }}>
          <IconGear size={22} />
        </span>
        <div className="min-w-0">
          <h1 className="webh1" data-size="27">{t('app.screen.settings.title')}</h1>
          <p style={{ fontSize: 14, color: 'var(--color-muted)' }}>
            {t('app.screen.settings.desc')}
          </p>
        </div>
      </div>

      {/* ═══ Телефон: секции одна под другой ═══════════════════════════
          Раскладка не тронута: на 390px список-с-панелью не помещается
          ни в каком виде, а «свернуть в аккордеон» добавило бы нажатие
          там, где сегодня всё видно сразу. Тела разделов — те же
          функции, что зовёт панель справа. */}
      <div className="flex flex-col gap-5 lg:hidden">
        {/* ── Шапка-герой закладу (макет `shop`) ────────────────────────
            README, розділ G: «Обкладинка + статистика + сітка послуг +
            контактні картки». Обложки и сетки услуг здесь нет намеренно:
            колонки под обложку у заклада не существует, а «популярні
            послуги» — это каталог, у которого свой раздел в панели.
            Показывать чужую сетку вторым входом в тот же каталог значит
            завести на экране второй путь туда же.

            Статистики из макета — рейтинг, підписники, «рекомендують» —
            тоже нет: подписчиков продукт не считает вовсе, а рисовать
            плитку ради круглого числа — это ровно то, за что был снят
            рейтинг с экрана послуг (М32).

            Что осталось — то, ради чего сюда заходят: как заклад выглядит
            снаружи и та самая ссылка, которая уходит в шапку Instagram.
            Признак публикации стоит здесь же кнопкой-меткой, как
            в макете, а не отдельной секцией строкой ниже. */}
        <section className="card rise-1">
          <div className="flex items-center gap-3">
            <span aria-hidden className="flex shrink-0 items-center justify-center"
                  style={{
                    width: 56, height: 56,
                    borderRadius: 999,
                    background: 'var(--color-accent-soft)',
                    color: 'var(--color-accent-ink)',
                    fontSize: 24, fontWeight: 700,
                  }}>
              {shop.name.trim().charAt(0).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              {/* Название и адрес — данные заклада, не переводятся. */}
              <p className="t-xl clamp-2">{shop.name}</p>
              <p className="t-sm mt-0.5 truncate prose-muted">
                {[shop.city, shop.address].filter(Boolean).join(', ') || shop.tagline}
              </p>
            </div>
            {hasStorefront && (
              shop.storefront_enabled
                ? <span className="badge-success shrink-0">{t('settings.public.published')}</span>
                : <span className="badge-warn shrink-0">{t('settings.public.draft')}</span>
            )}
          </div>

          {hasStorefront && (
            <>
              <div className="divider my-4" />
              {/* Пояснение здесь БОЛЬШЕ НЕ ПОВТОРЯЕТСЯ: `settings.public.desc`
                  стоял строкой над телом, а тело теперь начинается со своей
                  строки «что это такое». Два объяснения подряд об одном
                  и том же — второй показ одной величины (проверка 3).
                  `desc` остался подписью раздела в списке на широком
                  экране, где тела не видно. */}
              {publicBody(false)}
            </>
          )}
        </section>

        {/* Данные заведения */}
        {shopForm(false)}

        {/* ⚠️ СРЕЗА СОСТАВА КОМАНДЫ ЗДЕСЬ БОЛЬШЕ НЕТ, И ЭТО СНЯТЫЙ ДУБЛЬ.
            Он показывал список без единого действия и заканчивался
            кнопкой «Керувати доступами», ведущей на `/app/team` — экран,
            который и так лежит пунктом в шторке под аватаром. То есть
            на телефоне было ДВА входа в команду, и один из них тратил
            карточку на нередактируемую копию чужого экрана.

            На широком экране список остаётся: там разделы живут колонкой
            с панелью справа, и «Команда» — её законный раздел, а не
            дубль пункта навигации. Тела `teamBody` это не касается —
            оно одно на обе раскладки и зовётся панелью. */}

        {/* Сповіщення (ТЗ 2, право адміністратора).

            ⚠️ Розділи на телефоні і на широкому екрані малюються РІЗНИМИ
            місцями: масив `sections` читає лише розкладка `lg`, а тут
            стоять власні картки. Це вже коштувало помилки в цьому ж
            заході — секцію додали в масив, і на телефоні її не було
            зовсім. Заводячи новий розділ, правити треба ОБИДВА місця;
            тіло при цьому одне (`notifyBody`) і розійтись не може. */}
        {canWrite && (
          <section className="card rise-3">
            <h2 className="t-lg mb-1">{t('settings.notify.title')}</h2>
            <p className="t-sm mb-3 prose-muted">{t('settings.notify.desc')}</p>
            {notifyBody()}
          </section>
        )}

        {/* Ваши данные: выгрузка заведения.

            Стоит ПЕРЕД блоком удаления аккаунта намеренно: человек, дошедший
            до удаления, чаще всего сначала хочет забрать данные, а не потерять
            их. Порядок блоков здесь — это и есть подсказка.

            Отдельного права у экрана нет: он открывается по `settings.read`,
            как и сами настройки, а что именно уедет в файл, решают права
            РАЗДЕЛОВ внутри `tenant_export` (0102). */}
        <section className="card rise-3">
          <h2 className="t-lg mb-1">{t('settings.export.title')}</h2>
          <p className="t-sm mb-3 prose-muted">{t('settings.export.desc')}</p>
          {exportBody()}
        </section>

        {/* Безпека: видалення акаунта */}
        <section className="card rise-3">
          <h2 className="t-lg mb-1">{t('settings.security.title')}</h2>
          <p className="t-sm mb-3 prose-muted">{t('settings.security.desc')}</p>
          {securityBody()}
        </section>
      </div>

      {/* ═══ Широкий экран: список разделов слева, детали справа ════════
          Ряд — КНОПКА, а не ссылка: у разделов нет своих адресов, и
          заводить их пятью маршрутами ради раскладки значит развести
          один экран на пять и потерять общее состояние формы.
          Пока раздел не выбран, панели нет вовсе, и список занимает
          всю ширину — пустая колонка 420px справа сообщала бы, что
          «здесь что-то не загрузилось». */}
      <div className="hidden items-start gap-5 lg:flex">
        {/* Потолок ширины — не украшение. Пока панель закрыта, ряд тянулся
            на всю контентную область (1146px на 1440), и шеврон уезжал
            от подписи на метр: строка переставала читаться как строка.
            В хендоффе (§17) колонка разделов держит примерно эту ширину
            и с панелью, и без неё — то есть открытие панели ряды
            не переставляет. */}
        <div className="flex min-w-0 flex-1 flex-col gap-2" style={{ maxWidth: 700 }}>
          {sections.map((s) => {
            const active = picked === s.key
            return (
              <button key={s.key} type="button" className="flex w-full items-center gap-3 text-left"
                      aria-current={active ? 'true' : undefined}
                      style={{
                        minHeight: 'var(--tap-min)',
                        borderRadius: 14,
                        padding: '15px 16px',
                        // Запасное значение обязательно: `--web-surface-tint`
                        // объявлен только в светлой веб-теме, а человек мог
                        // выбрать тёмную — без него выбранный ряд остался бы
                        // прозрачным ровно у той половины, которую не смотрят.
                        background: active
                          ? 'var(--web-surface-tint, var(--color-surface-2))'
                          : 'var(--color-surface)',
                        border: `1px solid ${active
                          ? 'var(--color-accent-soft)' : 'var(--color-border)'}`,
                      }}
                      onClick={() => setPicked(active ? null : s.key)}>
                <span aria-hidden className="flex shrink-0 items-center justify-center"
                      style={{
                        width: 40, height: 40,
                        borderRadius: 'var(--radius-plate)',
                        background: s.bg, color: s.fg,
                      }}>
                  {s.icon}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate"
                        style={{ fontSize: 15, fontWeight: 650, color: 'var(--color-text)' }}>
                    {s.title}
                  </span>
                  <span className="block truncate"
                        style={{ fontSize: 13, color: 'var(--color-muted)' }}>
                    {s.desc}
                  </span>
                </span>
                <span aria-hidden className="shrink-0"
                      style={{ color: 'var(--color-faint)' }}>
                  <IconChevronRight size={18} />
                </span>
              </button>
            )
          })}
        </div>

        {/* Ширина 420px — из хендоффа §17. Класс `.wpanel` держит 398px
            и общий для «Клієнтів» и «Співробітників»; править его ради
            одного экрана значило бы сдвинуть два чужих. Липкость,
            прокрутка и появление остаются его. */}
        {pickedSection && (
          <aside className="wpanel" style={{ width: 420 }}>
            {/* Кнопки «назад» здесь нет намеренно: список никуда не делся,
                он слева и виден целиком. Крестик закрывает панель, а не
                возвращает на предыдущий экран, — это разные обещания. */}
            <div className="mb-4 flex items-start justify-between gap-3">
              <div className="min-w-0">
                <h2 className="webh2">{pickedSection.title}</h2>
                <p className="mt-1" style={{ fontSize: 13, color: 'var(--color-muted)' }}>
                  {pickedSection.desc}
                </p>
              </div>
              <button type="button" className="btn-icon shrink-0"
                      aria-label={t('common.close.aria')}
                      onClick={() => setPicked(null)}>
                <IconClose size={18} />
              </button>
            </div>
            {pickedSection.body()}
          </aside>
        )}
      </div>
    </div>
  )
}
