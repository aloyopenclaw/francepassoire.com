# Réseaux sociaux — obtention des clés API (guide propriétaire)

> **Public** : vous, propriétaire du site. Ce document décrit, plateforme par plateforme, les clics exacts à effectuer dans chaque console développeur pour obtenir les clés nécessaires au cross-posting automatique. Les libellés des consoles sont laissés en anglais (ce sont les textes réels des interfaces) ; le reste est en français.
>
> **Vérifié le 22 août 2026** — chaque fait cité ici provient d'une page officielle dont l'URL figure en bas de document (table « Sources vérifiées »). Les tarifs et règles d'accès des plateformes changent souvent : au moment où vous exécuterez ces étapes, re-cliquez les liens pour confirmer.

## Principe : file d'attente, lancement non bloqué

Les workers de publication (tâches 38–40, refonte 51) sont codés en mode **file d'attente** : chaque post est mis en file et publié dès que la clé de la plateforme concernée est disponible. **Le lancement du site n'attend pas ces clés.**

- **Bluesky et Nostr sont opérationnels dès le jour 1** : vos identifiants existent ou seront générés par la tâche 27, sans review externe.
- **X (via Make) et LinkedIn (via Make) démarrent en file d'attente** : les posts s'accumulent et partiront dès que vous aurez fourni la clé correspondante.
- **TikTok est retiré** (T51) : la Content Posting API est vidéo-first — il n'existe pas de post texte, et nos rendus sont texte + URL de fiche. Le client et ses secrets ont été supprimés du code ; le jour d'une stratégie vidéo (digest hebdomadaire), on rouvrira le sujet.
- **Facebook Page et Instagram sont retirés** (23/08/2026) : décision propriétaire — plus de produits Meta. Les clients, les plateformes et leurs secrets ont été supprimés du code ; le reste du guide est conservé pour mémoire.

## Secrets wrangler canoniques

Ces noms exacts sont consommés par les workers des tâches 38–40/51. Ne les renommez pas.

| Secret wrangler | Plateforme | Nature de la valeur |
|-----------------|------------|---------------------|
| `X_BEARER` | X | Bearer token app-only (lecture seule — pour mémoire) |
| `MAKE_WEBHOOK_URL` | X | URL du webhook du scénario Make X (LE crédential du scénario) |
| `LINKEDIN_WEBHOOK_URL` | LinkedIn | URL du webhook du scénario Make LinkedIn (scénario DISTINCT du X) |
| `LINKEDIN_ACCESS_TOKEN` | LinkedIn (client direct de référence) | Access token utilisateur (60 jours) |
| `LINKEDIN_MEMBER_URN` | LinkedIn (client direct de référence) | URN du membre émetteur |
| `BLUESKY_HANDLE` | Bluesky | Handle, ex. `votrecompte.bsky.social` |
| `BLUESKY_APP_PASSWORD` | Bluesky | Mot de passe d'application `xxxx-xxxx-xxxx-xxxx` |
| `NOSTR_NSEC` | Nostr | Clé privée `nsec1…` fournie par la tâche 27 |

## Résumé

| Plateforme | Statut | Ce que vous faites | Secret wrangler | Délai attendu |
|------------|--------|--------------------|-----------------|---------------|
| **X** | **Disponible via Make** | Créer un compte Make.com, un scénario Webhook → X « Create a Post », connecter @francepassoire | `MAKE_WEBHOOK_URL` | Immédiat (~20 min, offre gratuite Make) |
| **LinkedIn** | **Disponible via Make** | Scénario Make distinct avec module LinkedIn « Create a Post » | `LINKEDIN_WEBHOOK_URL` | Validé (21/08) |
| ~~Facebook Page~~ | Retiré (23/08/2026) | Rien — décision propriétaire : plus de produits Meta | — | — |
| ~~Instagram~~ | Retiré (23/08/2026) | Rien — décision propriétaire : plus de produits Meta | — | — |
| **Bluesky** | **Disponible jour 1** | Créer un compte, générer un *App Password* | `BLUESKY_HANDLE` + `BLUESKY_APP_PASSWORD` | Immédiat (~5 min) |
| **Nostr** | **Disponible jour 1** | Rien — la paire de clés est générée par la tâche 27 ; conservez le backup reçu | `NOSTR_NSEC` | Clé remise par la tâche 27 |
| ~~TikTok~~ | Retiré (T51) | Rien — API vidéo-first incompatible avec nos posts texte+URL | — | — |

---

## 1. X (Twitter) — via Make.com : plus besoin de payer l'API

### Pourquoi le bridge Make

L'API X directe est passée en **pay-per-use** (6 février 2026) : 0,015 $/post, **0,20 $/post avec URL** — or chacun de nos posts contient l'URL de la fiche. Hors de portée pour un observatoire citoyen.

