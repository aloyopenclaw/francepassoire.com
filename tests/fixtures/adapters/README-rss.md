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
