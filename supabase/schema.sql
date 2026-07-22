-- Entrenador Personal WEB - esquema Supabase revisable.
-- Ejecutar manualmente en SQL Editor. No contiene credenciales ni datos demo.
create extension if not exists pgcrypto;
create extension if not exists citext;

do $$ begin create type public.app_role as enum ('admin','trainer','user'); exception when duplicate_object then null; end $$;
do $$ begin create type public.plan_type as enum ('personal','group','app'); exception when duplicate_object then null; end $$;
do $$ begin create type public.subscription_status as enum ('active','expired','cancelled','renewed'); exception when duplicate_object then null; end $$;
do $$ begin create type public.exercise_media_type as enum ('video','image'); exception when duplicate_object then null; end $$;

create table if not exists public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  email citext not null unique,
  full_name text not null default '', role public.app_role not null default 'user',
  trainer_id uuid references public.profiles(id) on delete set null,
  phone text, age smallint check (age between 10 and 120),
  weight numeric(6,2) check (weight > 0), height numeric(6,2) check (height > 0),
  goal text, cooper_distance_km numeric(6,2) check (cooper_distance_km >= 0),
  vam_kmh numeric(6,2) check (vam_kmh >= 0), avatar_path text,
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.initial_assessments (
  user_id uuid primary key references public.profiles(id) on delete cascade,
  goal text, previous_training text, training_days smallint check (training_days between 0 and 7),
  session_duration smallint check (session_duration > 0), gym_experience text,
  physical_activity text, has_injury boolean, injury_description text,
  completed boolean not null default false, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint injury_description_consistency check (has_injury is distinct from false or injury_description is null)
);

create table if not exists public.exercises (
  id uuid primary key default gen_random_uuid(), legacy_id bigint unique,
  category text not null, muscle_group text not null, title text not null,
  media_type public.exercise_media_type not null default 'video', media_url text not null,
  description text, active boolean not null default true,
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now()
);

create table if not exists public.routines (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  trainer_id uuid not null references public.profiles(id) on delete restrict,
  name text not null, description text, start_date date, end_date date,
  active boolean not null default true,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint routine_dates check (end_date is null or start_date is null or end_date >= start_date)
);

create table if not exists public.routine_exercises (
  id uuid primary key default gen_random_uuid(), routine_id uuid not null references public.routines(id) on delete cascade,
  exercise_id uuid not null references public.exercises(id) on delete restrict,
  week_number smallint not null check (week_number >= 1),
  day_name text not null constraint routine_exercises_day_name_check
    check (day_name in ('Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo')),
  sets smallint not null check (sets > 0), repetitions smallint not null check (repetitions > 0),
  rest_seconds integer not null default 0 check (rest_seconds >= 0), notes text,
  display_order integer not null default 0 check (display_order >= 0),
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint routine_exercises_id_week_key unique (id, week_number)
);

create table if not exists public.subscriptions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  plan_type public.plan_type not null, start_date date not null, expiration_date date not null,
  status public.subscription_status not null default 'active',
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  constraint subscription_dates check (expiration_date >= start_date)
);

-- Justificada: conserva cambios de plan/renovaciones sin mezclarlos con el registro vigente.
create table if not exists public.subscription_events (
  id uuid primary key default gen_random_uuid(), subscription_id uuid references public.subscriptions(id) on delete set null,
  user_id uuid not null references public.profiles(id) on delete cascade,
  event_type text not null check (event_type in ('created','renewed','plan_changed','cancelled')),
  previous_plan public.plan_type, new_plan public.plan_type, details jsonb not null default '{}'::jsonb,
  created_by uuid not null references public.profiles(id) on delete restrict,
  created_at timestamptz not null default now()
);

create table if not exists public.exercise_completions (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.profiles(id) on delete cascade,
  routine_exercise_id uuid not null,
  week_number smallint not null check (week_number >= 1), completed_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (user_id, routine_exercise_id, week_number),
  constraint exercise_completions_assignment_week_fk
    foreign key (routine_exercise_id, week_number)
    references public.routine_exercises(id, week_number) on delete cascade
);

-- Añade restricciones también si las tablas provenían de una versión anterior.
do $$ begin
  if not exists (select 1 from pg_constraint where conname='routine_exercises_id_week_key') then
    alter table public.routine_exercises add constraint routine_exercises_id_week_key unique (id, week_number);
  end if;
  if not exists (select 1 from pg_constraint where conname='routine_exercises_day_name_check') then
    alter table public.routine_exercises add constraint routine_exercises_day_name_check
      check (day_name in ('Lunes','Martes','Miércoles','Jueves','Viernes','Sábado','Domingo'));
  end if;
  if not exists (select 1 from pg_constraint where conname='exercise_completions_assignment_week_fk') then
    alter table public.exercise_completions add constraint exercise_completions_assignment_week_fk
      foreign key (routine_exercise_id, week_number)
      references public.routine_exercises(id, week_number) on delete cascade;
  end if;
