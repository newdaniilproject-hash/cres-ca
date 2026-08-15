-- 0069. Мелочь, которую видно человеку: «накладна <NULL> проведена».
--
-- Триггер из 0066 подставлял в отказ document_number, а у накладной,
-- заведённой до нумерации, он пуст — и мастер получал сообщение
-- с «<NULL>» вместо номера. Отказ обязан называть документ так, чтобы
-- его можно было найти: есть номер — номер, нет — идентификатор.

create or replace function public.stock_receipt_guard()
returns trigger
language plpgsql
security definer
set search_path to ''
as $function$
begin
  if coalesce(current_setting('app.purging_account', true), 'off') = 'on' then
    return coalesce(new, old);
  end if;
  if coalesce(old.status, 'draft') = 'applied' then
    raise exception 'накладна % проведена: змінити або видалити її не можна',
      coalesce(nullif(btrim(old.document_number), ''), old.id::text)
      using hint = 'Виправлення проводиться окремим документом або сторнуючим рухом.';
  end if;
  return coalesce(new, old);
end;
$function$;

revoke all on function public.stock_receipt_guard() from public;
