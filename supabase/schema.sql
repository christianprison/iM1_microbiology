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

-- 2) HL7-Nachrichten: gemeinsame Beispiele (shared = true, owner_id = null)
--    und private Nachrichten der Nutzer.
create table if not exists public.messages (
  id         uuid primary key default gen_random_uuid(),
  owner_id   uuid references auth.users (id) on delete cascade default auth.uid(),
  title      text not null check (char_length(title) between 1 and 200),
  hl7        text not null check (char_length(hl7) <= 200000),
  shared     boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists messages_owner_idx on public.messages (owner_id);

alter table public.messages enable row level security;
revoke all on public.messages from anon;
grant select, insert, update, delete on public.messages to authenticated;

drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using ((select public.is_allowed()) and (shared or owner_id = (select auth.uid())));

drop policy if exists messages_insert on public.messages;
create policy messages_insert on public.messages
  for insert to authenticated
  with check ((select public.is_allowed()) and owner_id = (select auth.uid()) and not shared);

drop policy if exists messages_update on public.messages;
create policy messages_update on public.messages
  for update to authenticated
  using ((select public.is_allowed()) and owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()) and not shared);

drop policy if exists messages_delete on public.messages;
create policy messages_delete on public.messages
  for delete to authenticated
  using ((select public.is_allowed()) and owner_id = (select auth.uid()));

-- 3) Nutzer freischalten (Beispiel):
-- insert into public.allowed_emails (email, note) values ('kunde@example.org', 'Kunde X');
-- Zusätzlich den Nutzer unter Authentication → Users → "Add user" anlegen.
-- Zugriff entziehen: Zeile löschen (sofort wirksam für Daten) und Nutzer in Authentication löschen.
