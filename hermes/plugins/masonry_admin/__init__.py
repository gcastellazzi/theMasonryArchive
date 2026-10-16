"""The Masonry Archive — comandi diretti del bot admin (/aiutom per l'elenco).

Ogni comando lancia uno script di `tools/` e restituisce l'output cosi' com'e':
nessun modello da interpellare, risposta in un paio di secondi, nessuna
interpretazione da verificare. Per le domande libere resta la chat normale.

Il plugin si abilita solo nel profilo `masonry-admin`, che risponde
esclusivamente all'amministratore. Collegato al profilo con un link simbolico
da `hermes/install.sh`; il percorso reale serve a ritrovare il repository.
"""

from __future__ import annotations

import json
import os
import shlex
import subprocess
from pathlib import Path

REPO = Path(os.environ.get("MASONRY_REPO") or Path(__file__).resolve().parents[3])
# Telegram tronca oltre 4096 caratteri: si tiene la coda, che di solito e' il riepilogo.
MAX_REPLY = 3800


def _run(*args: str, timeout: int = 120) -> str:
    try:
        result = subprocess.run(
            ["python3", *args], cwd=REPO, capture_output=True, text=True, timeout=timeout
        )
    except subprocess.TimeoutExpired:
        return f"⏱ Interrotto dopo {timeout} s: {' '.join(args)}"
    output = (result.stdout + ("\n" + result.stderr if result.returncode else "")).strip()
    if len(output) > MAX_REPLY:
        output = "…\n" + output[-MAX_REPLY:]
    return output or "(nessun output)"


def _queue(*args: str, timeout: int = 120) -> str:
    return _run("tools/intake_queue.py", *args, timeout=timeout)


def _split(raw: str) -> list[str]:
    try:
        return shlex.split(raw or "")
    except ValueError:
        return (raw or "").split()


def _id_and_note(raw: str) -> tuple[str, str]:
    """`/accetta 3fa2 bella foto` → ("3fa2", "bella foto"): la nota non serve tra virgolette."""
    parts = (raw or "").strip().split(maxsplit=1)
    return (parts[0] if parts else ""), (parts[1].strip() if len(parts) > 1 else "")


# --------------------------------------------------------------------------
# Comandi


def stato(raw: str) -> str:
    del raw
    archive = _run("tools/archive_stats.py", "--next", "5")
    try:
        q = json.loads(_queue("stats"))
    except json.JSONDecodeError:
        return archive
    queue = (
        f"\n\n📥 Contributi: {q['pending']} da moderare · {q['accepted']} accettati da applicare · "
        f"{q['toNotify']} da avvisare · {q.get('inviteRequests', 0)} richieste d'invito · "
        f"{q['contributors']} contributori"
    )
    if q.get("deletionRequests"):
        queue += f"\n⚠️ {len(q['deletionRequests'])} richieste di cancellazione con record pubblicati"
    return archive + queue


# Comandi /f1…/f10: Telegram rende cliccabile solo un comando senza argomenti
# ("/foto 418af7" no, "/f1" si'), e Hermes rifiuta i comandi non registrati,
# quindi gli slot si registrano in anticipo e puntano all'n-esima foto in attesa.
SLOTS = 10


def _pending() -> list[dict]:
    try:
        rows = json.loads(_queue("--json", "list", "--status", "pending"))
    except json.JSONDecodeError:
        return []
    return sorted(rows, key=lambda r: r["createdAt"])


def coda(raw: str) -> str:
    del raw
    rows = _pending()
    if not rows:
        return "📥 Nessuna foto da moderare."
    lines = ["📥 Foto da moderare — /f… per vederla, /accetta… per accettarla", ""]
    for n, row in enumerate(rows, 1):
        where = (row.get("locationHint") or "") if row.get("lat") is None else f"{row['lat']:.3f},{row['lng']:.3f}"
        slot = f"/f{n} /accetta{n}" if n <= SLOTS else f"/foto {row['id'][:6]}"
        lines.append(f"{slot}  {row['createdAt'][:10]}  {row['originalName']}  {where}".rstrip())
    return "\n".join(lines)


