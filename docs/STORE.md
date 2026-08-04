# Публикация в App Store и Google Play

Что уже в репозитории, что настраивается один раз руками, и тексты
для карточек магазинов. Сборка идёт в облаке Codemagic — Mac не нужен.
Пайплайн перенесён с DaKi, где он уже довёл сборки до TestFlight.

## Как это устроено

Приложение — нативная обёртка (Capacitor) вокруг боевого сайта.
Бинарь не содержит наш код: WebView открывает cres-ca.com/app.
Все правки продукта прилетают с git push мгновенно, без пересборки
и без ревью. Пересborки требуют только: иконка, название, новый
нативный плагин.

Внутри натива уже подключено:
- **Face ID / отпечаток** — замок кабинета. iOS: плагин NativeBiometric
  через мост Capacitor. Android: BiometricPrompt в MainActivity, веб
  зовёт `window.AndroidBiometric`. Первый запуск предлагает включить.
- **Пуши OneSignal** — устройство представляется id пользователя
  Supabase (`external_id`), сервер уже шлёт по нему (lib/notify/send.ts).
  iOS: cordova-плагин через мост. Android: нативный SDK в MainActivity —
  JS-мост в удалённый server.url на Android не инжектится, это урок DaKi.
- **Камера** для сканера QR: purpose-строки в Info.plist, грант
  onPermissionRequest на Android.
- **Кнопка «назад»** на Android листает историю, а не убивает приложение.
- **Сплэш и статус-бар** в цвет продукта #141417, без белых вспышек.
- Офлайн-очередь и уведомления — те же, что в вебе: одна кодовая база.

## Запуск сборки

```
git tag ios-v1     && git push --tags   # iOS → TestFlight
git tag android-v1 && git push --tags   # Android APK на свой телефон
git tag play-v1    && git push --tags   # Android .aab для Google Play
```

## Один раз настроить (по порядку)

### 1. Codemagic (codemagic.io, вход через GitHub)
- Add application → репозиторий cres-ca.
- Teams → Integrations → App Store Connect → имя **cresca-app-store-connect**:
  Issuer ID, Key ID и .p8-ключ из App Store Connect → Users and Access → Keys.
- Environment groups:
  - `ios_signing` → `CM_CERTIFICATE_PRIVATE_KEY` (secure) — результат
    `openssl genrsa 2048`. Постоянный ключ, иначе каждый билд плодит
    сертификаты до лимита Apple.
  - `push` → `ONESIGNAL_APP_ID`.
  - `android_signing` → см. п. 4.

### 2. App Store Connect
- My Apps → «+» → New App: платформа iOS, имя **Маркет — облік і склад**,
  bundle **com.cresca.app** (создать в developer.apple.com → Identifiers,
  включить капабилити Push Notifications), язык Ukrainian.
- APNs-ключ для OneSignal: developer.apple.com → Keys → «+» → Apple Push
  Notifications service → скачать .p8 → загрузить в OneSignal.

### 3. OneSignal (только их панель, API этого не умеет)
- New App → **Маркет** → платформы Apple iOS (APNs .p8, Team ID, Bundle ID)
  и Google Android (FCM: см. п. 4).
- App ID скопировать в: Codemagic (группа push), Vercel
  (`NEXT_PUBLIC_ONESIGNAL_APP_ID` и `ONESIGNAL_APP_ID`), REST API Key →
  Vercel `ONESIGNAL_API_KEY`.

### 4. Firebase (для Android-пушей)
- console.firebase.google.com → новый проект → Android-приложение
  с пакетом com.cresca.app → скачать **google-services.json** →
  положить в `native-config/google-services.json` и закоммитить.
- Service Account JSON → загрузить в OneSignal (Android platform).

### 5. Ключ подписи Google Play
```
keytool -genkey -v -keystore release.jks -keyalg RSA -keysize 2048 \
  -validity 10000 -alias cresca
base64 -i release.jks   # → CM_KEYSTORE
```
Группа `android_signing`: CM_KEYSTORE, CM_KEYSTORE_PASSWORD, CM_KEY_ALIAS=cresca,
CM_KEY_PASSWORD. **Файл release.jks сохранить в надёжном месте:
потерян ключ — потеряна возможность обновлять приложение.**

