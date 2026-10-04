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
