-- Линтер безопасности помечал citext как установленный в public —
-- переносим в extensions, туда же, где уже живут pgcrypto/btree_gist/
-- pg_trgm/uuid-ossp. OID типа не меняется, поэтому существующие
-- колонки и сигнатуры функций продолжают работать без изменений;
-- проверено вручную на проде через storefront() после применения.
alter extension citext set schema extensions;
