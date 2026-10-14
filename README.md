# Mikrobiologie-Befundsimulator

Stellt per HL7 v2.4 an iMedOne übermittelte Mikrobiologiebefunde so dar, wie sie im Mikrobiologie-Viewer erscheinen, und prüft Nachrichten gegen die **Schnittstellenbeschreibung HL7-IN Mikrobiologiebefunde, Version 1.2.5**.

- **Befundansicht:** Gruppierung nach Entnahme (OBR-7), Statusbalken Final/Intermediate (OBR-25), Abschnitte je OBR (OBR-4.2), Erreger (OBR-31 = MOI, OBX Wertetyp IS), Antibiogramm nach Wirkstoffgruppe (OBR-31 = ABG, OBX-17), Kommentare (CMT, NTE), ORM-Auftragsstatus. PDF-Dokumente (OBX Wertetyp ED) landen in iMedOne im DMS und werden daher nicht angezeigt, nur in der Prüfung bewertet
- **Ansichten:** Nachricht (nur die aktuelle), Fall (Case View/Kompakt: alle Befunde mit gleicher Fallnummer PV1-19), Patient (alle Befunde mit gleicher Patientennummer PID-3 über alle Fälle); Quelle sind die Beispiele und die Nachrichten der laufenden Sitzung
- **Prüfung:** Pflichtfelder, feste Werte, Längen und Strukturregeln der Spezifikation, mit Verweis auf das jeweilige Kapitel
- **HL7-Struktur:** Feldpositionen (z. B. `OBX-5.2`); ein Klick auf ein Befundelement springt zum Quellsegment

Technik:
- Frontend: statisch auf GitHub Pages, ohne Build-Schritt
- Login und Daten: Supabase (Einmalcode per E-Mail, nur freigeschaltete Adressen)
- Die HL7-Auswertung läuft komplett im Browser.

Festlegungen, die nicht in der Spezifikation stehen:
- Befunddatum aus OBR-22 (bestätigt); fehlt OBR-22, zeigt der Simulator ersatzweise MSH-7 und gibt einen Hinweis aus
- Ein OBX mit Wertetyp IS ohne OBR-31 = MOI wird nicht als Erreger angezeigt (abgeleitet aus Isolat 2 im Beispiel der Spezifikation)
- Antibiogramm nach den Screenshots „Microbiology results viewer – NG form (Netcare)“: links die Überschrift des vorangehenden MOI-OBR, mittig OBR-4.2, Gruppen aus OBX-17, Wert als „S (MHK)“; Kommentare aus einem folgenden CMT-OBR über das ⓘ-Symbol
- HTML-Tags wie `<BR>` in Texten werden wörtlich angezeigt (Annahme); die Prüfung weist darauf hin, Zeilenumbruch in HL7 ist `\.br\`
- Probenangabe im Balken als „Specimen:Code-Text,Description:Code-Text“ (OBR-15.1 bzw. OBR-15.4)

## Sicherheitskonzept

| Ebene | Maßnahme |
|---|---|
| Daten | Supabase enthält nur die Beispielnachrichten; Lesen per Row Level Security nur für Adressen in `allowed_emails`, Schreiben für Nutzer gesperrt. Eigene Nachrichten verlassen den Browser nicht |
| Login | Keine Selbstregistrierung, Login nur für angelegte Nutzer, ausschließlich per Einmalcode mit kurzer Laufzeit (kein Link in der Mail) |
| Account-Enumeration | Die Login-Maske antwortet immer gleich, egal ob die Adresse bekannt ist |
| Browser | Strikte Content Security Policy, keine externen Skripte (supabase-js liegt in `vendor/`), Ausgabe nur über `textContent` (kein XSS) |
| Sitzung | Automatische Abmeldung nach 30 Minuten Inaktivität |

**Wichtig:** Repository und GitHub-Pages-Seite sind öffentlich. Code und `samples/` sind für jeden einsehbar. Deshalb nur synthetische Daten verwenden, keine echten Patientendaten, und keine geheimen Schlüssel eintragen. Schützenswert ist nur, was in Supabase liegt.

## Datenschutz: Pseudonymisierung

Nachrichten der Nutzer werden nicht gespeichert: Sie existieren nur im Arbeitsspeicher des Browserfensters (Liste „Diese Sitzung“) und sind nach Abmelden oder Schließen verworfen. Die Datenbank enthält nur die gemeinsamen Beispiele und ist für Nutzer schreibgeschützt.

Zusätzlich prüft die App beim Einfügen und beim Laden einer Datei jede Nachricht (`js/privacy.js`). Enthält der Patientenname (PID-5) keinen Hinweis auf Test- oder Musterdaten (Muster, Test, Demo, Beispiel, Dummy, Sample, Anonym …), gilt die Nachricht als wahrscheinlich echt und wird pseudonymisiert:

- PID-5 Name → `MUSTER^PATIENT <Code>`, PID-7 Geburtsdatum → 01.01. des Geburtsjahres
- PID-3 Patientennummer und PV1-19 Fallnummer → stabile Pseudonyme (Fall-/Patientenansicht bleibt nutzbar)
- Adresse, Telefon, Sozialversicherungs-/Konto- und weitere Kennungen in PID werden gelöscht, NK1 (Angehörige) entfernt
- Namen von Mitarbeitenden (PV1, ORC, OBR, OBX) → `MUSTERARZT`
- Vor- und Nachname des Patienten werden auch in OBX- und NTE-Freitexten ersetzt

Der Nutzer erhält einen Hinweis mit allen Änderungen. Die Pseudonyme werden mit einem zufälligen Schlüssel gebildet, der nur im Browser des Nutzers liegt. Grenzen: Andere Personendaten in Freitexten (z. B. Namen von Angehörigen) werden nicht sicher erkannt.

## Einrichtung

### 1. Supabase

1. **SQL Editor:** `supabase/schema.sql` ausführen, danach `supabase/seed.sql` (Beispielnachrichten). Bestehende Projekte mit der älteren Schema-Fassung (mit Speichern) einmalig `supabase/migration_nur_lesen.sql` ausführen.
2. **Authentication → Sign In / Providers:**
   - Email aktiv
   - „Allow new users to sign up“ **aus**
   - „Email OTP Expiration“ z. B. 600 Sekunden
3. **Authentication → URL Configuration:**
   - Site URL: `https://<github-user>.github.io/<repo>/`
   - Redirect URLs: nur diese eine Adresse
4. **Authentication → Emails → SMTP Settings:** eigenen SMTP-Server eintragen. Der eingebaute Mailversand von Supabase stellt nur an Mitglieder des Supabase-Teams zu und ist stark limitiert.
5. **Authentication → Emails → Templates → Magic Link:** nur den Code versenden, keinen Link (Links werden von Mailfiltern vorab aufgerufen und wirken im geschäftlichen Umfeld verdächtig). Betreff z. B. `Ihr Anmeldecode für den Mikrobiologie-Simulator`, Inhalt:
   ```html
   <p>Guten Tag,</p>
   <p>Ihr Anmeldecode für den Mikrobiologie-Befundsimulator lautet:</p>
   <p style="font-size:24px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
   <p>Der Code ist einige Minuten gültig und kann nur einmal verwendet werden.
   Wenn Sie keine Anmeldung angefordert haben, können Sie diese E-Mail ignorieren.</p>
   ```
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
