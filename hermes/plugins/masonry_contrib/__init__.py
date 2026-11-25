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
from datetime import datetime, timezone
import re
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


def request_change(args, user_id, username):
    del username
    change = queue.request_change(user_id, str(args.get("photo") or ""), str(args.get("request") or ""))
    return _reply(success=True, request=change["id"],
                  message="Richiesta inviata all'amministratore: ti risponderà qui.")


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
            "link": queue.record_url(s["recordId"]) if s.get("notifiedStatus") == "published" else None,
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
        "masonry_request_change",
        request_change,
        "Forward to the administrator the user's request to correct one of their photos (description, "
        "location, title, removal…). photo is the id or record from masonry_my_submissions; if the user "
        "has only one photo it can be omitted.",
        {"photo": _STRING, "request": {"type": "string", "description": "What the user wants changed, in their words"}},
        ["request"],
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
    "🧱 Welcome! · Benvenuto!\n\n"
    "🇬🇧 The Masonry Archive collects photos of historic masonry for an open research archive.\n"
    "1. Type your invitation code here. No code? Write in one message who you are (name, "
    "institution, role) and why you'd like to contribute: the administrator will reply here, "
    "please wait for the answer.\n"
    "2. Choose your language and register (5 quick questions).\n"
    "3. Send your photos as FILES (📎 → File) so they keep their GPS position. If a photo has no "
    "position: send your location (📎 → Location) if you are on site, or type the address if it's "
    "an older photo from your library.\n\n"
    "🇮🇹 The Masonry Archive raccoglie foto di murature storiche per un archivio di ricerca aperto.\n"
    "1. Scrivi qui il codice d'invito. Non ce l'hai? Scrivi in un messaggio chi sei (nome, ente, "
    "ruolo) e perche' vuoi contribuire: l'amministratore ti rispondera' qui, attendi la risposta.\n"
    "2. Scegli la lingua e registrati (5 domande veloci).\n"
    "3. Invia le foto come FILE (📎 → File), cosi' mantengono la posizione GPS. Se una foto non ha "
    "la posizione: manda la tua posizione (📎 → Posizione) se sei sul posto, oppure scrivi "
    "l'indirizzo se e' una foto vecchia della tua galleria."
)
CHOOSE_LANGUAGE = (
    "🧱 Welcome to The Masonry Archive! · Benvenuto in The Masonry Archive!\n\n"
    "Which language would you like? Type EN or IT.\n"
    "In che lingua preferisci i messaggi? Scrivi EN o IT."
)
REQUEST_SENT = (
    "📨 Request sent to the administrator: you'll get the answer here.\n"
    "📨 Richiesta inviata all'amministratore: riceverai qui la risposta."
)
REQUEST_PENDING = (
    "⏳ Your request is already with the administrator: please wait for the answer.\n"
    "⏳ La tua richiesta e' gia' all'esame dell'amministratore: attendi la risposta."
)
# Un messaggio piu' corto non e' una presentazione ("ciao", "?"): si ripete il benvenuto.
MIN_REQUEST_LENGTH = 20


# --------------------------------------------------------------------------
# Registrazione guidata
#
# Una serie fissa di domande non ha bisogno del modello: il portiere le pone e
# raccoglie le risposte con testi fissi, all'istante. Il modello entra in gioco
# solo da registrati, per le foto e le domande libere. ORCID, laboratorio ed
# email restano facoltativi: si aggiungono dopo, chiedendolo al bot.

STEPS = ("firstName", "lastName", "affiliation", "role", "terms")
ROLE_WORDS = {
    "Student": {"1", "student", "studente", "studentessa"},
    "PhD candidate": {"2", "phd", "phd candidate", "dottorando", "dottoranda", "dottorato"},
    "Researcher": {"3", "researcher", "ricercatore", "ricercatrice", "docente", "professore", "professoressa"},
    "Professional": {"4", "professional", "professionista", "ingegnere", "architetto", "tecnico"},
}
YES = {"si", "sì", "yes", "y", "s", "ok", "okay", "accetto", "accetta", "i agree", "agree", "va bene", "certo", "d'accordo"}
NO = {"no", "n", "non accetto", "rifiuto", "decline"}

