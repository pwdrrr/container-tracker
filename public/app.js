/* Container-Tracker Frontend.
 * Lädt public/data/positions.json, rendert Cards/Karte/Chart, refresht
 * sich alle 60 Sekunden client-seitig.
 */
const REFRESH_MS = 60_000;
const STALE_MIN = 90;          // ab so vielen Minuten wird der Status-Dot gelb
const KMH_PER_KNOT = 1.852;

const els = {
  title:    document.getElementById("title"),
  updated:  document.getElementById("updated"),
  dot:      document.getElementById("status-dot"),
  reload:   document.getElementById("reload"),
  refresh:  document.getElementById("refresh"),
  cards:    document.getElementById("cards"),
  map:      document.getElementById("map"),
  chart:    document.getElementById("km-chart"),
  err:      document.getElementById("error"),
  speed:    document.getElementById("show-speed"),
};

let leafletMap = null;
let layerGroup = null;
let kmChart = null;
let lastData = null;
let showSpeed = false;

// --------------------------------------------------------------- Map

function initMap() {
  leafletMap = L.map("map", { worldCopyJump: true }).setView([30, 10], 3);
  L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
    attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
    maxZoom: 18,
  }).addTo(leafletMap);
  layerGroup = L.layerGroup().addTo(leafletMap);
}

function splitAntimeridian(points) {
  // Zerteilt einen Pfad in Segmente, falls er den 180°-Meridian überquert.
  if (points.length < 2) return [points];
  const segs = [[points[0]]];
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1], curr = points[i];
    if (Math.abs(curr[1] - prev[1]) > 180) {
      segs.push([curr]);
    } else {
      segs[segs.length - 1].push(curr);
    }
  }
  return segs;
}

function renderMap(data) {
  if (!leafletMap) initMap();
  layerGroup.clearLayers();
  const bounds = [];
  for (const ship of data.ships || []) {
    const pts = (ship.track || []).map(r => [r[1], r[2]]);
    for (const seg of splitAntimeridian(pts)) {
      if (seg.length >= 2) {
        L.polyline(seg, { color: ship.color, weight: 3, opacity: 0.85 }).addTo(layerGroup);
      }
    }
    // Wegpunkte als kleine Kreise
    for (const r of (ship.track || [])) {
      L.circleMarker([r[1], r[2]], {
        radius: 2, color: ship.color, fillOpacity: 0.7, weight: 1,
      })
        .bindPopup(`<b>${escapeHtml(ship.name)}</b><br>${fmtTs(r[0])}<br>${r[1].toFixed(4)}°, ${r[2].toFixed(4)}°` +
                   (r[3] != null ? `<br>${r[3].toFixed(1)} kn (${(r[3]*KMH_PER_KNOT).toFixed(1)} km/h)` : ""))
        .addTo(layerGroup);
    }
    // letzter Punkt als grosser Marker
    const last = ship.last_position;
    if (last) {
      L.circleMarker([last.lat, last.lon], {
        radius: 9, color: "#fff", fillColor: ship.color,
        fillOpacity: 1, weight: 2,
      })
        .bindTooltip(ship.name, { permanent: false })
        .bindPopup(buildPopup(ship))
        .addTo(layerGroup);
      bounds.push([last.lat, last.lon]);
    }
  }
  if (bounds.length === 1) {
    leafletMap.setView(bounds[0], 5);
  } else if (bounds.length >= 2) {
    leafletMap.fitBounds(bounds, { padding: [40, 40], maxZoom: 6 });
  }
}

