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