-- Número administrativo consecutivo e inmutable para public.profiles.
-- Seguro para ejecutar más de una vez.

alter table public.profiles
  add column if not exists user_number bigint;

create sequence if not exists public.profiles_user_number_seq
  as bigint
  start with 1001
  increment by 1
  no cycle;

alter sequence public.profiles_user_number_seq
  owned by public.profiles.user_number;

-- Conserva el avance de la secuencia (incluidos números de usuarios eliminados)
-- y la adelanta si ya existen números asignados manualmente.
do $$
declare
  sequence_last bigint;
  sequence_called boolean;
  maximum_number bigint;
  missing_profile record;
begin
  select last_value, is_called
    into sequence_last, sequence_called
    from public.profiles_user_number_seq;

  select greatest(coalesce(max(user_number), 1000), 1000)
    into maximum_number
    from public.profiles;

  if not sequence_called or maximum_number > sequence_last then
    perform setval(
      'public.profiles_user_number_seq',
      maximum_number,
      true
    );
  end if;

  for missing_profile in
    select id
      from public.profiles
     where user_number is null
     order by created_at, id
  loop
    update public.profiles
       set user_number = nextval('public.profiles_user_number_seq')
     where id = missing_profile.id;
  end loop;
end
$$;

create unique index if not exists profiles_user_number_key
  on public.profiles(user_number);

alter table public.profiles
  alter column user_number set not null;

-- La base de datos ignora cualquier número enviado al crear un perfil.
create or replace function public.assign_profile_user_number()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  new.user_number := nextval('public.profiles_user_number_seq');
  return new;
end
$$;

drop trigger if exists assign_profile_user_number on public.profiles;
create trigger assign_profile_user_number
before insert on public.profiles
for each row
execute function public.assign_profile_user_number();

-- Ni frontend, trainer, user, admin ni service_role pueden cambiar un número
-- una vez asignado. Las correcciones excepcionales requieren retirar el trigger.
create or replace function public.prevent_profile_user_number_change()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  if new.user_number is distinct from old.user_number then
    raise exception 'user_number es inmutable'
      using errcode = '42501';
  end if;
  return new;
end
$$;

drop trigger if exists prevent_profile_user_number_change on public.profiles;
create trigger prevent_profile_user_number_change
before update of user_number on public.profiles
for each row
execute function public.prevent_profile_user_number_change();

revoke all on sequence public.profiles_user_number_seq
  from anon, authenticated;

grant select (user_number) on public.profiles
  to authenticated;
