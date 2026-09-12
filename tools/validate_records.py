#!/usr/bin/env python3
"""Controlla che l'archivio sia coerente prima di pubblicarlo.

Il pannello di amministrazione sovrascrive `src/data/records.json` per intero e
la pipeline di ingest lo riscrive a ogni importazione: un salvataggio partito da
una bozza vecchia, un ingest interrotto a meta' o una derivata cancellata a mano
lasciano incoerenze che il sito non segnala — mostra un'immagine rotta, o un
record che non compare e basta.

Gira in CI prima del build, cosi' un archivio incoerente non arriva online.

    python3 tools/validate_records.py            # segnala e basta
    python3 tools/validate_records.py --strict   # esce con errore se trova qualcosa
"""

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
RECORDS = ROOT / "src" / "data" / "records.json"
EXCLUDED = ROOT / "src" / "data" / "excluded.json"
SUGGESTIONS = ROOT / "src" / "data" / "suggestions.json"
IMAGES = ROOT / "public" / "images"

# Le derivate versionate: senza queste il sito mostra un'immagine rotta. La
# derivata da 1600 px non e' nel repository — sta su R2 — quindi non si
# controlla qui, altrimenti la CI fallirebbe sempre.
REQUIRED_DERIVATIVES = ("thumbnail", "strip")

# Stessa regola di `isPublishable` in `src/types.ts`: un record approvato che
# non la rispetta e' gia' pubblico ma incompleto.
REQUIRED_FOR_PUBLICATION = ("title", "element", "technique")

VALID_STATUS = {"pending", "approved", "rejected"}


class Report:
    def __init__(self) -> None:
        self.errors: list[str] = []
        self.warnings: list[str] = []

    def error(self, message: str) -> None:
        self.errors.append(message)

    def warn(self, message: str) -> None:
        self.warnings.append(message)


def check_position(record: dict[str, Any], where: str, report: Report) -> bool:
    lat, lng = record.get("lat"), record.get("lng")
    if lat is None or lng is None:
        return False
    if not isinstance(lat, (int, float)) or not isinstance(lng, (int, float)):
        report.error(f"{where}: coordinate non numeriche ({lat!r}, {lng!r})")
        return False
    if not (-90 <= lat <= 90 and -180 <= lng <= 180):
        report.error(f"{where}: coordinate fuori scala ({lat}, {lng})")
        return False
    return True


def validate(records: list[dict[str, Any]], images_dir: Path, report: Report) -> None:
    seen_ids: set[str] = set()
    seen_hashes: dict[str, str] = {}
    referenced: set[str] = set()

    for record in records:
        record_id = record.get("id")
        where = f"record {record_id or '(senza id)'}"

        if not record_id:
            report.error("un record non ha id")
            continue
        if record_id in seen_ids:
            report.error(f"{where}: id duplicato")
        seen_ids.add(record_id)

        status = record.get("status")
        if status not in VALID_STATUS:
            report.error(f"{where}: stato sconosciuto {status!r}")

        digest = record.get("sourceHash")
        if digest:
            if digest in seen_hashes:
                report.error(
                    f"{where}: stessa impronta di {seen_hashes[digest]} — foto importata due volte"
                )
            else:
                seen_hashes[digest] = record_id

        for key in REQUIRED_DERIVATIVES:
            path = record.get(key)
            if not path:
                report.error(f"{where}: manca il percorso di '{key}'")
                continue
            name = Path(path).name
            referenced.add(name)
            if not (images_dir / name).exists():
                report.error(f"{where}: '{key}' non trovata su disco ({name})")

        # Anche la derivata di dettaglio va nominata: e' la chiave con cui
        # `sync_r2.py` la cerca sul bucket.
        if record.get("image"):
            referenced.add(Path(record["image"]).name)

        has_position = check_position(record, where, report)

        captured = record.get("capturedAt")
        if captured:
            try:
                datetime.fromisoformat(captured)
            except ValueError:
                report.error(f"{where}: data di scatto illeggibile ({captured!r})")

        tags = record.get("tags")
        if not isinstance(tags, list) or any(not isinstance(tag, str) for tag in tags):
            report.error(f"{where}: i tag devono essere una lista di stringhe")
            tags = []
        elif any(tag != tag.strip() for tag in tags):
            report.warn(f"{where}: tag con spazi ai bordi — si sdoppiano nella nuvola dei tag")

        if status == "approved":
            missing = [
                field
                for field in REQUIRED_FOR_PUBLICATION
                if not str(record.get(field, "")).strip()
            ]
            if not tags:
                missing.append("tags")
            if not has_position:
                missing.append("position")
            if missing:
                report.error(
                    f"{where}: approvato ma incompleto — manca {', '.join(missing)}"
                )

    orphans = sorted(
        path.name for path in images_dir.glob("*.webp") if path.name not in referenced
    )
    if orphans:
        report.warn(
            f"{len(orphans)} derivate non appartengono a nessun record "
            f"(es. {orphans[0]}) — ripulisci con tools/prune_images.py"
        )


def validate_excluded(
    records: list[dict[str, Any]], excluded: list[str], report: Report
) -> None:
    """Un'impronta esclusa non puo' appartenere anche a un record vivo."""
    tombstones = set(excluded)
    for record in records:
        digest = record.get("sourceHash")
        if digest and digest in tombstones:
            report.error(
                f"record {record.get('id')}: impronta presente anche in excluded.json — "
                "il prossimo ingest la eliminerebbe di nuovo"
            )


def validate_suggestions(
    records: list[dict[str, Any]], suggestions: list[dict[str, Any]], report: Report
) -> None:
    known = {record.get("id") for record in records}
    for suggestion in suggestions:
        if suggestion.get("recordId") not in known:
            report.warn(
                f"proposta {suggestion.get('id')}: riguarda un record che non esiste piu'"
            )


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--records", default=str(RECORDS))
    parser.add_argument("--images-dir", default=str(IMAGES))
    parser.add_argument(
        "--strict", action="store_true", help="esce con codice 1 se ci sono errori"
    )
    args = parser.parse_args()

    records_path = Path(args.records)
    if not records_path.exists():
        sys.exit(f"{records_path} non trovato")

    records = json.loads(records_path.read_text(encoding="utf-8"))
    excluded = (
        json.loads(EXCLUDED.read_text(encoding="utf-8")) if EXCLUDED.exists() else []
    )
    suggestions = (
        json.loads(SUGGESTIONS.read_text(encoding="utf-8"))
        if SUGGESTIONS.exists()
        else []
    )

    report = Report()
    validate(records, Path(args.images_dir), report)
    validate_excluded(records, excluded, report)
    validate_suggestions(records, suggestions, report)

    approved = sum(1 for record in records if record.get("status") == "approved")
    print(f"{len(records)} record · {approved} approvati · {len(excluded)} esclusi")

    for message in report.warnings:
        print(f"  avviso:  {message}")
    for message in report.errors:
        print(f"  ERRORE:  {message}")

    if report.errors:
        print(f"\n{len(report.errors)} errori.")
        return 1 if args.strict else 0

    print("\nnessun errore." if not report.warnings else f"\n{len(report.warnings)} avvisi, nessun errore.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
