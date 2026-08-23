# Audit du blocage par IP des sources sortantes FrancePassoire

> **Sondage réel du 23 août 2026, 12:22 à 12:27 UTC.** Chaque verdict de ce
> document vient d'une sonde LIVE déployée pour l'occasion (un worker
> temporaire `francepassoire-ip-probe`, supprimé après usage) côté egress
> Workers, et d'un `curl` identique côté VPS. Aucun verdict n'est deviné.

## 1. Pourquoi cet audit

Plusieurs sources du pipeline refusent les adresses IP sortantes du runtime
Cloudflare Workers (constats historiques : Google News 503, Bluesky 403,
Reddit 403, FrenchBreaches 403 « Just a moment »). Ces cas étaient traités
un par un, au gré des pannes. Cet audit sonde SYSTÉMATIQUEMENT chaque hôte
contacté par les workers, depuis les deux égress disponibles (runtime
Workers et VPS OVH des runners), pour distinguer ce qui fonctionne, ce qui
est bloqué, ce qui est dégradé et ce qui a déjà basculé sur le VPS.

## 2. Méthodologie

* **Côté Workers** : worker jetable `francepassoire-ip-probe` (déployé,
  interrogé deux fois à 20 s d'intervalle, puis SUPPRIMÉ ; le code n'a
  jamais vécu dans le dépôt). Il exécute un `fetch` par hôte avec un UA
  navigateur Chrome 128 complet, timeout 15 s, et renvoie statut + 100
  premiers octets + latence. Une passe complémentaire a testé des variantes
  d'UA (pipeline `FrancePassoire-Ingest/1.0`, veille, nu).
* **Côté VPS** : même liste, même UA navigateur, `curl -L --max-time 15`
  depuis le runner (`ssh vps`), statut et premiers octets consignés.
* **Interprétation** : une réponse d'API opérationnelle non authentifiée
  (401/400/405) vaut « joignable, non bloqué par IP » : l'erreur porte sur
  l'authentification, pas sur notre adresse. Un statut 200 avec un corps
  vide de résultats vaut DÉGRADÉ, pas OK.

## 3. Sources d'ingestion (worker ingest, cron 7,37)

