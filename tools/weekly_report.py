#!/usr/bin/env python3
"""Resoconto per l'amministratore: cosa e' successo negli ultimi giorni e cosa resta da fare.

Legge la coda dei contributi (incoming/) e l'archivio (src/data/records.json) e
produce tre cose:

- un riepilogo testuale per Telegram, con i comandi da toccare;
- un'immagine PNG (numeri, mappa del mondo, foto ricevute per giorno) che
  Telegram mostra direttamente in chat;
- una pagina HTML autonoma con gli stessi grafici e l'elenco completo
  (contributi, persone, richieste), da aprire nel browser.

I file finiscono in incoming/reports/, fuori dal repository: contengono nomi
dei contributori.

    python3 tools/weekly_report.py [--days 7] [--telegram]

Con --telegram stampa il riepilogo con i tag MEDIA: che il bot (o il cron)
trasforma in allegati.
"""

from __future__ import annotations

import argparse
import html
import json
import math
import subprocess
import sys
from collections import Counter
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
import intake_queue as q  # noqa: E402

ROOT = Path(__file__).resolve().parents[1]
LAND = Path(__file__).resolve().parent / "data" / "land-110m.json"
OUT = q.INCOMING / "reports"
MAGICK = [str(Path.home() / ".local/bin/magick"), "magick", "convert"]

# Colori fissi per il PNG; la pagina HTML li ridefinisce per il tema scuro.
INK, MUTED, LINE, LAND_FILL, SEA = "#1c1917", "#78716c", "#d6d3d1", "#e7e5e4", "#fafaf9"
ACCENT, ARCHIVE_DOT = "#c2410c", "#57534e"
FONT = "DejaVu Sans"

STATUS_IT = {"pending": "da moderare", "accepted": "accettata", "rejected": "rifiutata", "ingested": "in archivio"}
NOTIFY_IT = {"accepted": "che la foto e' stata accettata", "rejected": "che la foto non e' stata accettata",
             "ingested": "che la foto e' entrata nell'archivio"}


def parse_time(value: str | None) -> datetime | None:
    if not value:
        return None
    try:
        moment = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    return moment if moment.tzinfo else moment.replace(tzinfo=timezone.utc)


def person_name(person: dict[str, Any] | None) -> str:
    if not person:
        return "contributore cancellato"
    name = f"{person.get('firstName', '')} {person.get('lastName', '')}".strip()
    return name or (person.get("telegramUsername") or "senza nome")


# --------------------------------------------------------------------------
# Dati


