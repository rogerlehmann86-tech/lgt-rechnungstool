# LGT – Rechnungstool

Interne Web-Anwendung der **Lehmann Gerätetechnik GmbH** zur Umwandlung von ERP-Proformarechnungen in Rechnungen, für das Rechnungsarchiv und zur Nachverfolgung von Husqvarna-Eintauschprämien.

## Status

**Erste technische Version / Prototyp. Noch nicht produktionsreif für die ungeprüfte Rechnungsausgabe.** Das Repository enthält bereits eine benutzbare Oberfläche, eine geschützte Datenbankstruktur, Prämienstatus-Verwaltung, einen PDF-Analyse- und PDF-Ausgabeversuch sowie Tests der Rappenberechnung. Die automatische ERP-Layoutbearbeitung muss anhand mehrerer originaler ERP-PDFs gründlich verifiziert werden. Falls Layout, Summen, Steuersatz oder Zeilenplatz nicht zweifelsfrei erkannt werden, wird die Rechnungsausgabe gestoppt.

### Funktionen

- **ERP-PDF hochladen**, Rapportnummer, Kunde, Kundennummer, Maschine, ursprüngliches Rechnungstotal und MwSt-Satz erkennen; Angaben manuell prüfen.
- **Rechnungstitel**, Rechnungsnummer (entspricht Rapportnummer) und Datum anpassen; Originalangaben visuell erhalten.
- **Optional zusätzlicher Eintausch brutto** → Nettoabzug/steuerwirksamer Rabatt mit ganzzahliger Rappenberechnung. Eigenständiger Eintausch im Original blockiert zusätzliche Abzüge.
- **Husqvarna-Herstellerprämie getrennt** vom Kunden-Eintausch verfolgen; Beträge, Antragsdatum, Referenz, Teil-/Vollzahlung.
- **Archiv**: Rechnungsnummer einmalig, Kunden-/Maschineninformationen, Original- und End-PDF in privatem Storage.
- **Sicherheitsmodell**: E-Mail/Passwort über Supabase Auth, manuell freigeschaltete LGT-Mitarbeitende, RLS, private PDFs. Keine Service-Role-Schlüssel im Browser.
- **Prüfpflicht**: Visuelle Kontrolle jeder erstellten Rechnung vor der Speicherung. Bei abweichender Rundung oder widersprüchlichen Originalwerten wird eine Warnung angezeigt bzw. die Ausgabe gesperrt.

## Technischer Aufbau

Statische Website (`index.html`, `style.css`, `app.js`, `invoice.js`, `money.js`) ohne Build-Prozess. Es werden fest versionierte Browserbibliotheken verwendet: PDF.js `6.5.438`, pdf-lib `1.17.1`, Supabase JS `2.119.2` (CDN). Geldberechnungen basieren auf Integer-Rappen; keine Gleitkomma-Betragsrechnung. `db/schema.sql` ist die separate Supabase-Struktur.

## Supabase einrichten

1. Eine **separate Supabase-Projektinstanz** für das Rechnungstool auswählen/anlegen (mögliche Kosten bitte vorab prüfen). Die Daten der bestehenden Werbe-/Miettools nicht unüberlegt vermischen.
2. Das SQL in `db/schema.sql` im SQL-Editor des ausgewählten Projekts ausführen. Das richtet vier Tabellen, RLS-Richtlinien und den privaten Storage-Bucket ein. **Nur in der ausgewählten Rechnungstool-Datenbank!**
3. Unter **Authentication → Users** den gewünschten LGT-Benutzer erstellen. Öffentliche Registrierung in den Supabase Auth-Einstellungen deaktivieren, falls aktiviert.
4. Im SQL-Editor die Benutzer-UUID freischalten:

   ```sql
   insert into public.lgt_staff (user_id, active)
   values ('HIER-DIE-UUID-AUS-AUTH-USERS', true);
   ```

