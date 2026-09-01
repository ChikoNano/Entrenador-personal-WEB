-- FIT51: auditoría y protección contra asignaciones duplicadas.
-- No elimina ni modifica duplicados existentes.
-- Revise primero los resultados de las dos consultas SELECT.

-- Duplicados de la misma asignación semanal dentro de una rutina.
select
  routine_id,
  exercise_id,
  week_number,
  day_name,
  count(*) as duplicate_count,
  array_agg(id order by created_at, id) as assignment_ids
from public.routine_exercises
group by routine_id, exercise_id, week_number, day_name
having count(*) > 1
order by duplicate_count desc, routine_id, week_number, day_name;

-- Varias rutinas activas del mismo entrenador para un usuario también pueden
-- hacer que el panel muestre asignaciones repetidas entre rutinas distintas.
select
  user_id,
  trainer_id,
  count(*) as active_routine_count,
  array_agg(id order by created_at, id) as routine_ids
from public.routines
where active = true
group by user_id, trainer_id
having count(*) > 1
order by active_routine_count desc, user_id;

-- Esta operación falla de forma segura si aún existen duplicados.
-- No borra datos: los casos reportados arriba deben revisarse manualmente.
do $$
begin
  if exists (
    select 1
    from public.routine_exercises
    group by routine_id, exercise_id, week_number, day_name
    having count(*) > 1
  ) then
    raise exception 'Existen asignaciones duplicadas. Revise y resuelva manualmente antes de crear la restricción.';
  end if;

  if not exists (
    select 1 from pg_constraint
    where conname = 'routine_exercises_logical_assignment_key'
  ) then
    alter table public.routine_exercises
      add constraint routine_exercises_logical_assignment_key
      unique (routine_id, exercise_id, week_number, day_name);
  end if;
end $$;
