#!/usr/bin/env python3
"""Esegue le decisioni prese nella scheda Incoming del pannello.

    python3 tools/apply_submissions.py --dry-run
    python3 tools/apply_submissions.py

Una foto accettata passa dalla **stessa** pipeline delle altre: impronta del
file, metadati di scatto, geocodifica inversa, tre derivate WebP, record nuovo
in stato `pending`. Non c'e' un percorso privilegiato per i contributi esterni,
e non deve essercene uno — una foto di uno studente e una scattata dal curatore
diventano lo stesso tipo di record.

Entra come `pending`: l'accettazione del contributo e l'approvazione alla
pubblicazione sono due cancelli distinti, e il secondo si passa catalogando.

Una foto rifiutata lascia la sua impronta in `excluded.json`, come una
cancellazione dal pannello, cosi' un rinvio non la riporta dentro.
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from archive_api import ROOT, post_json  # noqa: E402
from ingest_photos import (  # noqa: E402
    EXCLUDED, IMAGES, RECORDS, Geocoder, attach_derivatives, blank_record,
    load_json, slugify, source_hash, write_json,
)
from photo_meta import read_photo  # noqa: E402

SUBMISSIONS = ROOT / "src" / "data" / "submissions.json"
PREVIEWS = ROOT / "public" / "incoming"


def now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def accept(
    submission: dict[str, Any],
    records: list[dict[str, Any]],
    used_ids: set[str],
    geocoder: Geocoder,
) -> dict[str, Any] | None:
    """Trasforma un contributo accettato in un record. `None` se non si puo'."""
    photo = ROOT / submission["localFile"]
    if not photo.exists():
        print(f"    file assente: {submission['localFile']} — riscarica con pull_submissions.py")
        return None

    digest = source_hash(photo)
    for record in records:
        if record.get("sourceHash") == digest:
            print(f"    gia' nell'archivio come {record['id']}")
            return record

    meta = read_photo(photo)

    # Le coordinate del modulo vincono su quelle del file: sono quelle che chi
    # ha scattato ha confermato o corretto guardando la foto, e quando l'upload
    # ha dovuto ridurre l'immagine l'EXIF non e' nemmeno sopravvissuto.
    if submission.get("lat") is not None and submission.get("lng") is not None:
        meta.lat = float(submission["lat"])
        meta.lng = float(submission["lng"])
    if not meta.captured_at and submission.get("capturedAt"):
        meta.captured_at = submission["capturedAt"]
    if not meta.camera and submission.get("camera"):
        meta.camera = submission["camera"]

    place = geocoder.lookup(meta.lat, meta.lng) if meta.has_position else {}

    base = slugify(place.get("location") or "unlocated")
    record_id = f"{base}-{digest[:6]}"
    length = 6
    while record_id in used_ids and length < len(digest):
        length += 2
        record_id = f"{base}-{digest[:length]}"
    used_ids.add(record_id)

    record = blank_record(record_id, meta, place, digest)

    contributor = submission.get("contributor", {})
    name = " ".join(
        part for part in (contributor.get("firstName"), contributor.get("lastName")) if part
    )
    record["author"] = name or contributor.get("email", "")
    record["affiliation"] = contributor.get("affiliation", "")
    # Le note di chi ha contribuito sono il punto di partenza della
    # catalogazione, non il risultato: restano finche' non le si riscrive.
    record["notes"] = submission.get("notes", "")
    record["sourceFile"] = submission.get("originalName", photo.name)

    attach_derivatives(record, photo, IMAGES)
    records.append(record)
    return record


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--dry-run", action="store_true", help="mostra cosa farebbe")
    parser.add_argument("--no-geocode", action="store_true", help="non interrogare OpenStreetMap")
    parser.add_argument(
        "--keep-files", action="store_true", help="non cancellare originali e anteprime"
    )
    args = parser.parse_args()

    if not SUBMISSIONS.exists():
        sys.exit("src/data/submissions.json non trovato: prima python3 tools/pull_submissions.py")

    submissions: list[dict[str, Any]] = json.loads(SUBMISSIONS.read_text(encoding="utf-8"))
    todo = [s for s in submissions if s.get("decision") and not s.get("appliedAt")]

    if not todo:
        undecided = sum(1 for s in submissions if not s.get("decision"))
        print(f"Nessuna decisione da applicare. {undecided} contributi ancora da guardare.")
        return 0

    accepted = [s for s in todo if s["decision"] == "accepted"]
    rejected = [s for s in todo if s["decision"] == "rejected"]
    print(f"{len(todo)} decisioni da applicare — {len(accepted)} accettati, {len(rejected)} rifiutati")

    if args.dry_run:
        for item in todo:
            who = item.get("contributor", {}).get("email", "?")
            print(f"  {item['decision']:8} {item['originalName']}  ({who})")
        print("\n--dry-run: niente scritto.")
        return 0

    records: list[dict[str, Any]] = load_json(RECORDS, [])
    excluded: list[str] = load_json(EXCLUDED, [])
    used_ids = {record["id"] for record in records}
    geocoder = Geocoder(enabled=not args.no_geocode)

    applied, failed = 0, 0
    for item in todo:
        print(f"  {item['decision']}: {item['originalName']}")

        if item["decision"] == "accepted":
            record = accept(item, records, used_ids, geocoder)
            if record is None:
                failed += 1
                continue
            item["recordId"] = record["id"]
            print(f"    -> record {record['id']} (pending, da catalogare)")
        else:
            photo = ROOT / item["localFile"]
            if photo.exists():
                digest = source_hash(photo)
                if digest not in excluded:
                    excluded.append(digest)

        # Lo stato torna al server, che avvisa chi ha contribuito.
        try:
            post_json(
                f"/api/admin/submissions/{item['id']}",
                {
                    "status": item["decision"],
                    "note": item.get("decisionNote", ""),
                    "recordId": item.get("recordId"),
                },
            )
        except RuntimeError as error:
            # Il record locale c'e' gia': si segnala e si riprova al prossimo
            # giro, invece di rifare l'ingest e creare un doppione.
            print(f"    il server non ha accettato la decisione: {error}")
            failed += 1
            continue

        item["appliedAt"] = now()
        applied += 1

        if not args.keep_files:
            for path in (ROOT / item["localFile"], PREVIEWS / Path(item.get("preview", "x")).name):
                if path.exists() and path.is_file():
                    path.unlink()

    records.sort(key=lambda record: (record.get("capturedAt") or "", record["id"]), reverse=True)
    write_json(RECORDS, records)
    write_json(EXCLUDED, excluded)
    SUBMISSIONS.write_text(json.dumps(submissions, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    print(f"\n{applied} applicate, {failed} non riuscite · {len(records)} record in archivio")
    if applied:
        print("  le nuove foto sono in stato pending: catalogale nella scheda Admin,")
        print("  poi: python3 tools/sync_r2.py --bucket <bucket>")
        print("  e infine: git add src/data public/images && git commit && git push")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