REGISTRATION = {
    "it": {
        "intro": "Perfetto, ti scrivo in italiano. Bastano cinque domande per registrarti.",
        "firstName": "1/5 · Il tuo nome?",
        "lastName": "2/5 · Il tuo cognome?",
        "affiliation": "3/5 · La tua affiliazione (università, ente, studio)?",
        "role": "4/5 · Il tuo ruolo? Rispondi con il numero:\n1 Studente · 2 Dottorando · 3 Ricercatore · 4 Professionista",
        "terms": (
            "5/5 · Inviando foto confermi di averle scattate tu e le concedi con licenza "
            "Creative Commons Attribution 4.0 (CC BY 4.0): chiunque puo' riusarle citandoti.\n"
            "Privacy: conserviamo nome, affiliazione, ruolo e il tuo ID Telegram solo per attribuirti le foto e "
            "avvisarti dell'esito. Le foto restano private fino alla revisione; quelle non accettate vengono "
            "eliminate. Puoi chiedere in ogni momento di cancellare i tuoi dati.\n\nAccetti? (si/no)"
        ),
        "invalid": "Non ho capito. ",
        "declined": "Senza il consenso non posso registrarti. Se cambi idea, scrivi si.",
        "photoFirst": "Prima completiamo la registrazione, poi potrai inviare le foto. ",
        "done": (
            "✅ Registrazione completata, {name}! Ora puoi inviare le foto.\n\n"
            "📎 Inviale come FILE (graffetta → File), non come foto: Telegram cancella il GPS dalle foto "
            "compresse. Nella didascalia scrivi pure perche' la carichi (es. «evidente stato di degrado»).\n"
            "ORCID, laboratorio o email si possono aggiungere quando vuoi: chiedimelo."
        ),
    },
    "en": {
        "intro": "Great, I'll write to you in English. Five questions and you're registered.",
        "firstName": "1/5 · Your first name?",
        "lastName": "2/5 · Your last name?",
        "affiliation": "3/5 · Your affiliation (university, institution, firm)?",
        "role": "4/5 · Your role? Reply with the number:\n1 Student · 2 PhD candidate · 3 Researcher · 4 Professional",
        "terms": (
            "5/5 · By sending photos you confirm that you took them yourself and you license them under "
            "Creative Commons Attribution 4.0 (CC BY 4.0): anyone may reuse them, crediting you.\n"
            "Privacy: we keep your name, affiliation, role and Telegram ID only to credit your photos and tell "
            "you the outcome. Photos stay private until reviewed; photos that aren't accepted are deleted. You "
            "can ask to delete your data at any time.\n\nDo you agree? (yes/no)"
        ),
        "invalid": "Sorry, I didn't get that. ",
        "declined": "I can't register you without your consent. If you change your mind, type yes.",
        "photoFirst": "Let's finish the registration first, then you can send photos. ",
        "done": (
            "✅ You're registered, {name}! You can send photos now.\n\n"
            "📎 Send them as FILES (paperclip → File), not as photos: Telegram strips the GPS from compressed "
            "photos. Use the caption to say why you're sending it (e.g. \"evident decay\").\n"
            "You can add ORCID, lab or email whenever you like: just ask me."
        ),
    },
}


def _question(language: str, step: int) -> str:
    return REGISTRATION[language][STEPS[step]]


