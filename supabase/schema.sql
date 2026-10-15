-- Mikrobiologie-Befundsimulator: Datenbankschema für Supabase
-- Im Supabase-Dashboard unter "SQL Editor" ausführen.

-- 1) Freigabeliste: nur diese Adressen erhalten Zugriff auf Daten.
--    Ohne RLS-Policy ist die Tabelle über die API weder lesbar noch schreibbar.
create table if not exists public.allowed_emails (
  email      text primary key check (email = lower(email)),
  note       text,
  created_at timestamptz not null default now()
);
alter table public.allowed_emails enable row level security;
revoke all on public.allowed_emails from anon, authenticated;

create or replace function public.is_allowed()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.allowed_emails
    where email = lower(coalesce(auth.jwt() ->> 'email', ''))
  );
$$;
revoke execute on function public.is_allowed() from public, anon;
grant execute on function public.is_allowed() to authenticated;

-- 2) HL7-Beispielnachrichten: nur gemeinsame Beispiele (shared = true), nur lesend.
--    Nutzer können nichts speichern – eigene Nachrichten bleiben im Browser.
--    Beispiele pflegst du per SQL Editor (seed.sql).
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid references auth.users (id) on delete cascade,
  title      text not null check (char_length(title) between 1 and 200),
  hl7        text not null check (char_length(hl7) <= 200000),
  shared     boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.messages enable row level security;
revoke all on public.messages from anon, authenticated;
grant select on public.messages to authenticated;

drop policy if exists messages_insert on public.messages;
drop policy if exists messages_update on public.messages;
drop policy if exists messages_delete on public.messages;
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using ((select public.is_allowed()) and shared);

-- 3) Schnittstellenspezifikation für den Reiter „Spezifikation“ (Inhalt vertraulich, nicht im Repository)
create table if not exists public.spec (
  id         int primary key default 1 check (id = 1),
  version    text not null,
  data       jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.spec enable row level security;
revoke all on public.spec from anon, authenticated;
grant select on public.spec to authenticated;
drop policy if exists spec_select on public.spec;
create policy spec_select on public.spec
  for select to authenticated
  using ((select public.is_allowed()));

-- 4) Nutzer freischalten (Beispiel):
-- insert into public.allowed_emails (email, note) values ('kunde@example.org', 'Kunde X');
-- Zusätzlich den Nutzer unter Authentication → Users → "Add user" anlegen.
-- Zugriff entziehen: Zeile löschen (sofort wirksam für Daten) und Nutzer in Authentication löschen.
