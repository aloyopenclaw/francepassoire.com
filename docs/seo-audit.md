# Audit SEO pré-lancement (tâche 48)

> État au 2026-08-21. Preuve brute (les deux runs complets du crawler, table
> markdown incluse) dans
> `.omo/evidence/francepassoire-launch/task-48-francepassoire-launch.log`.

## Méthode

`scripts/seo-audit.mjs` (zéro dépendance, Node ≥ 18) — crawler piloté par le
sitemap :

1. lit `dist/sitemap-index.xml` + parts → les 164 URLs de production ;
2. interroge chaque page sur `https://francepassoire.pages.dev` (dernier build
   de production servi direct ; le fetch Node ne peut pas épingler l'IP et le
   DNS local de l'apex est poussiéreux sur ce Mac) — le run « after » cible un
   build local servi sur `127.0.0.1:8788`, canonical et OG restent comparés
   aux URLs `https://francepassoire.com/…` du sitemap ;
3. vérifie par page : HTTP 200 · un seul `<title>` non vide, unique au site ·
   meta description présente, non vide, unique · `<link rel=canonical>` présent
   et égal à l'URL du sitemap · balises OG (`og:title`, `og:description`,
   `og:url`, `og:type`) présentes · exactement un `<h1>` ;
4. gate du plan : **0 erreur, ≤ 5 avertissements**, sinon exit 1.

## Résultats

| Run | Cible | Erreurs | Avertissements | Exit |
|---|---|---|---|---|
| 1 (avant) | pages.dev (production live) | 4 | 5 | 1 |
| 2 (après correctifs) | build local `127.0.0.1:8788` | 0 | 0 | 0 |

`node scripts/check-sitemap.mjs` : sitemap 164 == 164 pages HTML du build,
avant et après correctifs.

### Offenseurs du run 1 et correctifs

| Page(s) | Constat | Correctif |
|---|---|---|
| `/embed/compteur/` | 4 erreurs : ni meta description, ni canonical, ni OG, ni `<h1>` (page pensée « iframe seule », mais présente au sitemap) | head complété dans `src/pages/embed/compteur.astro` (description, canonical, OG + twitter card) et le nombre devient `<h1 class="compteur__nombre">` (marge UA neutralisée) |
| `/fiche/chronopost-20250212/` + `/fiche/chronopost-20251219/` | titre dupliqué ×2 (« Chronopost : la fiche - France Passoire ») — récidiviste | titre fiche porteur de la date d'attribution : `<entité> : la fiche du <date> - France Passoire` |
| `/fiche/france-travail-*` (×3) | titre dupliqué ×3 — récidiviste | idem |
| `/` (accueil) | meta description périmée (« Le catalogue s'allumera avec les premières fiches vérifiées ») alors que 69 fiches sourcées sont en ligne | réécrite sans compteur dur (périmerait) : « Observatoire citoyen et indépendant des fuites de données en France : catalogue sourcé, panorama ransomware et autoprotection — aucun chiffre inventé. » |

Les metas descriptions des fiches, entités et hubs étaient déjà uniques
(l'unicité des titres d'entités tient au nom ; celle des hubs au
libellé + effectif).

## Données structurées (JSON-LD)

Vérification structurelle manuelle (champs requis présents, types corrects) —
extraction depuis le build, parsing JSON OK :

- **Accueil — `Dataset`** : `name`, `description`, `license`
  (CC-BY 4.0), `creator.@type=Organization`, `url` — conforme aux exigences
  Google Datasets.

  ```json
  {"@context":"https://schema.org","@type":"Dataset","name":"FrancePassoire — catalogue des fuites de données personnelles touchant la France","description":"Catalogue citoyen des fuites de données personnelles touchant la France : entités, statuts de vérification et métadonnées publiques, publiés sous licence CC-BY 4.0.","license":"https://creativecommons.org/licenses/by/4.0/","creator":{"@type":"Organization","name":"FrancePassoire"},"url":"https://francepassoire.com"}
  ```

- **5 fiches échantillon — `Article`** (`accor-20260715`,
  `france-travail-20240313`, `chronopost-20250212`, `tchap-20260607`,
  `weda-20251110`) : `headline`, `description`, `author.@type=Organization`,
  `publisher.@type=Organization`, `isAccessibleForFree: true`,
  `mainEntityOfPage` = URL canonique — tout requis présent.

  ```json
  {"@context":"https://schema.org","@type":"Article","headline":"Accor — fuite de données, FrancePassoire","description":"Accor : fuite revendiquée recensée…","author":{"@type":"Organization","name":"FrancePassoire"},"publisher":{"@type":"Organization","name":"FrancePassoire"},"isAccessibleForFree":true,"mainEntityOfPage":"https://francepassoire.com/fiche/accor-20260715/"}
  ```

- Les pages entité portent en outre un `CollectionPage` (mainEntity +
  `about.Organization`), non requis par Google, sans erreur de structure.

Recommandé au propriétaire après mise en production : passer l'accueil et une
fiche dans le [Rich Results Test](https://search.google.com/test/rich-results)
(l'outil consomme l'URL live).

## robots.txt

Publié et servi en production (`https://francepassoire.com/robots.txt`,
vérifié aussi sur pages.dev) :

```
User-agent: *
Allow: /

Sitemap: https://francepassoire.com/sitemap-index.xml
```

`https://francepassoire.com/sitemap-index.xml` répond 200 en direct.

## Aperçus OG — contrôle visuel propriétaire

Le site n'a pas d'image `og:image` (choix assumé : cartes `summary` texte,
zéro binaire). Contrôle visuel des cartes sur
[opengraph.xyz](https://www.opengraph.xyz) :

- Accueil : <https://www.opengraph.xyz/url/https%3A%2F%2Ffrancepassoire.com%2F>
- Fiche : <https://www.opengraph.xyz/url/https%3A%2F%2Ffrancepassoire.com%2Ffiche%2Faccor-20260715%2F>
- Hub secteur : <https://www.opengraph.xyz/url/https%3A%2F%2Ffrancepassoire.com%2Fsecteur%2Fsante%2F>
- Chiffres : <https://www.opengraph.xyz/url/https%3A%2F%2Ffrancepassoire.com%2Fchiffres%2F>

## Risques et observations

1. **Le run « after » cible le build local** : les correctifs ne sont visibles
   sur `francepassoire.com` qu'après le déploiement CI de ce commit. À
   re-vérifier en production avec `node scripts/seo-audit.mjs` (cible par
   défaut pages.dev) après déploiement — sortie attendue 0/0.
2. **Ticker accueil vide** : `index.astro` garde `tickerItems = []` avec le
   commentaire « aucune sourcée pour l'instant » alors que 69 fiches sourcées
   existent — périmètre contenu (pas SEO), à signaler au lane éditorial.
3. **Pas d'`og:image`** : les partages n'afficheront que titre + description.
   Si un visuel carte est voulu, ajouter une image 1200×630 et
   `twitter:card summary_large_image`.
4. **Titres longs** : certains hubs/données flirtent avec ~70 caractères —
   troncature SERP possible, sans impact sur le gate.
