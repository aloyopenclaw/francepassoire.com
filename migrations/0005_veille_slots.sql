-- 0005 : garde anti-double de la veille sociale (slots 07h/19h Paris).
-- Le workflow VPS (.github/workflows/veille-sociale-vps.yml) est l'unique
-- propriétaire des slots depuis le retrait du repli worker (les 4 sources
-- refusent les IP du runtime Workers : l'email worker était nécessairement
-- creux, voir docs/audit-ip-blocking.md). Un INSERT OR IGNORE par slot
-- réussi : les re-dispatch concurrents s'arrêtent proprement au lieu de
-- double-envoyer. Le KV RUN_STATE n'est pas utilisé : le jeton du runner
-- VPS n'y a pas accès, l'API D1 si.
CREATE TABLE IF NOT EXISTS veille_slots (
  slot TEXT PRIMARY KEY,
  done_at TEXT NOT NULL DEFAULT (datetime('now'))
);
