-- FIT51: consentimiento legal versionado v1.0.
-- Ejecutar en Supabase SQL Editor después del esquema base existente.

begin;

create table if not exists public.legal_consents (
  user_id uuid not null references public.profiles(id) on delete cascade,
  privacy_notice_accepted boolean not null,
  terms_accepted boolean not null,
  sensitive_data_consent boolean not null,
  privacy_notice_version text not null,
  terms_version text not null,
  legal_accepted_at timestamptz not null default now(),
  primary key (user_id, privacy_notice_version, terms_version),
  constraint legal_consents_all_accepted check (
    privacy_notice_accepted and terms_accepted and sensitive_data_consent
  )
);

alter table public.legal_consents enable row level security;

drop policy if exists legal_consents_read on public.legal_consents;
create policy legal_consents_read on public.legal_consents for select to authenticated
  using (user_id=auth.uid() or public.can_manage_user(user_id));

drop policy if exists legal_consents_user_insert on public.legal_consents;
create policy legal_consents_user_insert on public.legal_consents for insert to authenticated
  with check (
    user_id=auth.uid()
    and privacy_notice_accepted
    and terms_accepted
    and sensitive_data_consent
  );

commit;