end $$;

create index if not exists profiles_trainer_idx on public.profiles(trainer_id);
create index if not exists routines_user_idx on public.routines(user_id, active);
create index if not exists routine_exercises_lookup_idx on public.routine_exercises(routine_id, week_number, day_name, display_order);
create index if not exists subscriptions_user_idx on public.subscriptions(user_id, expiration_date desc);
create index if not exists completions_user_idx on public.exercise_completions(user_id, completed_at desc);
create index if not exists exercises_active_category_idx on public.exercises(active, category);

-- El estado vencido se deriva en servidor aunque el registro histórico conserve su estado original.
create or replace view public.subscription_overview with (security_invoker=true) as
select s.*, case when s.status='active' and s.expiration_date < current_date then 'expired'::public.subscription_status else s.status end as effective_status
from public.subscriptions s;
grant select on public.subscription_overview to authenticated;

create or replace function public.set_updated_at() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin new.updated_at=now(); return new; end $$;
do $$ declare t text; begin foreach t in array array['profiles','initial_assessments','exercises','routines','routine_exercises','subscriptions'] loop
  execute format('drop trigger if exists set_updated_at on public.%I',t);
  execute format('create trigger set_updated_at before update on public.%I for each row execute function public.set_updated_at()',t);
end loop; end $$;

create or replace function public.is_staff() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role in ('admin','trainer') and active)
$$;
create or replace function public.is_admin() returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.profiles where id=auth.uid() and role='admin' and active)
$$;
create or replace function public.can_manage_user(target uuid) returns boolean language sql stable security definer set search_path=public,pg_temp as $$
  select exists(select 1 from public.profiles actor join public.profiles client on client.id=target
    where actor.id=auth.uid() and actor.active and (actor.role='admin' or (actor.role='trainer' and client.trainer_id=actor.id)))
$$;
create or replace function public.safe_uuid(value text) returns uuid language plpgsql immutable set search_path=public,pg_temp as $$
begin return value::uuid; exception when invalid_text_representation then return null; end $$;
grant execute on function public.is_staff() to authenticated;
grant execute on function public.is_admin() to authenticated;
grant execute on function public.can_manage_user(uuid) to authenticated;
grant execute on function public.safe_uuid(text) to authenticated;

create or replace function public.protect_profile_security_fields() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  new.created_at=old.created_at;
  if public.is_admin() or current_user in ('postgres','supabase_admin') then return new; end if;
  -- La Edge Function usa service_role, pero solo puede vincular el perfil user
  -- con un entrenador activo. No puede cambiar rol, estado ni correo.
  if current_user = 'service_role' then
    new.role=old.role; new.active=old.active; new.email=old.email;
    if new.trainer_id is distinct from old.trainer_id and not exists (
      select 1 from public.profiles p
      where p.id=new.trainer_id and p.role in ('admin','trainer') and p.active
    ) then new.trainer_id=old.trainer_id; end if;
    return new;
  end if;
  -- Trainer y user solo pueden modificar campos personales, incluso en sí mismos.
  new.role=old.role; new.trainer_id=old.trainer_id; new.active=old.active; new.email=old.email;
  return new;
end $$;
drop trigger if exists protect_profile_security_fields on public.profiles;
create trigger protect_profile_security_fields before update on public.profiles for each row execute function public.protect_profile_security_fields();

create or replace function public.enforce_created_by() returns trigger language plpgsql set search_path=public,pg_temp as $$
begin
  if tg_op='UPDATE' then new.created_by=old.created_by;
  elsif auth.uid() is not null then new.created_by=auth.uid();
  end if;
  return new;
end $$;
drop trigger if exists exercises_enforce_created_by on public.exercises;
create trigger exercises_enforce_created_by before insert or update on public.exercises for each row execute function public.enforce_created_by();
drop trigger if exists subscriptions_enforce_created_by on public.subscriptions;
create trigger subscriptions_enforce_created_by before insert or update on public.subscriptions for each row execute function public.enforce_created_by();
drop trigger if exists subscription_events_enforce_created_by on public.subscription_events;
create trigger subscription_events_enforce_created_by before insert or update on public.subscription_events for each row execute function public.enforce_created_by();

create or replace function public.handle_new_auth_user() returns trigger language plpgsql security definer set search_path=public,pg_temp as $$
begin
  insert into public.profiles(id,email,full_name) values(new.id,new.email,coalesce(new.raw_user_meta_data->>'full_name',''))
  on conflict(id) do update set email=excluded.email; return new;
end $$;
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.handle_new_auth_user();

