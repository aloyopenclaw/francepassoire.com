# Exclusion de source — registre `fuitesinfos-transparence`

**Date : 20 août 2026** · Tâche 17 (wave 2) · Décision épinglée n° 9.

## Quoi

Le dépôt [`CedHaurus/fuitesinfos-transparence`](https://github.com/CedHaurus/fuitesinfos-transparence)
(publié par fuitesinfos.fr) ne porte **aucune licence** — ni fichier `LICENSE`,
ni champ licence GitHub, ni déclaration dans le README. Verdict détaillé et
preuves : [`docs/registry-license-verdict.md`](./registry-license-verdict.md).

## Conséquence

- **AUCUN adapter `workers/ingest/adapters/registre.ts` n'existe dans ce
  dépôt** et aucun ne sera construit tant que le verdict ne change pas.
- Le pipeline d'ingestion n'effectue **aucune requête réseau** vers ce dépôt :
  ni polling de `registre.jsonl`, ni insertion de candidats `source =
  'fuitesinfos-registre'`.
- La fixture locale `tests/fixtures/fuitesinfos-registre.jsonl` (téléchargée
  une fois en wave 1, tâche 10) reste utilisée exclusivement pour les tests
  d'intégrité de notre propre bibliothèque de chaînage
  (`src/lib/registry.ts`, `scripts/verify-registry.mjs`). Elle n'alimente
  aucun adapter ni aucune fiche publiée.

## Pourquoi

FrancePassoire revendique une exigence de conformité stricte : nous ne nous
dotons pas du droit de réutiliser massivement le travail d'un tiers sans
autorisation. Un dépôt sans licence = tous droits réservés (droit d'auteur,
code de la propriété intellectuelle). L'ingestion automatisée quotidienne
d'un flux, même de « simples métadonnées », est une exploitation des données
du tiers — elle exige son accord.

## Ce que nous perdons

Un flux de détection de changements (ajouts, retraits, corrections) sur le
catalogue fuitesinfos.fr, redondant de toute façon avec nos propres sources
(ransomware.live, RSS médias, CERT-FR, CNIL). Perte opérationnelle faible.

## Comment lever l'exclusion

1. L'auteur ajoute une licence permissive au dépôt, **ou** nous accorde une
   autorisation écrite.
2. Mettre à jour `docs/registry-license-verdict.md` (nouvelle citation + URL).
3. Construire l'adapter selon le cahier des charges déjà rédigé (poll du raw
   URL `registre.jsonl`, diff `lastSeq` → nouvelles lignes → candidats
   `fuitesinfos-registre` basse priorité, `entity_name` = `entite`,
   `source_url` = null).