**Make.com** (automatisation, ex-Integromat) est partenaire officiel X et LinkedIn : ses modules « Create a Post » publient via SES propres identifiants d'app, en OAuth sur VOTRE compte. Le worker envoie simplement le texte au webhook de votre scénario — Make publie. La publication manuelle via une app tierce de confiance reste conforme aux règles X (c'est le même chemin que les outils type Buffer/Hootsuite).

Coût : l'offre ** gratuite de Make** couvre ~1000 opérations/mois — largement au-delà de notre cadence (quelques posts/semaine).

### Étapes — créer le scénario Make

1. Créer un compte sur [make.com](https://www.make.com) (offre Free suffisante).
2. **Create a new scenario**. Ajouter un module **Webhooks → Custom webhook** : Make génère une URL unique (`https://hook.eu1.make.com/…`). **C'est cette URL qui devient le secret `MAKE_WEBHOOK_URL`** — longue, unique, impossible à deviner : qui la possède déclenche le post. Ne la collez nulle part ailleurs.
3. Ajouter le module **X (Twitter) → Create a Post** : cliquer **Add** pour connecter un compte, autoriser avec **@francepassoire**. Le module publie au nom du compte connecté.
4. Dans le module, mapper le champ **Text** sur la donnée entrante `text`, et le champ **url/média** sur la donnée entrante `mediaUrl`. Le worker envoie EXACTEMENT `{text, mediaUrl}` en JSON — `text` contient l'URL de la fiche, `mediaUrl` la carte 1080×1080 (`…/fiche/<slug>/card.jpg`). Tout écart de ce gabarit casse le mapping (« Missing value of required parameter 'url' », constaté en prod 2026-08-22).
5. Optionnel : insérer un module **Tools → Set variable** ou une approbation manuelle si vous voulez relire chaque post avant publication (Make attend alors votre clic).
6. **Save** puis activer le scénario (bouton **Scheduling on**).
7. Test : `curl -X POST <URL-webhook> -H 'Content-Type: application/json' -d '{"text":"test","mediaUrl":"https://francepassoire.com/fiche/<slug>/card.jpg"}'` — le post doit apparaître sur @francepassoire.

```
wrangler secret put MAKE_WEBHOOK_URL
# Valeur : l'URL https://hook.eu1.make.com/… du module webhook
```

> **DEUX scénarios, DEUX secrets** (constat 2026-08-22) : X et LinkedIn sont des scénarios Make distincts avec des webhooks distincts — `MAKE_WEBHOOK_URL` (scénario X, contrat `{text, mediaUrl}`) et `LINKEDIN_WEBHOOK_URL` (scénario LinkedIn, contrat `{text, url, statut, request_id}`). Ne jamais partager une URL entre les deux : chaque requête atteint exactement SA plateforme.

### Comportement du worker

- Webhook absent → les lignes X restent `PENDING_KEYS` (jamais un échec).
- Réponse 2xx → `SENT` (remis à Make ; l'approbation/publication en aval est visible dans l'historique Make).
- 429/5xx → rejoué au cron suivant ; 4xx/410 (scénario éteint) → lettre morte.

---

## 2. LinkedIn — via Make.com (même mécanique)

Le posting direct sur la page société exige le scope `w_organization_social` (revue LinkedIn = entreprise enregistrée active — hors de portée). Même délégation que X :

1. Dans Make, **nouveau scénario** : module **Webhooks → Custom webhook** (URL propre à ce scénario).
2. Module **LinkedIn → Create a Post (Organization)**, connecter le compte ayant un rôle d'admin sur la page société FrancePassoire.
3. Mapper `text` (le worker envoie `{text, url, statut, request_id}` pour LinkedIn).
4. Activer, puis :

```
wrangler secret put MAKE_WEBHOOK_URL
```

> Le client direct (token membre, scopes `w_member_social`) reste dans le code pour référence (`workers/social/clients/linkedin.ts`) mais n'est PAS branché : le chemin de production est le webhook.

---

## 3. Facebook Page — RETIRÉ

**RETIRÉ le 23/08/2026 — décision propriétaire : plus de produits Meta ; le reste du guide est conservé pour mémoire.**

Le client `workers/social/clients/facebook.ts`, la plateforme `facebook` de la file sociale et les secrets `FB_PAGE_ID` / `FB_PAGE_TOKEN` ont été supprimés du code. Les lignes déjà publiées restent dans l'historique D1 ; aucune nouvelle ligne Facebook n'est mise en file.

---

## 4. Instagram — RETIRÉ

**RETIRÉ le 23/08/2026 — décision propriétaire : plus de produits Meta ; le reste du guide est conservé pour mémoire.**

Le client `workers/social/clients/instagram.ts`, la plateforme `instagram` de la file sociale et les secrets `IG_TOKEN` / `IG_USER_ID` ont été supprimés du code. La carte fiche 1080×1080 (`card.jpg`) reste générée au build : elle sert toujours d'image aux posts LinkedIn et X (via Make).

---

## 5. Bluesky — app password, immédiat

### Principe

Bluesky (protocole AT) n'a **ni console développeur ni enregistrement d'app** : l'authentification se fait au niveau du compte via un **App Password**, distinct du mot de passe principal, révocable, et aux permissions restreintes (il ne permet pas les actions destructrices : changement des paramètres du compte, des réglages d'authentification, ni des app passwords eux-mêmes). Format : `xxxx-xxxx-xxxx-xxxx`.