function buildPopup(ship) {
  const last = ship.last_position;
  const kmh = last.sog_kmh != null ? last.sog_kmh : (last.sog_kn != null ? (last.sog_kn * KMH_PER_KNOT).toFixed(1) : null);
  const lines = [
    `<b>${escapeHtml(ship.name)}</b>`,
    `${last.lat.toFixed(4)}°, ${last.lon.toFixed(4)}°`,
    `Stand: ${fmtTs(last.ts)}`,
  ];
  if (last.sog_kn != null) lines.push(`Geschw.: ${last.sog_kn.toFixed(1)} kn (${kmh} km/h)`);
  if (last.cog != null) lines.push(`Kurs: ${Math.round(last.cog)}°`);
  if (ship.destination_label || ship.destination) lines.push(`Ziel: ${escapeHtml(ship.destination_label || ship.destination)}`);
  if (ship.eta_ts) lines.push(`ETA: ${fmtTs(ship.eta_ts)} ${etaRest(ship.eta_ts)}`);
  lines.push(`Strecke gesamt: <b>${fmtKm(ship.total_km)}</b>`);
  return lines.join("<br>");
}

// --------------------------------------------------------------- Cards

function renderCards(data) {
  const html = (data.ships || []).map(ship => {
    const last = ship.last_position;
    const kmh = last && last.sog_kmh != null ? last.sog_kmh
              : last && last.sog_kn != null ? (last.sog_kn * KMH_PER_KNOT).toFixed(1)
              : null;
    const dest = ship.destination_label || ship.destination || "–";
    let etaTxt = "–", etaRestTxt = "", etaClass = "";
    if (ship.eta_ts) {
      etaTxt = fmtTs(ship.eta_ts);
      const rest = etaRest(ship.eta_ts, true);
      etaRestTxt = rest.text;
      etaClass = rest.overdue ? "overdue" : "";
    }
    const posTxt = last ? `${last.lat.toFixed(3)}°, ${last.lon.toFixed(3)}°` : "–";
    return `
      <div class="card" style="border-left-color:${ship.color}">
        <h3>${escapeHtml(ship.name)} <span class="type">${escapeHtml(ship.ship_type || "")}</span></h3>
        <dl>
          <dt>Position</dt><dd>${posTxt}</dd>
          <dt>Geschw.</dt><dd>${last && last.sog_kn != null ? `<span class="big">${kmh}</span> km/h <span style="color:var(--fg-dim)">(${last.sog_kn.toFixed(1)} kn)</span>` : "–"}</dd>
          <dt>Kurs</dt><dd>${last && last.cog != null ? `${Math.round(last.cog)}°` : "–"}</dd>
          <dt>Ziel</dt><dd>${escapeHtml(dest)}</dd>
          <dt>ETA</dt><dd>${etaTxt} <span class="eta-rest ${etaClass}">${etaRestTxt}</span></dd>
          <dt>Strecke</dt><dd>${fmtKm(ship.total_km)} (${ship.track_points || 0} Punkte)</dd>
          <dt>Stand</dt><dd>${last ? fmtTs(last.ts) : "–"}</dd>
        </dl>
      </div>
    `;
  }).join("");
  els.cards.innerHTML = html || `<div class="card"><em>Noch keine Daten — der erste GitHub-Action-Lauf füllt sie.</em></div>`;
}

// --------------------------------------------------------------- Chart

function cumulativeKm(track) {
  // Liefert [{x: msEpoch, y: kmCumulative, kmh}]
  const out = [];
  let total = 0;
  for (let i = 0; i < track.length; i++) {
    const r = track[i];
    if (i > 0) {
      const p = track[i - 1];
      total += haversineKm(p[1], p[2], r[1], r[2]);
    }
    out.push({
      x: r[0] * 1000,
      y: total,
      kmh: r[3] != null ? r[3] * KMH_PER_KNOT : null,
    });
  }
  return out;
}