def collect(days: int) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    since = now - timedelta(days=days)

    def recent(value: str | None) -> bool:
        moment = parse_time(value)
        return bool(moment and moment >= since)

    submissions = q.load_submissions()
    contributors = q.load_contributors()
    requests = q.load_requests()
    changes = q.load_changes()
    deletions = q._load(q.INCOMING / "deletions.json", [])
    records = q._load(q.RECORDS, [])
    by_record = {r["id"]: r for r in records}

    def who(entry: dict[str, Any]) -> str:
        return person_name(contributors.get(entry.get("contributorId") or entry.get("userId") or ""))

    def position(entry: dict[str, Any]) -> tuple[float, float] | None:
        if entry.get("lat") is not None and entry.get("lng") is not None:
            return entry["lat"], entry["lng"]
        record = by_record.get(entry.get("recordId") or "")
        if record and record.get("lat") is not None and record.get("lng") is not None:
            return record["lat"], record["lng"]
        return None

    received = [s for s in submissions if recent(s["createdAt"])]
    reviewed = [s for s in submissions if recent(s.get("reviewedAt"))]

    # Cosa resta da fare, con nomi e motivi: il digest del mattino dice solo quanti.
    todo: list[dict[str, str]] = []
    for s in submissions:
        if s["status"] == "pending":
            todo.append({"kind": "moderare", "text": f"«{s['originalName']}» di {who(s)}, arrivata il {s['createdAt'][:10]}",
                         "command": "/coda"})
    for s in submissions:
        if s["status"] == "accepted":
            todo.append({"kind": "archiviare", "text": f"«{s['originalName']}» di {who(s)}, accettata il {(s.get('reviewedAt') or '')[:10]}",
                         "command": "/applica"})
    for s in q.pending_notifications(submissions):
        todo.append({"kind": "avvisare", "text": f"{who(s)}: dirgli {NOTIFY_IT.get(s['status'], s['status'])} "
                     f"(«{s['originalName']}»{', scheda ' + s['recordId'] if s.get('recordId') else ''})",
                     "command": "/avvisa"})
    for r in requests:
        if r["status"] == "pending":
            todo.append({"kind": "invito", "text": f"@{r.get('telegramUsername') or '—'} chiede di partecipare ({r['createdAt'][:10]})",
                         "command": "/richieste"})
    for c in changes:
        if c.get("status") == "open":
            todo.append({"kind": "modifica", "text": f"{who(c)} chiede: {c['request'][:120]}", "command": "/modifiche"})
    for d in deletions:
        if not d.get("handled"):
            todo.append({"kind": "cancellazione", "text": f"un contributore ha cancellato i suoi dati ({d['at'][:10]}); "
                         f"record gia' pubblicati: {', '.join(d.get('publishedRecords') or []) or 'nessuno'}",
                         "command": ""})
    waiting = Counter(who(s) for s in q.unannounced(submissions))
    if waiting:
        names = ", ".join(f"{name} ({n})" for name, n in waiting.most_common())
        todo.append({"kind": "link", "text": f"mandare il link alle foto gia' online a {names}", "command": "/avvisa"})
    approved_ids = {r["id"] for r in records if r.get("status") == "approved"}

    # Istogramma: almeno quattro settimane, perche' sette barre da sole dicono poco.
    span = max(days, 28)
    start_day = (now - timedelta(days=span - 1)).date()
    per_day = Counter(parse_time(s["createdAt"]).date() for s in submissions if parse_time(s["createdAt"]))
    histogram = [{"day": (start_day + timedelta(days=i)).isoformat(),
                  "count": per_day.get(start_day + timedelta(days=i), 0),
                  "inWindow": start_day + timedelta(days=i) >= since.date()} for i in range(span)]

    suggestions = q._load(ROOT / "src" / "data" / "suggestions.json", [])
    reviewable = {r["id"] for r in records if r.get("status") != "approved"}
    return {
        "generatedAt": now.isoformat(timespec="minutes"),
        "since": since.isoformat(timespec="minutes"),
        "days": days,
        "received": [{**s, "who": who(s), "pos": position(s)} for s in received],
        "reviewed": [{**s, "who": who(s)} for s in reviewed],
        "newContributors": [{"name": person_name(p), "role": p.get("role", ""), "affiliation": p.get("affiliation", ""),
                             "at": p["createdAt"]} for p in contributors.values() if recent(p.get("createdAt"))],
        "requests": [r for r in requests if recent(r["createdAt"]) or recent(r.get("decidedAt"))],
        "changes": [{**c, "who": who(c)} for c in changes if recent(c["createdAt"]) or c.get("status") == "open"],
        "todo": todo,
        "histogram": histogram,
        "archive": {
            "records": len(records),
            "approved": len(approved_ids),
            "countries": len({r["country"] for r in records if r.get("country")}),
            "withoutPosition": sum(1 for r in records if r.get("lat") is None),
            "contributors": len(contributors),
            "contributed": sum(1 for s in submissions if s.get("recordId")),
            "proposalsToReview": sum(1 for s in suggestions if s.get("status") == "pending" and s.get("recordId") in reviewable),
        },
        "archivePoints": [(r["lat"], r["lng"]) for r in records if r.get("lat") is not None and r.get("lng") is not None],
    }


# --------------------------------------------------------------------------
# Grafici (SVG scritto a mano: nessuna dipendenza da installare)


