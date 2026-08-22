# Contrat de rédaction d'une fiche FrancePassoire

Ce document est la source unique de vérité pour la rédaction d'une fiche. Il s'applique 1:1 aux rédactions humaines (rafales) et au workflow de rédaction automatique (`draft-fiches.yml`). Toute fiche qui ne respecte pas ce contrat sera refusée par le validateur (`agent-validate.yml`).

## 1. Quand rédiger (et quand ne pas rédiger)

- **Barre d'inclusion** : fuite de données personnelles touchant la France (entité française, ou plateforme étrangère avec victimes françaises documentées par la presse française).
- **2+ sources distinctes et vivantes obligatoires** : deux médias différents, ou un média + une source officielle. Une seule source = on ne rédige PAS.
- **Dédoublement AVANT rédaction** : `ls data/catalog/ | grep -i <fragment-nom-entité>` pour chaque candidat (fragments du nom + ville). Vérifier aussi les dates proches (±45 jours) d'une fiche existante de la même entité : si c'est le même incident, on ne rédige PAS. Exécuter `node scripts/check-doublons.mjs --intra` après écriture.
- **Pas une fuite** : DDoS sans vol de données, defacement seul, vulnérabilité non exploitée, availability pure → écarté.
- **Revendication débunkée** : si la presse établit que la revendication est fausse → écarté.

## 2. Schéma JSON (zod, `src/lib/fiche-schema.ts`)

Copier la structure d'une fiche récente (ex. `data/catalog/ramsay-sante-20230125.json`) :

```json
{
  "slug": "<entite-slugifiee>-<AAAAMMJJ-revendication>",
  "entity": "Nom exact de l'entité tel que cité par les sources",
  "secteur": "services|public|retail|sante|industrie|media|finance|recherche|autre",
  "statut": "confirmee|revendiquee",
  "group": "<slug du groupe ransomware, ex. lockbit, qilin> (UNIQUEMENT si dossier multi-entités)",
  "dates": { "revendication": "AAAA-MM-JJ", "publication": "AAAA-MM-JJ", "confirmation": "AAAA-MM-JJ (optionnel)" },
  "volume": { "count": <nombre|"0 si inconnu">, "unit": "personnes|comptes|enregistrements|lignes", "label": "<chiffre sourcé, attribution>" },
  "data_types": ["identite","coordonnees","sante","financier","credentials","biometrique","documents","geolocalisation","autre"],
  "sources": [ { "label": "Source — Titre (date)", "url": "https://...", "kind": "article|officiel|revendication|archive" } ],
  "description": "<80 à 120 mots, Ton A>",
  "timeline": [ { "date": "AAAA-MM-JJ", "event": "<fait sourcé, Ton A>" } ]
}
```

Règles strictes :
- **slug** : suffixe = date de REVENDICATION compactée AAAAMMJJ. Le nom de fichier = `<slug>.json` et le champ `slug` doit être IDENTIQUE.
- **statut** : `confirmee` UNIQUEMENT si une source `kind: "officiel"` existe (communiqué de l'entité, CNIL, regulator, ANSSI). Sinon `revendiquee`. En cas de doute : `revendiquee`.
- **dates** : revendication ≤ publication ≤ confirmation. Timeline croissante. Chaque date traçable à une source.
- **volume** : chiffre UNIQUEMENT depuis les sources, avec attribution dans le label (« selon X »). Inconnu → `count: 0` + label qui le dit (« nombre non communiqué »). Go/To/% non convertis en count : count 0 + label factuel.
- **group** : ajouter si la fiche rejoint un dossier ransomware existant (voir `src/lib/group-view.ts` et les fiches du groupe). LockBit 5.0 actuel = `lockbit` (pas lockbit5).

## 3. Ton A « factuel sec »

- Phrases déclaratives courtes (< 25 mots). Aucune image, aucun qualificatif éditorial.
- **Interdits** : « massif/massive », « scandale », « choc », « effarant », « inquiétant », « préoccupant », point d'exclamation, futur, conditionnel spéculatif.
- Chaque affirmation attribuée : « selon X », « d'après Y ». La revendication est TOUJOURS présentée comme revendication (« le groupe affirme déposer »).
- **AUCUN em-dash (—) dans description, timeline, volume.label, entity**. Utiliser « : » ou restructurer. Exception : `sources[].label` conserve le tiret du titre d'origine (convention « Source — Titre »).

## 4. Sources : vérification vivante

- Chaque URL est vérifiée AVANT écriture : `curl -sIL --max-time 15 -A 'Mozilla/5.0' <url>` → 200/301/308 = vivante. Si non-2xx, rejouer en GET (certains sites refusent HEAD).
- URL morte → chercher un snapshot `https://web.archive.org/web/<url>` (vérifier le code 200 du snapshot) et l'utiliser avec `kind: "archive"` + « (archive) » dans le label.
- **Jamais de lien direct vers un forum/darkweb** : la revendication est citée via son relais de presse.
- Pas d'URL inventée. Si une source n'est pas vérifiable, elle n'existe pas.

## 5. Processus de rédaction (pas à pas)

1. Lire le candidat (titre, URL, raw). Extraire : entité, date de la revendication, groupe ransomware éventuel.
2. Dédoublement (cf. §1).
3. Rechercher les sources complémentaires (recherche web : presse nationale, régionale, spécialisée ; CNIL ; communiqué de l'entité).
4. Vérifier CHAQUE URL (cf. §4).
5. Rédiger la fiche selon le schéma et le Ton A.
6. `node scripts/check-doublons.mjs --intra` → si la nouvelle fiche est signalée contre une existante et que ce n'est pas un incident distinct (dates ET faits différents), la SUPPRIMER.
7. `npx vitest run tests/pr-fiches.test.ts` → tout le catalogue doit rester vert.
8. Commit : `git add data/catalog/<slug>.json` (JAMAIS `git add -A`), message : `feat(catalog): <entité> — <résumé une ligne> depuis candidat ingest <source>:<id-courts>`.
9. Branche `fiche/<slug>`, push, PR avec titre `Fiche : <entité> — <nature> du <date>`.

## 6. Bornes du rédacteur automatique

- Maximum 3 fiches par exécution du workflow.
- Un candidat qui ne franchit pas la barre d'inclusion est marqué `REJECTED` dans D1 avec la raison (mono-source, doublon, hors périmètre, debunké) — il ne sera plus proposé.
- En cas d'échec technique (sources injoignables, recherche vide), marquer `DEFERRED` et laisser le candidat pour la session humaine suivante.
- Le rédacteur ne JAMAIS : fusionner une PR, déployer, toucher au registre, publier sur les réseaux. La fusion reste humaine (un tap), la publication est automatique post-fusion.
