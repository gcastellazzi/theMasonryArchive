#!/usr/bin/env python3
"""Accesso all'API dei contributi dalla macchina di chi cataloga.

La moderazione resta in locale: `src/data/records.json` e' la fonte di verita'
e vive in git, non sul server. Questi due strumenti fanno da ponte — scaricano
cosa e' arrivato e rimandano indietro le decisioni — e sono l'unico punto in cui
il repository parla con il Worker.
"""

from __future__ import annotations

import json
import os
import sys
import urllib.error
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

#: Dove cercare le impostazioni, se non stanno gia' nell'ambiente.
CONFIG_FILES = {
    "VITE_API_BASE": ROOT / ".env.local",
    "ADMIN_TOKEN": ROOT / ".dev.vars",
}


def _from_file(path: Path, key: str) -> str:
    """Legge `CHIAVE = valore` o `CHIAVE=valore`, con o senza virgolette."""
    if not path.exists():
        return ""
    for line in path.read_text(encoding="utf-8").splitlines():
        line = line.strip()
        if line.startswith("#") or "=" not in line:
            continue
        name, _, value = line.partition("=")
        if name.strip() == key:
            return value.strip().strip('"').strip("'")
    return ""


def config() -> tuple[str, str]:
    """Origine dell'API e token di amministrazione."""
    base = os.environ.get("VITE_API_BASE") or _from_file(CONFIG_FILES["VITE_API_BASE"], "VITE_API_BASE")
    token = os.environ.get("ADMIN_TOKEN") or _from_file(CONFIG_FILES["ADMIN_TOKEN"], "ADMIN_TOKEN")

    if not base:
        sys.exit(
            "Non so a quale API rivolgermi.\n"
            "  Metti VITE_API_BASE in .env.local, oppure passalo nell'ambiente."
        )
    if not token:
        sys.exit(
            "Manca il token di amministrazione.\n"
            "  Mettilo in .dev.vars come ADMIN_TOKEN, oppure passalo nell'ambiente.\n"
            "  In produzione e' quello impostato con: npx wrangler secret put ADMIN_TOKEN"
        )
    return base.rstrip("/"), token


def _request(method: str, path: str, payload: dict | None = None) -> urllib.request.Request:
    base, token = config()
    request = urllib.request.Request(
        f"{base}{path}",
        method=method,
        headers={"Authorization": f"Bearer {token}"},
    )
    if payload is not None:
        request.add_header("Content-Type", "application/json")
        request.data = json.dumps(payload).encode("utf-8")
    return request


def _explain(error: urllib.error.HTTPError) -> str:
    body = error.read().decode("utf-8", errors="replace")
    try:
        return json.loads(body).get("error", body)
    except json.JSONDecodeError:
        return body


def get_json(path: str) -> dict:
    try:
        with urllib.request.urlopen(_request("GET", path), timeout=60) as response:
            return json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        sys.exit(f"GET {path} -> {error.code}: {_explain(error)}")
    except urllib.error.URLError as error:
        sys.exit(f"GET {path} non raggiungibile: {error.reason}")


def post_json(path: str, payload: dict) -> None:
    try:
        with urllib.request.urlopen(_request("POST", path, payload), timeout=60):
            return
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"POST {path} -> {error.code}: {_explain(error)}") from error
    except urllib.error.URLError as error:
        raise RuntimeError(f"POST {path} non raggiungibile: {error.reason}") from error


def download(path: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        with urllib.request.urlopen(_request("GET", path), timeout=300) as response:
            target.write_bytes(response.read())
    except urllib.error.HTTPError as error:
        raise RuntimeError(f"GET {path} -> {error.code}: {_explain(error)}") from error