### Étapes

1. Créer un compte sur [bsky.app](https://bsky.app) si besoin — notez votre **handle** (ex. `votrecompte.bsky.social`).
2. Aller dans **Settings → App passwords** ([bsky.app/settings/app-passwords](https://bsky.app/settings/app-passwords)).
3. Cliquer **Add App Password**, nommer (ex. « FrancePassoire Bot »), copier le mot de passe généré — il n'est plus réaffiché ensuite.

```
wrangler secret put BLUESKY_HANDLE
# Valeur : votre handle, ex. votrenom.bsky.social

wrangler secret put BLUESKY_APP_PASSWORD
# Valeur : le mot de passe d'application (format xxxx-xxxx-xxxx-xxxx)
```

> **Délai** : immédiat, aucune review.

---

## 6. Nostr — rien à faire, la clé viendra de la tâche 27

### Principe

Nostr est un protocole décentralisé : pas de console, pas d'enregistrement d'app. Chaque compte est une **paire de clés** cryptographiques (signatures Schnorr sur la courbe secp256k1). Les posts sont des *events* signés par la clé privée.

- **npub** (`npub1…`) : clé **publique**, encodage bech32 — votre identité, partageable.
- **nsec** (`nsec1…`) : clé **privée**, encodage bech32 — signe vos posts. **Ne jamais la partager ni la coller ailleurs** que dans le secret wrangler ; qui la possède publie à votre place.

### Ce que vous devez faire

**Rien.** La tâche 27 du plan génère la paire et la met en quarantaine. Vous recevrez :

- la clé publique `npub` — à publier sur le profil / à diffuser ;
- la clé privée `nsec` — **backup sécurisé obligatoire** (coffre-fort de mots de passe, support physique). C'est elle que le worker Nostr utilise pour signer.

```
wrangler secret put NOSTR_NSEC
# Valeur : la clé privée nsec1… remise par la tâche 27
```

> **Délai** : la clé vous sera transmise à la clôture de la tâche 27. Aucune console externe.

---

## Sources vérifiées (contenu consulté le 2026-08-22 ; statut HTTP mesuré par curl)

| URL | HTTP | Usage dans ce document |
|-----|------|------------------------|
| https://docs.x.com/x-api/getting-started/pricing | 200 | X : pay-per-use, 0,015 $/post, 0,20 $/post avec URL — justification du bridge Make |
| https://docs.x.com/changelog | 200 | X : 6 fév. 2026 lancement pay-per-use ; 16 avr. 2026 tarifs écrits |
| https://www.make.com/en/integrations/x-twitter | 200 | Make : module X « Create a Post » (OAuth compte, publication au nom du compte) |
| https://www.make.com/en/integrations/linkedin | 200 | Make : module LinkedIn « Create a Post » |
| https://www.make.com/en/pricing | 200 | Make : offre Free ~1000 opérations/mois |
| https://developers.facebook.com/docs/facebook-login/guides/access-tokens/get-page-access-tokens | 200 | Facebook : page access token via /me/accounts, permissions pages_manage_posts |
| https://developers.facebook.com/docs/graph-api/reference/v21.0/page/feed | 200 | Facebook : POST /{page-id}/feed {message, link} |
| https://developers.facebook.com/docs/graph-api/using-graph-api/error-handling | 200 | Facebook : codes d'erreur 190/102 (token), 4/17/32 (débit) |
| https://developers.facebook.com/docs/instagram-platform/content-publishing | 200 | Instagram : conteneur /media + /media_publish, « JPEG is the only image format supported », 50 posts/24 h |
| https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/media | 200 | Instagram : specs image (JPEG, ≤8 Mo, ratio 4:5–1.91:1, ≤1440px de large) et champs image_url/caption |
| https://developers.facebook.com/docs/instagram-platform/instagram-graph-api/reference/ig-user/accounts | 200 | Instagram : instagram_business_account sur la Page → IG_USER_ID |
| https://atproto.com/specs/xrpc | 200 | Bluesky : App Passwords (création/révocation, format, permissions restreintes) |
| https://bsky.app/settings/app-passwords | 200 GET | Bluesky : écran de création d'App Password |
| https://github.com/nostr-protocol/nips/blob/master/01.md | 200 | Nostr : paire de clés, Schnorr/secp256k1, events |
| https://github.com/nostr-protocol/nips/blob/master/19.md | 200 | Nostr : encodages bech32 npub/nsec |
