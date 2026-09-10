"""Lettura dei metadati di scatto: sidecar XMP e, in mancanza, EXIF incorporato.

L'export di Foto di Apple accompagna ogni immagine con un sidecar `.xmp` che
contiene coordinate, quota, direzione di ripresa e data. Quando il sidecar non
c'e' (immagini non esportate da Foto) si ricade sull'EXIF letto da ImageMagick.
"""

from __future__ import annotations

import re
import subprocess
from dataclasses import dataclass, field
from pathlib import Path

# Estensioni immagine trattate dalla pipeline.
IMAGE_SUFFIXES = {".heic", ".heif", ".jpg", ".jpeg", ".png", ".tif", ".tiff", ".webp"}


@dataclass
class PhotoMeta:
    """Quanto si riesce a sapere di una foto senza guardarla."""

    source: Path
    lat: float | None = None
    lng: float | None = None
    altitude: float | None = None
    bearing: float | None = None
    captured_at: str | None = None
    camera: str | None = None
    lens: str | None = None
    width: int | None = None
    height: int | None = None
    # Metadati descrittivi, se mai fossero stati inseriti in Foto.
    title: str | None = None
    description: str | None = None
    keywords: list[str] = field(default_factory=list)

    @property
    def has_position(self) -> bool:
        return self.lat is not None and self.lng is not None


def _xmp_value(xmp: str, tag: str) -> str | None:
    """Legge un tag XMP sia in forma di elemento sia di attributo."""
    match = re.search(rf"<{tag}>(.*?)</{tag}>", xmp, re.S)
    if match:
        return match.group(1).strip()
    match = re.search(rf'{tag}="(.*?)"', xmp, re.S)
    return match.group(1).strip() if match else None


def _xmp_list(xmp: str, tag: str) -> list[str]:
    block = re.search(rf"<{tag}>(.*?)</{tag}>", xmp, re.S)
    if not block:
        return []
    return [item.strip() for item in re.findall(r"<rdf:li[^>]*>(.*?)</rdf:li>", block.group(1), re.S) if item.strip()]


def _coordinate(raw: str | None, ref: str | None) -> float | None:
    """Converte una coordinata XMP in gradi decimali con segno.

    XMP la scrive in due modi: decimale puro (`43.8967`, come fa Foto di Apple)
    oppure gradi e minuti decimali con il riferimento attaccato (`43,53.803N`).
    """
    if not raw:
        return None
    raw = raw.strip()
    trailing = re.match(r"^(.*?)([NSEW])$", raw)
    if trailing:
        raw, ref = trailing.group(1), trailing.group(2)

    parts = raw.split(",")
    try:
        if len(parts) == 1:
            value = float(parts[0])
        elif len(parts) == 2:
            value = float(parts[0]) + float(parts[1]) / 60.0
        else:
            value = float(parts[0]) + float(parts[1]) / 60.0 + float(parts[2]) / 3600.0
    except ValueError:
        return None

    if ref and ref.upper() in {"S", "W"}:
        value = -value
    return value


def _rational(raw: str) -> float | None:
    raw = raw.strip()
    if "/" in raw:
        num, _, den = raw.partition("/")
        try:
            denominator = float(den)
            return float(num) / denominator if denominator else None
        except ValueError:
            return None
    try:
        return float(raw)
    except ValueError:
        return None


def _exif_coordinate(raw: str | None, ref: str | None) -> float | None:
    """Converte la terna gradi/minuti/secondi dell'EXIF in gradi decimali."""
    if not raw:
        return None
    pieces = [_rational(piece) for piece in raw.split(",")]
    pieces = [p for p in pieces if p is not None]
    if not pieces:
        return None
    value = pieces[0]
    if len(pieces) > 1:
        value += pieces[1] / 60.0
    if len(pieces) > 2:
        value += pieces[2] / 3600.0
    if ref and ref.strip().upper().startswith(("S", "W")):
        value = -value
    return value


