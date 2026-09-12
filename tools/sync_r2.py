#!/usr/bin/env python3
"""Carica su Cloudflare R2 le derivate da 1600 px e, se richiesto, gli originali.

Le derivate di dettaglio pesano circa 244 MB su 750 foto e sono escluse dal
versionamento: senza uno storage esterno la scheda pubblica ripiega sul 480 px.
Questo script le porta sul bucket, da cui il sito le serve quando la variabile
`VITE_IMAGE_CDN` e' configurata.

Usa `wrangler`, gia' presente fra le dipendenze di sviluppo, cosi' non servono
ne' chiavi S3 da gestire ne' pacchetti Python in piu': l'autenticazione e'
quella di `npx wrangler login`, fatta una volta sola.

Quello che e' gia' stato caricato viene annotato in `tools/.r2manifest.json`,
sulla falsariga della cache delle geocodifiche: interrogare il bucket per 750
oggetti a ogni esecuzione costerebbe piu' del caricamento stesso. Il manifesto
puo' quindi divergere dalla realta' — `--force` ricarica tutto ignorandolo.

    python3 tools/sync_r2.py --bucket masonry-archive --dry-run
    python3 tools/sync_r2.py --bucket masonry-archive
    python3 tools/sync_r2.py --bucket masonry-archive --originals ~/Foto/Masonry
"""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
RECORDS = ROOT / "src" / "data" / "records.json"
IMAGES = ROOT / "public" / "images"
MANIFEST = Path(__file__).resolve().parent / ".r2manifest.json"

# I nomi dei file contengono l'impronta del sorgente, quindi un oggetto non
# cambia mai contenuto: si puo' mettere in cache per sempre.
CACHE_CONTROL = "public, max-age=31536000, immutable"

SUFFIX_TYPES = {
    ".webp": "image/webp",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
    ".heic": "image/heic",
    ".heif": "image/heif",
    ".tif": "image/tiff",
    ".tiff": "image/tiff",
}


def load_manifest() -> dict[str, int]:
    """Chiave dell'oggetto -> dimensione caricata."""
    if not MANIFEST.exists():
        return {}
    try:
        return json.loads(MANIFEST.read_text(encoding="utf-8"))
    except json.JSONDecodeError:
        print(f"  {MANIFEST.name} illeggibile, riparto da zero", file=sys.stderr)
        return {}


def save_manifest(manifest: dict[str, int]) -> None:
    MANIFEST.write_text(json.dumps(manifest, indent=2, sort_keys=True) + "\n", encoding="utf-8")


def upload(bucket: str, key: str, path: Path) -> tuple[str, int, str | None]:
    """Carica un file. Ritorna chiave, dimensione ed eventuale errore."""
    command = [
        "npx", "wrangler", "r2", "object", "put", f"{bucket}/{key}",
        "--file", str(path),
        "--remote",
        "--content-type", SUFFIX_TYPES.get(path.suffix.lower(), "application/octet-stream"),
        "--cache-control", CACHE_CONTROL,
    ]
    result = subprocess.run(command, capture_output=True, text=True, cwd=ROOT)
    if result.returncode == 0:
        return key, path.stat().st_size, None

    output = (result.stderr or result.stdout).strip()
    last_line = output.splitlines()[-1] if output else "errore sconosciuto"
    return key, 0, last_line


def main() -> int:
    parser = argparse.ArgumentParser(
        description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter
    )
    parser.add_argument("--bucket", required=True, help="nome del bucket R2")
    parser.add_argument("--records", default=str(RECORDS))
    parser.add_argument("--images-dir", default=str(IMAGES))
    parser.add_argument(
        "--originals",
        metavar="DIR",
        help="cartella degli originali da conservare sotto originals/ (privati)",
    )
    parser.add_argument("--jobs", type=int, default=4, help="caricamenti in parallelo (default 4)")
    parser.add_argument("--force", action="store_true", help="ignora il manifesto e ricarica tutto")
    parser.add_argument("--dry-run", action="store_true", help="elenca senza caricare")
    args = parser.parse_args()

    records_path, images_dir = Path(args.records), Path(args.images_dir)
    if not records_path.exists():
        sys.exit(f"{records_path} non trovato")

    records: list[dict[str, Any]] = json.loads(records_path.read_text(encoding="utf-8"))
    manifest = {} if args.force else load_manifest()

    todo: list[tuple[str, Path]] = []
    missing: list[str] = []

    for record in records:
        key = record.get("image")
        if not key:
            continue
        path = images_dir / Path(key).name
        if not path.exists():
            missing.append(path.name)
            continue
        if manifest.get(key) == path.stat().st_size:
            continue
        todo.append((key, path))

    if args.originals:
        originals_dir = Path(args.originals).expanduser()
        for record in records:
            source, digest = record.get("sourceFile"), record.get("sourceHash")
            if not source or not digest:
                continue
            path = originals_dir / source
            if not path.exists():
                continue
            key = f"originals/{digest}{path.suffix.lower()}"
            if manifest.get(key) == path.stat().st_size:
                continue
            todo.append((key, path))

    total_bytes = sum(path.stat().st_size for _, path in todo)
    print(
        f"{len(records)} record · {len(todo)} da caricare "
        f"({total_bytes / 1_048_576:.0f} MB) · {len(manifest)} gia' sul bucket"
    )

    if missing:
        print(f"\n  {len(missing)} derivate da 1600 px non generate in locale:")
        for name in missing[:5]:
            print(f"    {name}")
        if len(missing) > 5:
            print(f"    ... e altre {len(missing) - 5}")
        print("  rigenerale con: npm run ingest -- --source <cartella> --force")

    if not todo:
        print("\nniente da fare.")
        return 0

    if args.dry_run:
        print("\n  prime chiavi:")
        for key, path in todo[:5]:
            print(f"    {key}  ({path.stat().st_size / 1024:.0f} KB)")
        print("\n--dry-run: nessun caricamento.")
        return 0

    done, failed = 0, []
    with ThreadPoolExecutor(max_workers=max(1, args.jobs)) as pool:
        futures = [pool.submit(upload, args.bucket, key, path) for key, path in todo]
        for future in futures:
            key, size, error = future.result()
            if error:
                failed.append((key, error))
            else:
                manifest[key] = size
                done += 1
                if done % 20 == 0:
                    save_manifest(manifest)
                    print(f"  {done}/{len(todo)}")

    save_manifest(manifest)
    print(f"\n{done} caricati · {len(failed)} falliti")
    for key, error in failed[:10]:
        print(f"    {key}: {error}")
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(main())