def land_paths() -> list[list[tuple[float, float]]]:
    """Anelli dei continenti (lng, lat) dal TopoJSON di Natural Earth 1:110m."""
    try:
        topo = json.loads(LAND.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return []
    sx, sy = topo["transform"]["scale"]
    tx, ty = topo["transform"]["translate"]
    arcs = []
    for arc in topo["arcs"]:
        x = y = 0
        points = []
        for dx, dy in arc:
            x, y = x + dx, y + dy
            points.append((x * sx + tx, y * sy + ty))
        arcs.append(points)

    def ring(indexes: list[int]) -> list[tuple[float, float]]:
        out: list[tuple[float, float]] = []
        for index in indexes:
            points = arcs[index] if index >= 0 else arcs[~index][::-1]
            out.extend(points[1:] if out else points)
        return out

    rings = []
    for geometry in topo["objects"]["land"]["geometries"]:
        polygons = geometry["arcs"] if geometry["type"] == "MultiPolygon" else [geometry["arcs"]]
        for polygon in polygons:
            rings.extend(ring(r) for r in polygon)
    return rings


LAT_TOP, LAT_BOTTOM = 84.0, -58.0  # senza Antartide: nessuna foto laggiu', e ruberebbe spazio
MAP_ASPECT = 2.2   # larghezza / altezza della mappa
MIN_SPAN = 40.0    # gradi di longitudine: sotto, la mappa diventa uno stradario


def map_view(points: list[tuple[float, float]]) -> tuple[float, float, float, float, float]:
    """Riquadro (ovest, est, sud, nord) attorno alle foto, con la stessa forma della mappa.

    Inquadra le foto invece del mondo intero: con un archivio quasi tutto
    mediterraneo il planisfero lascerebbe tutto in un puntino. Se le foto sono
    sparse, il riquadro diventa il mondo. Ritorna anche il fattore cos(lat)
    che corregge lo schiacciamento alle medie latitudini.
    """
    if not points:
        return -180.0, 180.0, LAT_BOTTOM, LAT_TOP, 1.0
    lats = [p[0] for p in points]
    lngs = [p[1] for p in points]
    south, north, west, east = min(lats), max(lats), min(lngs), max(lngs)
    mid = (south + north) / 2
    k = max(math.cos(math.radians(mid)), 0.35)
    lng_span = max((east - west) * 1.3, MIN_SPAN)
    lat_span = max((north - south) * 1.3, lng_span * k / MAP_ASPECT)
    lng_span = max(lng_span, lat_span * MAP_ASPECT / k)
    if lng_span >= 300 or lat_span >= (LAT_TOP - LAT_BOTTOM) * 0.9:
        return -180.0, 180.0, LAT_BOTTOM, LAT_TOP, 1.0
    cx, cy = (west + east) / 2, mid
    west, east = cx - lng_span / 2, cx + lng_span / 2
    south, north = cy - lat_span / 2, cy + lat_span / 2
    if north > LAT_TOP:
        south, north = south - (north - LAT_TOP), LAT_TOP
    if south < LAT_BOTTOM:
        south, north = LAT_BOTTOM, north + (LAT_BOTTOM - south)
    return west, east, south, north, k


def map_height(width: int, points: list[tuple[float, float]]) -> int:
    west, east, south, north, k = map_view(points)
    return round(width * (north - south) / ((east - west) * k))


def world_map(width: int, received: list[tuple[float, float]], archive: list[tuple[float, float]],
              themed: bool = False) -> str:
    west, east, south, north, k = map_view(received + archive)
    height = map_height(width, received + archive)
    scale = width / (east - west)

    def xy(lat: float, lng: float) -> tuple[float, float]:
        return (lng - west) * scale, (north - lat) * scale / k

    def attrs(cls: str, fill: str, extra: str = "") -> str:
        return f'class="{cls}"' if themed else f'fill="{fill}" {extra}'.strip()

    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" role="img" '
             f'aria-label="Mappa con le foto dell\'archivio">',
             f'<rect width="{width}" height="{height}" {attrs("sea", SEA)}/>']
    for ring_points in land_paths():
        if all(lat < LAT_BOTTOM for _, lat in ring_points):
            continue
        lngs = [lng for lng, _ in ring_points]
        lats = [lat for _, lat in ring_points]
        if max(lngs) - min(lngs) > 300 and max(lats) - min(lats) < 5:
            # Isolette tagliate male sull'antimeridiano (Fiji, Wrangel): nel
            # planisfero diventerebbero una riga da un bordo all'altro.
            continue
        if max(lngs) < west or min(lngs) > east or max(lats) < south or min(lats) > north:
            continue
        # Coordinate schiacciate sul bordo (con margine): fuori inquadratura l'Eurasia
        # finirebbe a decine di migliaia di pixel e il renderer di ImageMagick
        # invertirebbe terra e mare. Schiacciare asse per asse non cambia cio' che si vede.
        d = "M" + "L".join(f"{min(max(x, -10), width + 10):.1f},{min(max(y, -10), height + 10):.1f}"
                           for x, y in (xy(lat, lng) for lng, lat in ring_points)) + "Z"
        parts.append(f'<path d="{d}" {attrs("land", LAND_FILL)}/>')
    for lat, lng in archive:
        x, y = xy(lat, lng)
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{width / 320:.1f}" {attrs("dot", ARCHIVE_DOT, "fill-opacity=\"0.5\"")}/>')
    for lat, lng in received:
        x, y = xy(lat, lng)
        parts.append(f'<circle cx="{x:.1f}" cy="{y:.1f}" r="{width / 140:.1f}" {attrs("new", ACCENT, "stroke=\"#fff\" stroke-width=\"1.5\"")}/>')
    parts.append("</svg>")
    return "".join(parts)