### 6. Google Play Console
- Create app → **Маркет — облік і склад** → App access: дать тестовый
  аккаунт (см. ниже) → загрузить .aab из артефактов сборки play-v1 →
  Internal testing → Production.

## Карточки магазинов (готовые тексты)

**Назва:** Маркет — облік і склад
**Підзаголовок (iOS) / короткий опис (Play):**
Склад, терміни придатності, журнали й записи — в одному застосунку.

**Опис:**
Маркет — кабінет для українських підприємців: салонів, майстрів,
локальних брендів.

• Склад із термінами придатності: партії, ємності, дата відкриття і PAO —
термін рахує система, а не памʼять. Попередження за 14 і 7 днів.
• Сканер QR-кодів: наліпка на кожній ємності, одна дія — відкрити банку,
списати, побачити залишок.
• Санітарні журнали для перевірок: дезрозчини, прибирання, стерилізація.
Запис незмінюваний — це доказ, а не файл, який переписали.
• Звіт для Держпродспоживслужби — одним документом, в один клік.
• Записи клієнтів і замовлення з нагадуваннями.
• Працює без мережі: дії зберігаються на телефоні й надсилаються самі,
щойно зʼявиться звʼязок.
• Вхід захищено Face ID або відбитком.

Дані вашого закладу — ваша власність, із вивантаженням у будь-який момент.

**Ключові слова (iOS):** склад,облік,салон,майстер,записи,QR,термін
придатності,журнали,ФОП,перевірка

**Категорія:** Business. **Вік:** 4+.
**Privacy Policy URL:** https://cres-ca.com/privacy
**Support URL:** https://cres-ca.com

### Данные для формы App Privacy (Apple) / Data safety (Google)
Собираем: email, имя, телефон (по желанию) — для работы аккаунта;
не продаём, не используем для рекламы, не передаём брокерам данных.
Диагностика не собирается. Данные удаляются по запросу:
https://cres-ca.com/privacy/delete (кнопка в приложении — Кабінет → Безпека).

### Тестовый аккаунт для ревью (создать перед подачей)
Ревьюеру нужен рабочий вход без регистрации: заведите
`review@cres-ca.com` с паролем, положите демо-заведение с парой
ёмкостей и журналами, впишите доступы в App Review Information.

## Что осталось сделать в продукте до подачи (не в сборке)

1. **Кнопка «Видалити акаунт» в кабинете** — правило Apple 5.1.1(v),
   без неё iOS-ревью развернёт. Страница /privacy/delete есть,
   нужна кнопка в Кабінет → Безпека.
2. Реквизиты владельца в /privacy — сейчас заглушка до регистрации ФОП/ТОВ.
3. Почта privacy@cres-ca.com — включить приём (Cloudflare Email Routing).

## От сборки до App Store — три клика

TestFlight — НЕ способ раздачи пользователям, а личный предпросмотр:
та же сборка, что пойдёт в магазин, доступная себе за 10 минут.
Пользователи качают только из App Store.

1. Сборка `ios-v*` сама приезжает в App Store Connect (пайплайн выше).
2. Смотришь её на своём iPhone через TestFlight — один вечер.
3. App Store Connect → My Apps → Маркет → версия 1.0 → выбрать эту
   сборку → заполнить карточку (тексты ниже) → **Add for Review**.
4. Ревью 1–3 дня → Release. Дальше обновления бинаря нужны редко:
   продукт обновляется с git push без ревью.

То же для Google Play: сборка `play-v*` → артефакт .aab → Play Console →
Production → Create release.

## Честный календарь

- Codemagic + сертификаты + OneSignal + Firebase: ~полдня кликов по панелям.
- TestFlight-сборка на твоём iPhone: в тот же день.
- Ревью Apple: обычно 1–3 дня, первое может дольше.
- Google Play: первая публикация нового аккаунта — ревью до 1–2 недель,
  дальше часы.

«Завтра в обоих магазинах» не бывает физически — завтра реально:
APK на твоём Android и сборка в TestFlight на твоём iPhone.
