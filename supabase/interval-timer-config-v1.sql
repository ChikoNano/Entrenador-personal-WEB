-- FIT51: configuración del cronómetro de intervalos V1.
-- No almacena resultados, sesiones, estadísticas ni desempeño.

create or replace function public.interval_timer_configured_work_seconds(value jsonb, total_rounds smallint)
returns integer language sql immutable set search_path=public,pg_temp as $$
  select coalesce(sum((phase->>'duration_seconds')::integer), 0)::integer * total_rounds
  from jsonb_array_elements(value) as phase
$$;

create table if not exists public.interval_timer_configs (
  id uuid primary key default gen_random_uuid(),
  routine_id uuid not null unique references public.routines(id) on delete cascade,
  rounds smallint not null check (rounds between 1 and 999),
  work_seconds integer not null check (work_seconds between 1 and 1800),
  phases jsonb not null check (jsonb_typeof(phases) = 'array' and jsonb_array_length(phases) > 0),
  cooldown jsonb not null default '{"name":"Enfriamiento","intensity":"","duration_seconds":0}'::jsonb
    check (jsonb_typeof(cooldown) = 'object'),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint interval_timer_work_matches_phases check (
    work_seconds = public.interval_timer_configured_work_seconds(phases, rounds)
  )
);

drop trigger if exists set_updated_at on public.interval_timer_configs;
create trigger set_updated_at
before update on public.interval_timer_configs
for each row execute function public.set_updated_at();

alter table public.interval_timer_configs enable row level security;

drop policy if exists interval_timer_configs_read on public.interval_timer_configs;
create policy interval_timer_configs_read on public.interval_timer_configs
for select to authenticated
using (
  exists (
    select 1 from public.routines r
    where r.id = routine_id
      and (r.user_id = auth.uid() or public.can_manage_user(r.user_id))
  )
);

drop policy if exists interval_timer_configs_staff_write on public.interval_timer_configs;
create policy interval_timer_configs_staff_write on public.interval_timer_configs
for all to authenticated
using (
  exists (
    select 1 from public.routines r
    where r.id = routine_id and public.can_manage_user(r.user_id)
  )
)
with check (
  exists (
    select 1 from public.routines r
    where r.id = routine_id and public.can_manage_user(r.user_id)
  )
);

comment on table public.interval_timer_configs is
'Configuración asignada del cronómetro V1. No contiene resultados ni historial de ejecución.';
