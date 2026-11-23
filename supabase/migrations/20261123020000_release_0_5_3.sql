-- Release 0.5.3, for the update notice in connected browsers (#151, docs/RELEASING.md). A security release: a Library
-- read passed over X's rate limit instead of stopping on the risk ladder (#392), and a keep word with &, < or > kept
-- nothing from an unlike or an undo-repost (#370), so connected browsers show a notice that can't be dismissed.
insert into public.extension_releases (version, published_at, security) values ('0.5.3', '2026-11-23T00:00:00Z', true);