def foto(raw: str) -> str:
    submission_id, _ = _id_and_note(raw)
    if not submission_id:
        return "Uso: /foto <id>, oppure tocca /f1, /f2… nell'elenco di /coda"
    try:
        entry = json.loads(_queue("show", submission_id))
    except json.JSONDecodeError:
        return _queue("show", submission_id)
    person = entry.get("contributor") or {}
    where = (f"{entry['lat']:.5f}, {entry['lng']:.5f} ({entry.get('positionSource')})"
             if entry.get("lat") is not None else (entry.get("locationHint") or "senza posizione"))
    lines = [
        f"🖼 {entry['originalName']} · {entry['id']} · {entry['status']}",
        f"👤 {person.get('firstName', '?')} {person.get('lastName', '')} — {person.get('role', '')}, {person.get('affiliation', '')}",
        f"📍 {where}",
        f"📅 {entry.get('capturedAt') or 'data sconosciuta'} · {entry.get('camera') or 'fotocamera sconosciuta'}",
    ]
    if entry.get("notes"):
        lines.append(f"💬 {entry['notes']}")
    ids = [row["id"] for row in _pending()]
    n = ids.index(entry["id"]) + 1 if entry["id"] in ids else 0
    accept = f"/accetta{n}" if 0 < n <= SLOTS else f"/accetta {entry['id'][:6]} [nota]"
    lines.append(f"\n{accept}  ·  /rifiuta {entry['id'][:6]} <motivo>")
    # Telegram non mostra l'HEIC: in quel caso basta il percorso.
    if Path(entry["path"]).suffix.lower() in (".jpg", ".jpeg", ".png", ".webp"):
        lines.append(f"MEDIA:{entry['path']}")
    else:
        lines.append(f"(anteprima non disponibile per questo formato: {entry['path']})")
    return "\n".join(lines)


def accetta(raw: str) -> str:
    submission_id, note = _id_and_note(raw)
    if not submission_id:
        return "Uso: /accetta <id> [nota per il contributore]"
    args = ["accept", submission_id] + (["--note", note] if note else [])
    out = _queue(*args)
    return ("✅ Accettata. /applica per farla entrare nell'archivio, /avvisa per informare il contributore."
            if '"status": "accepted"' in out else out)


def rifiuta(raw: str) -> str:
    submission_id, note = _id_and_note(raw)
    if not submission_id or not note:
        return "Uso: /rifiuta <id> <motivo>  (il motivo arriva al contributore)"
    out = _queue("reject", submission_id, "--note", note)
    return "🗑 Rifiutata: file eliminato, impronta in excluded.json. /avvisa per informare il contributore." \
        if '"status": "rejected"' in out else out


def applica(raw: str) -> str:
    del raw
    # Geocodifica (1 richiesta al secondo) e derivate: qualche secondo per foto.
    return _queue("apply", timeout=1800)


def avvisa(raw: str) -> str:
    del raw
    out = _queue("notify")
    return "✉️ Nessun contributore da avvisare." if out.strip() in ("[]", "") else "✉️ Avvisi inviati:\n" + out


def _requests() -> list[dict]:
    try:
        rows = json.loads(_queue("--json", "requests"))
    except json.JSONDecodeError:
        return []
    return sorted(rows, key=lambda r: r["createdAt"])


def richieste(raw: str) -> str:
    del raw
    rows = _requests()
    if not rows:
        return "🙋 Nessuna richiesta d'invito in attesa."
    lines = ["🙋 Richieste d'invito — tocca /ammetti… per accettare", ""]
    for n, row in enumerate(rows, 1):
        slot = f"/ammetti{n}" if n <= SLOTS else f"/ammetti {row['id']}"
        lines.append(f"{slot}  @{row['telegramUsername'] or '—'} · {row['createdAt'][:10]}\n    {row['text']}")
    lines.append(f"\nPer respingere: /respingi <id> [motivo]  (id: {', '.join(r['id'] for r in rows[:SLOTS])})")
    return "\n".join(lines)


def ammetti(raw: str) -> str:
    request_id, note = _id_and_note(raw)
    if not request_id:
        return "Uso: /ammetti <id> [messaggio]"
    out = _queue("approve-request", request_id, *(["--note", note] if note else []))
    return "✅ Accesso concesso: la persona ha ricevuto il benvenuto e la scelta della lingua." \
        if '"status": "approved"' in out else out


def respingi(raw: str) -> str:
    request_id, note = _id_and_note(raw)
    if not request_id:
        return "Uso: /respingi <id> [motivo]"
    out = _queue("reject-request", request_id, *(["--note", note] if note else []))
    return "Richiesta respinta, la persona e' stata avvisata." if '"status": "rejected"' in out else out


