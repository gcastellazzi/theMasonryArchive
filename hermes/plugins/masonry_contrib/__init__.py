"""The Masonry Archive — strumenti del bot dei contributori.

Il bot dei contributori parla con persone esterne, quindi questi sono gli
**unici** strumenti che ha: niente terminale, niente file, niente web. Ogni
controllo che conta sta qui nel codice, non nelle istruzioni al modello:

- l'identita' del contributore viene dal contesto della sessione del gateway
  (l'ID Telegram del mittente), mai da un argomento che il modello possa
  scegliere;
- il file da inviare deve stare nella cache di Hermes in cui il gateway salva
  gli allegati ricevuti: un percorso qualsiasi viene rifiutato;
- tipo, dimensione, duplicati e posizione si verificano in
  `tools/intake_queue.py`, lo stesso modulo che usa l'amministratore.

Il plugin vive nel repository (`hermes/plugins/masonry_contrib/`) e viene
collegato al profilo con un link simbolico da `hermes/install.sh`: il percorso
reale serve a ritrovare la radice del repository.
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

REPO = Path(os.environ.get("MASONRY_REPO") or Path(__file__).resolve().parents[3])
sys.path.insert(0, str(REPO / "tools"))

import intake_queue as queue  # noqa: E402

ADMIN_PROFILE = os.environ.get("MASONRY_ADMIN_PROFILE", "masonry-admin")


def _reply(**payload) -> str:
    return json.dumps(payload, ensure_ascii=False)


def _fail(code: str, message: str) -> str:
    return _reply(success=False, error=code, message=message)


def _sender() -> tuple[str, str] | None:
    """(ID Telegram, username) del mittente del messaggio in corso."""
    from gateway.session_context import get_session_env

    if get_session_env("HERMES_SESSION_PLATFORM") != "telegram":
        return None
    user_id = get_session_env("HERMES_SESSION_USER_ID")
    if not user_id or not user_id.lstrip("-").isdigit():
        return None
    return user_id, get_session_env("HERMES_SESSION_USER_NAME")


def _private_chat() -> bool:
    # I dati personali si scambiano solo in chat privata con il bot.
    from gateway.session_context import get_session_env

    return get_session_env("HERMES_SESSION_CHAT_TYPE") not in ("group", "forum", "channel")


def _attachment(file_path: str) -> Path | None:
    """Il percorso, solo se e' un allegato ricevuto dal gateway di questo profilo."""
    from hermes_constants import get_hermes_home

    home = get_hermes_home().resolve()
    roots = [home / "cache", *(home / name for name in ("image_cache", "document_cache"))]
    try:
        path = Path(file_path).expanduser().resolve(strict=True)
    except (OSError, RuntimeError):
        return None
    if not path.is_file():
        return None
    return path if any(path.is_relative_to(root.resolve()) for root in roots) else None


def _guarded(handler):
    """Ogni strumento richiede un mittente Telegram in chat privata."""

    def wrapper(args, **kwargs):
        del kwargs
        sender = _sender()
        if sender is None:
            return _fail("no_sender", "Questo strumento funziona solo dal bot Telegram dei contributori.")
        if not _private_chat():
            return _fail("not_private", "Per caricare foto o dati personali scrivimi in chat privata.")
        try:
            return handler(args or {}, *sender)
        except queue.IntakeError as error:
            return _fail(error.code, error.message)

    return wrapper


# --------------------------------------------------------------------------
# Strumenti


def register_contributor(args, user_id, username):
    contributor = queue.register_contributor(
        user_id,
        username,
        {
            "firstName": args.get("first_name"),
            "lastName": args.get("last_name"),
            "affiliation": args.get("affiliation"),
            "role": args.get("role"),
            "orcid": args.get("orcid"),
            "lab": args.get("lab"),
            "email": args.get("email"),
            "language": args.get("language"),
            "acceptTerms": args.get("accept_terms") is True,
        },
    )
    return _reply(success=True, profile=queue.public_profile(contributor))


def profile(args, user_id, username):
    del args, username
    contributor = queue.get_contributor(user_id)
    language = queue.get_language(user_id) or None
    if not contributor:
        return _reply(success=True, registered=False, language=language, roles=list(queue.ROLES))
    mine = queue.submissions_for(user_id)
    counts = {status: sum(1 for s in mine if s["status"] == status) for status in queue.STATUSES}
    return _reply(success=True, registered=True, language=language, profile=queue.public_profile(contributor), submissions=counts)


