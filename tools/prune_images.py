#!/usr/bin/env python3
"""Rimuove le derivate che non appartengono piu' a nessun record.

Quando una foto viene eliminata dal pannello di amministrazione sparisce da
`records.json`, ma i file immagine restano su disco e nel repository. Questo
script li individua e li cancella.

Serve anche dopo un ingest interrotto, che puo' lasciare derivate con
identificativi poi non piu' assegnati.

    python3 tools/prune_images.py --dry-run   # mostra cosa toglierebbe
    python3 tools/prune_images.py             # rimuove davvero
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RECORDS = ROOT / "src" / "data" / "records.json"
IMAGES = ROOT / "public" / "images"

DERIVATIVE = re.compile(r"^(?P<id>.+)_(?P<edge>160|480|1600)\.webp$")


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--records", default=str(RECORDS))
    parser.add_argument("--images-dir", default=str(IMAGES))
    parser.add_argument("--dry-run", action="store_true", help="elenca senza cancellare")
    args = parser.parse_args()

    records_path, images_dir = Path(args.records), Path(args.images_dir)
    if not records_path.exists():
        sys.exit(f"{records_path} non trovato")

    known = {record["id"] for record in json.loads(records_path.read_text(encoding="utf-8"))}

    orphans, kept, unexpected = [], 0, []
    for path in sorted(images_dir.glob("*.webp")):
        match = DERIVATIVE.match(path.name)
        if not match:
            unexpected.append(path)
            continue
        if match.group("id") in known:
            kept += 1
        else:
            orphans.append(path)

    print(f"{len(known)} record · {kept} derivate in uso · {len(orphans)} orfane")

    if unexpected:
        print(f"\n  {len(unexpected)} file dal nome non riconosciuto, lasciati intatti:")
        for path in unexpected[:5]:
            print(f"    {path.name}")

    if not orphans:
        return 0

    freed = sum(path.stat().st_size for path in orphans)
    print(f"\n  da rimuovere: {len(orphans)} file, {freed / 1048576:.1f} MB")
    for path in orphans[:12]:
        print(f"    {path.name}")
    if len(orphans) > 12:
        print(f"    ... e altri {len(orphans) - 12}")

    if args.dry_run:
        print("\n(dry run: nessun file rimosso)")
        return 0

    for path in orphans:
        path.unlink()
    print("\nrimosse")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
