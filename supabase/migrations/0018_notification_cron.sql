-- Обработчик очереди уведомлений должен запускаться раз в несколько минут,
-- а не раз в сутки: напоминание «за 2 часа» с суточным опозданием бессмысленно.
-- На бесплатном тарифе Vercel собственный крон ограничен одним запуском
-- в сутки (см. docs/vercel: Hobby — «Once per day»), поэтому расписание
-- делает pg_cron ЗДЕСЬ, в базе, а сам запрос наружу шлёт pg_net — это не
-- требует платного тарифа ни у одного из сервисов.
--
-- CRON_SECRET захардкожен в теле задания намеренно: таблица cron.job
-- недоступна через REST API (PostgREST её не публикует), читать её может
-- только роль postgres. Тот же секрет должен быть выставлен в Vercel
-- как переменная окружения CRON_SECRET — без совпадения роут вернёт 401.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select cron.schedule(
  'notifications-dispatch',
  '*/5 * * * *',
  $$
  select net.http_get(
    url := 'https://cres-ca.com/api/cron/notifications',
    headers := jsonb_build_object('Authorization', 'Bearer 1cdf96f8ab05ed10477226ba87d4bda64978d36c75af30bb'),
    timeout_milliseconds := 55000
  );
  $$
);
