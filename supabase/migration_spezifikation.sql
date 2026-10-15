-- Tabelle für die Schnittstellenspezifikation (Reiter „Spezifikation“).
-- Der Inhalt ist vertraulich und liegt nur in Supabase, nicht im öffentlichen Repository.
-- Einmalig im SQL Editor ausführen, danach die separat bereitgestellte Datei spezifikation_daten.sql.
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
