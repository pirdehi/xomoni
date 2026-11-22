-- Release 0.5.2, for the update notice in connected browsers (#151, docs/RELEASING.md). A security release: every
-- version since 0.2.0 could miss X's notice of a limited or suspended account at the start of a job (#375, #377), so
-- connected browsers show a notice that can't be dismissed.
insert into public.extension_releases (version, published_at, security) values ('0.5.2', '2026-11-22T00:00:00Z', true);
