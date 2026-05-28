# Container Tracker — Netlify + GitHub Actions Edition

Online-Version der Schiffsverfolgung. Stündlicher GitHub-Actions-Cron holt
die Positionen, commitet `public/data/positions.json` und Netlify deployt
die statische Seite automatisch. Frontend (Leaflet + Chart.js) refresht
sich selbständig alle 60 Sekunden.

## Was du siehst

- **Cards** pro Schiff: aktuelle Position, Geschwindigkeit (km/h gross, Knoten klein),
  Kurs, Ziel-Hafen (UN/LOCODE → Klartext), ETA mit Restzeit, Gesamt-Kilometer.
- **Leaflet-Karte** mit den vollständigen Pfaden + aktueller Position; Popup
  zeigt die Detail-Stats. Antimeridian (180°) wird korrekt aufgeteilt.
- **Chart.js-Liniendiagramm** der kumulierten Kilometer über Datum (UTC).
  Checkbox blendet auf Wunsch bei jedem Datenpunkt die Geschwindigkeit
  in km/h ein.
- Status-Dot rechts oben: grün < 90 min alt, gelb wenn älter, rot bei Fehler.

## Lokal testen (ohne Netlify)

```bash
cd vesselfinder-web

# Python-Venv + Abhängigkeiten
python3.12 -m venv .venv
source .venv/bin/activate
pip install -r scripts/requirements.txt

# Einmal Daten holen
python scripts/update.py

# Statische Seite servieren
python3 -m http.server 8080 --directory public
# → http://localhost:8080
```

## Deployment

### 1. GitHub-Repository erstellen

```bash
cd vesselfinder-web
git init
git add .
git commit -m "Initial commit"
gh repo create container-tracker --public --source=. --push
# Oder manuell: auf github.com Repo anlegen, Remote setzen, push.
```

### 2. GitHub Action aktivieren

Die `.github/workflows/update.yml` ist bereits eingerichtet:

- Cron: stündlich um Minute 5 (`5 * * * *`)
- Manuell auslösbar via Tab **Actions** → **Update ship positions** → **Run workflow**
- Commitet Änderungen an `public/data/positions.json` mit dem `github-actions[bot]`

**Wichtig:** Damit der Bot pushen darf, muss im Repo unter
*Settings → Actions → General → Workflow permissions* die Option
**„Read and write permissions"** aktiviert sein (Default bei neuen Repos ist
oft read-only).

Manuell den ersten Lauf starten, bevor Netlify verbunden wird, damit beim
ersten Deploy schon Daten da sind:

```bash
gh workflow run update.yml
```

### 3. Netlify verbinden

1. Auf [app.netlify.com](https://app.netlify.com) einloggen
2. **Add new site** → **Import an existing project** → **GitHub** → Repo wählen
3. Build-Settings (werden automatisch aus `netlify.toml` gelesen):
   - **Build command:** `echo 'no build step'`
   - **Publish directory:** `public`
4. **Deploy site** klicken
5. URL anpassen unter *Site settings → Change site name* (z. B. `container-tracker.netlify.app`)

Jeder zukünftige `git push` (also auch der stündliche Bot-Commit) löst
automatisch ein neues Deploy aus — typischerweise innerhalb von 30 Sekunden online.

## Konfiguration

[`config.json`](config.json) im Root:

```json
{
  "ships": [
    { "name": "ONE TRIUMPH", "color": "#E67E22" },
    { "name": "ONE TRIBUTE", "color": "#2980B9" }
  ],
  "history_days": 0,
  "title": "ONE Container Tracker"
}
```

| Feld | Wirkung |
|------|---------|
| `ships[].name` | Schiffsname, wird per Suche bei VesselFinder aufgelöst |
| `ships[].color` | Hex-Farbe für Pfad / Marker / Chart-Linie |
| `ships[].mmsi`, `imo` | Optional — überspringt die Namens-Suche |
| `history_days` | 0 = unbegrenzt, ansonsten ältere Punkte werden gelöscht |
| `title` | Im Browser-Tab und im Header sichtbar |

Schiff hinzufügen/entfernen → `config.json` ändern, committen, pushen.
Der nächste Action-Lauf bezieht die neue Konfiguration mit ein.

## Dateigrösse / Performance

- Eine Position ≈ 50 Bytes JSON.
- 2 Schiffe × 24 h × 12 Punkte/h ≈ 24 KB nach erstem Lauf.
- 90 Tage Historie ≈ 2 MB JSON, lädt im Browser in <100 ms.
- Bei mehr als ~1 Jahr Historie evtl. `history_days: 365` setzen oder
  in Zukunft splitten in `positions.json` (letzte 7 Tage) + `positions-full.json`.

## Bekannte Einschränkungen

- **VesselFinder-Scraping ist gegen deren AGB.** Aus IP-Diversität von
  GitHub-Runnern bisher unproblematisch, aber kann jederzeit brechen, wenn
  VesselFinder seine Endpoints ändert (Action loggt dann Fehler im Run-Output).
- **Cron läuft nicht punktgenau** — GitHub gibt sich 5–15 min Karenz bei hoher
  Last. Ein verpasster Lauf macht nichts: der nächste Lauf holt eh die kompletten
  letzten 24h.
- **GitHub Free Limits:** 2 000 Action-Minuten/Monat, 1 Lauf braucht ≈ 30 s.
  720 Läufe/Monat ≈ 6 Action-Minuten — also locker im Limit.
- **Netlify Free Limits:** 100 GB Bandbreite/Monat, 300 Build-Min/Monat. Reicht
  selbst für deutlich mehr Besucher.

## Update-Frequenz erhöhen

GitHub-Cron-Minimum ist alle 5 Minuten:

```yaml
on:
  schedule:
    - cron: "*/5 * * * *"
```

Aber: 12 × 24 = 288 Läufe/Tag = ~144 Min. Action-Zeit/Monat — immer noch im
Free-Limit. VesselFinder könnte aber bei so häufigen Requests blockieren.
Stündlich ist die freundliche Variante.
