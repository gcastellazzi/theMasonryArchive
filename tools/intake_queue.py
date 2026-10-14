#!/usr/bin/env python3
"""Coda dei contributi esterni: foto in attesa di moderazione.

Le foto arrivano dal bot Telegram dei contributori (plugin Hermes in
`hermes/plugins/masonry_contrib/`) e restano in quarantena in `incoming/`,
fuori dal repository e fuori dal sito, finche' l'amministratore non decide:

    incoming/
      contributors.json   chi ha contribuito (dati personali: mai in git)
      submissions.json    una voce per foto, con stato e decisione
      files/              i file ricevuti, intatti, EXIF compreso
      originals/          gli originali dei contributi gia' entrati nell'archivio

Due cancelli distinti, come nel resto dell'archivio: `accept` ammette il
contributo, `apply` lo fa passare dalla pipeline di ingest e lo trasforma in un
record `pending`, che si cataloga e si approva dal pannello come ogni altro.

Il modulo e' solo libreria standard, perche' gira in due interpreti: quello di
sistema (CLI e bot admin) e quello isolato di Hermes (plugin del bot dei
contributori), che non ha Pillow ne' ImageMagick.

Uso da riga di comando:

    python3 tools/intake_queue.py list [--status pending]
    python3 tools/intake_queue.py show <id>
    python3 tools/intake_queue.py accept <id> [--note "..."]
    python3 tools/intake_queue.py reject <id> --note "motivo"
    python3 tools/intake_queue.py apply [--dry-run]
    python3 tools/intake_queue.py notify [--dry-run]
    python3 tools/intake_queue.py contributors
    python3 tools/intake_queue.py stats
    python3 tools/intake_queue.py invite [CODICE | off]

Ogni comando accetta `--json` per un output leggibile da un altro programma.
"""

from __future__ import annotations

import argparse
import contextlib
import fcntl
import hashlib
import json
import os
import shutil
import struct
import subprocess
import sys
import tempfile
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Iterator

ROOT = Path(__file__).resolve().parent.parent
INCOMING = Path(os.environ.get("MASONRY_INCOMING") or ROOT / "incoming").expanduser()
RECORDS = ROOT / "src" / "data" / "records.json"
EXCLUDED = ROOT / "src" / "data" / "excluded.json"
INGEST = ROOT / "tools" / "ingest_photos.py"

# Telegram non scarica file oltre i 20 MB; il margine copre un server locale.
MAX_BYTES = 25 * 1024 * 1024
# Un tetto giornaliero per contributore: abbastanza per una giornata di
# rilievo, troppo poco per riempire il disco per errore o per dispetto.
DAILY_LIMIT = 30

ROLES = ("Student", "PhD candidate", "Researcher", "Professional")
STATUSES = ("pending", "accepted", "rejected", "ingested")

# Il profilo Hermes che possiede il bot dei contributori: le notifiche partono
# da li', cosi' lo studente le riceve nella stessa chat in cui ha caricato.
CONTRIB_PROFILE = os.environ.get("MASONRY_CONTRIB_PROFILE", "masonry-contrib")


# --------------------------------------------------------------------------
# Archiviazione


def now() -> str:
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat()


def _load(path: Path, fallback: Any) -> Any:
    if not path.exists():
        return fallback
    return json.loads(path.read_text(encoding="utf-8"))


