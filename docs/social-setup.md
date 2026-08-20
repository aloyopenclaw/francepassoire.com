# Réseaux sociaux — obtention des clés API (guide propriétaire)

> **Public** : vous, propriétaire du site. Ce document décrit, plateforme par plateforme, les clics exacts à effectuer dans chaque console développeur pour obtenir les clés nécessaires au cross-posting automatique. Les libellés des consoles sont laissés en anglais (ce sont les textes réels des interfaces) ; le reste est en français.
>
> **Vérifié le 20 août 2026** — chaque fait cité ici provient d'une page officielle dont l'URL figure en bas de document (table « Sources vérifiées »). Les tarifs et règles d'accès des plateformes changent souvent : au moment où vous exécuterez ces étapes, re-cliquez les liens pour confirmer.

## Principe : file d'attente, lancement non bloqué

Les workers de publication (tâches 38–40) sont codés en mode **file d'attente** : chaque post est mis en file et publié dès que la clé de la plateforme concernée est disponible. **Le lancement du site n'attend pas ces clés.**

- **Bluesky et Nostr sont opérationnels dès le jour 1** : vos identifiants existent ou seront générés par la tâche 27, sans review externe.
- **X, LinkedIn et TikTok démarrrent en file d'attente** : les posts s'accumulent et partiront dès que vous aurez fourni la clé correspondante (X nécessite en outre une offre payante — voir verdict ci-dessous).

## Secrets wrangler canoniques

Ces noms exacts sont consommés par les workers des tâches 38–40. Ne les renommez pas.

| Secret wrangler | Plateforme | Nature de la valeur |
|-----------------|------------|---------------------|
| `X_BEARER` | X | Bearer token app-only (lecture seule — voir §1) |
| `LINKEDIN_ACCESS_TOKEN` | LinkedIn | Access token utilisateur (60 jours) |
| `TIKTOK_ACCESS_TOKEN` | TikTok | User access token (Login Kit) |
| `BLUESKY_HANDLE` | Bluesky | Handle, ex. `votrecompte.bsky.social` |
| `BLUESKY_APP_PASSWORD` | Bluesky | Mot de passe d'application `xxxx-xxxx-xxxx-xxxx` |
| `NOSTR_NSEC` | Nostr | Clé privée `nsec1…` fournie par la tâche 27 |

## Résumé

| Plateforme | Statut | Ce que vous faites | Secret wrangler | Délai attendu |
|------------|--------|--------------------|-----------------|---------------|
| **X** | **Différé — offre payante hors périmètre** | Rien pour l'instant. La publication via API est payante (pay-per-use, crédits à acheter). Revoir la décision plus tard si budget | `X_BEARER` (lecture seule) | Sans objet tant que l'offre payante n'est pas souscrite |
| **LinkedIn** | Disponible (self-service) | Créer une app, activer *Share on LinkedIn*, générer un token membre via le *Token Generator* | `LINKEDIN_ACCESS_TOKEN` | Immédiat (~15 min) |
| **TikTok** | En attente de review | Créer une app, ajouter *Content Posting API*, soumettre à review avec vidéo démo, puis audit séparé | `TIKTOK_ACCESS_TOKEN` | Plusieurs jours à quelques semaines (non documenté officiellement) |
| **Bluesky** | **Disponible jour 1** | Créer un compte, générer un *App Password* | `BLUESKY_HANDLE` + `BLUESKY_APP_PASSWORD` | Immédiat (~5 min) |
| **Nostr** | **Disponible jour 1** | Rien — la paire de clés est générée par la tâche 27 ; conservez le backup reçu | `NOSTR_NSEC` | Clé remise par la tâche 27 |

---

## 1. X (Twitter) — verdict : aucune écriture gratuite, modèle pay-per-use

### Le verdict documenté