| Source | Hôte | Code source | Depuis Workers | Depuis VPS | Verdict | Recommandation |
| --- | --- | --- | --- | --- | --- | --- |
| rss:01net | www.01net.com | `workers/ingest/adapters/rss.ts:237` | 200 XML | 200 XML | OK | Garder tel quel |
| rss:zdnet-fr | www.zdnet.fr | `rss.ts:238` | 200 XML | 200 XML | OK | Garder |
| rss:jdn | www.journaldunet.com | `rss.ts:239` | 200 XML (0,7 s) | 200 XML | OK | Garder |
| rss:zataz | www.zataz.com | `rss.ts:240` | 200 XML | 200 XML | OK | Garder |
| rss:fuitesinfos | fuitesinfos.fr | `rss.ts:245` | 200 XML | 200 XML | OK | Garder |
| rss:gnews-fuites | news.google.com | `rss.ts:251` | **503** (3 sondages, 2 UA différents, 6 à 9 s avant échec) | 200 XML | **BLOQUÉ** | **Bascule VPS proposée** (même motif que FrenchBreaches ; aujourd'hui l'adaptateur récolte du vide en silence) |
| rss:undernews | www.undernews.fr | `rss.ts:252` | 200 XML | 200 XML | OK | Garder |
| rss:dsb | www.datasecuritybreach.fr | `rss.ts:253` | 200 XML | 200 XML | OK | Garder |
| rss:hackmanac | hackmanac.com | `rss.ts:254` | **202 + page HTML anti-bot** (interstitiel meta-refresh, tous UA testés) | 200 XML réel | **BLOQUÉ** | **Bascule VPS proposée** ; voir constat 4.2 (échec silencieux) |
| ransomware.live | api.ransomware.live | `adapters/ransomware-live.ts:27` | 200 JSON | 200 JSON | OK | Garder |
| RansomLook | www.ransomlook.io | `adapters/ransomlook.ts:13` | 200 JSON | 200 JSON | OK | Garder |
| CERT-FR avis | www.cert.ssi.gouv.fr | `adapters/cert-fr.ts:32` | 200 XML | 200 XML | OK | Garder |
| CERT-FR alertes | www.cert.ssi.gouv.fr | `adapters/cert-fr.ts:33` | 200 XML | 200 XML | OK | Garder |
| CNIL sanctions | www.cnil.fr | `adapters/cnil.ts:42` | 200 HTML (parfois 5,6 s) | 200 HTML | OK | Garder (surveiller la lenteur) |
| CNIL jeux de données | www.data.gouv.fr | `adapters/cnil.ts:44` | 200 JSON | 200 JSON | OK | Garder |
| HIBP | haveibeenpwned.com | `adapters/hibp.ts:25` | 200 JSON | 200 JSON | OK | Garder |
| FrenchBreaches | frenchbreaches.com | `rss.ts:246` (commentaire), moisson `.github/workflows/fb-vps.yml` | 403 « Just a moment » (UA pipeline) ; 200 (UA navigateur) | 200 XML | **DÉJÀ VPS** | Statu quo : la garder sur le VPS ; ne pas revenir au worker (le bot-check réapparaît selon l'UA) |

## 4. Constats d'ingestion notables

### 4.1 Google News est mort côté worker, en silence

`rss:gnews-fuites` (`rss.ts:251`) a répondu **503 aux trois sondages
Workers**, avec l'UA navigateur ET l'UA pipeline. Le VPS obtient le flux
complet (200 XML). L'adaptateur RSS traite un statut non-2xx par
`return []` (`rss.ts:207`) : la source ne produit donc RIEN depuis le
worker, sans erreur visible. Proposition (non implémentée) : un workflow
VPS sur le modèle de `fb-vps.yml`, ou l'ajout du flux à `veille-sociale-vps.yml`.

### 4.2 Hackmanac : le pire des cas, un 200-factice qui récolte du vide

Depuis Workers, hackmanac.com répond **202** avec une page HTML
anti-bot (interstitiel meta-refresh), quel que soit l'UA. Or 202 EST un
statut `res.ok` pour l'adaptateur (`rss.ts:204-207`) : le parseur reçoit du
HTML, n'y trouve aucun `<item>`, et la récolte est vide SANS aucun signal
d'échec. Depuis le VPS : 200 et le vrai flux RSS. Proposition : bascule VPS,
et à court terme considérer « 202 sans XML » comme un échec de source dans
l'adaptateur RSS (à implémenter séparément si retenu).

### 4.3 FrenchBreaches : le bot-check vit encore

Avec l'UA pipeline (celui de `fb-vps.yml`), Workers reçoit 403 « Just a
moment » ; avec un UA navigateur complet, Workers passe (200). Le VPS passe
dans tous les cas. Conclusion : la bascule VPS de `fb-vps.yml` reste la
bonne décision ; un retour au worker exigerait un UA navigateur strict et
resterait fragile.

## 5. Veille sociale (module de repli `workers/api/src/veille-sociale.ts`, production sur VPS)

Rappel : depuis le commit `d026068`, le slot de production est
`.github/workflows/veille-sociale-vps.yml` ; le module du worker api reste
en repli silencieux. Les lignes citées sont celles du module de repli.

| Source | Hôte | Code source | Depuis Workers | Depuis VPS | Verdict | Recommandation |
| --- | --- | --- | --- | --- | --- | --- |
| Google News (veille) | news.google.com | `veille-sociale.ts:95` | 503 | 200 XML | DÉJÀ VPS | Statu quo, la bascule était juste |
| Bluesky searchPosts | public.api.bsky.app | `veille-sociale.ts:118` | **403** | **403** (même avec la requête EXACTE du workflow VPS) | **BLOQUÉ des deux côtés** | À investiguer : la bascule VPS ne résout plus (voir 5.1) |
| Reddit recherche | www.reddit.com | `veille-sociale.ts:133` | 200 XML (UA navigateur ET UA veille au sondage du 23/08) | 200 XML | DÉGRADÉ | Statu quo VPS avec UA navigateur ; le 403 historique est erratique, ne pas rebasculer sur cette seule journée |
| Mastodon recherche | mastodon.social | `veille-sociale.ts:148` | 200 mais **résultats vides** | 200, vides aussi | **DÉGRADÉ (non lié à l'IP)** | Retirer la source ou l'authentifier (voir 5.2) |

### 5.1 Bluesky : contradiction avec l'hypothèse VPS

L'en-tête de `veille-sociale-vps.yml` affirme que l'IP OVH « passe partout »
sur Bluesky. Le sondage du 23/08 contredit : `searchPosts` renvoie 403
depuis le VPS également, avec la requête exacte du workflow (UA navigateur
compris). L'API publique a probablement durci ses règles (frontwall par
réputation d'IP ou par signature de requête). La source est donc morte des
deux côtés à date ; le workflow VPS la tolère comme « source morte » dans
son email. Piste : jeton d'App Password gratuit sur un compte dédié (à
décider par le propriétaire).

### 5.2 Mastodon : ce n'est pas un blocage IP

L'API `v2/search` non authentifiée renvoie `{"statuses":[]}` DEPUIS LES DEUX
égrees, sur une requête qui a déjà produit des résultats par le passé.
Le service a restreint la recherche de statuts aux appels authentifiés ;
aucun changement d'IP n'y fera rien. Recommandation : retirer la source des
deux côtés, ou la brancher sur un jeton d'application.

## 6. Hôtes opérationnels et sociaux

| Rôle | Hôte | Code source | Depuis Workers | Depuis VPS | Verdict | Recommandation |
| --- | --- | --- | --- | --- | --- | --- |
| Publication Bluesky | bsky.social | `workers/social/clients/bluesky.ts:27,29` | 200 (describeServer) | 200 | OK | Garder |
| Relais Nostr | relay.damus.io, nos.lol, relay.primal.net | `workers/social/clients/nostr.ts:28-30` | 200 (racine HTTPS) | 200 | OK (le posting réel est WebSocket, non sondé ici) | Garder |
| PR GitHub | api.github.com | `workers/ingest/src/pr-automation.ts:104` | 200 | 200 | OK | Garder |
| Email Brevo | api.brevo.com | `workers/api/src/watchlist.ts:61` | 401 sans clé (joignable) | 401 (un timeout transitoire sur 3 essais) | OK | Garder |
| Turnstile siteverify | challenges.cloudflare.com | `workers/api/src/index.ts:77` | 405 en GET (joignable) | 405 | OK | Garder |
| Graph Facebook | graph.facebook.com | `workers/social/clients/facebook.ts:69` | 400 sans token (joignable) | 400 | OK | Garder |
| Graph Instagram | graph.instagram.com | `workers/social/clients/instagram.ts:22` | 400 sans token (joignable) | 400 | OK | Garder |
| LinkedIn UGC | api.linkedin.com | `workers/social/clients/linkedin.ts:19` | 401 sans token (joignable) | 401 | OK | Garder |
| Webhooks Make.com | secrets `LINKEDIN_WEBHOOK_URL` / `MAKE_WEBHOOK_URL` | `workers/social/clients/make-linkedin.ts:26`, `make-x.ts:28` | non sondable : l'URL est le credential | idem | NON AUDITABLE par principe | RAS (le secret n'existe pas en clair, c'est voulu) |
| Auto-sondes du site | francepassoire.com, api.francepassoire.com | `workers/watchdog/src/cibles.ts:29-47` | (cibles internes) | 200 | OK | Garder |

## 7. Règles de décision appliquées

1. Source saine depuis Workers : **garder sur le worker** (aucune action).
2. Morte depuis Workers mais saine depuis le VPS : **bascule VPS proposée**
   (PROPOSITION SEULE, rien n'a été implémenté par cet audit ; modèle :
   `fb-vps.yml`). Concernées : `rss:gnews-fuites`, `rss:hackmanac`.
3. Instable selon l'UA : **exiger un UA navigateur** côté VPS et ne pas
   rebasculer au worker. Concernées : Reddit, FrenchBreaches.
4. Morte des deux côtés : question de contrat d'API, pas d'IP ; décision
   propriétaire. Concernées : Bluesky searchPosts (403/403), Mastodon
   (200 vide / 200 vide).

## 8. Reproduire l'audit

Le worker de sonde n'existe plus (supprimé après usage, voir §2). Pour
rejouer : recréer un worker jetable qui fetch chaque URL du tableau avec un
UA navigateur (même liste, `rss.ts` + `veille-sociale.ts` + clients
sociaux), l'interroger sur son URL workers.dev, puis le supprimer ; côté
VPS, un simple `curl -A "<UA Chrome>" -o /dev/null -w '%{http_code}'` par
hôte suffit. Les sorties brutes du 23/08 sont archivées dans le journal de
session (hors dépôt).

## 9. Écart aux hypothèses de départ

* FrenchBreaches passe depuis Workers AVEC un UA navigateur complet (le 403
  ne survient qu'avec l'UA pipeline) : le blocage est partiellement lié à
  l'UA, pas uniquement à l'IP. La décision VPS reste néanmoins la bonne.
* Reddit est passé (200) depuis Workers avec les deux UA testés le
  23/08 : le blocage 403 historique est erratique, pas permanent.
* Bluesky searchPosts est 403 AUSSI depuis le VPS : contradiction directe
  avec le commentaire d'en-tête de `veille-sociale-vps.yml`.
* Mastodon renvoie des résultats vides depuis les deux côtés : ce n'est pas
  un blocage par IP.
* Deux sources configurées dans le worker ingest récoltent actuellement du
  vide en silence (`gnews-fuites`, `hackmanac`) : c'était précisément la
  classe de panne que cet audit devait révéler.