def _normalise_date(raw: str | None) -> str | None:
    """Riporta le date EXIF (`2023:07:08 12:17:35`) alla forma ISO."""
    if not raw:
        return None
    raw = raw.strip()
    match = re.match(r"^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}:\d{2}:\d{2})", raw)
    if match:
        return f"{match.group(1)}-{match.group(2)}-{match.group(3)}T{match.group(4)}"
    return raw


def read_xmp(sidecar: Path, meta: PhotoMeta) -> None:
    xmp = sidecar.read_text(encoding="utf-8", errors="replace")

    meta.lat = _coordinate(_xmp_value(xmp, "exif:GPSLatitude"), _xmp_value(xmp, "exif:GPSLatitudeRef"))
    meta.lng = _coordinate(_xmp_value(xmp, "exif:GPSLongitude"), _xmp_value(xmp, "exif:GPSLongitudeRef"))

    altitude = _xmp_value(xmp, "exif:GPSAltitude")
    if altitude:
        meta.altitude = _rational(altitude)

    bearing = _xmp_value(xmp, "exif:GPSImgDirection")
    if bearing:
        meta.bearing = _rational(bearing)

    meta.captured_at = _xmp_value(xmp, "photoshop:DateCreated") or _xmp_value(xmp, "exif:DateTimeOriginal")

    meta.title = meta.title or _xmp_list(xmp, "dc:title")[:1] and _xmp_list(xmp, "dc:title")[0] or None
    descriptions = _xmp_list(xmp, "dc:description")
    meta.description = meta.description or (descriptions[0] if descriptions else None)
    meta.keywords = meta.keywords or _xmp_list(xmp, "dc:subject")


def read_exif(image: Path, meta: PhotoMeta) -> None:
    """Completa i campi mancanti leggendo l'EXIF con ImageMagick."""
    try:
        output = subprocess.run(
            ["magick", "identify", "-format", "%w %h\n%[EXIF:*]", str(image)],
            capture_output=True,
            text=True,
            # Il MakerNote di Apple contiene byte non testuali: vanno assorbiti,
            # non fatti esplodere.
            errors="replace",
            check=True,
        ).stdout
    except (subprocess.CalledProcessError, FileNotFoundError):
        return

    lines = output.splitlines()
    if lines:
        dimensions = lines[0].split()
        if len(dimensions) == 2 and all(d.isdigit() for d in dimensions):
            meta.width, meta.height = int(dimensions[0]), int(dimensions[1])

    exif: dict[str, str] = {}
    for line in lines[1:]:
        if "=" in line:
            key, _, value = line.partition("=")
            exif[key.strip().removeprefix("exif:")] = value.strip()

    if not meta.has_position:
        meta.lat = _exif_coordinate(exif.get("GPSLatitude"), exif.get("GPSLatitudeRef"))
        meta.lng = _exif_coordinate(exif.get("GPSLongitude"), exif.get("GPSLongitudeRef"))
    if meta.altitude is None and exif.get("GPSAltitude"):
        meta.altitude = _rational(exif["GPSAltitude"])
    if meta.bearing is None and exif.get("GPSImgDirection"):
        meta.bearing = _rational(exif["GPSImgDirection"])
    if not meta.captured_at:
        meta.captured_at = _normalise_date(exif.get("DateTimeOriginal") or exif.get("DateTime"))

    make, model = exif.get("Make", "").strip(), exif.get("Model", "").strip()
    meta.camera = meta.camera or (f"{make} {model}".strip() or None)
    meta.lens = meta.lens or exif.get("LensModel") or None


def read_photo(image: Path) -> PhotoMeta:
    """Metadati di una foto: prima il sidecar XMP, poi l'EXIF per il resto."""
    meta = PhotoMeta(source=image)

    for candidate in (image.with_suffix(".xmp"), Path(f"{image}.xmp")):
        if candidate.exists():
            read_xmp(candidate, meta)
            break

    read_exif(image, meta)
    meta.captured_at = _normalise_date(meta.captured_at)
    return meta