def invito(raw: str) -> str:
    args = _split(raw)[:1]
    try:
        current = json.loads(_queue("invite", *args))
    except json.JSONDecodeError:
        return _queue("invite", *args)
    if current["open"]:
        return "🔓 Nessun codice: chiunque puo' registrarsi. /invito <CODICE> per richiederne uno."
    return f"🔑 Codice d'invito: {current['inviteCode']}\n/invito <NUOVO> per cambiarlo · /invito off per aprire a tutti"


# --------------------------------------------------------------------------
# Pubblicazione su GitHub
#
# Solo i dati dell'archivio (src/data, public/images): il codice si committa a
# mano, cosi' una modifica a meta' non finisce online da un comando del bot. Il
# push usa una deploy key, valida solo per questo repository e revocabile da
# GitHub (Settings → Deploy keys); il remote https resta com'e' per l'uso normale.

DATA_PATHS = ["src/data", "public/images"]
GITHUB_SSH = os.environ.get("MASONRY_GITHUB_SSH", "git@github.com:gcastellazzi/theMasonryArchive.git")
DEPLOY_KEY = Path(os.environ.get("MASONRY_DEPLOY_KEY", Path.home() / ".ssh" / "masonry_github"))


def _git(*args: str, ssh: bool = False, timeout: int = 120) -> subprocess.CompletedProcess:
    env = dict(os.environ)
    if ssh:
        env["GIT_SSH_COMMAND"] = (
            f"ssh -i {DEPLOY_KEY} -o IdentitiesOnly=yes -o BatchMode=yes -o StrictHostKeyChecking=accept-new"
        )
    return subprocess.run(["git", *args], cwd=REPO, capture_output=True, text=True, timeout=timeout, env=env)


def _approved(ref: str | None) -> int:
    """Foto approvate in records.json, nel file attuale o in un commit."""
    try:
        if ref:
            text = _git("show", f"{ref}:src/data/records.json").stdout
        else:
            text = (REPO / "src" / "data" / "records.json").read_text(encoding="utf-8")
        return sum(1 for record in json.loads(text) if record.get("status") == "approved")
    except (OSError, ValueError):
        return 0


def _publish_check() -> tuple[str, list[str]]:
    """Errore bloccante (o "") e righe di riepilogo delle modifiche da pubblicare."""
    if not DEPLOY_KEY.exists():
        return "Manca la deploy key: vedi hermes/README.md.", []
    fetch = _git("fetch", GITHUB_SSH, "main", ssh=True)
    if fetch.returncode:
        return "GitHub non raggiungibile con la deploy key:\n" + fetch.stderr.strip()[-500:], []
    behind = _git("rev-list", "--count", "HEAD..FETCH_HEAD").stdout.strip()
    if behind not in ("", "0"):
        return (f"Su GitHub ci sono {behind} commit che qui mancano (es. pushati dal Mac). "
                "Sincronizza prima con git pull, poi riprova."), []
    changed = [line for line in _git("status", "--porcelain", "--", *DATA_PATHS).stdout.splitlines() if line.strip()]
    if not changed:
        return "", []
    images = sum(1 for line in changed if "public/images/" in line)
    data = [line[3:] for line in changed if "src/data/" in line]
    lines = [f"Foto approvate: {_approved('HEAD')} → {_approved(None)}"]
    if data:
        lines.append("Dati: " + ", ".join(Path(path).name for path in data))
    if images:
        lines.append(f"Immagini nuove o cambiate: {images}")
    others = [line[3:] for line in _git("status", "--porcelain").stdout.splitlines()
              if line.strip() and not any(line[3:].startswith(path) for path in DATA_PATHS)]
    if others:
        lines.append(f"(non inclusi: {len(others)} file di codice o altro, da committare a mano)")
    return "", lines


def pubblica(raw: str) -> str:
    del raw
    error, lines = _publish_check()
    if error:
        return "⚠️ " + error
    if not lines:
        return "Niente da pubblicare: i dati dell'archivio sono gia' su GitHub."
    return "📦 Da pubblicare sul sito\n" + "\n".join(lines) + "\n\nConferma con /pubblicaok"