def histogram_svg(width: int, bars: list[dict[str, Any]], themed: bool = False) -> str:
    height, top, bottom, left = 170, 16, 30, 30
    plot_h, plot_w = height - top - bottom, width - left - 8
    peak = max([b["count"] for b in bars] + [1])
    step = max(1, -(-peak // 4))
    ticks = list(range(0, peak + step, step))
    peak = ticks[-1]
    slot = plot_w / len(bars)

    def a(cls: str, fill: str) -> str:
        return f'class="{cls}"' if themed else f'fill="{fill}"'

    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {width} {height}" width="{width}" height="{height}" role="img" '
             f'aria-label="Foto ricevute per giorno" font-family="{FONT}" font-size="11">']
    for tick in ticks:
        y = top + plot_h - tick / peak * plot_h
        parts.append(f'<line x1="{left}" x2="{width - 8}" y1="{y:.1f}" y2="{y:.1f}" '
                     + ('class="grid"' if themed else f'stroke="{LINE}"') + ' stroke-width="1"/>')
        parts.append(f'<text x="{left - 6}" y="{y + 4:.1f}" text-anchor="end" {a("axis", MUTED)}>{tick}</text>')
    for i, bar in enumerate(bars):
        if bar["count"]:
            h = bar["count"] / peak * plot_h
            x = left + i * slot + slot * 0.15
            parts.append(f'<rect x="{x:.1f}" y="{top + plot_h - h:.1f}" width="{slot * 0.7:.1f}" height="{h:.1f}" rx="2" '
                         f'{a("bar-now" if bar["inWindow"] else "bar-old", ACCENT if bar["inWindow"] else "#a8a29e")}>'
                         f'<title>{bar["day"]}: {bar["count"]}</title></rect>')
        day = datetime.fromisoformat(bar["day"])
        if day.weekday() == 0 or i == len(bars) - 1:
            label = f"{day.day}/{day.month}"
            parts.append(f'<text x="{left + i * slot + slot / 2:.1f}" y="{height - 10}" text-anchor="middle" {a("axis", MUTED)}>{label}</text>')
    parts.append("</svg>")
    return "".join(parts)


def headline(data: dict[str, Any]) -> list[tuple[str, int]]:
    reviewed = Counter(s["status"] for s in data["reviewed"])
    return [
        ("foto ricevute", len(data["received"])),
        ("accettate", reviewed["accepted"] + reviewed["ingested"]),
        ("rifiutate", reviewed["rejected"]),
        ("nuovi contributori", len(data["newContributors"])),
        ("richieste d'invito", len(data["requests"])),
        ("da fare", len(data["todo"])),
    ]


def period_label(data: dict[str, Any]) -> str:
    since = parse_time(data["since"]).astimezone()
    until = parse_time(data["generatedAt"]).astimezone()
    return f"{since:%d/%m} – {until:%d/%m/%Y}"


def png_card(data: dict[str, Any], path: Path) -> Path | None:
    """Un'unica immagine da guardare in chat: numeri, mappa, istogramma."""
    width = 1000
    received_points = [s["pos"] for s in data["received"] if s["pos"]]
    map_svg = world_map(width - 48, received_points, data["archivePoints"])
    map_h = map_height(width - 48, received_points + data["archivePoints"])
    hist = histogram_svg(width - 48, data["histogram"])
    kpis = headline(data)
    tile_w = (width - 48) / len(kpis)
    total_h = 170 + map_h + 230
    # Prima la mappa, poi riquadri bianchi attorno: il renderer di ImageMagick
    # non ritaglia gli <svg> annidati e le terre fuori inquadratura sborderebbero.
    parts = [f'<svg xmlns="http://www.w3.org/2000/svg" width="{width}" height="{total_h}" font-family="{FONT}">',
             f'<rect width="100%" height="100%" fill="#fff"/>',
             f'<g transform="translate(24,164)">{map_svg}</g>',
             f'<rect x="0" y="0" width="{width}" height="164" fill="#fff"/>',
             f'<rect x="0" y="{164 + map_h}" width="{width}" height="{total_h - 164 - map_h}" fill="#fff"/>',
             f'<rect x="0" y="0" width="24" height="{total_h}" fill="#fff"/>',
             f'<rect x="{width - 24}" y="0" width="24" height="{total_h}" fill="#fff"/>',
             f'<text x="24" y="40" font-size="24" font-weight="bold" fill="{INK}">The Masonry Archive · ultimi {data["days"]} giorni</text>',
             f'<text x="24" y="64" font-size="14" fill="{MUTED}">{period_label(data)} · archivio: {data["archive"]["records"]} foto, '
             f'{data["archive"]["countries"]} paesi, {data["archive"]["contributors"]} contributori</text>']
    for i, (label, value) in enumerate(kpis):
        x = 24 + i * tile_w
        color = ACCENT if label == "da fare" and value else INK
        parts.append(f'<text x="{x:.0f}" y="118" font-size="34" font-weight="bold" fill="{color}">{value}</text>')
        parts.append(f'<text x="{x:.0f}" y="140" font-size="13" fill="{MUTED}">{label}</text>')
    legend_y = 164 + map_h + 24
    parts.append(f'<circle cx="32" cy="{legend_y - 4}" r="6" fill="{ACCENT}"/>'
                 f'<text x="44" y="{legend_y}" font-size="13" fill="{MUTED}">ricevute nel periodo ({len(received_points)} con posizione)</text>'
                 f'<circle cx="370" cy="{legend_y - 4}" r="3" fill="{ARCHIVE_DOT}"/>'
                 f'<text x="380" y="{legend_y}" font-size="13" fill="{MUTED}">gia\' in archivio</text>')
    parts.append(f'<text x="24" y="{legend_y + 34}" font-size="15" font-weight="bold" fill="{INK}">Foto ricevute per giorno</text>')
    parts.append(f'<g transform="translate(24,{legend_y + 44})">{hist}</g>')
    parts.append("</svg>")
    svg_path = path.with_suffix(".svg")
    svg_path.write_text("".join(parts), encoding="utf-8")
    for tool in MAGICK:
        try:
            result = subprocess.run([tool, "-density", "96", str(svg_path), str(path)], capture_output=True, timeout=120)
        except (OSError, subprocess.TimeoutExpired):
            continue
        if path.exists() and path.stat().st_size:
            svg_path.unlink(missing_ok=True)
            return path
        del result
    return None


# --------------------------------------------------------------------------
# Pagina HTML

CSS = """
:root{--ink:#1c1917;--muted:#78716c;--line:#e7e5e4;--bg:#fafaf9;--card:#fff;--accent:#c2410c;--land:#e7e5e4;--sea:#f5f5f4;--dot:#57534e;--old:#a8a29e}
@media (prefers-color-scheme:dark){:root{--ink:#f5f5f4;--muted:#a8a29e;--line:#3f3a36;--bg:#1c1917;--card:#292524;--accent:#fb923c;--land:#44403c;--sea:#292524;--dot:#d6d3d1;--old:#78716c}}
*{box-sizing:border-box}body{margin:0;background:var(--bg);color:var(--ink);font:15px/1.5 system-ui,-apple-system,"Segoe UI",sans-serif}
main{max-width:960px;margin:0 auto;padding:24px 16px 48px}h1{font-size:24px;margin:0}h2{font-size:17px;margin:32px 0 10px}
.sub{color:var(--muted);margin:2px 0 20px}.kpis{display:grid;grid-template-columns:repeat(auto-fit,minmax(130px,1fr));gap:10px}
.kpi{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:12px 14px}.kpi b{display:block;font-size:28px;line-height:1.1}
.kpi span{color:var(--muted);font-size:13px}.kpi.hot b{color:var(--accent)}
.card{background:var(--card);border:1px solid var(--line);border-radius:10px;padding:14px;overflow:hidden}.card svg{width:100%;height:auto;display:block}
.legend{color:var(--muted);font-size:13px;margin-top:8px}.legend i{display:inline-block;width:10px;height:10px;border-radius:50%;margin:0 6px 0 14px;vertical-align:-1px}
.legend i:first-child{margin-left:0}
svg .sea{fill:var(--sea)}svg .land{fill:var(--land)}svg .dot{fill:var(--dot);fill-opacity:.55}svg .new{fill:var(--accent);stroke:var(--card);stroke-width:1.5}
svg .grid{stroke:var(--line)}svg .axis{fill:var(--muted)}svg .bar-now{fill:var(--accent)}svg .bar-old{fill:var(--old)}
table{width:100%;border-collapse:collapse;font-size:14px}th,td{text-align:left;padding:7px 8px;border-bottom:1px solid var(--line);vertical-align:top}
th{color:var(--muted);font-weight:600;font-size:12px;text-transform:uppercase;letter-spacing:.03em}.wrap{overflow-x:auto}
.todo li{margin:6px 0}.tag{display:inline-block;font-size:12px;border:1px solid var(--line);border-radius:999px;padding:0 8px;margin-right:6px;color:var(--muted)}
code{font-size:13px;color:var(--accent)}.empty{color:var(--muted)}a{color:var(--accent)}
"""


def table(headers: list[str], rows: list[list[str]], empty: str) -> str:
    if not rows:
        return f'<p class="empty">{empty}</p>'
    head = "".join(f"<th>{h}</th>" for h in headers)
    body = "".join("<tr>" + "".join(f"<td>{cell}</td>" for cell in row) + "</tr>" for row in rows)
    return f'<div class="wrap"><table><thead><tr>{head}</tr></thead><tbody>{body}</tbody></table></div>'


def html_page(data: dict[str, Any]) -> str:
    e = html.escape
    received_points = [s["pos"] for s in data["received"] if s["pos"]]
    kpis = "".join(f'<div class="kpi{" hot" if label == "da fare" and value else ""}"><b>{value}</b><span>{label}</span></div>'
                   for label, value in headline(data))
    todo = ("<ul class=\"todo\">" + "".join(
        f'<li><span class="tag">{e(t["kind"])}</span>{e(t["text"])} {("<code>" + e(t["command"]) + "</code>") if t["command"] else ""}</li>'
        for t in data["todo"]) + "</ul>") if data["todo"] else '<p class="empty">Niente in sospeso.</p>'

    def link(record_id: str | None) -> str:
        return f'<a href="{e(q.record_url(record_id))}">{e(record_id)}</a>' if record_id else "—"

    received = table(["Arrivata", "Foto", "Da", "Luogo", "Stato"], [
        [e(s["createdAt"][:10]), e(s["originalName"]), e(s["who"]),
         e(f"{s['pos'][0]:.3f}, {s['pos'][1]:.3f}" if s["pos"] else (s.get("locationHint") or "senza posizione")),
         e(STATUS_IT.get(s["status"], s["status"])) + (" · " + link(s.get("recordId")) if s.get("recordId") else "")]
        for s in sorted(data["received"], key=lambda s: s["createdAt"], reverse=True)], "Nessuna foto ricevuta nel periodo.")
    reviewed = table(["Decisa", "Foto", "Di", "Esito", "Nota"], [
        [e((s.get("reviewedAt") or "")[:10]), e(s["originalName"]), e(s["who"]), e(STATUS_IT.get(s["status"], s["status"])),
         e(s.get("reviewNote") or "")]
        for s in sorted(data["reviewed"], key=lambda s: s.get("reviewedAt") or "", reverse=True)], "Nessuna decisione nel periodo.")
    people = table(["Registrato", "Nome", "Ruolo", "Ente"], [
        [e(p["at"][:10]), e(p["name"]), e(p["role"]), e(p["affiliation"])] for p in data["newContributors"]],
        "Nessun nuovo contributore.")
    requests = table(["Richiesta", "Utente", "Stato", "Testo"], [
        [e(r["createdAt"][:10]), "@" + e(r.get("telegramUsername") or "—"),
         e({"pending": "in attesa", "approved": "ammesso", "rejected": "respinto"}.get(r["status"], r["status"])), e(r["text"][:200])]
        for r in data["requests"]], "Nessuna richiesta d'invito nel periodo.")
    changes = table(["Data", "Da", "Foto", "Richiesta", "Stato"], [
        [e(c["createdAt"][:10]), e(c["who"]), link(c.get("recordId")), e(c["request"][:200]),
         e("aperta" if c.get("status") == "open" else "chiusa")] for c in data["changes"]], "Nessuna richiesta di modifica.")
    archive = data["archive"]
    return f"""<!doctype html><html lang="it"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Resoconto archivio</title><style>{CSS}</style></head>
<body><main>
<h1>The Masonry Archive · ultimi {data['days']} giorni</h1>
<p class="sub">{period_label(data)} · archivio: {archive['records']} foto ({archive['approved']} pubblicate), {archive['countries']} paesi,
{archive['contributors']} contributori, {archive['contributed']} foto arrivate dai contributori · {archive['proposalsToReview']} proposte da rivedere</p>
<div class="kpis">{kpis}</div>
<h2>Da fare</h2>{todo}
<h2>Dove sono le foto</h2>
<div class="card">{world_map(960, received_points, data['archivePoints'], themed=True)}
<div class="legend"><i style="background:var(--accent)"></i>ricevute nel periodo ({len(received_points)} con posizione)<i style="background:var(--dot)"></i>gia' in archivio</div></div>
<h2>Foto ricevute per giorno</h2>
<div class="card">{histogram_svg(960, data['histogram'], themed=True)}
<div class="legend"><i style="background:var(--accent)"></i>nel periodo<i style="background:var(--old)"></i>settimane precedenti</div></div>
<h2>Foto ricevute</h2>{received}
<h2>Decisioni</h2>{reviewed}
<h2>Nuovi contributori</h2>{people}
<h2>Richieste d'invito</h2>{requests}
<h2>Richieste di modifica</h2>{changes}
<p class="sub" style="margin-top:32px">Generato il {parse_time(data['generatedAt']).astimezone():%d/%m/%Y %H:%M} da tools/weekly_report.py</p>
</main></body></html>
"""


# --------------------------------------------------------------------------
# Testo per Telegram


def telegram_text(data: dict[str, Any]) -> str:
    lines = [f"📊 The Masonry Archive · ultimi {data['days']} giorni ({period_label(data)})", ""]
    lines += [f"{value:>4}  {label}" for label, value in headline(data)[:-1]]
    if data["todo"]:
        lines += ["", "Da fare:"]
        for item in data["todo"][:12]:
            lines.append(f"• {item['text']}" + (f" → {item['command']}" if item["command"] else ""))
        if len(data["todo"]) > 12:
            lines.append(f"… e altre {len(data['todo']) - 12} voci nella pagina allegata")
    else:
        lines += ["", "✅ Niente in sospeso."]
    return "\n".join(lines)


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--days", type=int, default=7, help="giorni da considerare (predefinito 7)")
    parser.add_argument("--telegram", action="store_true", help="riepilogo con allegati MEDIA: per il bot")
    args = parser.parse_args()
    days = min(max(args.days, 1), 365)

    data = collect(days)
    OUT.mkdir(parents=True, exist_ok=True)
    stamp = datetime.now().strftime("%Y-%m-%d")
    page = OUT / f"resoconto-{stamp}-{days}g.html"
    page.write_text(html_page(data), encoding="utf-8")
    image = png_card(data, OUT / f"resoconto-{stamp}-{days}g.png")

    print(telegram_text(data))
    if args.telegram:
        if image:
            print(f"MEDIA:{image}")
        print(f"MEDIA:{page}")
    else:
        print(f"\n{page}" + (f"\n{image}" if image else ""))
    return 0


if __name__ == "__main__":
    sys.exit(main())
