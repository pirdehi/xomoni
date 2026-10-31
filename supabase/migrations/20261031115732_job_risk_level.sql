-- The X account's risk level (#41): the extension's risk ladder (ADR-0013) as it stood when the job last
-- reported. A number from 0 (Normal) to 4 (Full stop), never a reason or a notice from X, so no X content
-- reaches the cloud (ADR-0004). Null until the extension reports it; the dashboard then shows no level.
-- The row policies on public.jobs already cover the new column.
alter table public.jobs
  add column risk_level smallint check (risk_level between 0 and 4);

comment on column public.jobs.risk_level is
  'Risk ladder level of the X account when the job last reported (0 Normal … 4 Full stop); null if not reported.';