def submit_photo(args, user_id, username):
    del username
    source = _attachment(str(args.get("file_path") or ""))
    if source is None:
        return _fail(
            "no_attachment",
            "Non trovo la foto ricevuta. Chiedi di inviarla di nuovo, come file, in questa chat.",
        )
    lat, lng = args.get("latitude"), args.get("longitude")
    try:
        lat = float(lat) if lat not in (None, "") else None
        lng = float(lng) if lng not in (None, "") else None
    except (TypeError, ValueError):
        return _fail("bad_position", "Le coordinate devono essere numeri decimali.")
    entry = queue.submit(
        user_id,
        source,
        original_name=source.name.split("_", 2)[-1],
        notes=str(args.get("notes") or ""),
        lat=lat,
        lng=lng,
        location_hint=str(args.get("location_hint") or ""),
    )
    return _reply(
        success=True,
        submission={
            "id": entry["id"],
            "status": entry["status"],
            "position": entry["positionSource"] or "location hint only",
            "capturedAt": entry["capturedAt"],
            "camera": entry["camera"],
        },
        message="Foto ricevuta: e' in attesa di moderazione. Riceverai un messaggio quando verra' esaminata.",
    )


def set_language(args, user_id, username):
    del username
    return _reply(success=True, language=queue.set_language(user_id, str(args.get("language") or "")))


def add_comment(args, user_id, username):
    del username
    entry = queue.add_comment(user_id, str(args.get("submission_id") or ""), str(args.get("comment") or ""))
    return _reply(success=True, submission={"id": entry["id"], "file": entry["originalName"], "notes": entry["notes"]})


def my_submissions(args, user_id, username):
    del args, username
    rows = [
        {
            "id": s["id"],
            "file": s["originalName"],
            "sent": s["createdAt"][:10],
            "status": s["status"],
            "note": s.get("reviewNote") or None,
            "record": s.get("recordId"),
        }
        for s in queue.submissions_for(user_id)
    ]
    return _reply(success=True, submissions=rows[-30:], total=len(rows))


def delete_my_data(args, user_id, username):
    del username
    if args.get("confirm") is not True:
        return _fail("not_confirmed", "Chiedi una conferma esplicita prima di cancellare i dati.")
    return _reply(success=True, **queue.delete_contributor(user_id))


# --------------------------------------------------------------------------
# Schemi visti dal modello

_STRING = {"type": "string"}

TOOLS = [
    (
        "masonry_register",
        register_contributor,
        "Register or update the sender as a contributor to The Masonry Archive. Ask the user for every "
        "required field first; set accept_terms to true only after the user has explicitly agreed to "
        "license their photos under CC BY 4.0 and to the privacy notice.",
        {
            "first_name": _STRING,
            "last_name": _STRING,
            "affiliation": {"type": "string", "description": "University, company or institution"},
            "role": {"type": "string", "enum": list(queue.ROLES)},
            "accept_terms": {"type": "boolean"},
            "orcid": {"type": "string", "description": "Optional ORCID iD"},
            "lab": {"type": "string", "description": "Optional laboratory or research group"},
            "email": {"type": "string", "description": "Optional contact email"},
            "language": {"type": "string", "enum": list(queue.LANGUAGES), "description": "Language for messages"},
        },
        ["first_name", "last_name", "affiliation", "role", "accept_terms"],
    ),
    (
        "masonry_profile",
        profile,
        "Return whether the sender is registered, their profile, and how many of their photos are in "
        "each review status. Call this at the start of a conversation.",
        {},
        [],
    ),
    (
        "masonry_submit_photo",
        submit_photo,
        "Submit a photo the user just sent to the moderation queue. file_path is the path shown in the "
        "'[Image attached at: ...]' or 'saved at: ...' note of the user's message. If the result is "
        "missing_position, ask the user where the photo was taken and call again with location_hint "
        "or latitude/longitude.",
        {
            "file_path": _STRING,
            "notes": {"type": "string", "description": "What the photo shows, in the user's words"},
            "location_hint": {"type": "string", "description": "Place name given by the user"},
            "latitude": {"type": "number"},
            "longitude": {"type": "number"},
        },
        ["file_path"],
    ),
    (
        "masonry_set_language",
        set_language,
        "Set the language (it or en) used for the user's messages and review notifications.",
        {"language": {"type": "string", "enum": list(queue.LANGUAGES)}},
        ["language"],
    ),
    (
        "masonry_add_comment",
        add_comment,
        "Add the user's comment to a photo they already sent and that is still under review: why they "
        "sent it, what it shows (e.g. 'evident decay of the mortar joints'). Without submission_id the "
        "comment goes to their most recent photo.",
        {
            "submission_id": {"type": "string", "description": "Id returned by masonry_submit_photo; optional"},
            "comment": _STRING,
        },
        ["comment"],
    ),
    (
        "masonry_my_submissions",
        my_submissions,
        "List the sender's own submitted photos with their review status.",
        {},
        [],
    ),
    (
        "masonry_delete_my_data",
        delete_my_data,
        "Delete the sender's profile and all their photos not yet published. Only call with "
        "confirm=true after the user has explicitly confirmed.",
        {"confirm": {"type": "boolean"}},
        ["confirm"],
    ),
]


