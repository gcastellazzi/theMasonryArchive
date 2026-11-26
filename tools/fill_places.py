#!/usr/bin/env python3
"""Compila localita', provincia, regione e paese dei record che hanno le coordinate ma non i nomi.

Succede alle foto posizionate a mano nel pannello o arrivate dal bot con il luogo
scritto a parole: l'ingest geocodifica solo le coordinate che trova nella foto.
Senza paese la mappa e i filtri le perdono. Stessa geocodifica inversa (e stessa
cache) di ingest_photos.py; si scrivono solo i campi vuoti.

    python3 tools/fill_places.py [--dry-run]
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from ingest_photos import RECORDS, Geocoder  # noqa: E402

FIELDS = ("location", "county", "state", "country", "countryCode")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--dry-run", action="store_true", help="mostra senza scrivere")
    args = parser.parse_args()

    records = json.loads(RECORDS.read_text(encoding="utf-8"))
    todo = [r for r in records if r.get("lat") is not None and r.get("lng") is not None
            and not (r.get("country") and r.get("location"))]
    if not todo:
        print("Nessun record da completare.")
        return 0

    geocoder = Geocoder(enabled=True)
    filled = 0
    for record in todo:
        place = geocoder.lookup(record["lat"], record["lng"])
        changes = {k: place[k] for k in FIELDS if place.get(k) and not record.get(k)}
        if not changes:
            print(f"  {record['id']}: nessun nome trovato per {record['lat']:.5f},{record['lng']:.5f}")
            continue
        record.update(changes)
        filled += 1
        print(f"  {record['id']}: {changes.get('location') or record.get('location')}, {changes.get('country') or record.get('country')}")

    if args.dry_run:
        print(f"\n{filled} record da completare su {len(todo)} (dry run: nessun file scritto)")
        return 0
    RECORDS.write_text(json.dumps(records, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    geocoder.save()
    print(f"\n{filled} record completati su {len(todo)}.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
