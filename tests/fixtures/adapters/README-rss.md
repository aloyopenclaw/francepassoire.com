# Fixtures `rss-*.xml` — tâche 15 (adapter RSS médias)

Captures **réelles** effectuées une seule fois le 2026-08-20 (heure locale
Europe/Paris), via `curl -L -A "Mozilla/5.0 …"` sur les 4 flux configurés.
Aucune retouche du contenu ; uniquement la restriction aux 30 premiers
`<item>` (voir « rognage » ci-dessous). Le code HTTP était 200 pour chacun.

| Fixture | Flux configuré | URL réellement servie (après redirection) |
|---|---|---|
| `rss-01net.xml` | `rss:01net` | `https://www.01net.com/feed/` (redirige depuis `/feed`) |
| `rss-zdnet-fr.xml` | `rss:zdnet-fr` | `https://www.zdnet.fr/feed` (redirige depuis `/feed/`) |
| `rss-jdn.xml` | `rss:jdn` | `https://www.journaldunet.com/rss/` |
| `rss-zataz.xml` | `rss:zataz` | `https://www.zataz.com/feed/` |

## Écarts par rapport au plan initial

- **JDN** : l'URL thématique du plan
  `https://www.journaldunet.com/rss/thematique/cybersecurite/` renvoie **404**
  (vérifié en direct). Le flux réel et fonctionnel est le flux général
  `https://www.journaldunet.com/rss/` (« JDN : Derniers contenus », 60 items),
  c'est lui qui est configuré.
- **ZDNet FR** : `https://www.zdnet.fr/feed/` fonctionne (redirection vers
  `/feed` sans slash). Les variantes « sécurité » testées
  (`/feeds/rss/actualites/securite/`, `/feeds/rss/thematique/securite/`,
  `/rss/securite/`) renvoient toutes une redirection 200 vers la page
  d'accueil HTML — ce ne sont pas des flux réels.

## Rognage (≤ 30 items)

- `rss-01net.xml` : 30/30 items, aucun rognage.
- `rss-zdnet-fr.xml` : 10/10 items, aucun rognage.
- `rss-zataz.xml` : 10/10 items, aucun rognage.
- `rss-jdn.xml` : **60 → 30 items**. Rognage non contigu, documenté : les 29
  premiers items + l'item n°40 (« Sébastien Lecornu préside … piratage de
  données fiscales… »), conservé exprès car c'est le seul item réel du lot
  portant à la fois un mot-clé et une entité vérifiable à l'œil
  (« Sébastien Lecornu », suite TitleCase) pour le test d'extraction
  d'entité. Aucun item modifié.

## Fixtures dérivées / composées (pas des réponses brutes)

- `rss-malformed.xml` — **dérivée** : capture Zataz tronquée en plein milieu
  d'un item, sans balise fermante `</rss>` (XML structurellement invalide),
  pour le test d'isolation.
- `rss-zdnet-fr-breach.xml` — **composée** : enveloppe et items de bruit =
  capture réelle de `/feed` (10 items sans mot-clé au moment de la capture),
  complétée de **2 articles réels** de la rubrique sécurité de zdnet.fr
  (titre + lien + guid capturés sur la page HTML de la rubrique, car aucune
  publication sécurité n'était présente dans l'instantané du flux) :
  - « Fuite à la DGFiP : après les excuses du ministre, l'urgence de revoir
    l'IAM face aux cyberattaques en série » —
    `…/fuite-a-la-dgfip-…-500205.htm` (porte les mots-clés ; témoin positif) ;
  - « Crise cyber à la DGFiP : Lecornu fouette l'Anssi par courrier » —
    `…/crise-cyber-a-la-dgfip-…-500249.htm` (aucun mot-clé ; témoin négatif).
  `pubDate` omis pour ces 2 items (non publié sur la page de rubrique) ;
  l'analyseur le tolère.

## Captures du 23/08 (T54d — LeMagIT, Clubic)

Captures **réelles** le 2026-08-23 (après-midi Europe/Paris), `curl -L -A
"Mozilla/5.0 …"`, code 200 pour chacun — confirmé aussi avec l'UA pipeline
du worker et depuis le VPS (tailles identiques à l'octet près, voir
`docs/audit-ip-blocking.md` §3).

| Fixture | Flux configuré | URL réellement servie (après redirection) |
|---|---|---|
| `rss-lemagit.xml` | `rss:lemagit` | `https://www.lemagit.fr/rss/ContentSyndication.xml` (aucune redirection) |
| `rss-clubic.xml` | `rss:clubic` | `https://www.clubic.com/feed/rss` (redirige depuis `/rss/news.rss`) |

### Écarts / particularités

- **LeMagIT** : `ContentSyndication.xml` est le SEUL flux exposé (site
  TechTarget — pas de `<link rel="alternate">`, pas de flux sécurité dédié).
  20 items servis ; 5 portent un mot-clé (Cyberhebdo du 21/08, Vols de
  données, brève + tribune « Cyberattaques contre l'État » — doublon —,
  Cyberattaques & vols de données). Les items n'exposent PAS de `<guid>` :
  l'analyseur replie sur le lien (couvert par test). Les titres utilisent
  des espaces insécables (`Cyberhebdo du 21\u00a0août`) — le fragment du
  test porte les mêmes octets.
- **Clubic** : `/rss/news.rss` redirige (301) vers `/feed/rss`, unique flux
  du site — aucune URL de catégorie ne fonctionne (`/feed/actualite`,
  `/feed/cybersecurite` → 404 ; `?category=securite` est ignoré : même
  contenu servi au octet près). L'instantané du 23/08 (50 items) ne
  comportait AUCUN titre à mot-clé (bons plans, tech grand public).

### Rognage

- `rss-lemagit.xml` : **20 → 8 items**, rognage non contigu, documenté :
  items d'origine 0,1,3,4,5,7,10,17 (ordre préservé, aucun item modifié).
  Conservés : les 4 porteurs de mots-clés + 4 de bruit dont les 2 titres
  quotés « … » (« Phantom Compute », « Nous vivons une crise existentielle
  des infrastructures IA ») pour couvrir le style de titres du média ; la
  tribune doublon « Cyberattaques contre l'État » (item 11) est laissée
  dehors. Les items TechTarget embarquent le corps complet (`<body>`,
  ~10 Ko/item) : 8 items ≈ 60 Ko, taille comparable à `rss-01net.xml`.
- `rss-clubic.xml` : **composée** (même motif que `rss-zdnet-fr-breach.xml`) :
  enveloppe et 8 items de bruit = capture réelle de `/feed/rss` (les 8
  premiers, titres CDATA sans mot-clé), complétés de **2 articles réels**
  de la rubrique cybersécurité (l'instantané du flux n'en contenait aucun) :
  - « Cyberattaque chez Almerys : les adhérents d'Alan touchés par une
    fuite de données sensibles » — `…/actualite-613981-…-fuite-de-donnees-sensibles.html`
    (porte les mots-clés ; témoin positif, titre CDATA) ;
  - « Les pirates entrent, les données sortent : ce que révèlent les
    attaques contre l'État » — `…/actualite-625753-les-pirates-entrent-…html`
    (porte les mots-clés ; témoin positif).
  Titres, liens et dates (`pubDate` au format RSS, conversion de
  l'`datePublished` JSON-LD des pages) proviennent des pages réelles ;
  convention guid vérifiée sur la capture : le guid Clubic EST l'URL de
  l'article.
