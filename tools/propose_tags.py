#!/usr/bin/env python3
"""Proposte di catalogazione notturne, da un modello di visione locale.

Prende alcune foto `pending` senza titolo o senza tag, le mostra al modello
(Ollama, di default `qwen3.5:9b`) insieme ai vocabolari di `src/vocabulary.ts`
e scrive cio' che propone in `src/data/suggestions.json`, come proposte
`pending` a nome "Hermes". Non tocca mai `records.json`: si accettano o si
scartano una per una dal pannello admin, dove compaiono gia' accanto alla foto
come le proposte degli utenti.

Gira di notte (cron di Hermes, profilo `masonry-admin`) perche' su CPU il
modello impiega minuti per foto. `keep_alive` corto: finito il lavoro, il
modello esce dalla memoria e non pesa sui bot di giorno.

Attenzione: il pannello salva `suggestions.json` per intero. Se lo si lascia
aperto con modifiche non salvate durante l'esecuzione, al salvataggio le
proposte della notte vanno perse (e il ricaricamento a caldo di Vite puo'
azzerare le modifiche in corso). Salvare prima di sera.

    python3 tools/propose_tags.py [--limit 10] [--model qwen3.5:9b] [--dry-run]
"""

from __future__ import annotations

import argparse
import base64
import io
import json
import os
import re
import sys
import time
import urllib.error
import urllib.request
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RECORDS = ROOT / "src" / "data" / "records.json"
SUGGESTIONS = ROOT / "src" / "data" / "suggestions.json"
VOCABULARY = ROOT / "src" / "vocabulary.ts"
PUBLIC = ROOT / "public"

OLLAMA = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
FIELDS = ("title", "element", "technique", "material", "period")
MAX_TAGS = 5

SCHEMA = {
    "type": "object",
    "properties": {
        "title": {"type": "string"},
        "element": {"type": "string"},
        "technique": {"type": "string"},
        "material": {"type": "string"},
        "period": {"type": "string"},
        "tags": {"type": "array", "items": {"type": "string"}},
        "confidence": {"type": "number"},
        "rationale": {"type": "string"},
    },
    "required": ["title", "element", "technique", "material", "period", "tags", "confidence", "rationale"],
}


def vocabulary() -> dict[str, list[str]]:
    """Gli array esportati da src/vocabulary.ts, letti senza eseguire TypeScript."""
    source = VOCABULARY.read_text(encoding="utf-8")
    found = {}
    for name in ("ELEMENTS", "TECHNIQUES", "MATERIALS", "PERIODS", "TAGS"):
        block = re.search(rf"export const {name} = \[(.*?)\];", source, re.S)
        found[name.lower()] = re.findall(r"'([^']+)'", block.group(1)) if block else []
    return found


def image_payload(path: Path) -> str:
    """Base64 per Ollama, in JPEG: il WebP non e' accettato da tutti i backend."""
    raw = path.read_bytes()
    try:
        from PIL import Image

        buffer = io.BytesIO()
        Image.open(io.BytesIO(raw)).convert("RGB").save(buffer, "JPEG", quality=88)
        raw = buffer.getvalue()
    except ImportError:
        pass
    return base64.b64encode(raw).decode("ascii")


def prompt_for(record: dict, vocab: dict[str, list[str]], tags: list[str]) -> str:
    place = ", ".join(p for p in (record.get("location"), record.get("state"), record.get("country")) if p)
    return f"""You are helping catalogue a research archive of historic masonry photographs.
Look at the photo and describe the masonry you can actually see. Be conservative: if you are not
sure about a field, return an empty string rather than guessing. Never invent a specific building name.

Context: taken in {place or "an unknown place"}{f" on {record['capturedAt'][:10]}" if record.get("capturedAt") else ""}.

Fields (English):
- title: short descriptive title, e.g. "Brick barrel vault with lime mortar joints" (max 70 characters)
- element: preferably one of {vocab['elements']}
- technique: preferably one of {vocab['techniques']}
- material: preferably one of {vocab['materials']}
- period: one of {vocab['periods']} — use "Undetermined" unless the photo really shows it
- tags: up to {MAX_TAGS} lowercase keywords, preferably from {tags}
- confidence: 0 to 1, how sure you are overall
- rationale: one sentence on the visual evidence you used"""


def ask(model: str, prompt: str, image: str, timeout: int) -> dict:
    body = {
        "model": model,
        "messages": [{"role": "user", "content": prompt, "images": [image]}],
        "format": SCHEMA,
        "stream": False,
        "think": False,
        "keep_alive": "2m",
        # Contesto piccolo: prompt e un'immagine stanno in 8k, e il server di default
        # ne allocherebbe 64k (quanti ne servono a Hermes), ~2 GB di RAM in piu' per niente.
        "options": {"temperature": 0.2, "num_ctx": 8192},
    }
    request = urllib.request.Request(
        f"{OLLAMA}/api/chat", data=json.dumps(body).encode(), headers={"Content-Type": "application/json"}
    )
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(json.loads(response.read())["message"]["content"])