def pubblicaok(raw: str) -> str:
    del raw
    error, lines = _publish_check()
    if error:
        return "⚠️ " + error
    if not lines:
        return "Niente da pubblicare."
    approved_before, approved_now = _approved("HEAD"), _approved(None)
    _git("add", "--", *DATA_PATHS)
    message = f"Archive data: {approved_now} approved photos ({approved_now - approved_before:+d})"
    commit = _git("commit", "-m", message, "--", *DATA_PATHS)
    if commit.returncode:
        return "⚠️ Commit non riuscito:\n" + (commit.stderr or commit.stdout).strip()[-800:]
    push = _git("push", GITHUB_SSH, "HEAD:main", ssh=True, timeout=300)
    if push.returncode:
        return ("⚠️ Commit fatto in locale ma push non riuscito:\n" + push.stderr.strip()[-800:]
                + "\n\nRiprova /pubblicaok, oppure git push dal terminale.")
    _git("fetch", "origin")  # aggiorna origin/main (lettura anonima, repository pubblico)
    sha = _git("rev-parse", "--short", "HEAD").stdout.strip()
    return f"✅ Pubblicato ({sha}): {message}.\nIl sito si aggiorna in 2–3 minuti."


COMMANDS = [
    ("archivio", stato, "Archivio e contributi in sintesi"),
    ("coda", coda, "Foto dei contributori da moderare"),
    ("foto", foto, "Dettagli e anteprima di una foto: /foto <id>"),
    ("accetta", accetta, "Accetta una foto: /accetta <id> [nota]"),
    ("rifiuta", rifiuta, "Rifiuta una foto: /rifiuta <id> <motivo>"),
    ("applica", applica, "Fa entrare nell'archivio le foto accettate"),
    ("avvisa", avvisa, "Avvisa i contributori dell'esito"),
    ("richieste", richieste, "Richieste d'invito in attesa"),
    ("ammetti", ammetti, "Accetta una richiesta d'invito: /ammetti <id>"),
    ("respingi", respingi, "Respinge una richiesta d'invito: /respingi <id> [motivo]"),
    ("invito", invito, "Mostra o cambia il codice d'invito: /invito [CODICE|off]"),
    ("pubblica", pubblica, "Mostra cosa verrebbe pubblicato su GitHub (non pubblica)"),
    ("pubblicaok", pubblicaok, "Pubblica su GitHub i dati dell'archivio (commit + push)"),
]


def _slot(n: int):
    def show(raw: str) -> str:
        del raw
        rows = _pending()
        if n > len(rows):
            return f"Non c'e' una foto n. {n} in attesa: /coda per l'elenco aggiornato."
        return foto(rows[n - 1]["id"])
    return show


def _accept_slot(n: int):
    def accept(raw: str) -> str:
        rows = _pending()
        if n > len(rows):
            return f"Non c'e' una foto n. {n} in attesa: /coda per l'elenco aggiornato."
        row = rows[n - 1]
        return f"{row['originalName']} ({row['id'][:6]}): " + accetta(f"{row['id']} {raw}".strip())
    return accept


def _admit_slot(n: int):
    def admit(raw: str) -> str:
        rows = _requests()
        if n > len(rows):
            return f"Non c'e' una richiesta n. {n} in attesa: /richieste per l'elenco aggiornato."
        row = rows[n - 1]
        return f"@{row['telegramUsername'] or '—'} ({row['id']}): " + ammetti(f"{row['id']} {raw}".strip())
    return admit


def aiuto(raw: str) -> str:
    del raw
    lines = ["🧱 The Masonry Archive — comandi", ""]
    lines += [f"/{name} — {description}" for name, _, description in COMMANDS]
    lines += [
        f"/f1 … /f{SLOTS} — apre la foto n. 1…{SLOTS} di /coda",
        f"/accetta1 … /accetta{SLOTS} — accetta la foto n. 1…{SLOTS} di /coda",
        f"/ammetti1 … /ammetti{SLOTS} — accetta la richiesta n. 1…{SLOTS} di /richieste",
    ]
    lines += ["", "Per tutto il resto scrivi normalmente: risponde il modello."]
    return "\n".join(lines)


def register(ctx) -> None:
    # Nomi diversi da quelli di PETRAS (/aiuto, /stato sono comandi rapidi del
    # profilo principale e avrebbero la precedenza).
    ctx.register_command("aiutom", aiuto, description="Elenco dei comandi dell'archivio")
    for name, handler, description in COMMANDS:
        ctx.register_command(name, handler, description=description)
    for n in range(1, SLOTS + 1):
        ctx.register_command(f"f{n}", _slot(n), description=f"Foto n. {n} della coda")
        ctx.register_command(f"accetta{n}", _accept_slot(n), description=f"Accetta la foto n. {n} della coda")
        ctx.register_command(f"ammetti{n}", _admit_slot(n), description=f"Accetta la richiesta d'invito n. {n}")
