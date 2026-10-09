# Toskana-Fahrt Live

Live-Seite zur Stufenfahrt in die Toskana (04.–09.10.2026).

## Meldungen unterwegs

Die Seite liest alle 60 Sekunden `status.json`. Zum Melden die Datei auf GitHub bearbeiten (Stift-Symbol) und speichern; nach ca. 1 Minute ist es live.

- `checkins`: Liste von Meldungen, z. B. `{"phase": "hin", "wp": "ba", "t": "2026-10-05T05:40:00+02:00"}`
  - `phase`: `hin` oder `rueck`
  - `wp` (Ort): mg Mönchengladbach, ko Koblenz, ma Mannheim, ka Karlsruhe, fr Freiburg, ba Basel, lu Luzern, go Göschenen, ai Airolo, be Bellinzona, lg Lugano, ch Chiasso, mi Mailand, pc Piacenza, pr Parma, sp La Spezia, vi Viareggio, lc Lucca, bo Bologna, fi Florenz, mt Montecatini Terme
- `message`: Text für die Leuchtanzeige, `messageAt`: Uhrzeit dazu
- `gpsLink`: Link zum Live-Standort (muss mit https:// beginnen)
- `variant`: Weg ab Parma, `cisa` (La Spezia) oder `bologna`
## Live-GPS

`sender.html` (oder die iOS-App in `ios/`) auf dem Handy im Bus öffnen, einmalig einen GitHub-Token eintragen (Fine-grained, nur Repository `toskana-2026`, Berechtigung „Contents: Read and write“) und „Tracking starten“ tippen. Das Handy schreibt etwa jede Minute seine Position in `pos.json` im Branch `live`. Die Schülerseite liest sie von dort.

Nach der Fahrt: Branch `live` löschen, damit der Streckenverlauf nicht öffentlich bleibt, und den Token auf GitHub widerrufen.

## Benachrichtigungen

Echte Push-Benachrichtigungen über die Webseite (PWA), ohne Zusatz-App. Auf dem iPhone muss die Seite dafür als App auf dem Home-Bildschirm gespeichert sein (iOS 16.4+).

- Anmelden: In der Einführung auf „Benachrichtigungen einschalten“ tippen. Das Handy legt seine Push-Adresse in einem unsichtbaren ntfy-Briefkasten ab (`toskana26-subs-r8x2kp`).
- `.github/workflows/notify.yml` läuft bei jeder neuen Position im Branch `live` und alle 15 Minuten. `scripts/notify.mjs` holt neue Anmeldungen ab (`subs.json`), erkennt Abfahrt, Grenzen, Tunnel, Pausen, Stau, Umleitungen und Ankunft und schickt die Push-Nachrichten mit dem VAPID-Schlüssel (Secret `VAPID_PRIVATE`).
- Gemeldetes steht in `state.json`, die gefahrene Spur in `track.json` (nur während der Fahrten).

## Rückfahrt 09.10.2026: was dazugekommen ist

### Ankunftsprognose (index.html, `forecastRueck`)
- **Fahrzeit**: reine Fahrminuten der Hinfahrt ab der aktuellen Stelle (`HIN_PROF`, aus der GPS-Spur, Pausen herausgerechnet), mal **Tempo von heute** (`paceFactor`: letzte 100 Min flüssiger Fahrt im Vergleich zur Hinfahrt, −12 % bis +15 %).
- **Pausen nach EU-Lenkzeit** (`legalState`, `euBreak`): max. 4,5 Std Lenken, dann 45 Min (aufteilbar 15 + 30). Als Pause zählen nur Halte an Raststätten oder ab 30 Min; Stillstand im Stau nicht. Zusätzlich ein Toilettenstopp ca. alle 2 Std 20 (`FC.drive`), je ca. 33 Min (`FC.pause`). Fahrerwechsel = erster Halt ab 8 Min nach `FC_FRFROM` (heute Rasthof Mahlberg, 18:36–18:52).
- **Verkehr**: TomTom (siehe unten) an der Stelle des Staus eingerechnet; Stau, durch den der Bus laut GPS mit über 45 km/h fährt, wird ignoriert (`busThrough`).
- **Maut/Grenze** (`CHECKPTS`): Halte dort sind keine Pause (Grenze erst ab 20 Min).
- **Zeitfenster** (`win`): früh = nur gesetzliche Pause, spät = Extra-Halt + unbekannter Stau, wird mit der Restzeit kleiner.
- **Zwischenzeiten** im Fahrplan kommen aus derselben Simulation (`fcTimeAt`).

### Live-Verkehr TomTom
- Secret `TOMTOM_KEY` im Repo (Actions). `scripts/notify.mjs` fragt höchstens alle 4 Min die Route Bus → Schule ab (Reisemodus Bus) und speichert in `state.json` unter `rueck.tt`: Fahrzeit, Verzögerung, ausgedünnte Route (`geo`, für die Karte bei Umwegen) und Stauabschnitte (`jams`, rot/orange/gelb auf der Karte).
- Wichtig: Läufe, die das GPS auslöst, nehmen `notify.yml` aus dem Branch **live**. Änderungen an der Workflow-Datei auch dort einspielen.

### Anzeige
- **Statuszeile** oben (`statusInfo`): Stau / Pause / Maut-Grenze / Fahrerwechsel / Weiterfahrt / Freie Fahrt / GPS hängt (ab 5 Min ohne Position).
- **Ankunftsanzeige** mit Balken Fahrt / Pausen / Verkehr, nächster Pause und spätestem Zeitpunkt nach Lenkzeit.
- **Karte**: gefahrene Strecke = echte GPS-Spur, auf die Straße gelegt (`snapPath`); bei Abweichung über 2,5 km wird die Reststrecke neu gezeichnet (TomTom, sonst OSRM), Planroute gestrichelt.
- Seite lädt sich bei neuer Version selbst neu (`<meta name="app-build">`, alle 3 Min geprüft). Bei jeder Änderung `app-build` und den Cache in `sw.js` hochzählen.

### Sender
- `sender.html` schickt zusätzlich `sent` (Lebenszeichen) und `trail` (Positionen, die ohne Netz gesammelt wurden). `notify.mjs` füllt damit Lücken in `track.json`. Die iOS-App in `ios/` kann das noch nicht.
- `track.json` wird nicht mehr auf 600 Punkte gekürzt (jetzt 4000).

## Toskana Wrapped (Rückblick, nicht verlinkt)
- `wrapped-33477060a2.html`: Story-Folien (Titel mit Fotowand, Kilometer, Karte, Zeit, Gotthard, Nachtfahrt, Woche, Foto-Folien Siena/Firenze/Pisa, Fotoalbum, Rückfahrt, Stau, Rekorde, Ende).
- Fotos in `img/wrapped/` (WebP ohne Metadaten; `-s` = kleine Version für Titelwand, Karten und Album).
- Hinfahrt und Rückfahrt bis 18:45 sind fest eingebaut (`PTS`, aus der Git-Historie wiederhergestellt). Den Rest der Rückfahrt und die Ankunft holt die Seite live aus `track.json` / `state.json` im Branch `live`.
- **Vor dem Löschen des Branches `live`**: die endgültige Rückfahrt in `PTS` übernehmen und die Ankunftszeit fest eintragen (`RUE.arr`), sonst fehlt der Rest der Rückfahrt.
- Ausflugs-Kilometer sind aus dem Wochenplan geschätzt (`EXC_BUS`, `EXC_TRAIN`); während der Woche lief kein GPS-Tracking.

## Aufräumen nach der Fahrt
1. Toskana Wrapped mit den endgültigen Daten einfrieren (siehe oben).
2. Branch `live` löschen, GitHub-Token des Senders widerrufen.
3. TomTom-Schlüssel auf developer.tomtom.com löschen und Secret `TOMTOM_KEY` entfernen.