function renderChart(data) {
  const datasets = (data.ships || []).map(ship => ({
    label: `${ship.name} (${fmtKm(ship.total_km)})`,
    data: cumulativeKm(ship.track || []),
    borderColor: ship.color,
    backgroundColor: ship.color + "33",
    pointRadius: 1.5,
    pointHoverRadius: 4,
    borderWidth: 2,
    tension: 0.1,
    parsing: false,
  }));

  if (kmChart) kmChart.destroy();
  const ctx = els.chart.getContext("2d");
  const isDark = matchMedia("(prefers-color-scheme: dark)").matches;
  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const tickColor = isDark ? "#8d96a0" : "#5b6471";

  kmChart = new Chart(ctx, {
    type: "line",
    data: { datasets },
    options: {
      maintainAspectRatio: false,
      animation: false,
      interaction: { mode: "nearest", intersect: false },
      plugins: {
        legend: { labels: { color: tickColor } },
        tooltip: {
          callbacks: {
            label: (ctx) => {
              const km = ctx.parsed.y.toFixed(1);
              const kmh = ctx.raw.kmh;
              return `${ctx.dataset.label.split(" (")[0]}: ${km} km` + (kmh != null ? `  ·  ${kmh.toFixed(1)} km/h` : "");
            },
          },
        },
        speedLabels: { enabled: showSpeed },
      },
      scales: {
        x: {
          type: "time",
          time: { tooltipFormat: "yyyy-MM-dd HH:mm 'UTC'" },
          adapters: { date: { zone: "UTC" } },
          ticks: { color: tickColor },
          grid:  { color: gridColor },
          title: { display: true, text: "Datum (UTC)", color: tickColor },
        },
        y: {
          beginAtZero: true,
          ticks: { color: tickColor, callback: v => `${v.toLocaleString("de-CH")} km` },
          grid:  { color: gridColor },
          title: { display: true, text: "Kumulierte Strecke", color: tickColor },
        },
      },
    },
    plugins: [speedLabelPlugin],
  });
}

// Chart.js Plugin: schreibt km/h neben jeden Datenpunkt, wenn Toggle aktiv.
const speedLabelPlugin = {
  id: "speedLabels",
  afterDatasetsDraw(chart, _args, opts) {
    if (!opts || !opts.enabled) return;
    const { ctx } = chart;
    ctx.save();
    ctx.font = "9px -apple-system, sans-serif";
    ctx.textBaseline = "bottom";
    for (const meta of chart._metasets) {
      const ds = meta._dataset;
      ctx.fillStyle = ds.borderColor;
      for (let i = 0; i < meta.data.length; i++) {
        const el = meta.data[i];
        const raw = ds.data[i];
        if (raw.kmh == null || !el) continue;
        ctx.fillText(`${Math.round(raw.kmh)}`, el.x + 2, el.y - 4);
      }
    }
    ctx.restore();
  },
};

// --------------------------------------------------------------- Helpers

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371.0088;
  const toRad = d => d * Math.PI / 180;
  const dlat = toRad(lat2 - lat1);
  const dlon = toRad(lon2 - lon1);
  const a = Math.sin(dlat/2)**2 + Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dlon/2)**2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(a)));
}

function fmtTs(unixSec) {
  if (!unixSec) return "–";
  return new Date(unixSec * 1000).toISOString().slice(0, 16).replace("T", " ") + " UTC";
}

function fmtKm(km) {
  if (km == null) return "–";
  return `${Math.round(km).toLocaleString("de-CH")} km`;
}

function etaRest(unixSec, asObject = false) {
  const diff = unixSec * 1000 - Date.now();
  if (diff <= 0) {
    return asObject ? { text: "(überfällig)", overdue: true } : "(überfällig)";
  }
  const h = Math.floor(diff / 3_600_000);
  const d = Math.floor(h / 24);
  const text = d > 0 ? `(in ${d}d ${h % 24}h)` : `(in ${h}h)`;
  return asObject ? { text, overdue: false } : text;
}

