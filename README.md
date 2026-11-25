# LGT – Rechnungstool

Interne Web-Anwendung der **Lehmann Gerätetechnik GmbH** zur Umwandlung von ERP-Proformarechnungen und Kostenvoranschlägen in Rechnungen sowie zur Verarbeitung bestehender ERP-Rechnungen, für das Rechnungsarchiv und zur Nachverfolgung von Husqvarna-Eintauschprämien.

## Status

**Erste technische Version / Prototyp. Noch nicht produktionsreif für die ungeprüfte Rechnungsausgabe.** Das Repository enthält bereits eine benutzbare Oberfläche, eine geschützte Datenbankstruktur, Prämienstatus-Verwaltung, einen PDF-Analyse- und PDF-Ausgabeversuch sowie Tests der Rappenberechnung. Die automatische ERP-Layoutbearbeitung muss anhand mehrerer originaler ERP-PDFs gründlich verifiziert werden. Falls Layout, Summen, Steuersatz oder Zeilenplatz nicht zweifelsfrei erkannt werden, wird die Rechnungsausgabe gestoppt.

### Funktionen

- **ERP-PDF hochladen**, Rapportnummer, Kunde, Kundennummer, Maschine, ursprüngliches Rechnungstotal und MwSt-Satz erkennen; Angaben manuell prüfen.
- **Rechnungstitel**, Rechnungsnummer (entspricht Rapportnummer) und Datum anpassen; Originalangaben visuell erhalten.
- **Optional zusätzlicher Eintausch brutto** → Nettoabzug/steuerwirksamer Rabatt mit ganzzahliger Rappenberechnung. Eigenständiger Eintausch im Original blockiert zusätzliche Abzüge.
- **Husqvarna-Herstellerprämie getrennt** vom Kunden-Eintausch verfolgen; Beträge, Antragsdatum, Referenz, Teil-/Vollzahlung.
- **Archiv**: Rechnungsnummer einmalig, Kunden-/Maschineninformationen, Original- und End-PDF in privatem Storage.
- **Sicherheitsmodell**: E-Mail/Passwort über Supabase Auth, manuell freigeschaltete LGT-Mitarbeitende, RLS, private PDFs. Keine Service-Role-Schlüssel im Browser.
- **Prüfpflicht**: Visuelle Kontrolle jeder erstellten Rechnung vor der Speicherung. Rundungsdifferenzen beim Eintausch sind Hinweise ohne zusätzliche Bestätigung. ERP-Originalsummen bis CHF 0.05 Abweichung werden unverändert akzeptiert; grössere Widersprüche bleiben gesperrt.

## Technischer Aufbau

Statische Website (`index.html`, `style.css`, `app.js`, `invoice.js`, `money.js`) ohne Build-Prozess. Es werden fest versionierte Browserbibliotheken verwendet: PDF.js `6.5.438`, pdf-lib `1.17.1`, Supabase JS `2.119.2` (CDN). Geldberechnungen basieren auf Integer-Rappen; keine Gleitkomma-Betragsrechnung. `db/schema.sql` enthält die zusätzlichen Tabellen im gemeinsamen Supabase-Projekt «Lehmann Werbetool».

## Supabase-Anbindung

Das bestehende Supabase-Projekt «Lehmann Werbetool» ist angebunden. Die vier neuen `lgt_*`-Tabellen und der private Storage-Bucket `lgt-rechnungen` wurden eingerichtet. Die vorhandene Kundentabelle `contacts` bleibt unverändert; die ERP-Kundennummer wird mit `contacts.id` abgeglichen und der Kundenname (Firma bzw. Vor- und Nachname) automatisch ins Formular übernommen. Der Name bleibt manuell korrigierbar. Das PDF behält die ERP-Kundenangaben. Rechnungsdaten und PDF bleiben als historische Momentaufnahme erhalten. Die logische Referenz ohne Fremdschlüssel verhindert, dass Kundenimporte durch die Rechnungsablage blockiert werden.

Das bestehende bestätigte Werbetool-Konto wurde für das Rechnungstool freigeschaltet. Weitere Rechnungstool-Berechtigungen werden ausschliesslich vom Administrator vergeben. Achtung: Bestehende Werbetool-Richtlinien erlauben angemeldeten Benutzern breiten Zugriff auf Werbedaten. Keine weiteren Auth-Benutzer anlegen, bevor diese Berechtigungen geprüft und die öffentliche Registrierung deaktiviert ist.

`config.js` enthält die Projekt-URL und den browserseitigen Publishable Key, niemals einen geheimen Schlüssel. Das Schema ist bereits angewandt und darf nicht erneut ausgeführt werden.

Für die Veröffentlichung GitHub Pages oder ein anderes statisches Hosting nutzen. Die Verfügbarkeit von Pages bei privaten Repositories hängt vom GitHub-Plan ab. Bei neuen Auth-Redirects bestehende Einstellungen des Werbetools erhalten. Die Datenbankanbindung ist geprüft; der Browser-/PDF-End-to-End-Test steht noch aus.

## Arbeitsschritte im Alltag

1. **Rechnung erstellen** öffnen, Proformarechnung, Kostenvoranschlag oder Rechnung aus ERP als *textbasiertes* PDF hochladen. Der Dokumenttitel wird erkannt; alle drei Typen werden als Rechnung mit Rapportnummer ausgegeben. Bei bestehenden Rechnungen wird das vorhandene Rechnungsdatum, sofern erkannt, vorgeschlagen.
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
- Rundungsdifferenzen werden in der Kontrollübersicht ausgewiesen; kein zusätzlicher Bestätigungsschritt für Eintauschrundung.
- Datensicherung, Aufbewahrungsfristen, Zugriffskontrolle und Wiederherstellbarkeit definieren.
- Transaktionssichere Statushistorie/Fehlerbehebung für unvollständige Dateien ergänzen.