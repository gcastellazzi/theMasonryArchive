#!/usr/bin/env python3
"""Scarica i contributi in attesa e li prepara per la revisione nel pannello.

    python3 tools/pull_submissions.py

Per ogni contributo arrivato scarica l'originale in `incoming/`, ne genera
un'anteprima in `public/incoming/` — cosi' il pannello la mostra anche quando
l'originale e' un HEIC, che il browser non sa aprire — e aggiorna
`src/data/submissions.json`.

Le decisioni gia' prese e non ancora applicate non vengono toccate: si puo'
scaricare di nuovo a meta' revisione senza perdere il lavoro fatto.

Nulla di tutto questo entra nell'archivio: le foto restano fuori dal
versionamento finche' `apply_submissions.py` non esegue le decisioni.
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from pathlib import Path
from typing import Any

sys.path.insert(0, str(Path(__file__).resolve().parent))
from archive_api import ROOT, download, get_json  # noqa: E402

SUBMISSIONS = ROOT / "src" / "data" / "submissions.json"
ORIGINALS = ROOT / "incoming"
PREVIEWS = ROOT / "public" / "incoming"

#: Lato lungo dell'anteprima, come la derivata usata dalla scheda pubblica.
PREVIEW_EDGE = 480

EXTENSIONS = {
    "image/jpeg": ".jpg",
    "image/png": ".png",
    "image/webp": ".webp",
    "image/heic": ".heic",
    "image/heif": ".heif",
}


def make_preview(source: Path, target: Path) -> bool:
    """Anteprima WebP priva di metadati. Senza ImageMagick si rinuncia."""
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        subprocess.run(
            [
                "magick", str(source), "-auto-orient", "-strip",
                "-resize", f"{PREVIEW_EDGE}x{PREVIEW_EDGE}>",
                "-quality", "78", str(target),
            ],
            check=True, capture_output=True,
        )
        return True
    except FileNotFoundError:
        print("  ImageMagick non trovato: niente anteprime (brew install imagemagick)")
        return False
    except subprocess.CalledProcessError as error:
        print(f"  anteprima fallita per {source.name}: {error.stderr.decode()[:200]}")
        return False


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--dry-run", action="store_true", help="mostra cosa scaricherebbe")
    args = parser.parse_args()

    queue = get_json("/api/admin/queue?status=pending")
    incoming = queue.get("submissions", [])
    contributors = queue.get("contributors", {})

    existing: list[dict[str, Any]] = json.loads(SUBMISSIONS.read_text(encoding="utf-8")) if SUBMISSIONS.exists() else []
    by_id = {item["id"]: item for item in existing}

    # Quello che era in attesa e non lo e' piu' e' stato deciso altrove.
    remote_ids = {item["id"] for item in incoming}
    kept = [
        item for item in existing
        if item["id"] in remote_ids or (item.get("decision") and not item.get("appliedAt"))
    ]
    dropped = len(existing) - len(kept)

    print(f"{len(incoming)} contributi in attesa sul server · {len(existing)} gia' in locale")
    if args.dry_run:
        for item in incoming:
            if item["id"] not in by_id:
                print(f"  scaricherebbe {item['originalName']} ({item['bytes'] / 1024:.0f} KB)")
        print("\n--dry-run: nessun download.")
        return 0

    result = {item["id"]: item for item in kept}
    fetched = 0

    for item in incoming:
        known = by_id.get(item["id"])
        extension = EXTENSIONS.get(item["contentType"], ".bin")
        original = ORIGINALS / f"{item['id']}{extension}"
        preview = PREVIEWS / f"{item['id']}_{PREVIEW_EDGE}.webp"

        if not original.exists():
            print(f"  scarico {item['originalName']} ({item['bytes'] / 1024:.0f} KB)")
            try:
                download(f"/api/admin/submissions/{item['id']}/file", original)
            except RuntimeError as error:
                print(f"    non riuscito: {error}")
                continue
            fetched += 1

        if not preview.exists():
            make_preview(original, preview)

        contributor = contributors.get(item["contributorId"]) or {}
        entry = {
            "id": item["id"],
            "contributor": {
                "id": contributor.get("id", item["contributorId"]),
                "email": contributor.get("email", ""),
                "firstName": contributor.get("firstName", ""),
                "lastName": contributor.get("lastName", ""),
                "affiliation": contributor.get("affiliation", ""),
                "role": contributor.get("role", "Student"),
            },
            "originalName": item["originalName"],
            "bytes": item["bytes"],
            "contentType": item["contentType"],
            "lat": item["lat"],
            "lng": item["lng"],
            "capturedAt": item["capturedAt"],
            "camera": item["camera"],
            "notes": item["notes"],
            "createdAt": item["createdAt"],
            "localFile": str(original.relative_to(ROOT)),
            "preview": f"incoming/{preview.name}" if preview.exists() else "",
        }
        # Una decisione gia' presa nel pannello sopravvive al riscaricamento.
        if known:
            for key in ("decision", "decisionNote", "appliedAt", "recordId"):
                if known.get(key):
                    entry[key] = known[key]
        result[item["id"]] = entry

    ordered = sorted(result.values(), key=lambda item: item["createdAt"], reverse=True)
    SUBMISSIONS.write_text(json.dumps(ordered, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    pending = sum(1 for item in ordered if not item.get("decision"))
    decided = sum(1 for item in ordered if item.get("decision") and not item.get("appliedAt"))
    print(
        f"\n{fetched} scaricati · {len(ordered)} in coda locale\n"
        f"  da guardare:        {pending}\n"
        f"  decisi da applicare: {decided}"
    )
    if dropped:
        print(f"  {dropped} spariti dal server, tolti dalla coda")
    if decided:
        print("\n  per eseguire le decisioni: python3 tools/apply_submissions.py")
    elif pending:
        print("\n  apri la scheda Incoming del pannello: npm run dev")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