def _save(path: Path, payload: Any) -> None:
    """Scrittura atomica: un'interruzione lascia il file vecchio, mai uno a meta'."""
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, tmp = tempfile.mkstemp(dir=path.parent, prefix=f".{path.name}.")
    with os.fdopen(fd, "w", encoding="utf-8") as handle:
        handle.write(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    os.chmod(tmp, 0o600)
    os.replace(tmp, path)


@contextlib.contextmanager
def locked() -> Iterator[None]:
    """Il bot e la riga di comando scrivono gli stessi file: uno alla volta."""
    INCOMING.mkdir(parents=True, exist_ok=True)
    os.chmod(INCOMING, 0o700)
    with (INCOMING / ".lock").open("w") as handle:
        fcntl.flock(handle, fcntl.LOCK_EX)
        try:
            yield
        finally:
            fcntl.flock(handle, fcntl.LOCK_UN)


def load_contributors() -> dict[str, dict[str, Any]]:
    return _load(INCOMING / "contributors.json", {})


def load_submissions() -> list[dict[str, Any]]:
    return _load(INCOMING / "submissions.json", [])


def contributor_key(telegram_user_id: str | int) -> str:
    return f"telegram:{telegram_user_id}"


# --------------------------------------------------------------------------
# Riconoscimento del file

# Firma iniziale → (estensione, MIME). L'estensione dichiarata non conta:
# un PDF rinominato .jpg resta un PDF.
def sniff(head: bytes) -> tuple[str, str] | None:
    if head.startswith(b"\xff\xd8\xff"):
        return ".jpg", "image/jpeg"
    if head.startswith(b"\x89PNG\r\n\x1a\n"):
        return ".png", "image/png"
    if head[:4] == b"RIFF" and head[8:12] == b"WEBP":
        return ".webp", "image/webp"
    if head[:4] in (b"II*\x00", b"MM\x00*"):
        return ".tif", "image/tiff"
    if head[4:8] == b"ftyp" and head[8:12] in (b"heic", b"heix", b"hevc", b"heim", b"heis", b"mif1", b"msf1"):
        return ".heic", "image/heic"
    return None


def sha1_of(path: Path) -> str:
    digest = hashlib.sha1()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


# --------------------------------------------------------------------------
# EXIF minimo: posizione, data e fotocamera, senza dipendenze.
#
# Basta per dire subito allo studente se la foto ha perso il GPS (succede
# quando Telegram la riceve come "foto" invece che come "file"). La lettura
# completa la fa comunque `ingest_photos.py` al momento di `apply`.

_TYPE_SIZE = {1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1, 9: 4, 10: 8}


def _find_tiff(data: bytes, ext: str) -> bytes | None:
    if ext == ".tif":
        return data
    if ext == ".jpg":
        pos = 2
        while pos + 4 <= len(data) and data[pos] == 0xFF:
            marker = data[pos + 1]
            if marker in (0xD9, 0xDA):  # fine immagine o inizio dei dati compressi
                break
            size = struct.unpack(">H", data[pos + 2 : pos + 4])[0]
            segment = data[pos + 4 : pos + 2 + size]
            if marker == 0xE1 and segment.startswith(b"Exif\x00\x00"):
                return segment[6:]
            pos += 2 + size
        return None
    # HEIC, PNG (eXIf) e WebP (EXIF): il blocco TIFF e' riconoscibile dalla firma.
    for prefix in (b"Exif\x00\x00II*\x00", b"Exif\x00\x00MM\x00*"):
        at = data.find(prefix)
        if at >= 0:
            return data[at + 6 :]
    for chunk in (b"eXIf", b"EXIF"):
        at = data.find(chunk)
        if at >= 0 and data[at + 8 : at + 12] in (b"II*\x00", b"MM\x00*"):
            return data[at + 8 :]
    return None


def _read_ifd(tiff: bytes, offset: int, endian: str) -> dict[int, Any]:
    entries: dict[int, Any] = {}
    if offset + 2 > len(tiff):
        return entries
    count = struct.unpack(endian + "H", tiff[offset : offset + 2])[0]
    for index in range(min(count, 512)):
        base = offset + 2 + index * 12
        if base + 12 > len(tiff):
            break
        tag, kind, n = struct.unpack(endian + "HHI", tiff[base : base + 8])
        size = _TYPE_SIZE.get(kind, 0) * n
        if not size:
            continue
        if size <= 4:
            raw = tiff[base + 8 : base + 8 + size]
        else:
            ptr = struct.unpack(endian + "I", tiff[base + 8 : base + 12])[0]
            raw = tiff[ptr : ptr + size]
        if len(raw) < size:
            continue
        if kind == 2:
            entries[tag] = raw.split(b"\x00", 1)[0].decode("latin-1").strip()
        elif kind == 3:
            entries[tag] = struct.unpack(endian + "H" * n, raw)
        elif kind in (4, 9):
            entries[tag] = struct.unpack(endian + ("I" if kind == 4 else "i") * n, raw)
        elif kind in (5, 10):
            values = struct.unpack(endian + ("I" if kind == 5 else "i") * (2 * n), raw)
            entries[tag] = tuple(values[i] / values[i + 1] if values[i + 1] else 0.0 for i in range(0, len(values), 2))
        else:
            entries[tag] = raw
    return entries


def _degrees(value: Any, ref: Any, negative: str) -> float | None:
    if not isinstance(value, tuple) or len(value) != 3:
        return None
    degrees = value[0] + value[1] / 60 + value[2] / 3600
    return round(-degrees if str(ref).upper().startswith(negative) else degrees, 7)


def read_exif(path: Path, ext: str) -> dict[str, Any]:
    """Posizione, data e fotocamera; chiavi assenti quando l'EXIF non le ha."""
    found: dict[str, Any] = {}
    try:
        tiff = _find_tiff(path.read_bytes(), ext)
        if not tiff or len(tiff) < 8:
            return found
        endian = "<" if tiff[:2] == b"II" else ">"
        ifd0 = _read_ifd(tiff, struct.unpack(endian + "I", tiff[4:8])[0], endian)
        make, model = ifd0.get(0x010F, ""), ifd0.get(0x0110, "")
        if model:
            found["camera"] = model if make and model.startswith(make) else f"{make} {model}".strip()
        if 0x8769 in ifd0:
            exif = _read_ifd(tiff, ifd0[0x8769][0], endian)
            stamp = exif.get(0x9003) or ifd0.get(0x0132)
            if stamp and len(stamp) >= 19:
                iso = stamp[:10].replace(":", "-") + "T" + stamp[11:19]
                offset = exif.get(0x9011)
                found["capturedAt"] = iso + (offset if isinstance(offset, str) and len(offset) == 6 else "")
        if 0x8825 in ifd0:
            gps = _read_ifd(tiff, ifd0[0x8825][0], endian)
            lat = _degrees(gps.get(2), gps.get(1, "N"), "S")
            lng = _degrees(gps.get(4), gps.get(3, "E"), "W")
            if lat is not None and lng is not None and (lat, lng) != (0.0, 0.0):
                found["lat"], found["lng"] = lat, lng
    except (struct.error, IndexError, ValueError, OSError):
        pass
    return found


# --------------------------------------------------------------------------
# Operazioni usate dal bot dei contributori


class IntakeError(Exception):
    """Errore da riferire al contributore: `code` per il bot, `message` per le persone."""

    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def public_profile(contributor: dict[str, Any]) -> dict[str, Any]:
    keys = ("firstName", "lastName", "affiliation", "role", "orcid", "lab", "email", "acceptedTermsAt")
    return {key: contributor.get(key) for key in keys if contributor.get(key)}


def register_contributor(user_id: str, username: str, fields: dict[str, Any]) -> dict[str, Any]:
    first, last = (fields.get("firstName") or "").strip(), (fields.get("lastName") or "").strip()
    affiliation = (fields.get("affiliation") or "").strip()
    role = (fields.get("role") or "").strip()
    if not (first and last and affiliation):
        raise IntakeError("missing_fields", "Servono nome, cognome e affiliazione.")
    if role not in ROLES:
        raise IntakeError("bad_role", f"Il ruolo deve essere uno fra: {', '.join(ROLES)}.")
    if not fields.get("acceptTerms"):
        raise IntakeError(
            "terms_not_accepted",
            "Per caricare foto bisogna accettare la licenza CC BY 4.0 e l'informativa privacy.",
        )
    with locked():
        contributors = load_contributors()
        key = contributor_key(user_id)
        current = contributors.get(key, {"id": key, "createdAt": now(), "blocked": False})
        if current.get("blocked"):
            raise IntakeError("blocked", "Questo account non puo' piu' contribuire.")
        current.update(
            {
                "telegramUserId": str(user_id),
                "telegramUsername": username or current.get("telegramUsername", ""),
                "firstName": first[:80],
                "lastName": last[:80],
                "affiliation": affiliation[:160],
                "role": role,
                "orcid": (fields.get("orcid") or "").strip()[:40],
                "lab": (fields.get("lab") or "").strip()[:160],
                "email": (fields.get("email") or "").strip()[:160],
                "acceptedTermsAt": current.get("acceptedTermsAt") or now(),
                "updatedAt": now(),
            }
        )
        contributors[key] = current
        _save(INCOMING / "contributors.json", contributors)
        return current


def get_contributor(user_id: str) -> dict[str, Any] | None:
    return load_contributors().get(contributor_key(user_id))


# --------------------------------------------------------------------------
# Codice d'invito
#
# Il bot e' aperto a chiunque su Telegram, ma chi non e' registrato deve prima
# scrivere il codice d'invito (uno per corso o per gruppo, si cambia quando si
# vuole). Senza codice il plugin risponde con un testo fisso e il modello non
# viene nemmeno chiamato. Codice vuoto = bot aperto a tutti.


def invite_code() -> str:
    return str(_load(INCOMING / "settings.json", {}).get("inviteCode") or "")


def set_invite_code(code: str) -> str:
    code = "".join(code.split()).upper()
    if code and len(code) < 6:
        # Il codice si cerca dentro il messaggio: se e' corto, compare per caso.
        raise IntakeError("short_code", "Il codice d'invito deve avere almeno 6 caratteri.")
    with locked():
        settings = _load(INCOMING / "settings.json", {})
        settings["inviteCode"] = code
        _save(INCOMING / "settings.json", settings)
    return code


def is_admitted(user_id: str) -> bool:
    key = contributor_key(user_id)
    return key in load_contributors() or key in _load(INCOMING / "invited.json", {})


def admit(user_id: str) -> None:
    with locked():
        invited = _load(INCOMING / "invited.json", {})
        invited.setdefault(contributor_key(user_id), now())
        _save(INCOMING / "invited.json", invited)


def submit(
    user_id: str,
    source: Path,
    *,
    original_name: str = "",
    notes: str = "",
    lat: float | None = None,
    lng: float | None = None,
    location_hint: str = "",
) -> dict[str, Any]:
    """Mette in quarantena una foto. Solleva `IntakeError` se non e' accettabile."""
    contributor = get_contributor(user_id)
    if not contributor:
        raise IntakeError("not_registered", "Prima di caricare serve la registrazione.")
    if contributor.get("blocked"):
        raise IntakeError("blocked", "Questo account non puo' piu' contribuire.")

    size = source.stat().st_size
    if not 0 < size <= MAX_BYTES:
        raise IntakeError("too_large", f"Il file supera {MAX_BYTES // (1024 * 1024)} MB o e' vuoto.")
    with source.open("rb") as handle:
        kind = sniff(handle.read(16))
    if not kind:
        raise IntakeError("not_an_image", "Il file non e' un'immagine JPEG, HEIC, PNG, WebP o TIFF.")
    ext, mime = kind

    if (lat is None) != (lng is None):
        raise IntakeError("bad_position", "Servono sia la latitudine sia la longitudine.")
    if lat is not None and not (-90 <= lat <= 90 and -180 <= lng <= 180 and (lat, lng) != (0, 0)):
        raise IntakeError("bad_position", "Coordinate fuori dai limiti geografici.")

    exif = read_exif(source, ext)
    # La posizione serve: senza, la foto non puo' essere pubblicata sulla mappa.
    # Meglio chiederla subito che scoprirlo in moderazione.
    if "lat" not in exif and lat is None and not location_hint.strip():
        raise IntakeError(
            "missing_position",
            "La foto non contiene coordinate GPS. Invia la foto come FILE (non come foto), "
            "oppure indica il luogo o le coordinate.",
        )

    digest = sha1_of(source)
    with locked():
        submissions = load_submissions()
        mine_today = [
            s for s in submissions
            if s["contributorId"] == contributor["id"] and s["createdAt"][:10] == now()[:10]
        ]
        if len(mine_today) >= DAILY_LIMIT:
            raise IntakeError("daily_limit", f"Raggiunto il limite di {DAILY_LIMIT} foto al giorno. Riprova domani.")
        if any(s["sha1"] == digest for s in submissions):
            raise IntakeError("duplicate", "Questa foto e' gia' stata inviata.")
        known = {r.get("sourceHash") for r in _load(RECORDS, [])} | set(_load(EXCLUDED, []))
        if digest in known:
            raise IntakeError("duplicate", "Questa foto e' gia' nell'archivio.")

        submission_id = uuid.uuid4().hex[:12]
        target = INCOMING / "files" / f"{submission_id}{ext}"
        target.parent.mkdir(parents=True, exist_ok=True)
        # Copia, non spostamento: la cache di Hermes ha un suo ciclo di pulizia.
        shutil.copyfile(source, target)
        os.chmod(target, 0o600)

        entry = {
            "id": submission_id,
            "contributorId": contributor["id"],
            "channel": "telegram",
            "file": f"files/{target.name}",
            "originalName": (original_name or source.name)[:200],
            "bytes": size,
            "contentType": mime,
            "sha1": digest,
            "lat": exif.get("lat", lat),
            "lng": exif.get("lng", lng),
            "positionSource": "exif" if "lat" in exif else ("contributor" if lat is not None else None),
            "locationHint": location_hint.strip()[:200],
            "capturedAt": exif.get("capturedAt"),
            "camera": exif.get("camera"),
            "notes": notes.strip()[:2000],
            "status": "pending",
            "createdAt": now(),
            "reviewedAt": None,
            "reviewNote": "",
            "recordId": None,
            "notifiedStatus": "pending",
        }
        submissions.append(entry)
        _save(INCOMING / "submissions.json", submissions)
        return entry


def submissions_for(user_id: str) -> list[dict[str, Any]]:
    key = contributor_key(user_id)
    return [s for s in load_submissions() if s["contributorId"] == key]


def delete_contributor(user_id: str) -> dict[str, Any]:
    """Diritto all'oblio: via il profilo e tutto cio' che non e' ancora pubblicato.

    I contributi gia' entrati nell'archivio restano come record (sono opere
    concesse in licenza CC BY), ma l'amministratore riceve l'elenco degli id per
    decidere se rimuoverli o anonimizzarne l'autore.
    """
    key = contributor_key(user_id)
    with locked():
        contributors = load_contributors()
        existed = contributors.pop(key, None) is not None
        invited = _load(INCOMING / "invited.json", {})
        if invited.pop(key, None):
            _save(INCOMING / "invited.json", invited)
        kept, removed, published = [], 0, []
        for entry in load_submissions():
            if entry["contributorId"] != key:
                kept.append(entry)
            elif entry["status"] == "ingested":
                published.append(entry["recordId"])
                kept.append({**entry, "contributorId": "deleted"})
            else:
                (INCOMING / entry["file"]).unlink(missing_ok=True)
                removed += 1
        _save(INCOMING / "contributors.json", contributors)
        _save(INCOMING / "submissions.json", kept)
        if published:
            # Resta traccia solo degli id dei record: e' quanto serve
            # all'amministratore per decidere, senza conservare dati personali.
            deletions = _load(INCOMING / "deletions.json", [])
            deletions.append({"at": now(), "publishedRecords": published, "handled": False})
            _save(INCOMING / "deletions.json", deletions)
    return {"profileDeleted": existed, "submissionsDeleted": removed, "publishedRecords": published}


# --------------------------------------------------------------------------
# Operazioni dell'amministratore


def _find(submissions: list[dict[str, Any]], submission_id: str) -> dict[str, Any]:
    matches = [s for s in submissions if s["id"].startswith(submission_id)]
    if len(matches) != 1:
        sys.exit(f"contributo non trovato o ambiguo: {submission_id}")
    return matches[0]


def review(submission_id: str, decision: str, note: str = "") -> dict[str, Any]:
    with locked():
        submissions = load_submissions()
        entry = _find(submissions, submission_id)
        if entry["status"] not in ("pending", "accepted"):
            sys.exit(f"{entry['id']} e' gia' {entry['status']}")
        entry.update({"status": decision, "reviewedAt": now(), "reviewNote": note.strip()})
        if decision == "rejected":
            # Come una cancellazione dal pannello: l'impronta entra in excluded.json
            # e nessun reimport la riporta dentro. Il file non si conserva.
            excluded = _load(EXCLUDED, [])
            if entry["sha1"] not in excluded:
                excluded.append(entry["sha1"])
                EXCLUDED.write_text(json.dumps(excluded, indent=2) + "\n", encoding="utf-8")
            (INCOMING / entry["file"]).unlink(missing_ok=True)
        _save(INCOMING / "submissions.json", submissions)
        return entry


def apply(dry_run: bool = False) -> list[dict[str, Any]]:
    """Fa entrare gli accettati nell'archivio con la pipeline di ingest esistente."""
    if not shutil.which("magick"):
        sys.exit("ingest_photos.py richiede ImageMagick 7 (comando `magick`), che qui non e' installato.")
    contributors = load_contributors()
    done: list[dict[str, Any]] = []
    for entry in [s for s in load_submissions() if s["status"] == "accepted"]:
        person = contributors.get(entry["contributorId"], {})
        author = f"{person.get('firstName', '')} {person.get('lastName', '')}".strip()
        with tempfile.TemporaryDirectory(prefix="masonry-intake-") as staging:
            # Una cartella per foto: l'ingest lavora su cartelle e attribuisce
            # autore e affiliazione a tutto cio' che trova dentro.
            photo = Path(staging) / Path(entry["file"]).name
            shutil.copyfile(INCOMING / entry["file"], photo)
            command = [sys.executable, str(INGEST), "--source", staging, "--author", author,
                       "--affiliation", person.get("affiliation", "")]
            if dry_run:
                command.append("--dry-run")
            print(f"→ {entry['id']} ({author or 'autore sconosciuto'})", flush=True)
            subprocess.run(command, check=True)
        if dry_run:
            continue
        with locked():
            records = _load(RECORDS, [])
            record = next((r for r in records if r.get("sourceHash") == entry["sha1"]), None)
            if record is None:
                print(f"  ATTENZIONE: nessun record con impronta {entry['sha1'][:10]}, contributo lasciato accettato")
                continue
            # La posizione indicata dal contributore vale solo se l'EXIF non ne aveva.
            if record.get("lat") is None and entry.get("lat") is not None:
                record["lat"], record["lng"] = entry["lat"], entry["lng"]
            hints = [entry.get("notes", ""), entry.get("locationHint", "")]
            if not record.get("notes") and any(hints):
                record["notes"] = " — ".join(h for h in hints if h)
            RECORDS.write_text(json.dumps(records, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

            submissions = load_submissions()
            current = _find(submissions, entry["id"])
            original = INCOMING / "originals" / f"{entry['sha1']}{Path(entry['file']).suffix}"
            original.parent.mkdir(parents=True, exist_ok=True)
            shutil.move(INCOMING / entry["file"], original)
            current.update({"status": "ingested", "recordId": record["id"], "file": str(original.relative_to(INCOMING))})
            _save(INCOMING / "submissions.json", submissions)
            done.append(current)
            print(f"  record {record['id']} creato come pending")
    return done


MESSAGES = {
    "accepted": "La tua foto «{name}» e' stata accettata: entrera' nell'archivio dopo la catalogazione.",
    "rejected": "La tua foto «{name}» non e' stata accettata.",
    "ingested": "La tua foto «{name}» e' entrata nell'archivio (scheda {record}). Grazie!",
}


def notify(dry_run: bool = False) -> list[str]:
    """Avvisa i contributori dei cambi di stato, dal bot in cui hanno caricato."""
    sent: list[str] = []
    with locked():
        submissions = load_submissions()
        contributors = load_contributors()
        for entry in submissions:
            status = entry["status"]
            if status == entry.get("notifiedStatus") or status not in MESSAGES:
                continue
            person = contributors.get(entry["contributorId"])
            if not person:
                continue
            text = MESSAGES[status].format(name=entry["originalName"], record=entry.get("recordId"))
            if entry.get("reviewNote"):
                text += f"\nNota: {entry['reviewNote']}"
            target = f"telegram:{person['telegramUserId']}"
            if not dry_run:
                result = subprocess.run(["hermes", "-p", CONTRIB_PROFILE, "send", "-q", "--to", target, text])
                if result.returncode != 0:
                    print(f"  invio fallito per {entry['id']}", file=sys.stderr)
                    continue
                entry["notifiedStatus"] = status
            sent.append(f"{entry['id']} → {target}: {status}")
        if not dry_run:
            _save(INCOMING / "submissions.json", submissions)
    return sent


def stats() -> dict[str, Any]:
    submissions = load_submissions()
    counts = {status: sum(1 for s in submissions if s["status"] == status) for status in STATUSES}
    return {
        "contributors": len(load_contributors()),
        "submissions": len(submissions),
        **counts,
        "toNotify": sum(1 for s in submissions if s["status"] != s.get("notifiedStatus") and s["status"] in MESSAGES),
        "deletionRequests": [d for d in _load(INCOMING / "deletions.json", []) if not d["handled"]],
    }


# --------------------------------------------------------------------------
# Riga di comando


def _summary(entry: dict[str, Any], contributors: dict[str, Any]) -> str:
    person = contributors.get(entry["contributorId"], {})
    who = f"{person.get('firstName', '?')} {person.get('lastName', '')}".strip()
    where = f"{entry['lat']:.5f},{entry['lng']:.5f}" if entry.get("lat") is not None else (entry.get("locationHint") or "senza posizione")
    return f"{entry['id']}  {entry['status']:<9} {entry['createdAt'][:10]}  {who:<24} {where}  {entry['originalName']}"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--json", action="store_true", help="output JSON")
    sub = parser.add_subparsers(dest="command", required=True)
    listing = sub.add_parser("list", help="elenca i contributi")
    listing.add_argument("--status", choices=STATUSES)
    sub.add_parser("show", help="dettaglio di un contributo").add_argument("id")
    accept = sub.add_parser("accept", help="ammette un contributo")
    accept.add_argument("id")
    accept.add_argument("--note", default="")
    reject = sub.add_parser("reject", help="rifiuta un contributo")
    reject.add_argument("id")
    reject.add_argument("--note", required=True)
    sub.add_parser("apply", help="ingest degli accettati").add_argument("--dry-run", action="store_true")
    sub.add_parser("notify", help="avvisa i contributori").add_argument("--dry-run", action="store_true")
    sub.add_parser("contributors", help="elenca i contributori")
    sub.add_parser("stats", help="riepilogo della coda")
    invite = sub.add_parser("invite", help="mostra o cambia il codice d'invito")
    invite.add_argument("code", nargs="?", help="nuovo codice; 'off' per aprire il bot a tutti")
    args = parser.parse_args()

    contributors = load_contributors()
    if args.command == "list":
        rows = [s for s in load_submissions() if not args.status or s["status"] == args.status]
        output: Any = rows if args.json else "\n".join(_summary(s, contributors) for s in rows) or "coda vuota"
    elif args.command == "show":
        entry = _find(load_submissions(), args.id)
        output = {**entry, "path": str(INCOMING / entry["file"]), "contributor": contributors.get(entry["contributorId"])}
    elif args.command in ("accept", "reject"):
        output = review(args.id, "accepted" if args.command == "accept" else "rejected", args.note)
    elif args.command == "apply":
        output = apply(args.dry_run)
    elif args.command == "notify":
        output = notify(args.dry_run)
    elif args.command == "contributors":
        output = list(contributors.values())
    elif args.command == "invite":
        if args.code:
            set_invite_code("" if args.code.lower() == "off" else args.code)
        code = invite_code()
        output = {"inviteCode": code or None, "open": not code}
    else:
        output = stats()

    if isinstance(output, str):
        print(output)
    else:
        print(json.dumps(output, indent=2, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    sys.exit(main())
