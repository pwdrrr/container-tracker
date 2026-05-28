"""Minimal-Scraper für VesselFinder (Track-Endpoint + Click-API)."""
from __future__ import annotations

import logging
import re
import struct
import time
from dataclasses import dataclass, field
from typing import Optional
from urllib.parse import quote_plus

import requests
from bs4 import BeautifulSoup

log = logging.getLogger(__name__)

BASE = "https://www.vesselfinder.com"
UA = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_4) AppleWebKit/605.1.15 "
    "(KHTML, like Gecko) Version/17.4 Safari/605.1.15"
)
HEADERS = {
    "User-Agent": UA,
    "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
    "Accept-Language": "de-DE,de;q=0.9,en;q=0.8",
    "Referer": BASE + "/",
}
TRACK_XOR32 = 0x55555555
TRACK_XOR16 = 0x5555
TRACK_REC = 16


class ScrapeError(RuntimeError):
    pass


@dataclass
class Position:
    ts: int           # Unix seconds (UTC)
    lat: float
    lon: float
    sog: Optional[float] = None  # knots
    cog: Optional[float] = None  # degrees


@dataclass
class VesselMeta:
    destination: Optional[str] = None
    eta_ts: Optional[int] = None
    ship_type: Optional[str] = None
    country: Optional[str] = None


@dataclass
class ScrapeResult:
    name: str
    mmsi: Optional[str] = None
    imo: Optional[str] = None
    positions: list[Position] = field(default_factory=list)
    meta: Optional[VesselMeta] = None


class Scraper:
    def __init__(self, request_timeout: int = 25, delay_s: float = 2.5) -> None:
        self.session = requests.Session()
        self.session.headers.update(HEADERS)
        self.timeout = request_timeout
        self.delay = delay_s
        self._last_req = 0.0

    def _wait(self) -> None:
        elapsed = time.time() - self._last_req
        if elapsed < self.delay:
            time.sleep(self.delay - elapsed)
        self._last_req = time.time()

    def _get(self, url: str, headers: Optional[dict] = None) -> requests.Response:
        self._wait()
        merged = {**self.session.headers, **(headers or {})}
        log.info("GET %s", url)
        r = self.session.get(url, headers=merged, timeout=self.timeout)
        if r.status_code in (403, 429, 503):
            raise ScrapeError(f"VesselFinder HTTP {r.status_code} — wahrscheinlich blockiert.")
        r.raise_for_status()
        return r

    # ----- Search

    def search(self, name: str) -> tuple[Optional[str], Optional[str]]:
        url = f"{BASE}/vessels?name={quote_plus(name)}"
        r = self._get(url)
        soup = BeautifulSoup(r.text, "html.parser")
        mmsi = imo = None
        for a in soup.select("a[href*='/vessels/details/']"):
            href = a.get("href") or ""
            m = re.search(r"/vessels/details/(\d+)", href)
            if not m:
                continue
            cid = m.group(1)
            if name.strip().upper() not in a.get_text(" ", strip=True).upper():
                continue
            if len(cid) == 7:
                imo = cid
            else:
                mmsi = cid
            break
        if not mmsi:
            m = re.search(r"data-mmsi=[\"'](\d{6,9})[\"']", r.text)
            if m:
                mmsi = m.group(1)
        if imo and not mmsi:
            mmsi = self._mmsi_from_detail(imo)
        if not (mmsi or imo):
            raise ScrapeError(f"Schiff '{name}' nicht gefunden.")
        return mmsi, imo

    def _mmsi_from_detail(self, imo: str) -> Optional[str]:
        try:
            r = self._get(f"{BASE}/vessels/details/{imo}")
        except Exception:
            return None
        m = re.search(r"MMSI[^0-9]{1,30}(\d{9})", r.text)
        return m.group(1) if m else None

    # ----- Track

    def get_track(self, mmsi: str) -> list[Position]:
        r = self._get(
            f"{BASE}/api/pub/track/{mmsi}",
            headers={"Accept": "*/*", "Referer": f"{BASE}/?mmsi={mmsi}"},
        )
        return _decode_track(r.content)

    def get_metadata(self, mmsi: str) -> Optional[VesselMeta]:
        try:
            r = self._get(
                f"{BASE}/api/pub/click/{mmsi}",
                headers={
                    "Accept": "application/json, text/plain, */*",
                    "X-Requested-With": "XMLHttpRequest",
                    "Referer": f"{BASE}/?mmsi={mmsi}",
                },
            )
            data = r.json()
        except Exception as exc:
            log.warning("Metadaten-Fetch fehlgeschlagen für mmsi=%s: %s", mmsi, exc)
            return None
        if not isinstance(data, dict):
            return None
        try:
            eta = int(data.get("etaTS")) if data.get("etaTS") else None
        except (TypeError, ValueError):
            eta = None
        return VesselMeta(
            destination=data.get("dest") or None,
            eta_ts=eta,
            ship_type=data.get("type") or None,
            country=data.get("country") or None,
        )

    # ----- Combined

    def fetch_ship(self, name: str, mmsi: Optional[str] = None, imo: Optional[str] = None) -> ScrapeResult:
        if not mmsi and not imo:
            mmsi, imo = self.search(name)
        if not mmsi and imo:
            mmsi = self._mmsi_from_detail(imo)
        if not mmsi:
            raise ScrapeError(f"Keine MMSI für {name}.")
        positions = self.get_track(mmsi)
        meta = self.get_metadata(mmsi)
        return ScrapeResult(name=name, mmsi=mmsi, imo=imo, positions=positions, meta=meta)


def _decode_track(data: bytes) -> list[Position]:
    """16-Byte-Records: ts(u32), lon^xor / 6e5, lat^xor / 6e5, cog^xor / 10, sog^xor / 10."""
    out: list[Position] = []
    for o in range(0, len(data) - TRACK_REC + 1, TRACK_REC):
        rec = data[o : o + TRACK_REC]
        ts = struct.unpack(">I", rec[0:4])[0]
        lon_raw = struct.unpack(">i", rec[4:8])[0]
        lat_raw = struct.unpack(">i", rec[8:12])[0]
        cog_raw = struct.unpack(">H", rec[12:14])[0]
        sog_raw = struct.unpack(">H", rec[14:16])[0]
        lon = (TRACK_XOR32 ^ lon_raw) / 6e5
        lat = (TRACK_XOR32 ^ lat_raw) / 6e5
        cog = (TRACK_XOR16 ^ cog_raw) / 10.0
        sog = (TRACK_XOR16 ^ sog_raw) / 10.0
        if not (-90 <= lat <= 90) or not (-180 <= lon <= 180):
            continue
        out.append(Position(ts=ts, lat=lat, lon=lon, sog=sog, cog=cog))
    out.sort(key=lambda p: p.ts)
    return out