def _registration_step(user_id: str, username: str, language: str, text: str):
    words = REGISTRATION[language]
    state = queue.get_registration(user_id)
    if state is None:
        # Registrazione mai iniziata (es. ammesso prima di questo flusso): il messaggio
        # non e' una risposta, quindi si parte dalla prima domanda.
        queue.set_registration(user_id, {"step": 0, "data": {}})
        return {"action": "handled", "reply": words["intro"] + "\n\n" + _question(language, 0)}
    step, data = int(state.get("step", 0)), dict(state.get("data") or {})
    answer = " ".join(text.split())
    if not answer:  # una foto o un allegato senza testo
        return {"action": "handled", "reply": words["photoFirst"] + _question(language, step)}

    field = STEPS[step]
    if field in ("firstName", "lastName", "affiliation"):
        if len(answer) > (160 if field == "affiliation" else 80) or answer.startswith("/"):
            return {"action": "handled", "reply": words["invalid"] + _question(language, step)}
        data[field] = answer
    elif field == "role":
        role = next((r for r, options in ROLE_WORDS.items() if answer.lower().strip(".") in options), "")
        if not role:
            return {"action": "handled", "reply": words["invalid"] + _question(language, step)}
        data["role"] = role
    else:  # terms
        reply = answer.lower().strip(".!")
        if reply in NO:
            return {"action": "handled", "reply": words["declined"]}
        if reply not in YES:
            return {"action": "handled", "reply": words["invalid"] + _question(language, step)}
        try:
            queue.register_contributor(user_id, username, {**data, "language": language, "acceptTerms": True})
        except queue.IntakeError as error:
            return {"action": "handled", "reply": error.message}
        queue.set_registration(user_id, None)
        return {"action": "handled", "reply": words["done"].format(name=data.get("firstName", ""))}

    queue.set_registration(user_id, {"step": step + 1, "data": data})
    return {"action": "handled", "reply": _question(language, step + 1)}


# --------------------------------------------------------------------------
# Invio delle foto
#
# Il modello piccolo, senza ragionamento, tende a descrivere la foto invece di
# inviarla. Quindi la decisione non e' sua: `pre_llm_call` riceve il messaggio con
# il percorso dell'allegato ("[Image attached at: …]"), mette la foto in coda e
# prepara la risposta, che `transform_llm_output` sostituisce a quella del modello.
# Le domande successive (provenienza se manca il GPS, motivo dell'invio se manca
# la didascalia) le raccoglie il portiere, perche' le risposte sono solo testo.

PHOTO = {
    "it": {
        "received": "📥 Foto ricevuta, grazie!",
        "receivedMany": "📥 {n} foto ricevute, grazie!",
        "askPosition": (
            "La foto non contiene la posizione GPS: da dove viene?\n"
            "• Sei ancora sul posto? Manda la tua posizione: 📎 → Posizione.\n"
            "• E' una foto vecchia della galleria? Scrivi l'indirizzo o il luogo "
            "(es. «Spello, Porta Venere») oppure le coordinate (es. 44.4938, 11.3426)."
        ),
        "confirmPlace": "📍 Ho trovato: {name}\nE' giusto? Rispondi «si», oppure mandami la posizione o un indirizzo piu' preciso.",
        "placeNotFound": "Non trovo questo luogo sulla mappa: lo salvo cosi' e la posizione la sistemera' l'amministratore.",
        "answerThanks": "✅ Grazie, ho girato la tua risposta all'amministratore.",
        "askNote": (
            "Perche' l'hai scattata? Scrivi una breve nota, ad esempio «evidente stato di degrado» "
            "o «fessura sopra l'arco». (Se non vuoi aggiungerla, scrivi salta.)"
        ),
        "done": "✅ Grazie! La foto e' in moderazione: riceverai qui un messaggio con l'esito.",
        "tip": ("\n\n📎 Telegram l'ha ricevuta come foto compressa (1280 px, senza GPS ne' data). "
                "La prossima volta inviala come FILE: graffetta → File → scegli la foto."),
        "errors": {
            "duplicate": "Questa foto e' gia' stata inviata o e' gia' nell'archivio.",
            "not_an_image": "Questo file non e' una foto (JPEG, HEIC, PNG, WebP o TIFF).",
            "too_large": "Il file e' troppo grande (massimo 25 MB).",
            "daily_limit": "Hai raggiunto il limite di foto per oggi: riprova domani.",
            "no_attachment": "Non riesco a leggere la foto: prova a inviarla di nuovo, come file.",
        },
    },
    "en": {
        "received": "📥 Photo received, thank you!",
        "receivedMany": "📥 {n} photos received, thank you!",
        "askPosition": (
            "The photo has no GPS position: where was it taken?\n"
            "• Still on site? Send your location: 📎 → Location.\n"
            "• An older photo from your library? Type the address or the place "
            "(e.g. \"Spello, Porta Venere\") or the coordinates (e.g. 44.4938, 11.3426)."
        ),
        "confirmPlace": "📍 I found: {name}\nIs that right? Reply \"yes\", or send the location or a more precise address.",
        "placeNotFound": "I can't find this place on the map: I'll keep it as written and the administrator will place it.",
        "answerThanks": "✅ Thank you, I've passed your answer on to the administrator.",
        "askNote": (
            "Why did you take it? Write a short note, for example \"evident decay\" or "
            "\"crack above the arch\". (Type skip if you'd rather not.)"
        ),
        "done": "✅ Thank you! The photo is under review: you'll get a message here with the outcome.",
        "tip": ("\n\n📎 Telegram received it as a compressed photo (1280 px, no GPS or date). "
                "Next time send it as a FILE: paperclip → File → pick the photo."),
        "errors": {
            "duplicate": "This photo has already been sent or is already in the archive.",
            "not_an_image": "This file is not a photo (JPEG, HEIC, PNG, WebP or TIFF).",
            "too_large": "The file is too large (25 MB at most).",
            "daily_limit": "You've reached today's photo limit: please try again tomorrow.",
            "no_attachment": "I can't read the photo: please send it again, as a file.",
        },
    },
}
SKIP = {"salta", "skip", "no", "-", "niente", "nessuna", "none"}
FLOW_TTL = 24 * 3600  # secondi: oltre, le domande in sospeso decadono
# Testo che Hermes mette al posto della didascalia quando una foto arriva senza.
_DEFAULT_CAPTION = "What do you see in this image?"
_ATTACHMENT_RE = re.compile(r"\[Image attached at: ([^\]]+)\]|saved at: ([^\s\]]+?)[.\]]?(?:\s|$)")
# Risposta pronta per il turno in corso, per sessione: la consegna transform_llm_output.
_REPLIES: dict[str, str] = {}


