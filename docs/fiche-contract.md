# Contrat JSON d'une fiche du catalogue

Ce document définit le **contrat public** d'une fiche FrancePassoire : chaque
fichier `data/catalog/<slug>.json` décrit une fuite de données personnelles
touchant la France. La source de vérité est le schéma zod
[`src/lib/fiche-schema.ts`](../src/lib/fiche-schema.ts), référencé tel quel par
la collection Astro `catalog` ([`src/content/config.ts`](../src/content/config.ts),
loader `glob('./data/catalog', '*.json')`). Un JSON qui échoue à la validation
zod **n'existe pas** pour le site : ni build, ni page, ni statistique.

Les énumérations sont **volontairement fermées**. Toute extension (nouveau
secteur, nouveau type de données, nouvelle unité de volume, nouveau genre de
source) est un changement de contrat public : elle exige une approbation de
plan avant toute édition du schéma.

---

## 1. Champs, champ par champ

### `slug` — chaîne, obligatoire

- **Règle technique** : `^[a-z0-9-]+$` (minuscules, chiffres et tirets
  uniquement ; ni accent, ni apostrophe, ni espace, ni underscore).
- **Convention de nommage** (règle de la tâche 8, cf. `src/lib/slugs.ts`) :
  `<slug-entite>-<aaaammjj>`, où `<aaaammjj>` est la date de la
  **revendication** sourcée (valeur de `dates.revendication` au format
  compact). Exemples : `alaxione-20260820`, `ird-20260817`.
- Le `slug` doit être **unique** dans le catalogue ; en cas de collision
  (même entité, deux fuites le même jour), le générateur de slugs applique
  un suffixe de collision — on ne décale jamais la date à la main.

### `entity` — chaîne, obligatoire

- **Règle technique** : `z.string().min(1)` — jamais vide.
- **Ligne directrice** : dénomination usuelle et vérifiable de l'entité
  (raison sociale ou sigle public), telle que citée par les sources. Le
  sigle seul est admis quand il est immédiatement identifiable
  (ex. « IRD ») ; sinon on privilégie la forme complète
  (ex. « Institut de recherche pour le développement (IRD) »).

### `siren` — chaîne, **optionnelle**

- **Règle technique** : `^\d{9}$` (exactement 9 chiffres, pas de séparateur
  ni d'espace).
- **Ligne directrice** : SIREN de l'entité victime, **résolu via l'annuaire
  des entreprises** (annuaire-entreprises.data.gouv.fr) et jamais inventé ni
  reconstruit de mémoire. On omet le champ quand la résolution échoue
  (association étrangère, entité non immatriculée…) plutôt que d'écrire un
  numéro approximatif.

### `secteur` — énumération, obligatoire

Valeurs admises (fermées) :

| Valeur | Périmètre |
| --- | --- |
| `sante` | Soins, éditeurs e-santé, hébergeurs de données de santé, assurance maladie |
| `finance` | Banque, assurance, paiement, fiscalité |
| `retail` | Commerce, grande distribution, e-commerce |
| `recherche` | Organismes de recherche, universités, laboratoires |
| `public` | Administrations, collectivités, opérateurs publics hors recherche |
| `industrie` | Industrie, énergie, transport, BTP |
| `services` | Services privés hors santé/finance/retail (SSII, jurídique, loisirs…) |
| `media` | Médias, télécoms, plateformes de contenu |
| `autre` | Aucune des catégories ci-dessus |

- **Ligne directrice** : on choisit le secteur de l'**activité principale**
  de l'entité, pas la nature du dossier (un institut public de recherche
  reste `recherche`, pas `public`).

### `statut` — énumération, obligatoire

Valeurs admises (fermées) : `revendiquee` | `confirmee`.

- `revendiquee` : la fuite est alléguée (revendication d'un acteur
  malveillant, signalement relayé) mais **non établie** officiellement —
  soit parce que personne n'a confirmé, soit parce que l'entité confirme
  l'intrusion mais pas l'exfiltration des données. C'est l'état d'entrée
  de toute fiche.
