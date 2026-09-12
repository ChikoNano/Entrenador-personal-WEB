-- FIT51: identificación explícita y segura de las rutinas de cardio.
-- Migración incremental. No convierte rutinas existentes ni infiere su tipo.

alter table public.routines
  add column if not exists routine_type text not null default 'general';

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'routines_type_check'
      and conrelid = 'public.routines'::regclass
  ) then
    alter table public.routines
      add constraint routines_type_check
      check (routine_type in ('general', 'cardio'));
  end if;
end
$$;

create index if not exists routines_user_active_type_idx
  on public.routines (user_id, active, routine_type);

-- user_id es la identidad propietaria de la rutina. trainer_id puede cambiar y
-- no debe permitir dos rutinas cardio activas para el mismo usuario.
create unique index if not exists routines_one_active_cardio_per_user_idx
  on public.routines (user_id)
  where active = true and routine_type = 'cardio';

comment on column public.routines.routine_type is
  'Tipo explícito de rutina FIT51: general o cardio.';
