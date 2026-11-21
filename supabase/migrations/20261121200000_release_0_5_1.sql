-- Release 0.5.1, for the update notice in connected browsers (#151, docs/RELEASING.md). 0.5.0 was tagged but never
-- published (#354), so its row, added on main before that was decided, goes: a browser must never be told about a
-- version GitHub Releases doesn't have.
delete from public.extension_releases where version = '0.5.0';
insert into public.extension_releases (version, published_at, security) values ('0.5.1', '2026-11-21T00:00:00Z', false);
