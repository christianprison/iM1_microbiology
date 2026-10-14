# Mikrobiologie-Befundsimulator

Stellt per HL7 v2.4 an iMedOne übermittelte Mikrobiologiebefunde so dar, wie sie im Mikrobiologie-Viewer erscheinen, und prüft Nachrichten gegen die **Schnittstellenbeschreibung HL7-IN Mikrobiologiebefunde, Version 1.2.5**.

- **Befundansicht:** Gruppierung nach Entnahme (OBR-7), Statusbalken Final/Intermediate (OBR-25), Abschnitte je OBR (OBR-4.2), Erreger (OBR-31 = MOI, OBX Wertetyp IS), Antibiogramm nach Wirkstoffgruppe (OBR-31 = ABG, OBX-17), Kommentare (CMT, NTE), PDF-Dokumente (OBX Wertetyp ED), ORM-Auftragsstatus
- **Prüfung:** Pflichtfelder, feste Werte, Längen und Strukturregeln der Spezifikation, mit Verweis auf das jeweilige Kapitel
- **HL7-Struktur:** Feldpositionen (z. B. `OBX-5.2`); ein Klick auf ein Befundelement springt zum Quellsegment

Technik:
- Frontend: statisch auf GitHub Pages, ohne Build-Schritt
- Login und Daten: Supabase (E-Mail-Code bzw. Magic Link, nur freigeschaltete Adressen)
- Die HL7-Auswertung läuft komplett im Browser.

Festlegungen, die nicht in der Spezifikation stehen:
- Befunddatum aus OBR-22 (bestätigt); fehlt OBR-22, zeigt der Simulator ersatzweise MSH-7 und gibt einen Hinweis aus
- Ein OBX mit Wertetyp IS ohne OBR-31 = MOI wird nicht als Erreger angezeigt (abgeleitet aus Isolat 2 im Beispiel der Spezifikation)
- Antibiogramm nach den Screenshots „Microbiology results viewer – NG form (Netcare)“: links die Überschrift des vorangehenden MOI-OBR, mittig OBR-4.2, Gruppen aus OBX-17, Wert als „S (MHK)“; Kommentare aus einem folgenden CMT-OBR über das ⓘ-Symbol
- Probenangabe im Balken als „Specimen:Code-Text,Description:Code-Text“ (OBR-15.1 bzw. OBR-15.4)

## Sicherheitskonzept

| Ebene | Maßnahme |
|---|---|
| Daten | Liegen nur in Supabase, Zugriff per Row Level Security nur für Adressen in `allowed_emails` |
| Login | Keine Selbstregistrierung, Login nur für angelegte Nutzer, Einmalcode/-link mit kurzer Laufzeit |
| Account-Enumeration | Die Login-Maske antwortet immer gleich, egal ob die Adresse bekannt ist |
| Browser | Strikte Content Security Policy, keine externen Skripte (supabase-js liegt in `vendor/`), Ausgabe nur über `textContent` (kein XSS) |
| Sitzung | Automatische Abmeldung nach 30 Minuten Inaktivität |

**Wichtig:** Repository und GitHub-Pages-Seite sind öffentlich. Code und `samples/` sind für jeden einsehbar. Deshalb nur synthetische Daten verwenden, keine echten Patientendaten, und keine geheimen Schlüssel eintragen. Schützenswert ist nur, was in Supabase liegt.

## Einrichtung

### 1. Supabase

1. **SQL Editor:** `supabase/schema.sql` ausführen, danach `supabase/seed.sql` (Beispielnachrichten).
2. **Authentication → Sign In / Providers:**
   - Email aktiv
   - „Allow new users to sign up“ **aus**
   - „Email OTP Expiration“ z. B. 600 Sekunden
3. **Authentication → URL Configuration:**
   - Site URL: `https://<github-user>.github.io/<repo>/`
   - Redirect URLs: nur diese eine Adresse
4. **Authentication → Emails → SMTP Settings:** eigenen SMTP-Server eintragen. Der eingebaute Mailversand von Supabase stellt nur an Mitglieder des Supabase-Teams zu und ist stark limitiert.
5. **Authentication → Emails → Templates → Magic Link:** Code und Link einfügen, z. B.:
   ```html
   <p>Ihr Anmeldecode: <strong>{{ .Token }}</strong></p>
   <p>Oder hier klicken: <a href="{{ .ConfirmationURL }}">Anmelden</a></p>
   ```
   Der Code funktioniert auch, wenn Mail-Scanner den Link vorab aufrufen oder die Mail auf einem anderen Gerät geöffnet wird.
6. **Project Settings → API:** Project URL und anon/publishable Key in `js/config.js` eintragen. Den `service_role`/`secret` Key **niemals** dort eintragen.

### 2. Nutzer freischalten

Beide Schritte sind nötig:

1. Authentication → Users → „Add user“ → E-Mail-Adresse (ohne Passwort)
2. SQL Editor:
   ```sql
   insert into public.allowed_emails (email, note) values ('kunde@example.org', 'Kunde X');
   ```

Zugriff entziehen: Zeile aus `allowed_emails` löschen (sofort wirksam) und Nutzer unter Authentication löschen.

### 3. GitHub Pages

Settings → Pages → Source „Deploy from a branch“ → Branch `main`, Ordner `/ (root)`.

## Entwicklung

```bash
npm test                 # Parser-Tests (Node ≥ 20, keine Abhängigkeiten)
python3 -m http.server   # lokal unter http://localhost:8000
```

Für lokales Testen `http://localhost:8000/` zusätzlich als Redirect URL in Supabase eintragen.

Beispielnachrichten liegen in `samples/`. `supabase/seed.sql` ist aus diesen Dateien erzeugt.