**Le palier gratuit avec écriture (celui qui offrait historiquement un quota mensuel de posts) n'est plus disponible pour les nouveaux développeurs.** Depuis le **6 février 2026**, X a lancé le modèle **Pay-Per-Use** : pas d'abonnement, on achète des **crédits** à l'avance et chaque requête est débitée. La page officielle *Overview* ne propose plus que deux produits : **X API — Pay-per-use** et **X API — Enterprise**. Le jour du lancement, X précisait que les utilisateurs récemment actifs de l'ancien palier gratuit recevaient un bon unique de 10 $, et que les « Public Utility Apps » (apps d'utilité publique approuvées au cas par cas) continuent de bénéficier d'un accès gratuit — ce n'est pas un chemin réaliste pour un lancement.

> **Décision retenue : X différé, offre payante hors périmètre.** Le worker X (tâche 38) publiera depuis la file d'attente le jour où une offre sera souscrite.

Chiffres issus de la page officielle *Pricing* (vérifiée le 20 août 2026) :

| Opération | Coût par requête |
|-----------|------------------|
| **Post: Create** | 0,015 $ |
| **Post: Create (with URL)** | 0,20 $ |
| **Post: Create (summoned)** — réponse à un post dont l'auteur vous a @mentionné/cité | 0,01 $ |
| Post: Read | 0,005 $ |
| Plafond de lecture | 3 millions de lectures de posts par cycle mensuel |

Chronologie officielle (changelog docs.x.com) :

- **6 févr. 2026** — lancement de *X API Pay-Per-Use pricing* : « a flexible credit-based model » ; console développeur déplacée vers console.x.com ; bon unique de 10 $ pour les anciens du free tier ; « Basic and Pro plans remain available » (formulation ambiguë — la page Products actuelle ne les liste plus ; à confirmer au moment de la création de l'app si vous voulez un abonnement plutôt que du pay-per-use).
- **23 févr. 2026** — réponses programmatiques restreintes : une réponse via `POST /2/tweets` n'est permise que si l'auteur du post original vous a « summoné » (@mention ou citation de votre compte). Restrictions uniquement sur les paliers self-serve.
- **16 avr. 2026 (effectif 20 avr.)** — `POST /2/tweets` à 0,015 $/post, post avec URL à 0,20 $ ; **Following, Likes et Quote-Posts supprimés de tous les paliers self-serve** (quote-post = plan Enterprise uniquement, confirmé aussi sur la page *Create Posts*).

### Types de clés : lecture seule vs publication

| Type de clé | Ce qu'elle permet | Suffit pour publier ? |
|-------------|-------------------|------------------------|
| **Bearer Token** (app-only) | Lire les données publiques | **Non** — lecture seule |
| **Access Token & Secret** (OAuth 1.0a, votre propre compte) | Agir en tant que vous-même (bots personnels) | Oui |
| **Client ID & Secret + token utilisateur OAuth 2.0** (PKCE) | Agir au nom d'un utilisateur, scopes fins | Oui — recommandé |

La page de référence de `POST /2/tweets` exige un **token utilisateur** avec les scopes **`tweet.read`, `users.read`, `tweet.write`** (OAuth 2.0) ou un token OAuth 1.0a. Le Bearer token ne peut pas publier.

### Étapes — uniquement si vous décidez de payer plus tard

1. Aller sur [console.x.com](https://console.x.com), se connecter avec votre compte X, accepter le *Developer Agreement*.
2. Cliquer **New App**, remplir nom/description/cas d'usage — la console génère les credentials (API Key & Secret, Bearer Token, Access Token & Secret, Client ID & Secret). **Les copier immédiatement** : elles ne sont affichées qu'une fois.
3. Configurer l'authentification utilisateur (OAuth 2.0, PKCE) avec les scopes `tweet.read`, `users.read`, `tweet.write`.
4. Acheter des crédits dans la section **Billing** du Developer Console, et fixer un **Spending limit** pour plafonner la dépense.
5. Transmettre le token utilisateur au worker X (le nom exact du secret sera défini par la tâche 38 — le Bearer seul ne suffit pas pour publier).

```
wrangler secret put X_BEARER
# Bearer token app-only — LECTURE SEULE, ne permet pas de publier
```

> Les écrans exacts de la nouvelle console (fév. 2026) peuvent évoluer : **à confirmer au moment de la création de l'app.**

---

## 2. LinkedIn — self-service, token en 15 minutes

### Console développeur

Portail : [linkedin.com/developers](https://www.linkedin.com/developers/)

### Étapes

1. Aller sur [linkedin.com/developer/apps/new](https://www.linkedin.com/developer/apps/new) : nom de l'app, logo, URL de politique de confidentialité (ex. `https://francepassoire.com/confidentialite`).
2. Une fois l'app créée, ouvrir l'onglet **Products** et activer **Share on LinkedIn**. C'est ce produit qui accorde le scope **`w_member_social`**.
3. Ouvrir l'onglet **Auth** : noter le **Client ID** (*API Key*) et le **Client Secret**. Ajouter un **Redirect URL** absolu en HTTPS (ex. `https://francepassoire.com/callback` — les URL relatives ou en `#` sont refusées).
4. Générer le token membre — le plus simple est l'outil officiel : **[Token Generator](https://www.linkedin.com/developers/tools/oauth/token-generator)** (Tools du portail) : sélectionner l'app, le scope `w_member_social`, s'authentifier, autoriser — le token est affiché directement. Alternative technique : dérouler le *Authorization Code Flow* (3-legged OAuth) à la main.
5. Copier le token (≈ 500 caractères) et le charger comme secret.

### Scopes et permissions

- Scope nécessaire : **`w_member_social`** — « Post, comment and like posts on behalf of an authenticated member. »
- C'est une **Open Permission** : activable en self-service via l'onglet Products, **sans review ni approbation LinkedIn**. La publication se fait au nom du **membre** (vous), pas d'une organisation — aucun scope organization requis.
- **Durée de vie du token : 60 jours** (« access tokens are issued with a 60-day lifespan »). Notez la date de génération : il faudra le renouveler environ tous les 2 mois (le worker, tâche 39, gérera l'alerte).

```
wrangler secret put LINKEDIN_ACCESS_TOKEN
```

> **Délai** : immédiat. Activation du produit et génération du token dans la même session.

---

## 3. TikTok — Content Posting API, review + audit (plusieurs jours)

### Console développeur

Portail : [developers.tiktok.com](https://developers.tiktok.com/)

### Étapes

1. Créer un compte développeur sur [developers.tiktok.com/signup](https://developers.tiktok.com/signup) (e-mail), puis se connecter. Créer ou rejoindre une **organisation** (recommandé).
2. Cliquer l'icône de profil → **Manage apps** → **Connect an app** : choisir l'organisation propriétaire, renseigner **App icon** (1024 × 1024 px), **App name**, **Category**, **Description**, plateforme **Web** (URL du site officiel demandée).
3. Noter dans **Credentials** le **Client key** et le **Client secret**.
4. Dans la section **Products**, cliquer **Add products** et ajouter **Content Posting API** ; activer la configuration **Direct Post** pour publier directement sur le profil des utilisateurs autorisés.
5. Vérifier les URL : bouton **URL properties** → **Verify properties** (par Domaine ou par URL prefix). Obligatoire pour les URLs ToS, Privacy Policy et Web, et pour toute URL utilisée par la Content Posting API.
6. Obtenir l'autorisation utilisateur du compte TikTok cible (Login Kit) : le scope **`video.publish`** doit être à la fois **approuvé pour l'app** et **autorisé par l'utilisateur**. Le token résultant démarre par `act.`.

### Review obligatoire, puis audit séparé

1. Section **App review** : expliquer en détail l'usage de chaque produit/scope, **uploader une vidéo démo** du flux de bout en bout (max 5 vidéos, 50 Mo chacune), **Save**, puis **Submit for review**.
2. Statuts : **Draft** → **In review** → **Live** (ou **Not approved** avec *Review comments* à traiter avant re-soumission).
3. **Audit séparé de la Content Posting API** : sans lui, « all content posted by unaudited clients will be restricted to private viewing mode » — les posts restent privés. Demande via [developers.tiktok.com/application/content-posting-api](https://developers.tiktok.com/application/content-posting-api), après avoir testé l'intégration.
4. Le mode **Sandbox** permet de tester sans attendre la review.

```
wrangler secret put TIKTOK_ACCESS_TOKEN
```

> **Délai attendu : plusieurs jours à quelques semaines** — TikTok ne documente pas de SLA officiel pour la review ni pour l'audit ; prévoyez large, d'où le mode file d'attente.

---

## 4. Bluesky — app password, immédiat

### Principe

Bluesky (protocole AT) n'a **ni console développeur ni enregistrement d'app** : l'authentification se fait au niveau du compte via un **App Password**, distinct du mot de passe principal, révocable, et aux permissions restreintes (il ne permet pas les actions destructrices : changement des paramètres du compte, des réglages d'authentification, ni des app passwords eux-mêmes). Format : `xxxx-xxxx-xxxx-xxxx`.

### Étapes

1. Créer un compte sur [bsky.app](https://bsky.app) si besoin — notez votre **handle** (ex. `votrecompte.bsky.social`).
2. Aller dans **Settings → App passwords** ([bsky.app/settings/app-passwords](https://bsky.app/settings/app-passwords)).
3. Cliquer **Add App Password**, nommer (ex. « FrancePassoire Bot »), copier le mot de passe généré — il n'est plus reréaffiché ensuite.

```
wrangler secret put BLUESKY_HANDLE
# Valeur : votre handle, ex. votrenom.bsky.social

wrangler secret put BLUESKY_APP_PASSWORD
# Valeur : le mot de passe d'application (format xxxx-xxxx-xxxx-xxxx)
```

> **Délai** : immédiat, aucune review.

---

## 5. Nostr — rien à faire, la clé viendra de la tâche 27

### Principe

Nostr est un protocole décentralisé : pas de console, pas d'enregistrement d'app. Chaque compte est une **paire de clés** cryptographiques (signatures Schnorr sur la courbe secp256k1). Les posts sont des *events* signés par la clé privée.

- **npub** (`npub1…`) : clé **publique**, encodage bech32 — votre identité, partageable.
- **nsec** (`nsec1…`) : clé **privée**, encodage bech32 — signe vos posts. **Ne jamais la partager ni la coller ailleurs** que dans le secret wrangler ; qui la possède publie à votre place.

### Ce que vous devez faire

**Rien.** La tâche 27 du plan génère la paire et la met en quarantaine. Vous recevrez :

- la clé publique `npub` — à publier sur le profil / à diffuser ;
- la clé privée `nsec` — **backup sécurisé obligatoire** (coffre-fort de mots de passe, support physique). C'est elle que le worker Nostr (tâche 40) utilise pour signer.

```
wrangler secret put NOSTR_NSEC
# Valeur : la clé privée nsec1… remise par la tâche 27
```

> **Délai** : la clé vous sera transmise à la clôture de la tâche 27. Aucune console externe.

---

## Sources vérifiées (contenu consulté le 2026-08-20 ; statut HTTP mesuré par curl)

Les pages TikTok et bsky.app sont des applications mono-page qui répondent 404 aux requêtes HEAD et 200 aux requêtes GET (noté `200 GET`). Le formulaire d'audit TikTok renvoie 401 sans session développeur connectée — comportement attendu d'un portail applicatif ; le lien provient de la documentation officielle TikTok elle-même.

| URL | HTTP | Usage dans ce document |
|-----|------|------------------------|
| https://docs.x.com/x-api/getting-started/pricing | 200 | X : pay-per-use, crédits, coûts Post:Create 0,015 $/0,20 $/0,01 $, plafond 3 M lectures |
| https://docs.x.com/overview | 200 | X : deux produits seulement (Pay-per-use, Enterprise) |
| https://docs.x.com/changelog | 200 | X : 6 fév. 2026 lancement pay-per-use ; 23 fév. 2026 réponses « summoned » ; 16 avr. 2026 tarifs écrits + retraits self-serve |
| https://docs.x.com/x-api/posts/create-post | 200 | X : scopes requis `tweet.read`/`users.read`/`tweet.write` ; quote-post Enterprise uniquement |
| https://docs.x.com/x-api/getting-started/getting-access | 200 | X : types de credentials, Bearer = lecture seule, OAuth pour publier |
| https://devcommunity.x.com/t/x-api-v2-update-addressing-llm-generated-spam/257909 | 200 | X : annonce « summoned replies » (23 fév. 2026, liée au changelog) |
| https://devcommunity.x.com/t/x-api-pricing-update-owned-reads-now-0-001-other-changes-effective-april-20-2026/263025 | 200 | X : annonce tarifs avril 2026 (liée au changelog) |
| https://console.x.com | 200 | X : Developer Console (création d'app, achat de crédits) |
| https://learn.microsoft.com/en-us/linkedin/shared/authentication/getting-access | 200 | LinkedIn : `w_member_social` Open Permission self-service |
| https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow | 200 | LinkedIn : Authorization Code Flow, token 60 jours, Token Generator |
| https://www.linkedin.com/developers/ | 200 | LinkedIn : portail développeur |
| https://www.linkedin.com/developers/tools/oauth/token-generator | 200 | LinkedIn : outil de génération de token |
| https://developers.tiktok.com/doc/content-posting-api-get-started | 200 GET | TikTok : Direct Post, scope `video.publish`, mode privé sans audit |
| https://developers.tiktok.com/doc/getting-started-create-an-app | 200 GET | TikTok : création d'app, URL properties, review, statuts |
| https://developers.tiktok.com/application/content-posting-api | 401 (portail applicatif, session requise) | TikTok : demande d'audit Content Posting API — lien cité par la doc officielle |
| https://developers.tiktok.com/signup | 200 GET | TikTok : inscription développeur |
| https://atproto.com/specs/xrpc | 200 | Bluesky : App Passwords (création/révocation, format, permissions restreintes) |
| https://bsky.app/settings/app-passwords | 200 GET | Bluesky : écran de création d'App Password |
| https://github.com/nostr-protocol/nips/blob/master/01.md | 200 | Nostr : paire de clés, Schnorr/secp256k1, events |
| https://github.com/nostr-protocol/nips/blob/master/19.md | 200 | Nostr : encodages bech32 npub/nsec |
