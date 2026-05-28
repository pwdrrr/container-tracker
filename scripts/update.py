"""Holt für alle in config.json eingetragenen Schiffe den aktuellen Track,
merged ihn mit der bestehenden Historie aus public/data/positions.json und
schreibt die Datei zurück.

Wird stündlich von einem GitHub-Actions-Cron aufgerufen.
"""
from __future__ import annotations

import json
import logging
import math
import sys
import time
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path

from ports import lookup as port_lookup
from scraper import Position, ScrapeError, Scraper

log = logging.getLogger("update")

ROOT = Path(__file__).resolve().parent.parent
CONFIG_PATH = ROOT / "config.json"
DATA_PATH = ROOT / "public" / "data" / "positions.json"

KMH_PER_KNOT = 1.852
EARTH_KM = 6371.0088


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dl = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dl / 2) ** 2
    return 2 * EARTH_KM * math.asin(min(1.0, math.sqrt(a)))


def total_km(points: list[list]) -> float:
    total = 0.0
    for i in range(1, len(points)):
        total += haversine_km(points[i - 1][1], points[i - 1][2], points[i][1], points[i][2])
    return total


def load_existing() -> dict:
    if not DATA_PATH.exists():
        return {"updated_at": None, "ships": []}
    try:
        return json.loads(DATA_PATH.read_text("utf-8"))
    except Exception:
        log.warning("Vorhandene positions.json konnte nicht gelesen werden — starte neu.")
        return {"updated_at": None, "ships": []}


def merge_track(existing: list[list], fresh: list[Position]) -> list[list]:
    """Existierende Punkte beibehalten, neue per Zeitstempel hinzufügen."""
    seen = {row[0] for row in existing}
    merged = list(existing)
    for p in fresh:
        if p.ts in seen:
            continue
        merged.append([p.ts, round(p.lat, 6), round(p.lon, 6),
                       round(p.sog, 1) if p.sog is not None else None,
                       round(p.cog, 1) if p.cog is not None else None])
        seen.add(p.ts)
    merged.sort(key=lambda r: r[0])
    return merged


def prune(track: list[list], history_days: int) -> list[list]:
    if history_days <= 0:
        return track
    cutoff = time.time() - history_days * 86400
    return [row for row in track if row[0] >= cutoff]


def main() -> int:
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
    )
    cfg = json.loads(CONFIG_PATH.read_text("utf-8"))
    history_days = int(cfg.get("history_days", 0) or 0)
    title = cfg.get("title", "Vessel Tracker")

    existing = load_existing()
    existing_by_name = {s["name"].upper(): s for s in existing.get("ships", [])}

    scraper = Scraper()
    out_ships: list[dict] = []
    errors: list[str] = []

    for ship_cfg in cfg["ships"]:
        name = ship_cfg["name"].strip().upper()
        color = ship_cfg.get("color", "#3498DB")
        prev = existing_by_name.get(name, {})
        log.info("=== %s ===", name)
        try:
            mmsi = prev.get("mmsi") or ship_cfg.get("mmsi")
            imo = prev.get("imo") or ship_cfg.get("imo")
            res = scraper.fetch_ship(name, mmsi=mmsi, imo=imo)
            prev_track = prev.get("track", []) if isinstance(prev.get("track"), list) else []
            merged = prune(merge_track(prev_track, res.positions), history_days)

            new_count = len(merged) - len(prev_track)
            log.info("  %d neue, %d gesamt", max(0, new_count), len(merged))

            last = merged[-1] if merged else None
            ship_entry = {
                "name": name,
                "mmsi": res.mmsi or mmsi,
                "imo": res.imo or imo,
                "color": color,
                "destination": res.meta.destination if res.meta else prev.get("destination"),
                "destination_label": port_lookup(
                    res.meta.destination if res.meta else prev.get("destination")
                ),
                "eta_ts": res.meta.eta_ts if res.meta else prev.get("eta_ts"),
                "ship_type": res.meta.ship_type if res.meta else prev.get("ship_type"),
                "country": res.meta.country if res.meta else prev.get("country"),
                "last_position": (
                    {
                        "ts": last[0],
                        "lat": last[1],
                        "lon": last[2],
                        "sog_kn": last[3],
                        "sog_kmh": round(last[3] * KMH_PER_KNOT, 1) if last[3] is not None else None,
                        "cog": last[4],
                    }
                    if last
                    else None
                ),
                "total_km": round(total_km(merged), 1),
                "track_points": len(merged),
                "track": merged,
            }
            out_ships.append(ship_entry)
        except ScrapeError as exc:
            log.error("  %s: %s", name, exc)
            errors.append(f"{name}: {exc}")
            if prev:
                out_ships.append(prev)
        except Exception as exc:
            log.exception("  Fehler bei %s", name)
            errors.append(f"{name}: {exc}")
            if prev:
                out_ships.append(prev)

    payload = {
        "updated_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "title": title,
        "errors": errors,
        "ships": out_ships,
    }

    DATA_PATH.parent.mkdir(parents=True, exist_ok=True)
    DATA_PATH.write_text(json.dumps(payload, ensure_ascii=False, separators=(",", ":")), "utf-8")
    log.info("Geschrieben: %s (%d bytes, %d Schiffe)",
             DATA_PATH, DATA_PATH.stat().st_size, len(out_ships))
    return 1 if errors and not out_ships else 0


if __name__ == "__main__":
    sys.exit(main())