def _message_text(user_message) -> str:
    if isinstance(user_message, list):
        return "\n".join(str(p.get("text", "")) for p in user_message if isinstance(p, dict) and p.get("type") == "text")
    return str(user_message or "")


def _next_question(flow: dict, words: dict) -> str:
    if flow.get("needPosition"):
        return words["askPosition"]
    if flow.get("needNote"):
        return words["askNote"]
    return ""


def intake_photos(session_id="", user_message=None, sender_id="", platform="", **kwargs):
    del kwargs
    user_id = str(sender_id or "")
    if not user_id:
        from gateway.session_context import get_session_env

        user_id = get_session_env("HERMES_SESSION_USER_ID")
    if platform != "telegram" or not user_id or not queue.get_contributor(user_id):
        return None
    text = _message_text(user_message)
    paths = [a or b for a, b in _ATTACHMENT_RE.findall(text)]
    if not paths:
        return None
    # Didascalia = il testo dell'utente, senza le note che Hermes aggiunge sugli allegati.
    caption = re.sub(r"\[(?:The user sent|Image attached)[^\]]*\]", "", text).replace(_DEFAULT_CAPTION, "")
    caption = " ".join(caption.split())

    words = PHOTO[queue.get_language(user_id) or "it"]
    accepted, errors, no_gps, previews = [], [], [], []
    for raw in paths:
        source = _attachment(raw)
        if source is None:
            errors.append(words["errors"]["no_attachment"])
            continue
        try:
            entry = queue.submit(user_id, source, original_name=source.name.split("_", 2)[-1],
                                 notes=caption, require_position=False)
        except queue.IntakeError as error:
            errors.append(words["errors"].get(error.code, error.message))
            continue
        accepted.append(entry["id"])
        # Un HEIC inviato come file in chat appare come documento senza miniatura:
        # si risponde con l'anteprima, cosi' chi lo manda vede che e' la foto giusta.
        if Path(entry["file"]).suffix.lower() in (".heic", ".heif"):
            preview = queue.preview_jpeg(queue.INCOMING / entry["file"])
            if preview:
                previews.append(f"MEDIA:{preview}")
        if entry["positionSource"] is None:
            no_gps.append(entry["id"])

    parts = []
    if accepted:
        flow = queue.get_photo_flow(user_id) or {"needPosition": [], "needNote": []}
        flow["needPosition"] = sorted(set(flow.get("needPosition", [])) | set(no_gps))
        if not caption:
            flow["needNote"] = sorted(set(flow.get("needNote", [])) | set(accepted))
        flow["at"] = datetime.now(timezone.utc).isoformat()
        queue.set_photo_flow(user_id, flow if (flow["needPosition"] or flow["needNote"]) else None)
        parts.append(words["received"] if len(accepted) == 1 else words["receivedMany"].format(n=len(accepted)))
        question = _next_question(flow, words)
        parts.append(question or words["done"])
        if no_gps:
            parts[-1] += words["tip"]
    parts += sorted(set(errors))
    parts += previews
    _REPLIES[str(session_id)] = "\n\n".join(parts)
    # Il modello gira comunque: gli si chiede una risposta minima, che verra' sostituita.
    return {"context": "The attached photo has already been handled by the system. Reply with just: OK"}