5. `config.js` nur mit der Supabase-Projekt-URL und dem **Publishable Key** ausfüllen. Diese zwei Werte sind für den Browser bestimmt. **Nie `service_role`, `sb_secret_...`, Datenbank-Passwort oder andere geheime Schlüssel hinterlegen.**
6. Website z. B. mittels GitHub Pages bereitstellen (Verfügbarkeit von Pages aus einem privaten Repository hängt vom GitHub-Plan ab). Da Pfade relativ sind, funktioniert die Website unter `/lgt-rechnungstool/`. In den Supabase Auth-Einstellungen die veröffentlichte URL als Site URL / Redirect URL pflegen.

Ohne Supabase-Verbindung lässt sich die PDF-Vorschau lokal testen; Archivieren und Prämienbuchungen sind absichtlich deaktiviert.

## Arbeitsschritte im Alltag

1. **Rechnung erstellen** öffnen, Proformarechnung aus ERP als *textbasiertes* PDF hochladen.
2. Datum, Kundendaten und extrahierte Beträge prüfen. Bei vorhandenem eigenständigem Eintausch nur "Eintausch bereits enthalten" auswählen.
3. Bei zusätzlichem Eintausch den **Bruttobetrag (inkl. MwSt.)** eingeben. Herstellerprämie separat erfassen; niemals ein zweites Mal vom Kundenbetrag abziehen.
4. PDF-Vorschau generieren, **alle Seiten**, Artikelpositionen, Eintausch, Total und MwSt prüfen und Bestätigung anhaken.
5. Definitiv speichern; Original und neue Rechnung liegen privat im Storage. Bei ausgewiesener Husqvarna-Prämie wird eine offene Forderung angelegt.
6. Unter **Husqvarna-Prämien** das Einforderungsdatum dokumentieren, später die erhaltene Zahlung quittieren (auch Teilzahlungen möglich). Der Verlauf wird separat gespeichert.

## PDF-Bearbeitung: bewusste Einschränkungen

- Derzeit rasterisiert der Browser die bestehenden ERP-Seiten mit ca. **252 dpi**, überschreibt erkannte Stellen (Titel/Datum/Summen) und schreibt die Ausgabe in ein neues PDF. Das schützt davor, dass überdeckte Altbeträge als versteckter PDF-Text erhalten bleiben, ergibt aber **kein vektor- oder durchsuchbares PDF**. Die OCR-/Textkopierbarkeit geht verloren.
- Ein neuer Eintausch wird **nur dann** automatisch gedruckt, wenn vor dem Fussbereich nach den letzten ERP-Artikeln sicher genug Platz erkannt wird. Bei zu wenig Platz wird abgebrochen, statt Artikel zu überdecken.
- Keine automatische Steuerzuordnung bei mehreren MwSt-Sätzen und keine automatische Erkennung aus eingescannten Rechnungen.
- Erkennung, Schriften, Koordinaten und Seitenränder müssen anhand tatsächlicher ERP-Beispiele noch kalibriert und mit Kontrollrechnungen freigegeben werden.
- Die Anwendung ist noch **kein revisionssicheres oder rechtsverbindlich geprüftes Buchhaltungs-/Archivsystem**; die endgültige Verbuchung erfolgt wie vorgesehen extern.
- Fehlgeschlagene PDF-Uploads können einen unvollständigen Archivdatensatz hinterlassen (`files_ready = false`), den ein Administrator bereinigen muss.

## Lokale Tests

```bash
node --version  # Node 20+ empfohlen
npm test        # keine Installation erforderlich
npm run check
python3 -m http.server 8080
# http://localhost:8080 aufrufen
```

## Weitere Schritte vor Produktivbetrieb

- PDF-Layout mit mindestens drei unterschiedlichen realen ERP-Rechnungen testen (1 / 2 / 3 Seiten, mit und ohne Eintausch). Original-/End-PDF visuell vergleichen, Preis- und Positionstext zeilenweise überprüfen.
- Rundungsdifferenzen von CHF 0.01 mit Buchhaltung abstimmen; nicht automatisch als exakt verbucht ausgeben.
- Datensicherung, Aufbewahrungsfristen, Zugriffskontrolle und Wiederherstellbarkeit definieren.
- Transaktionssichere Statushistorie/Fehlerbehebung für unvollständige Dateien ergänzen.