alter table public.profiles enable row level security;
alter table public.initial_assessments enable row level security;
alter table public.exercises enable row level security;
alter table public.routines enable row level security;
alter table public.routine_exercises enable row level security;
alter table public.subscriptions enable row level security;
alter table public.subscription_events enable row level security;
alter table public.exercise_completions enable row level security;

drop policy if exists profiles_read on public.profiles;
create policy profiles_read on public.profiles for select to authenticated using (id=auth.uid() or public.can_manage_user(id));
drop policy if exists profiles_update on public.profiles;
create policy profiles_update on public.profiles for update to authenticated using (id=auth.uid() or public.can_manage_user(id)) with check (id=auth.uid() or public.can_manage_user(id));
drop policy if exists assessments_all on public.initial_assessments;
create policy assessments_all on public.initial_assessments for all to authenticated using (user_id=auth.uid() or public.can_manage_user(user_id)) with check (user_id=auth.uid() or public.can_manage_user(user_id));
drop policy if exists exercises_read on public.exercises;
create policy exercises_read on public.exercises for select to authenticated using (active or public.is_staff());
drop policy if exists exercises_staff_write on public.exercises;
create policy exercises_staff_write on public.exercises for all to authenticated using (public.is_staff()) with check (public.is_staff());
drop policy if exists routines_read on public.routines;
create policy routines_read on public.routines for select to authenticated using (user_id=auth.uid() or public.can_manage_user(user_id));
drop policy if exists routines_staff_write on public.routines;
create policy routines_staff_write on public.routines for all to authenticated using (public.can_manage_user(user_id)) with check (public.can_manage_user(user_id) and trainer_id=auth.uid());
drop policy if exists routine_exercises_read on public.routine_exercises;
create policy routine_exercises_read on public.routine_exercises for select to authenticated using (exists(select 1 from public.routines r where r.id=routine_id and (r.user_id=auth.uid() or public.can_manage_user(r.user_id))));
drop policy if exists routine_exercises_staff_write on public.routine_exercises;
create policy routine_exercises_staff_write on public.routine_exercises for all to authenticated using (exists(select 1 from public.routines r where r.id=routine_id and public.can_manage_user(r.user_id))) with check (exists(select 1 from public.routines r where r.id=routine_id and public.can_manage_user(r.user_id)));
drop policy if exists subscriptions_read on public.subscriptions;
create policy subscriptions_read on public.subscriptions for select to authenticated using (user_id=auth.uid() or public.can_manage_user(user_id));
drop policy if exists subscriptions_staff_write on public.subscriptions;
create policy subscriptions_staff_write on public.subscriptions for all to authenticated using (public.can_manage_user(user_id)) with check (public.can_manage_user(user_id));
drop policy if exists subscription_events_read on public.subscription_events;
create policy subscription_events_read on public.subscription_events for select to authenticated using (user_id=auth.uid() or public.can_manage_user(user_id));
drop policy if exists subscription_events_staff_insert on public.subscription_events;
create policy subscription_events_staff_insert on public.subscription_events for insert to authenticated with check (public.can_manage_user(user_id) and created_by=auth.uid());
drop policy if exists completions_read on public.exercise_completions;
create policy completions_read on public.exercise_completions for select to authenticated using (user_id=auth.uid() or public.can_manage_user(user_id));
drop policy if exists completions_user_insert on public.exercise_completions;
create policy completions_user_insert on public.exercise_completions for insert to authenticated with check (user_id=auth.uid() and exists(select 1 from public.routine_exercises re join public.routines r on r.id=re.routine_id where re.id=routine_exercise_id and r.user_id=auth.uid()));
drop policy if exists completions_user_delete on public.exercise_completions;
create policy completions_user_delete on public.exercise_completions for delete to authenticated using (user_id=auth.uid());

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('avatars','avatars',false,5242880,array['image/jpeg','image/png','image/webp'])
on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;
drop policy if exists avatars_read on storage.objects;
create policy avatars_read on storage.objects for select to authenticated using (bucket_id='avatars' and ((storage.foldername(name))[1]=auth.uid()::text or public.can_manage_user(public.safe_uuid((storage.foldername(name))[1]))));
drop policy if exists avatars_insert on storage.objects;
create policy avatars_insert on storage.objects for insert to authenticated with check (bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists avatars_update on storage.objects;
create policy avatars_update on storage.objects for update to authenticated using (bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text) with check (bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);
drop policy if exists avatars_delete on storage.objects;
create policy avatars_delete on storage.objects for delete to authenticated using (bucket_id='avatars' and (storage.foldername(name))[1]=auth.uid()::text);

comment on column public.profiles.trainer_id is 'Permite varios entrenadores; admin actúa como entrenador en v1.';
comment on column public.routine_exercises.week_number is 'Semana real de la rutina; UI actual usa 1..4 y el esquema admite más.';
comment on type public.plan_type is 'personal=Plan personal, group=Plan grupal, app=Plan APP.';
