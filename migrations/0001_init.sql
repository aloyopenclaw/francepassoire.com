-- 0001_init.sql — schéma de staging D1 FrancePassoire (tâche 7, Wave 1).
--
-- INVARIANT FONDAMENTAL : cette base ne contient JAMAIS de
-- données personnelles de victimes de fuites (ni identités, ni
-- coordonnées, ni santé, ni données financières). Seules des métadonnées publiques y
-- transitent, à des fins de pipeline éditorial. Le catalogue publié
-- (maître) vit dans le dépôt : data/catalog/*.json. Le registre d'intégrité
-- canonique (chaîne d'empreintes) vit dans un artefact public du dépôt
-- (décision #6) ; la table `registry` ci-dessous n'est qu'un miroir de
-- staging.

CREATE TABLE candidates (
  id TEXT PRIMARY KEY,
  source TEXT NOT NULL,
  source_url TEXT,
  raw TEXT NOT NULL,
  dedup_score REAL,
  status TEXT NOT NULL DEFAULT 'NEW'
    CHECK(status IN ('NEW','DRAFT','PUBLISHED','REJECTED')),
  entity_name TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE events (
  id TEXT PRIMARY KEY,
  fiche_id TEXT NOT NULL,
  type TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE subscribers (
  id TEXT PRIMARY KEY,
  email_hash TEXT NOT NULL UNIQUE,
  email_enc TEXT NOT NULL,
  confirmed_at TEXT,
  unsub_token TEXT NOT NULL UNIQUE,
  prefs_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE social_outbox (
  id TEXT PRIMARY KEY,
  platform TEXT NOT NULL,
  payload TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'PENDING',
  scheduled_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE registry (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  date TEXT NOT NULL,
  type TEXT NOT NULL,
  entite TEXT,
  fiche_du TEXT,
  empreinte TEXT NOT NULL,
  empreinte_precedente TEXT,
  payload_json TEXT
);

CREATE INDEX idx_candidates_status ON candidates(status);
CREATE INDEX idx_candidates_source ON candidates(source);
CREATE INDEX idx_subscribers_email_hash ON subscribers(email_hash);
CREATE INDEX idx_social_outbox_status ON social_outbox(status);
CREATE INDEX idx_registry_fiche_du ON registry(fiche_du);
