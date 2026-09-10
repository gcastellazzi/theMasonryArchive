#!/usr/bin/env python3
"""Porta una cartella di foto esportate da Foto dentro l'archivio.

Per ogni immagine la pipeline:

  1. legge coordinate, quota, direzione di ripresa e data (sidecar XMP o EXIF);
  2. risolve il toponimo con la geocodifica inversa di OpenStreetMap;
  3. genera tre derivate WebP ripulite dei metadati — 1600 px per la scheda,
     480 px per mappa ed elenchi, 160 px per il rullino dell'amministratore;
  4. aggiorna `src/data/records.json`.

Il punto 4 e' una fusione, non una riscrittura: i campi descrittivi che
l'amministratore ha compilato a mano (titolo, epoca, tecnica, elemento,
materiale, tag, note, stato) vengono conservati. Rieseguire l'ingest dopo aver
aggiunto foto nuove non cancella il lavoro di catalogazione gia' fatto.

Le proposte degli utenti vivono in `src/data/suggestions.json` e questo script
non le tocca mai.

Uso tipico:

    python3 tools/ingest_photos.py --source ~/Downloads/Masonry_photos

Richiede ImageMagick (`brew install imagemagick`), che legge l'HEIC dell'iPhone.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import re
import subprocess
import sys
import time
import unicodedata
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from photo_meta import IMAGE_SUFFIXES, PhotoMeta, read_photo  # noqa: E402

ROOT = Path(__file__).resolve().parent.parent
RECORDS = ROOT / "src" / "data" / "records.json"
IMAGES = ROOT / "public" / "images"
GEOCACHE = Path(__file__).resolve().parent / ".geocache.json"

# Derivate pubbliche: nome, lato lungo, qualita' WebP.
DERIVATIVES = [
    ("detail", 1600, 75),
    ("card", 480, 78),
    ("strip", 160, 70),
]

# Campi scritti dall'amministratore o dalle proposte approvate: la fusione li
# conserva sempre, anche quando la foto viene rielaborata.
CURATED_FIELDS = (
    "title",
    "period",
    "technique",
    "element",
    "material",
    "tags",
    "notes",
    "status",
    "hasAlotiaJson",
    "alotiaJsonUrl",
    "license",
)

NOMINATIM = "https://nominatim.openstreetmap.org/reverse"
USER_AGENT = "theMasonryArchive/0.1 (https://github.com/gcastellazzi/theMasonryArchive)"
# Nominatim ammette al massimo una richiesta al secondo.
GEOCODE_INTERVAL = 1.1


def slugify(value: str) -> str:
    value = unicodedata.normalize("NFKD", value).encode("ascii", "ignore").decode()
    value = re.sub(r"[^a-zA-Z0-9]+", "-", value).strip("-").lower()
    return value or "unknown"


def source_hash(path: Path) -> str:
    """Impronta del file, per riconoscere la stessa foto a ogni riesecuzione."""
    digest = hashlib.sha1()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def load_json(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        sys.exit(f"{path} non e' JSON valido: {error}")


def write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")


class Geocoder:
    """Geocodifica inversa con cache su disco e rispetto del rate limit."""

    def __init__(self, enabled: bool) -> None:
        self.enabled = enabled
        self.cache: dict[str, dict[str, str]] = load_json(GEOCACHE, {})
        self.last_call = 0.0
        self.calls = 0

    def lookup(self, lat: float, lng: float) -> dict[str, str]:
        # ~11 m di risoluzione: scatti dello stesso muro condividono la voce.
        key = f"{lat:.4f},{lng:.4f}"
        if key in self.cache:
            return self.cache[key]
        if not self.enabled:
            return {}

        wait = GEOCODE_INTERVAL - (time.monotonic() - self.last_call)
        if wait > 0:
            time.sleep(wait)

        query = urllib.parse.urlencode(
            {"lat": lat, "lon": lng, "format": "json", "zoom": 16, "accept-language": "en"}
        )
        request = urllib.request.Request(f"{NOMINATIM}?{query}", headers={"User-Agent": USER_AGENT})
        try:
            with urllib.request.urlopen(request, timeout=30) as response:
                payload = json.loads(response.read().decode("utf-8"))
        except Exception as error:  # rete assente, rate limit, servizio giu'
            print(f"    geocodifica non riuscita ({error}); toponimo lasciato vuoto")
            return {}
        finally:
            self.last_call = time.monotonic()

        address = payload.get("address", {})
        place = {
            "location": (
                address.get("city")
                or address.get("town")
                or address.get("village")
                or address.get("hamlet")
                or address.get("municipality")
                or ""
            ),
            "county": address.get("county", ""),
            "state": address.get("state", ""),
            "country": address.get("country", ""),
            "countryCode": (address.get("country_code") or "").upper(),
        }
        self.cache[key] = place
        self.calls += 1
        # Salvataggio immediato: una geocodifica costa oltre un secondo, e
        # un'interruzione a meta' non deve buttare via il lavoro gia' fatto.
        self.save()
        return place

    def save(self) -> None:
        if self.cache:
            write_json(GEOCACHE, self.cache)


def make_derivatives(image: Path, record_id: str, images_dir: Path, force: bool) -> dict[str, str]:
    """Genera le tre derivate WebP, senza metadati incorporati."""
    images_dir.mkdir(parents=True, exist_ok=True)
    paths: dict[str, str] = {}

    todo = []
    for name, edge, quality in DERIVATIVES:
        target = images_dir / f"{record_id}_{edge}.webp"
        paths[name] = f"images/{target.name}"
        if not (target.exists() and not force):
            todo.append((edge, quality, target))

    if not todo:
        return paths

    # Un solo processo per foto: l'HEIC viene decodificato una volta e ogni
    # taglia esce da un clone dell'immagine gia' in memoria. Tre invocazioni
    # separate rileggevano da capo un file da 4-5 MB ciascuna.
    command = ["magick", str(image), "-auto-orient", "-strip"]
    for edge, quality, target in todo[:-1]:
        command += [
            "(", "+clone",
            "-resize", f"{edge}x{edge}>",
            "-quality", str(quality),
            "-write", str(target),
            "+delete", ")",
        ]
    edge, quality, target = todo[-1]
    command += ["-resize", f"{edge}x{edge}>", "-quality", str(quality), str(target)]

    subprocess.run(command, check=True, capture_output=True)
    return paths


def blank_record(record_id: str, meta: PhotoMeta, place: dict[str, str], digest: str) -> dict[str, Any]:
    """Record nuovo: campi automatici compilati, campi di merito vuoti."""
    return {
        "id": record_id,
        # --- da compilare in fase di catalogazione ---
        "title": "",
        "period": "",
        "technique": "",
        "element": "",
        "material": "",
        "tags": [],
        "notes": "",
        "status": "pending",
        "hasAlotiaJson": False,
        "alotiaJsonUrl": "",
        "license": "CC BY 4.0",
        # --- ricavati dai metadati di scatto ---
        "location": place.get("location", ""),
        "county": place.get("county", ""),
        "state": place.get("state", ""),
        "country": place.get("country", ""),
        "countryCode": place.get("countryCode", ""),
        "lat": meta.lat,
        "lng": meta.lng,
        "altitude": round(meta.altitude) if meta.altitude is not None else None,
        "bearing": round(meta.bearing, 1) if meta.bearing is not None else None,
        "capturedAt": meta.captured_at,
        "camera": meta.camera,
        "width": meta.width,
        "height": meta.height,
        "author": "",
        "affiliation": "",
        # --- gestiti dalla pipeline ---
        "image": "",
        "thumbnail": "",
        "strip": "",
        "sourceFile": meta.source.name,
        "sourceHash": digest,
    }


def ingest(args: argparse.Namespace) -> int:
    source = Path(args.source).expanduser()
    if not source.is_dir():
        sys.exit(f"cartella non trovata: {source}")

    images_dir = Path(args.images_dir).expanduser()
    records_path = Path(args.records).expanduser()

    existing = load_json(records_path, [])
    by_hash = {record.get("sourceHash"): record for record in existing if record.get("sourceHash")}
    used_ids = {record["id"] for record in existing}

    photos = sorted(p for p in source.rglob("*") if p.suffix.lower() in IMAGE_SUFFIXES)
    if not photos:
        sys.exit(f"nessuna immagine in {source}")

    print(f"{len(photos)} immagini in {source}")
    geocoder = Geocoder(enabled=not args.no_geocode)

    added, updated, without_position = 0, 0, []
    result: list[dict[str, Any]] = list(existing)

    for photo in photos:
        meta = read_photo(photo)
        digest = source_hash(photo)
        record = by_hash.get(digest)
        is_new = record is None

        place = geocoder.lookup(meta.lat, meta.lng) if meta.has_position else {}
        if not meta.has_position:
            without_position.append(photo.name)

        if is_new:
            base = slugify(place.get("location") or "unlocated")
            record_id = f"{base}-{digest[:6]}"
            while record_id in used_ids:
                record_id = f"{base}-{digest[:8]}"
            used_ids.add(record_id)
            record = blank_record(record_id, meta, place, digest)
            result.append(record)
            added += 1
        else:
            # Campi automatici rinfrescati, campi curati intoccati.
            curated = {key: record[key] for key in CURATED_FIELDS if key in record}
            refreshed = blank_record(record["id"], meta, place, digest)
            refreshed.update(curated)
            refreshed["author"] = record.get("author", "")
            refreshed["affiliation"] = record.get("affiliation", "")
            result[result.index(record)] = refreshed
            record = refreshed
            updated += 1

        if args.author:
            record["author"] = record.get("author") or args.author
        if args.affiliation:
            record["affiliation"] = record.get("affiliation") or args.affiliation

        if not args.dry_run:
            paths = make_derivatives(photo, record["id"], images_dir, args.force)
            record["image"] = paths["detail"]
            record["thumbnail"] = paths["card"]
            record["strip"] = paths["strip"]

        marker = "nuova" if is_new else "aggiornata"
        where = record["location"] or "posizione sconosciuta"
        print(f"  [{marker:>11}] {photo.name} -> {record['id']} · {where}", flush=True)

        # Su cartelle grandi l'import dura decine di minuti: salvare a blocchi
        # fa si' che un'interruzione costi al massimo gli ultimi venti scatti.
        if not args.dry_run and (added + updated) % 20 == 0:
            write_json(records_path, result)

    result.sort(key=lambda r: (r.get("capturedAt") or "", r["id"]), reverse=True)

    if args.dry_run:
        print("\n(dry run: nessun file scritto)")
    else:
        write_json(records_path, result)
        geocoder.save()

    pending = sum(1 for r in result if r.get("status") == "pending")
    untagged = sum(1 for r in result if not r.get("tags"))
    print(
        f"\n{len(result)} record in archivio — {added} nuovi, {updated} aggiornati\n"
        f"  da moderare:      {pending}\n"
        f"  senza tag:        {untagged}\n"
        f"  chiamate geocode: {geocoder.calls} (le altre dalla cache)"
    )
    if without_position:
        print(f"\n  ATTENZIONE — {len(without_position)} senza coordinate, non compariranno sulla mappa:")
        for name in without_position[:10]:
            print(f"    {name}")
        if len(without_position) > 10:
            print(f"    ... e altre {len(without_position) - 10}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--source", required=True, help="cartella con le foto esportate da Foto")
    parser.add_argument("--records", default=str(RECORDS), help="file JSON dei record")
    parser.add_argument("--images-dir", default=str(IMAGES), help="cartella di destinazione delle derivate")
    parser.add_argument("--author", default="", help="autore da attribuire ai record nuovi")
    parser.add_argument("--affiliation", default="", help="affiliazione da attribuire ai record nuovi")
    parser.add_argument("--force", action="store_true", help="rigenera le derivate anche se esistono")
    parser.add_argument("--no-geocode", action="store_true", help="non interrogare OpenStreetMap")
    parser.add_argument("--dry-run", action="store_true", help="mostra cosa farebbe senza scrivere")
    return ingest(parser.parse_args())


if __name__ == "__main__":
    raise SystemExit(main())
