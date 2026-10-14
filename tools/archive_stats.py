#!/usr/bin/env python3
"""Avanzamento della catalogazione, in poche righe.

Pensato per il bot admin, che risponde a "a che punto siamo?" lanciando questo
script invece di ricalcolare a mano: stati, campi mancanti, paesi, e le
prossime foto da catalogare.

    python3 tools/archive_stats.py [--next 10] [--json]
"""

from __future__ import annotations

import argparse
import json
import sys
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
RECORDS = ROOT / "src" / "data" / "records.json"
SUGGESTIONS = ROOT / "src" / "data" / "suggestions.json"


def missing(record: dict) -> list[str]:
    """Stessa regola di `missingFields` in src/types.ts."""
    gaps = [field for field in ("title", "element", "technique") if not str(record.get(field) or "").strip()]
    if not record.get("tags"):
        gaps.append("tags")
    lat, lng = record.get("lat"), record.get("lng")
    if lat is None or lng is None or not (-90 <= lat <= 90 and -180 <= lng <= 180):
        gaps.append("position")
    return gaps


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--next", type=int, default=10, help="quante foto da catalogare elencare")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    records = json.loads(RECORDS.read_text(encoding="utf-8"))
    suggestions = json.loads(SUGGESTIONS.read_text(encoding="utf-8")) if SUGGESTIONS.exists() else []
    gaps = {r["id"]: missing(r) for r in records}
    pending = [r for r in records if r.get("status") == "pending"]
    # Prima le foto a cui manca meno: sono quelle che si sbloccano subito.
    upcoming = sorted(pending, key=lambda r: (len(gaps[r["id"]]), r.get("capturedAt") or ""))[: args.next]

    report = {
        "total": len(records),
        "status": dict(Counter(r.get("status", "pending") for r in records)),
        "missing": dict(Counter(field for fields in gaps.values() for field in fields)),
        "readyToApprove": sum(1 for r in pending if not gaps[r["id"]]),
        "openSuggestions": sum(1 for s in suggestions if s.get("status") == "pending"),
        "countries": dict(Counter(r.get("country") or "?" for r in records).most_common(8)),
        "next": [{"id": r["id"], "location": r.get("location"), "missing": gaps[r["id"]]} for r in upcoming],
    }

    if args.json:
        print(json.dumps(report, indent=2, ensure_ascii=False))
        return 0
    total = report["total"]
    print(f"{total} foto · " + " · ".join(f"{k} {v}" for k, v in report["status"].items()))
    print(f"pronte da approvare: {report['readyToApprove']} · proposte da esaminare: {report['openSuggestions']}")
    print("mancano: " + " · ".join(f"{k} {v} ({v * 100 // total}%)" for k, v in report["missing"].items()))
    print("paesi: " + " · ".join(f"{k} {v}" for k, v in report["countries"].items()))
    print("\nprossime da catalogare:")
    for item in report["next"]:
        print(f"  {item['id']:<40} {item['location'] or '—':<28} manca: {', '.join(item['missing']) or 'nulla'}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