function escapeHtml(s) {
  return (s ?? "").toString()
    .replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function updateHeader(data) {
  if (data.title) els.title.textContent = data.title;
  if (!data.updated_at) {
    els.updated.textContent = "Noch keine Daten";
    els.dot.className = "dot err";
    return;
  }
  const d = new Date(data.updated_at);
  els.updated.textContent = "aktualisiert " + d.toLocaleString("de-CH", {
    dateStyle: "short", timeStyle: "short",
  });
  const ageMin = (Date.now() - d.getTime()) / 60000;
  els.dot.className = "dot" + (ageMin > STALE_MIN ? " stale" : "");
  els.dot.title = `${Math.round(ageMin)} min alt`;
}

// --------------------------------------------------------------- Load

async function loadData() {
  els.err.hidden = true;
  try {
    const url = `data/positions.json?t=${Date.now()}`;
    const r = await fetch(url, { cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    const data = await r.json();
    lastData = data;
    updateHeader(data);
    renderCards(data);
    renderMap(data);
    renderChart(data);
    if (data.errors && data.errors.length) {
      els.err.hidden = false;
      els.err.textContent = "Letzter Lauf hatte Probleme: " + data.errors.join(" · ");
    }
  } catch (exc) {
    els.err.hidden = false;
    els.err.textContent = `Fehler beim Laden: ${exc.message}`;
    els.dot.className = "dot err";
  }
}

els.reload.addEventListener("click", loadData);
els.speed.addEventListener("change", e => {
  showSpeed = e.target.checked;
  if (lastData) renderChart(lastData);
});

els.refresh.addEventListener("click", triggerFreshFetch);

// ----- Manueller Trigger via Netlify-Function -----

async function triggerFreshFetch() {
  const btn = els.refresh;
  const originalLabel = btn.textContent;
  setRefreshState("loading", "⏳ Lauf gestartet …");

  let dispatched = false;
  try {
    const r = await fetch("/api/refresh", { method: "POST" });
    const data = await r.json().catch(() => ({}));
    if (r.status === 429) {
      setRefreshState("err", `Cooldown — ${data.retry_in_s || 60}s warten`);
      restoreLater(btn, originalLabel, 5_000);
      return;
    }
    if (!r.ok) {
      console.error("refresh fehlgeschlagen", data);
      setRefreshState("err", "Fehler — siehe Konsole");
      restoreLater(btn, originalLabel, 6_000);
      return;
    }
    dispatched = true;
  } catch (e) {
    setRefreshState("err", "Netzwerk-Fehler");
    restoreLater(btn, originalLabel, 6_000);
    return;
  }

  // Workflow-Lauf dauert typisch ~60-90s. Wir pollen positions.json
  // alle 5s und vergleichen updated_at. Bei neuerem Wert → fertig.
  const baseline = lastData?.updated_at || "";
  const start = Date.now();
  const timeoutMs = 180_000; // 3 min Geduld

  while (Date.now() - start < timeoutMs) {
    const secs = Math.floor((Date.now() - start) / 1000);
    setRefreshState("loading", `⏳ läuft … (${secs}s)`);
    await sleep(5_000);
    try {
      const r = await fetch(`data/positions.json?probe=${Date.now()}`, { cache: "no-store" });
      if (!r.ok) continue;
      const d = await r.json();
      if (d.updated_at && d.updated_at > baseline) {
        // Neue Daten — komplettes Re-Render
        lastData = d;
        updateHeader(d);
        renderCards(d);
        renderMap(d);
        renderChart(d);
        setRefreshState("success", "✓ Frisch geholt");
        restoreLater(btn, originalLabel, 4_000);
        return;
      }
    } catch (e) { /* ignore, retry */ }
  }

  setRefreshState("err", "Timeout — später erneut versuchen");
  restoreLater(btn, originalLabel, 6_000);
}

function setRefreshState(stateClass, label) {
  els.refresh.disabled = true;
  els.refresh.className = stateClass;
  els.refresh.textContent = label;
}

function restoreLater(btn, label, ms) {
  setTimeout(() => {
    btn.disabled = false;
    btn.className = "";
    btn.textContent = label;
  }, ms);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

loadData();
setInterval(loadData, REFRESH_MS);
