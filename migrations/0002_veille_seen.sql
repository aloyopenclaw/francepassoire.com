-- 0002_veille_seen.sql — T52 : déduplication persistante de la veille sociale.
-- url_hash = sha256 hex de l'URL normalisée (lowercase, sans utm_*) — aucune
-- donnée personnelle : uniquement des métadonnées d'articles publics.
CREATE TABLE IF NOT EXISTS veille_seen (
  url_hash TEXT PRIMARY KEY,
  first_seen TEXT NOT NULL
);
