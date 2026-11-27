-- Release 0.6.0, for the update notice in connected browsers (#151, docs/RELEASING.md). It carries a safety fix: two
-- quick changes in Settings could put back the first, so a job could work in active hours the person had excluded
-- (#427), so connected browsers show a notice that can't be dismissed.
insert into public.extension_releases (version, published_at, security) values ('0.6.0', '2026-11-24T00:00:00Z', true);