def replace_reply(response_text="", session_id="", **kwargs):
    del response_text, kwargs
    return _REPLIES.pop(str(session_id), None)


YES_WORDS = {"si", "sì", "yes", "y", "ok", "okay", "esatto", "giusto", "corretto", "right", "correct", "certo"}
NO_WORDS = {"no", "n", "non e' giusto", "non è giusto", "sbagliato", "errato", "wrong", "nope", "not right"}


def _photo_flow_step(user_id: str, text: str):
    flow = queue.get_photo_flow(user_id)
    answer = " ".join((text or "").split())
    if not flow or not answer:
        return None  # nessuna domanda in sospeso, o un'altra foto: al modello
    # Una domanda di giorni fa non aspetta piu' risposta: il messaggio di oggi e' un'altra cosa.
    asked = flow.get("at")
    if not asked or (datetime.now(timezone.utc) - datetime.fromisoformat(asked)).total_seconds() > FLOW_TTL:
        queue.set_photo_flow(user_id, None)
        return None
    words = PHOTO[queue.get_language(user_id) or "it"]
    reply_prefix = ""
    answered_admin = False

    confirmed = False
    if flow.get("confirm"):
        # Luogo trovato a partire da un testo: "si" lo conferma (e la risposta finisce qui),
        # qualunque altra cosa e' una nuova posizione da cercare.
        found = flow.pop("confirm")
        if answer.lower().strip(".!") in YES_WORDS:
            queue.set_position(user_id, found["ids"], lat=found["lat"], lng=found["lng"], hint=found["name"])
            flow["needPosition"] = []
            confirmed = True
        else:
            flow["needPosition"] = found["ids"]
            if answer.lower().strip(".!") in NO_WORDS:
                # "No" non e' un luogo: si richiede la posizione.
                flow["at"] = datetime.now(timezone.utc).isoformat()
                queue.set_photo_flow(user_id, flow)
                return {"action": "handled", "reply": words["askPosition"]}
    if confirmed:
        pass
    elif flow.get("needPosition"):
        # Puntina di Telegram ("latitude: … longitude: …"), coordinate scritte o luogo a parole.
        coords = queue.parse_coordinates(answer)
        if coords:
            queue.set_position(user_id, flow["needPosition"], lat=coords[0], lng=coords[1])
            flow["needPosition"] = []
        else:
            found = queue.find_place(answer, near=queue.last_position(user_id))
            if found:
                flow["confirm"] = {"ids": flow["needPosition"], "lat": found["lat"], "lng": found["lng"],
                                   "name": found["name"]}
                flow["needPosition"] = []
                flow["at"] = datetime.now(timezone.utc).isoformat()
                queue.set_photo_flow(user_id, flow)
                return {"action": "handled", "reply": words["confirmPlace"].format(name=found["name"])}
            queue.set_position(user_id, flow["needPosition"], hint=answer)
            flow["needPosition"] = []
            reply_prefix = words["placeNotFound"] + "\n\n"
    elif flow.get("needNote"):
        if answer.lower().strip(".!") not in SKIP:
            for submission_id in flow["needNote"]:
                try:
                    queue.add_comment(user_id, submission_id, answer)
                except queue.IntakeError:
                    pass  # foto gia' esaminata nel frattempo: la nota non serve piu'
        flow["needNote"] = []
    elif flow.get("adminQuestion"):
        # Risposta a una domanda dell'admin (/chiedi): resta sulla foto e gli viene inoltrata.
        question = flow.pop("adminQuestion")
        entry = queue.add_answer(user_id, question["submission"], question["question"], answer)
        person = queue.get_contributor(user_id) or {}
        who = f"{person.get('firstName', '')} {person.get('lastName', '')}".strip()
        if entry:
            queue.send_to_admin(f"💬 Risposta di {who} su «{entry['originalName']}» "
                                f"({entry.get('recordId') or entry['id']}):\n{answer}")
        reply_prefix = words["answerThanks"] + "\n\n"
        answered_admin = True

    question = _next_question(flow, words)
    keep = question or flow.get("adminQuestion")
    if keep:
        flow["at"] = datetime.now(timezone.utc).isoformat()
    queue.set_photo_flow(user_id, flow if keep else None)
    if question:
        return {"action": "handled", "reply": reply_prefix + question}
    # Dopo una risposta all'admin basta il grazie; dopo le domande su una foto, la conferma.
    return {"action": "handled", "reply": reply_prefix.strip() if answered_admin else reply_prefix + words["done"]}


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


