-- Umstellung auf „nur lesen“: Nutzer können keine Nachrichten mehr speichern.
-- Einmalig im SQL Editor ausführen (für Projekte, die schema.sql in der alten Fassung eingespielt haben).

-- Schreibrechte und Schreib-Regeln entfernen
revoke insert, update, delete on public.messages from authenticated;
drop policy if exists messages_insert on public.messages;
drop policy if exists messages_update on public.messages;
drop policy if exists messages_delete on public.messages;

-- Lesen nur noch für gemeinsame Beispiele
drop policy if exists messages_select on public.messages;
create policy messages_select on public.messages
  for select to authenticated
  using ((select public.is_allowed()) and shared);

-- Bisher gespeicherte eigene Nachrichten der Nutzer löschen (Datensparsamkeit)
delete from public.messages where not shared;
