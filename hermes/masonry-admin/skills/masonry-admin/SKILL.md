---
name: masonry-admin
description: "The Masonry Archive: progress, contribution moderation, contributor pairing, nightly proposals."
version: 0.1.0
author: The Masonry Archive
platforms: [linux]
metadata:
  hermes:
    tags: [masonry, archive, moderation]
    category: productivity
---

# The Masonry Archive — admin procedures

All commands run from the repository root (your working directory). Add `--json` to `intake_queue.py` and `archive_stats.py` when you need to parse the output.

## Progress — "a che punto siamo?"

```bash
python3 tools/archive_stats.py --next 10
python3 tools/intake_queue.py stats
```

Summarise in a few lines: approved / pending, what's missing most, open suggestions, contributions waiting. If `deletionRequests` is not empty, say so first: a contributor deleted their data and the listed records still credit them — Giovanni must decide whether to keep, anonymise or remove them.

## Contributions waiting for review

1. List them:
   ```bash
   python3 tools/intake_queue.py list --status pending
   ```
2. For each one Giovanni wants to see, get the details and send the photo:
   ```bash
   python3 tools/intake_queue.py show <id>
   ```
   Reply with who sent it (name, affiliation, role), where (coordinates or place), when, notes, and the photo as `MEDIA:<path>` using the `path` field. HEIC files can't be previewed in Telegram: say so and give the path.
3. Only on his explicit decision:
   ```bash
   python3 tools/intake_queue.py accept <id> [--note "..."]
   python3 tools/intake_queue.py reject <id> --note "reason for the contributor"
   ```
   The rejection note is sent to the contributor: write it politely, in the contributor's likely language. A rejected photo is deleted and its fingerprint goes to `src/data/excluded.json`.
4. Bring accepted photos into the archive (runs the normal ingest pipeline; needs ImageMagick 7 and network access for geocoding):
   ```bash
   python3 tools/intake_queue.py apply --dry-run
   python3 tools/intake_queue.py apply
   ```
   New records are created as `pending` with the contributor as author: they still need cataloguing in the admin panel before publication.
5. Tell contributors the outcome:
   ```bash
   python3 tools/intake_queue.py notify
   ```

Ids can be shortened to their first characters when unambiguous.

## New contributors (invitation code)

The contributor bot accepts messages from anyone on Telegram, but people who are not registered must first type the invitation code. Until then they get a fixed reply and the model is not called. Giovanni hands the code out to classes and colleagues.

```bash
python3 tools/intake_queue.py invite              # show the current code
python3 tools/intake_queue.py invite NEWCODE26    # change it (at least 6 characters); registered people stay in
python3 tools/intake_queue.py invite off          # no code: anyone can register
```

Matching ignores case and spaces, but punctuation must be typed exactly.

## Nightly proposals

A Hermes cron job runs `tools/propose_tags.py` at night with a local vision model and adds proposals to `src/data/suggestions.json` (author "Hermes · <model>"). They are reviewed in the admin panel (`npm run dev`, Admin tab), next to each photo. To run a small batch on request:

```bash
python3 tools/propose_tags.py --limit 3
```

It takes several minutes per photo on this machine: warn Giovanni before starting, and don't run it while he has unsaved work open in the admin panel.

## Don'ts

- Never edit `src/data/records.json`, `suggestions.json` or anything in `incoming/` by hand.
- Never commit or push without being asked.
