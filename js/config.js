// Supabase-Projektdaten (Dashboard → Project Settings → API).
// Der anon/publishable Key ist für den Browser gedacht und darf öffentlich sein –
// der Schutz der Daten erfolgt ausschließlich über Row Level Security (siehe supabase/schema.sql).
// NIEMALS den service_role/secret Key hier eintragen!
export const SUPABASE_URL = 'https://DEIN-PROJEKT.supabase.co';
export const SUPABASE_ANON_KEY = 'DEIN-ANON-ODER-PUBLISHABLE-KEY';

// Automatische Abmeldung nach Inaktivität (Minuten)
export const IDLE_LOGOUT_MINUTES = 30;
