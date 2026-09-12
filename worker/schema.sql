-- Schema dell'API dei contributi.
--
--   npx wrangler d1 execute masonry-archive --local --file worker/schema.sql
--   npx wrangler d1 execute masonry-archive --remote --file worker/schema.sql
--
-- Il database NON e' la fonte di verita' dell'archivio: quella resta
-- `src/data/records.json`, versionata in git. Qui vivono solo le persone che
-- contribuiscono e i contributi in attesa di moderazione, cioe' le cose che un
-- sito statico non puo' tenere.

CREATE TABLE IF NOT EXISTS contributors (
  id            TEXT PRIMARY KEY,
  email         TEXT NOT NULL UNIQUE,
  first_name    TEXT NOT NULL DEFAULT '',
  last_name     TEXT NOT NULL DEFAULT '',
  affiliation   TEXT NOT NULL DEFAULT '',
  role          TEXT NOT NULL DEFAULT 'Student',
  orcid         TEXT NOT NULL DEFAULT '',
  lab           TEXT NOT NULL DEFAULT '',
  created_at    TEXT NOT NULL,
  last_seen_at  TEXT NOT NULL,
  -- Chi abusa viene bloccato senza cancellarne i contributi gia' accettati.
  blocked       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS submissions (
  id             TEXT PRIMARY KEY,
  contributor_id TEXT NOT NULL REFERENCES contributors(id) ON DELETE CASCADE,
  r2_key         TEXT NOT NULL,
  original_name  TEXT NOT NULL DEFAULT '',
  bytes          INTEGER NOT NULL DEFAULT 0,
  content_type   TEXT NOT NULL DEFAULT '',
  lat            REAL,
  lng            REAL,
  captured_at    TEXT,
  camera         TEXT,
  notes          TEXT NOT NULL DEFAULT '',
  license_ok     INTEGER NOT NULL DEFAULT 0,
  -- pending | accepted | rejected
  status         TEXT NOT NULL DEFAULT 'pending',
  created_at     TEXT NOT NULL,
  reviewed_at    TEXT,
  review_note    TEXT NOT NULL DEFAULT '',
  -- Id del record nato da questo contributo, una volta accettato.
  record_id      TEXT
);

CREATE INDEX IF NOT EXISTS submissions_status ON submissions(status, created_at);
CREATE INDEX IF NOT EXISTS submissions_contributor ON submissions(contributor_id, created_at);

CREATE TABLE IF NOT EXISTS suggestions (
  id             TEXT PRIMARY KEY,
  contributor_id TEXT NOT NULL REFERENCES contributors(id) ON DELETE CASCADE,
  record_id      TEXT NOT NULL,
  -- tag | text
  kind           TEXT NOT NULL,
  field          TEXT,
  value          TEXT NOT NULL,
  rationale      TEXT NOT NULL DEFAULT '',
  status         TEXT NOT NULL DEFAULT 'pending',
  created_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS suggestions_status ON suggestions(status, created_at);
