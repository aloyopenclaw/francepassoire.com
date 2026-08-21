# Dataset FrancePassoire — catalogue des fuites de données personnelles touchant la France

## Accès

- **URL canonique** : <https://francepassoire.com/dataset/catalogue.json>
- **API versionnée** (même payload) : <https://francepassoire.com/opendata/v1/fiches.json>
- **Schéma** : `francepassoire/fiches@v1` — contrat stable. Toute rupture
  de compatibilité ouvrira `francepassoire/fiches@v2` ; `@v1` ne changera
  jamais silencieusement.
- **Régénération** : à chaque build du site (champ `generated_at`, ISO 8601
  UTC). Le dataset ne peut pas être vide : le build échoue si le catalogue
  l'est (« catalogue vide — dataset non généré »).

Chaque fiche suit le schéma public `src/lib/fiche-schema.ts` du dépôt :
`slug`, `entity`, `siren` (optionnel), `secteur`, `statut`, `dates`,
`volume`, `data_types`, `sources`, `description`, `timeline`, `group`
(optionnel). Les volumes sont des **chiffres revendiqués** (annoncés par
l'attaquant ou l'entité, non audités) tant que le `statut` n'est pas
`confirmee`.

## Licence

Le dataset est publié sous **Creative Commons Attribution 4.0
International (CC-BY-4.0)** — texte intégral dans [`LICENSE`](./LICENSE),
source canonique : <https://creativecommons.org/licenses/by/4.0/legalcode.txt>.

Attribution attendue : « FrancePassoire (francepassoire.com), CC-BY 4.0 ».

## Provenance et licences des sources

Chaque fiche cite ses sources publiques (article de presse, communication
officielle, revendication). Aucune donnée volée n'est hébergée, consultée
ou redistribuée — ce dataset ne contient que des métadonnées publiques.

| Source | Statut |
|---|---|
| ransomware.live (API publique) | Revendications citées en métadonnées ; chaque fiche renvoie à ses propres sources publiques. |
| Flux RSS médias (presse nationale, spécialisée) | Citation légitime fiche par fiche : lien + attribution vers l'article source. |
| CERT-FR, CNIL | Contenus officiels publics, cités et liés. |
| `fuitesinfos-transparence` (fuitesinfos.fr) | **EXCLUE** — le dépôt ne porte aucune licence (verdict de licence, tâche 17, décision épinglée n° 9 — `docs/registry-license-verdict.md` et `docs/license-exclusion.md` dans le dépôt). Aucune ingestion automatisée, aucune republication de `registre.jsonl`. |
| EuRepoC | **À déterminer (tâche 24)** — verdict de licence non encore rendu. Aucune donnée EuRepoC n'entre dans le dataset tant que ce statut n'est pas tranché. |

Un flux RSS 2.0 accompagne le dataset : <https://francepassoire.com/feed.xml>
(global, 50 dernières fiches) et <https://francepassoire.com/feed/<secteur>.xml>
(par secteur présent au catalogue).
