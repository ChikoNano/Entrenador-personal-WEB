-- FIT51: ajuste incremental para instalaciones que ya ejecutaron interval-timer-config-v1.sql.
-- Persiste el tiempo de trabajo y exige que coincida con fases por ronda × rondas.

create or replace function public.interval_timer_configured_work_seconds(value jsonb, total_rounds smallint)
returns integer language sql immutable set search_path=public,pg_temp as $$
  select coalesce(sum((phase->>'duration_seconds')::integer), 0)::integer * total_rounds
  from jsonb_array_elements(value) as phase
$$;

alter table public.interval_timer_configs
  add column if not exists work_seconds integer;

alter table public.interval_timer_configs
  drop column if exists name;

update public.interval_timer_configs
set work_seconds = public.interval_timer_configured_work_seconds(phases, rounds)
where work_seconds is null;

alter table public.interval_timer_configs
  alter column work_seconds set not null;

do $$ begin
  if not exists (
    select 1 from pg_constraint where conname = 'interval_timer_work_seconds_range'
  ) then
    alter table public.interval_timer_configs
      add constraint interval_timer_work_seconds_range
      check (work_seconds between 1 and 1800);
  end if;
  if not exists (
    select 1 from pg_constraint where conname = 'interval_timer_work_matches_phases'
  ) then
    alter table public.interval_timer_configs
      add constraint interval_timer_work_matches_phases
      check (work_seconds = public.interval_timer_configured_work_seconds(phases, rounds));
  end if;
end $$;

comment on column public.interval_timer_configs.work_seconds is
'Tiempo de trabajo sin enfriamiento; máximo 1800 segundos y debe coincidir con fases × rondas.';
