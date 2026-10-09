# Toskana-Fahrt 2026

Seite zur Stufenfahrt in die Toskana (04.–10.10.2026). Die Fahrt ist vorbei: Der Live-Tracker ist abgeschaltet, die Seite zeigt nur noch den Rückblick.

- `index.html`: Abschlussseite mit Link zu Toskana Wrapped, Zahlen zur Fahrt, Hin- und Rückfahrt und der Woche. Die Zahlen sind fest eingetragen (aus Wrapped übernommen).
- `wrapped-33477060a2.html`: Toskana Wrapped, Story-Folien zum Durchtippen. Die GPS-Spur von Hin- und Rückfahrt ist komplett eingebaut (`PTS`), die Seite lädt nichts nach. Abfahrt Rückfahrt 06:00 am Hotel (das Handy sendete erst ab 06:19), Ankunft an der Schule 00:22 laut GPS.
- `img/wrapped/`: Fotos für Wrapped und die Abschlussseite (WebP ohne Metadaten; `-s` = kleine Version).
- `sw.js`: Service Worker (Seite offline verfügbar). Benachrichtigungen werden keine mehr verschickt.

Der Live-Tracker (Karte, Ankunftsprognose, TomTom, Push-Nachrichten, Sender-Seite und iOS-App) steht in der Git-Historie bis Commit `e84189b`. Der Branch `live` mit Positionen und Spur ist gelöscht.

## Noch zu erledigen (nur im jeweiligen Konto möglich)
- GitHub-Token des Senders widerrufen (Settings → Developer settings → Fine-grained tokens).
- TomTom-Schlüssel auf developer.tomtom.com löschen und die Secrets `TOMTOM_KEY` und `VAPID_PRIVATE` im Repo entfernen.
- Cloudflare-Worker `toskana-ki` (Quelltext in `ki-worker/`) abschalten, falls er nicht mehr gebraucht wird.