# --------------------------------------------------------------------------
# Portiere: il codice d'invito
#
# Il bot e' aperto a tutti su Telegram (TELEGRAM_ALLOW_ALL_USERS nel profilo),
# quindi niente codici di abbinamento da girare all'amministratore. Chi non e'
# ancora registrato deve pero' scrivere il codice d'invito: fino ad allora
# riceve una risposta fissa e il modello non viene chiamato, cosi' uno
# sconosciuto non tiene occupata la CPU. L'hook gira solo per questo profilo.

WELCOME_LOCKED = (
    "🧱 The Masonry Archive\n\n"
    "🇮🇹 Questo bot raccoglie foto di murature storiche per un archivio di ricerca aperto.\n"
    "• Hai un codice d'invito? Scrivilo qui.\n"
    "• Non ce l'hai? Scrivi in un messaggio chi sei (nome, ente, ruolo) e perche' vuoi contribuire: "
    "la richiesta arriva all'amministratore.\n\n"
    "🇬🇧 This bot collects photos of historic masonry for an open research archive.\n"
    "• Have an invitation code? Type it here.\n"
    "• No code? Write in one message who you are (name, institution, role) and why you'd like to "
    "contribute: your request goes to the administrator."
)
CHOOSE_LANGUAGE = (
    "🧱 Benvenuto in The Masonry Archive! · Welcome to The Masonry Archive!\n\n"
    "In che lingua preferisci i messaggi? Scrivi IT o EN.\n"
    "Which language would you like? Type IT or EN."
)
REQUEST_SENT = (
    "📨 Richiesta inviata all'amministratore: riceverai qui la risposta.\n"
    "📨 Request sent to the administrator: you'll get the answer here."
)
REQUEST_PENDING = (
    "⏳ La tua richiesta e' gia' all'esame dell'amministratore.\n"
    "⏳ Your request is already with the administrator."
)
# Un messaggio piu' corto non e' una presentazione ("ciao", "?"): si ripete il benvenuto.
MIN_REQUEST_LENGTH = 20


def _notify_admin(entry) -> None:
    """Avvisa l'amministratore dal suo bot, senza aspettare: l'hook deve restare rapido."""
    # Posizione nella lista di /richieste: /ammettiN e' cliccabile, "/ammetti <id>" no.
    pending = sorted((r for r in queue.load_requests() if r["status"] == "pending"), key=lambda r: r["createdAt"])
    n = next((i for i, r in enumerate(pending, 1) if r["id"] == entry["id"]), 0)
    admit = f"/ammetti{n}" if 0 < n <= 10 else f"/ammetti {entry['id']}"
    text = (f"🙋 Richiesta d'invito da @{entry['telegramUsername'] or '—'}:\n"
            f"{entry['text']}\n\n{admit}  ·  /respingi {entry['id']} [motivo]")
    subprocess.Popen(["hermes", "-p", ADMIN_PROFILE, "send", "-q", "--to", "telegram", text],
                     stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def gate(platform, source, text, **kwargs):
    del kwargs
    source = source or {}
    user_id = str(source.get("user_id") or "")
    if platform != "telegram" or not user_id or source.get("chat_type") in ("group", "forum", "channel"):
        return None
    text = text or ""

    if queue.is_admitted(user_id):
        # Prima scelta di lingua: si registra e il messaggio prosegue al modello,
        # che saluta e avvia la registrazione nella lingua scelta.
        if not queue.get_language(user_id) and queue.language_choice(text):
            queue.set_language(user_id, queue.language_choice(text))
        return None

    code = queue.invite_code()
    if not code or code in "".join(text.split()).upper():
        queue.admit(user_id)
        return {"action": "handled", "reply": CHOOSE_LANGUAGE}

    if not queue.was_welcomed(user_id) or len(text.strip()) < MIN_REQUEST_LENGTH:
        queue.mark_welcomed(user_id)
        return {"action": "handled", "reply": WELCOME_LOCKED}
    try:
        entry = queue.request_invite(user_id, str(source.get("user_name") or ""), text)
    except queue.IntakeError:
        return {"action": "handled", "reply": REQUEST_PENDING}
    _notify_admin(entry)
    return {"action": "handled", "reply": REQUEST_SENT}


def register(ctx) -> None:
    ctx.register_hook("post_gateway_admission", gate)
    for name, handler, description, properties, required in TOOLS:
        ctx.register_tool(
            name=name,
            toolset="masonry_contrib",
            schema={
                "name": name,
                "description": description,
                "parameters": {"type": "object", "properties": properties, "required": required},
            },
            handler=_guarded(handler),
        )
