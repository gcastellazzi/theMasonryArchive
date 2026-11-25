#!/usr/bin/env python3
"""Converte un HEIC in JPEG conservando l'EXIF (GPS, data, fotocamera).

Serve per le foto che la libheif di sistema non apre: gli iPhone con iOS 18
salvano le foto "ritratto" con una mappa di profondita' che la libheif 1.17 di
Ubuntu 24.04 rifiuta ("Non-existing depth image referenced"). pillow-heif porta
una libheif recente; vive in un ambiente Python a parte, per non toccare il
sistema:

    python3 -m venv ~/.local/share/masonry-heif
    ~/.local/share/masonry-heif/bin/pip install pillow-heif pillow

Uso (lo chiamano ingest_photos.py e intake_queue.py, con quell'interprete):

    ~/.local/share/masonry-heif/bin/python tools/heic_to_jpg.py foto.heic foto.jpg [qualita']
"""

import sys

from PIL import Image
from pillow_heif import register_heif_opener


def main() -> int:
    if len(sys.argv) < 3:
        print(__doc__.strip().splitlines()[0], file=sys.stderr)
        return 2
    source, target = sys.argv[1], sys.argv[2]
    quality = int(sys.argv[3]) if len(sys.argv) > 3 else 95
    register_heif_opener()
    with Image.open(source) as image:
        extra = {key: image.info[key] for key in ("exif", "icc_profile") if image.info.get(key)}
        image.convert("RGB").save(target, "JPEG", quality=quality, **extra)
    return 0


if __name__ == "__main__":
    sys.exit(main())