def suggestions_from(record: dict, answer: dict, model: str) -> list[dict]:
    stamp = datetime.now(timezone.utc).replace(microsecond=0).isoformat()
    note = f"{answer.get('rationale', '').strip()} (confidence {float(answer.get('confidence') or 0):.2f})"
    base = {"recordId": record["id"], "author": f"Hermes · {model}", "rationale": note,
            "submittedAt": stamp, "status": "pending"}
    made = []
    # Solo i campi vuoti: il lavoro gia' fatto a mano non si rimette in discussione.
    for field in FIELDS:
        value = str(answer.get(field) or "").strip()
        if value and not str(record.get(field) or "").strip() and not (field == "period" and value == "Undetermined"):
            made.append({**base, "id": f"ai-{record['id']}-{field}", "kind": "text", "field": field, "value": value[:120]})
    for tag in [str(t).strip().lower() for t in answer.get("tags") or []][:MAX_TAGS]:
        if tag and tag not in record.get("tags", []):
            made.append({**base, "id": f"ai-{record['id']}-tag-{re.sub(r'[^a-z0-9]+', '-', tag)}", "kind": "tag", "value": tag[:40]})
    return made


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--limit", type=int, default=10, help="quante foto per esecuzione")
    parser.add_argument("--model", default=os.environ.get("MASONRY_VISION_MODEL", "qwen3.5:9b"))
    parser.add_argument("--timeout", type=int, default=900, help="secondi massimi per foto")
    parser.add_argument("--dry-run", action="store_true", help="stampa le proposte senza scriverle")
    args = parser.parse_args()

    records = json.loads(RECORDS.read_text(encoding="utf-8"))
    suggestions = json.loads(SUGGESTIONS.read_text(encoding="utf-8")) if SUGGESTIONS.exists() else []
    already = {s["recordId"] for s in suggestions if s.get("author", "").startswith("Hermes")}
    queue = [
        r for r in records
        if r.get("status") == "pending" and r["id"] not in already
        and (not r.get("title") or not r.get("tags")) and (PUBLIC / r.get("thumbnail", "")).is_file()
    ]
    # Prima le foto georiferite: sono quelle che, catalogate, si possono approvare.
    queue.sort(key=lambda r: (r.get("lat") is None, r.get("capturedAt") or ""))
    if not queue:
        return 0  # niente da fare: nessun messaggio dal cron

    vocab = vocabulary()
    used = Counter(t for r in records for t in r.get("tags", []))
    tags = sorted(set(vocab["tags"]) | {t for t, _ in used.most_common(40)})

    made, failures, started = [], [], time.monotonic()
    for record in queue[: args.limit]:
        try:
            answer = ask(args.model, prompt_for(record, vocab, tags), image_payload(PUBLIC / record["thumbnail"]), args.timeout)
        except (urllib.error.URLError, TimeoutError, KeyError, ValueError) as error:
            failures.append(f"{record['id']}: {error}")
            if isinstance(error, urllib.error.HTTPError) and error.code == 404:
                print(f"Modello {args.model} non trovato: `ollama pull {args.model}`", file=sys.stderr)
                return 1
            continue
        new = suggestions_from(record, answer, args.model)
        made.extend(new)
        print(f"{record['id']}: {answer.get('title') or '—'} · {len(new)} proposte", flush=True)
        if args.dry_run:
            for item in new:
                print(f"    {item.get('field', 'tag'):<10} {item['value']}")
            print(f"    perche':   {new[0]['rationale']}" if new else "")

    if made and not args.dry_run:
        # Riletto adesso: durante i minuti di lavoro il file puo' essere cambiato.
        current = json.loads(SUGGESTIONS.read_text(encoding="utf-8")) if SUGGESTIONS.exists() else []
        ids = {s["id"] for s in current}
        current.extend(s for s in made if s["id"] not in ids)
        SUGGESTIONS.write_text(json.dumps(current, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    minutes = (time.monotonic() - started) / 60
    print(f"\n{len(made)} proposte su {min(len(queue), args.limit)} foto in {minutes:.0f} min "
          f"({len(queue) - args.limit if len(queue) > args.limit else 0} foto ancora in coda)."
          + (" Da esaminare nel pannello admin." if made else ""))
    for failure in failures:
        print(f"  errore {failure}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