# Menu dei comandi: Hermes pubblica i suoi ~60 comandi (/model, /yolo…) per tutte le chat,
# e li riscrive a ogni avvio. Un menu impostato per la singola chat ha la precedenza e
# Hermes non lo tocca: ai contributori resta solo /new.
CONTRIB_MENU = [{"command": "new", "description": "Start over / Ricomincia la conversazione"}]


def _set_chat_menu(user_id: str) -> None:
    import threading
    import urllib.parse
    import urllib.request

    def push() -> None:
        try:
            from hermes_constants import get_hermes_home

            env = (get_hermes_home() / ".env").read_text()
            token = next(l.split("=", 1)[1].strip() for l in env.splitlines() if l.startswith("TELEGRAM_BOT_TOKEN="))
            data = urllib.parse.urlencode({"commands": json.dumps(CONTRIB_MENU),
                                           "scope": json.dumps({"type": "chat", "chat_id": int(user_id)})}).encode()
            urllib.request.urlopen(f"https://api.telegram.org/bot{token}/setMyCommands", data=data, timeout=30)
            queue._set_preference(user_id, menuSet=True)
        except Exception:
            pass  # riprova al prossimo messaggio

    threading.Thread(target=push, daemon=True).start()


def gate(platform, source, text, **kwargs):
    del kwargs
    source = source or {}
    user_id = str(source.get("user_id") or "")
    if platform != "telegram" or not user_id or source.get("chat_type") in ("group", "forum", "channel"):
        return None
    text = text or ""
    if not queue._preferences().get(queue.contributor_key(user_id), {}).get("menuSet"):
        _set_chat_menu(user_id)

    if queue.is_admitted(user_id):
        if queue.get_contributor(user_id):
            # Registrato: se dopo un invio ci sono domande in sospeso (provenienza,
            # motivo) la risposta la raccoglie il portiere; il resto va al modello.
            return _photo_flow_step(user_id, text)
        language = queue.get_language(user_id)
        if not language:
            choice = queue.language_choice(text)
            if not choice:
                return {"action": "handled", "reply": CHOOSE_LANGUAGE}
            queue.set_language(user_id, choice)
            queue.set_registration(user_id, {"step": 0, "data": {}})
            return {"action": "handled", "reply": REGISTRATION[choice]["intro"] + "\n\n" + _question(choice, 0)}
        return _registration_step(user_id, str(source.get("user_name") or ""), language, text)

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
    ctx.register_hook("pre_llm_call", intake_photos)
    ctx.register_hook("transform_llm_output", replace_reply)
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