- `confirmee` : la fuite est établie par une source primaire officielle
  (communiqué de l'entité, autorité, justice). Le passage
  `revendiquee → confirmee` passe **exclusivement** par la machine à états
  de [`src/lib/taxonomy.ts`](../src/lib/taxonomy.ts), qui exige une source
  de genre `officiel` et émet une ligne pour le registre d'intégrité.
  On n'édite jamais `statut` à la main dans le JSON.
- Une fiche ne redevient jamais `revendiquee` (aucune rétrogradation).

### `dates` — objet, obligatoire

| Sous-champ | Type | Obligatoire | Règle |
| --- | --- | --- | --- |
| `dates.revendication` | date | **oui** | `^\d{4}-\d{2}-\d{2}$` (AAAA-MM-JJ). Date à laquelle la fuite entre dans l'espace public : publication de la revendication sur un forum, ou date portée par la notification/communication qui documente l'incident. C'est cette date (compactée) qui alimente le suffixe du `slug`. |
| `dates.publication` | date | non | Première couverture presse de l'incident. |
| `dates.confirmation` | date | non | Date de la source officielle qui établit la fuite (remplie avec le passage à `confirmee`). |

- **Ligne directrice** : chaque date doit être **traçable à une URL de
  `sources[]`** (date de publication de l'article, date portée par la
  notification citée). Si une date ne se source pas, on ne l'écrit pas —
  on omet le sous-champ optionnel plutôt que d'estimer.

### `volume` — objet, obligatoire

| Sous-champ | Type | Obligatoire | Règle |
| --- | --- | --- | --- |
| `volume.count` | entier | **oui** | `≥ 0`, sans séparateur de milliers. |
| `volume.unit` | énumération | **oui** | `personnes` \| `comptes` \| `enregistrements` \| `lignes` (fermée). |
| `volume.label` | chaîne | **oui** | Reformulation lisible destinée au visiteur. |

- **Ligne directrice (honnêteté)** : `count`/`unit` portent le **chiffre le
  plus couramment cité** par les sources, et `label` restitue le contexte
  et son degré de certitude — p. ex. « 6,8 millions de personnes (chiffre
  revendiqué, non confirmé) » ou « 7 500 personnes (périmètre notifié par
  l'IRD ; exfiltration non confirmée) ». On n'arrondit pas à la louche, on
  ne mélange pas les unités (des *lignes* extraites ne sont pas des
  *personnes*), et si les sources divergent on cite dans `label` la
  source du retenu.

### `data_types` — tableau d'énumération, obligatoire

Valeurs admises (fermées) : `identite` | `coordonnees` | `sante` |
`financier` | `credentials` | `biometrique` | `documents` |
`geolocalisation` | `autre`.

- **Règle technique** : tableau **non vide** (`min(1)`), valeurs
  distinctes.
- **Ligne directrice** : on ne coche que les catégories **explicitement
  listées par les sources**. Le numéro de Sécurité sociale relève de
  `identite` ; un motif de consultation ou un message avec un praticien
  relève de `sante` ; mail/téléphone/adresse relèvent de
  `coordonnees`. En cas de doute, on s'abstient — jamais de `autre` « pour
  être sûr ».

### `sources` — tableau d'objets, obligatoire

| Sous-champ | Type | Obligatoire | Règle |
| --- | --- | --- | --- |
| `label` | chaîne | **oui** | Source + titre (abrégé si besoin), lisible. |
| `url` | chaîne | **oui** | URL absolue valide (`z.string().url()`), vérifiée vivante (HTTP 2xx/3xx ou équivalent archivé). |
| `kind` | énumération | **oui** | `article` \| `officiel` \| `revendication` \| `archive` (fermée). |

- **Règle technique** : tableau **non vide** (`min(1)`).
- **Genres** : `article` = presse ou média spécialisé ; `officiel` =
  communiqué de l'entité, d'une autorité (CNIL, ANSSI…), de l'État ou de
  la justice ; `revendication` = relais de la revendication d'un acteur
  malveillant (forum, site de veille la documentant) ; `archive` =
  snapshot/équivalent archivé d'une page disparue.
- **Ligne directrice (traçabilité, zéro invention)** : **tout fait** de la
  fiche (date, volume, type de données, événement de timeline) doit
  pouvoir être retrouvé dans au moins une URL de `sources[]`. On cite la
  revendication **via son relais de presse/veille** (on ne lie jamais un
  forum criminel en direct), et on privilégie au moins une source
  journalistique identifiée.

### `description` — chaîne, obligatoire

- **Règle technique** : `min(50)` caractères.
- **Ligne directrice** : prose factuelle et neutre en français — qui est
  l'entité, que revendique ou confirme chaque partie (attaquant, entité,
  autorité), quels volumes et quelles données, avec quel degré de
  certitude. Aucune accusation au-delà des sources, aucun sensationnalisme,
  aucune donnée volée reproduite. Ton et bornes stylistiques détaillés :
  §3 (à finaliser à la tâche 21).

### `timeline` — tableau d'objets, obligatoire

| Sous-champ | Type | Obligatoire | Règle |
| --- | --- | --- | --- |
| `date` | date | **oui** | `^\d{4}-\d{2}-\d{2}$` (AAAA-MM-JJ). |
| `event` | chaîne | **oui** | Phrase courte, factuelle, sourcée. |

- **Règle technique** : tableau **non vide** (`min(1)`), ordre
  chronologique croissant.
- **Ligne directrice** : jalons vérifiables uniquement (détection,
  qualification de la violation, revendication,   notification CNIL/plainte,
  réaction publique de l'entité, confirmation officielle). Mêmes dates
  autorisées plusieurs fois si les événements diffèrent.

### `group` — chaîne, **optionnelle**

- Réservé aux **dossiers ransomware** : groupe revendiquant plusieurs
  entités françaises (ex. dossier Qilin). Absent des fiches isolées — une
  fiche d'acteur unique **ne doit pas** porter ce champ.

---

## 2. Exemple complet annoté

```json
{
  "slug": "alaxione-20260820",
  "entity": "Alaxione",
  "siren": "811197557",
  "secteur": "sante",
  "statut": "revendiquee",
  "dates": {
    "revendication": "2026-08-20",
    "publication": "2026-08-20"
  },
  "volume": {
    "count": 6800000,
    "unit": "personnes",
    "label": "6,8 millions de personnes et 10,1 millions de rendez-vous médicaux (chiffres revendiqués, non confirmés)"
  },
  "data_types": ["identite", "coordonnees", "sante"],
  "sources": [
    {
      "label": "FrenchBreaches — Alaxione : 6,8 millions de profils et plus de 10 millions de rendez-vous médicaux revendiqués",
      "url": "https://frenchbreaches.com/alertes/alaxione-mt0ophzmbommap9dya",
      "kind": "revendication"
    },
    {
      "label": "RTL — Un cybercriminel revendique le piratage d'Alaxione, la plateforme de rendez-vous médicaux dément",
      "url": "https://www.rtl.fr/actu/sciences-tech/pres-de-sept-millions-d-utilisateurs-concernes-par-une-nouvelle-fuite-de-donnees-un-cybercriminel-revendique-le-piratage-d-alaxione-la-plateforme-de-rendez-vous-medicaux-dement-7900663473",
      "kind": "article"
    }
  ],
  "description": "Un cybercriminel agissant sous le pseudonyme « Angel_Batista » revendique le 20 août 2026, sur un forum de revente de données, le piratage d'Alaxione, éditeur français de solutions de prise de rendez-vous médicaux. Il affirme disposer de données sur 6,8 millions de personnes et 10,1 millions de rendez-vous : identité, coordonnées, environ 70 000 numéros de Sécurité sociale, motifs de consultation et messages échangés avec les praticiens, le tout proposé à la vente pour 5 000 dollars. Alaxione reconnaît une intrusion limitée à un serveur de test mais dément le vol de données réelles ; les volumes annoncés ne sont pas confirmés à ce stade.",
  "timeline": [
    { "date": "2026-08-20", "event": "…" },
    { "date": "2026-08-20", "event": "…" }
  ]
}
```

Annotations : `siren` résolu via l'annuaire des entreprises ; `dates.publication`
= première couverture presse (même jour que la revendication) ; la source
`revendication` est le **relais** FrenchBreaches du post de forum (jamais le
forum lui-même) ; `volume.label` porte la nuance « revendiqués, non
confirmés » ; `group` absent (fiche isolée).

---

## 3. Lignes directrices rédactionnelles — « à finaliser à la tâche 21 (gate de style) »

> **Statut : PROVISOIRE.** Les règles définitives de prose (bornes de longueur
> de phrase, temps verbaux, formules d'attribution des sources,
> micro-copies d'info-bulles, longueur cible de `description`) seront
> verrouillées dans `docs/prose-style.md` lors de la **tâche 21** (gate de
> style), après revue des fiches d'ancrage Alaxione et IRD par le
> propriétaire. Jusqu'à signal contraire, les fiches d'ancrage servent
> d'étalons de calibration et cette section ne lie pas encore
> éditorialement.

Principes non négociables dès maintenant :

1. **Neutralité factuelle** : chaque affirmation est attribuée (« selon
   l'éditeur », « selon la revendication relayée par… ») ; on distingue
   systématiquement revendication, confirmation d'intrusion et
   confirmation d'exfiltration.
2. **Zéro invention** : tout fait trace à une URL de `sources[]` ; ce qui
   n'est pas sourcé n'est pas écrit ; les champs optionnels incertains
   sont omis.
3. **Aucune donnée volée consultée, hébergée ou reproduite** — la fiche ne
   contient que des métadonnées publiques (contrainte permanente du
   projet).
4. **Français** exclusivement, chiffres et dates aux normes françaises
   dans `label`/`event`/`description`.

---

## 4. Validation opérationnelle

- **Localement / CI** : `npx vitest run` valide les fixtures du schéma
  (`tests/content-schema.test.ts`) ; le workflow `pr-validate.yml`
  (tâche 22) validera en plus chaque JSON modifié d'une PR fiche
  (zod + build + sondage d'URLs).
- **En direct** : `import { ficheSchema } from './src/lib/fiche-schema'`
  puis `ficheSchema.safeParse(JSON.parse(...))` sur n'importe quel fichier
  du catalogue.
- **Rappel branchement site** : `data/catalog/` reste vide sur `main`
  jusqu'à la genèse du registre d'intégrité (décision épinglée n° 6) ; les
  fiches d'ancrage vivent sur la branche `fiche/anchors-preview` et ne
  rendent que sur les déploiements de prévisualisation.
