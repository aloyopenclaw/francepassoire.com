# Runbook de lancement — FrancePassoire (tâche 49)

> **Statut : PROJET (DRAFT).** Plusieurs dépendances restent en attente et
> sont marquées « EN ATTENTE » ci-dessous — aucune n'est masquée. Exécution
> par le **propriétaire uniquement** (l'annonce de lancement est un acte
> humain ; aucune annonce automatique, jamais).
>
> Dernier état connu des vérifications : **vendredi 21 août 2026** — chaque
> commande citée en « dernier état connu » (§1.1, §5) a été réellement
> exécutée ce jour-là, sorties consignées dans
> `.omo/evidence/francepassoire-launch/task-49-francepassoire-launch.log`.

## 0. Préambule technique (à exporter avant toute commande wrangler)

```bash
export CLOUDFLARE_API_TOKEN="$(cat ~/.config/francepassoire/cloudflare.token)"
export CLOUDFLARE_ACCOUNT_ID="8bf7b7311f17611f5b95f1f4e755f8e7"
```

Identifiants fixes : projet Pages `francepassoire` (branche de production
`main`) · base D1 `francepassoire` (id `613f348d-fb59-478c-8f53-84a8679f1ed9`)
· zone DNS `francepassoire.com` (id `55f7a20e65f02cedd5fbd88511e6ab75`).

## 1. Critères GO / NO-GO

**Règle :** GO si et seulement si les 14 critères ci-dessous repassent au vert
le jour J (commandes fournies, toutes copiables-collables) ET si le
propriétaire a pris connaissance des 4 points « EN ATTENTE » du §1.2 (aucun
n'est bloquant par conception). **Tout critère rouge au re-run = NO-GO
explicite** — corriger d'abord, relancer le balayage, puis décider.

### 1.1 Critères vérifiables par commande

| # | Critère | Tâche | Preuve (`.omo/evidence/francepassoire-launch/`) | Dernier état connu (21/08/2026) |
|---|---------|-------|--------------------------------------------------|--------------------------------|
| 1 | Domaine + HTTPS en production | T6 | `task-6-francepassoire-launch.log` | `curl -sI https://francepassoire.com/` → 200, `server: cloudflare` |
| 2 | Toutes les routes répondent (balayage global) | T50 | `task-50-francepassoire-launch.log` | `node scripts/launch-sweep.mjs` → **294/294 sondes OK**, exit 0 (inclut `api/health` 200) |
| 3 | Chaîne d'intégrité vérifiée | T10/T27 | `docs/ancrages.md` + plan T27 | `node scripts/verify-registry.mjs registre.jsonl` → exit 0, **134 événements**, tête `92a2b578c9958b862dd7549503ab05ef43e72429246f1de66fcd49a5e8da2e5e` |
| 4 | Artefact public = chaîne du dépôt | T27/T35 | plan T27 | `curl -s https://francepassoire.com/registre.jsonl` → 134 lignes, **octet-identique** à `registre.jsonl` (diff vide, 21/08) |
| 5 | Ancrages Nostr retrouvés (≥2 relais) | T27 | `docs/ancrages.md` (tableau des ids) | `node scripts/verify-anchors.mjs` → exit 0, tous les ancrages ≥2/3 relais |
| 6 | 404 stylée en production | T50 | `task-50-francepassoire-launch.log` | `curl -s -o /dev/null -w "%{http_code}" https://francepassoire.com/inexistant-runbook` → **404** (page aux couleurs du site) |
| 7 | Audit SEO 0 erreur | T48 | `task-48-francepassoire-launch.log` | `node scripts/seo-audit.mjs https://francepassoire.com` → **291 pages crawlées, 0 erreur, 0 avertissement**, exit 0 |
| 8 | Lighthouse ≥95 ×4 (médiane de 3) | T44 | `task-44-francepassoire-launch.log` + `task-44-artifacts/` | 16/16 médianes ≥95 au run T44 (non rejoué ce jour — relancer Lighthouse CI au jour J si souhaité) |
| 9 | Accessibilité axe : 0 violation critique | T44 | idem T44 | 8 violations corrigées → 0 au run T44 |
| 10 | Zéro lien mort | T42 | `task-42-francepassoire-launch.log` | `node scripts/link-sweep.mjs` → **292 pages · 7672 liens internes · 0 mort · 0 `href="#"`**, exit 0 |
| 11 | En-têtes de sécurité conformes | T45 | `task-45-francepassoire-launch.log` | `node scripts/check-headers.mjs` → **45/46**. Unique écart : `/embed/compteur` répond 308 vers `/embed/compteur/` (200 au suivi) — le vérificateur ne suit pas les redirections ; cosmétique, non bloquant. CSP en phase Report-Only, version contraignante prête (T45) |
| 12 | RGPD complet (registre, notices, effacement) | T46 | `task-46-francepassoire-launch.log` | `docs/rgpd.md` complet + `scripts/erase-subscriber.mjs` + cron `francepassoire-retention` (03:17 UTC/j) |
| 13 | Watchdog de production actif | T50 | `task-50-francepassoire-launch.log` | Worker `francepassoire-watchdog` déployé (version `4d0a71f8`, 20/08 22:57 UTC), cron `*/10 * * * *`, notes Nostr à chaque transition d'état |
| 14 | Watchlists opérationnelles + envoi email réel reçu | T29/T30 | `task-29-francepassoire-launch.log` (verdict sonde), `task-30-31-francepassoire-launch.log` + plan T30 | Worker `francepassoire-api` déployé (version `fe54f8a2`, 20/08 23:32 UTC, domaine `api.francepassoire.com`), secrets Brevo posés, **envoi réel prouvé** (test `alerte@`→icloud via Brevo, messageId `202608202332…`, consigné plan T30 + ledger) ; double opt-in, désinscription 1 clic, cron digest lundi 09:00 Paris |

Vérification du catalogue au jour J (chiffres d'annonce) :

```bash
ls data/catalog/*.json | wc -l          # 134 fiches au 21/08 (83 confirmées, 51 revendiquées)
node scripts/verify-registry.mjs registre.jsonl   # doit sortir 0
node scripts/verify-anchors.mjs                     # doit sortir 0
```

### 1.2 Points EN ATTENTE (non bloquants, assumés)

| Point | Porteur | Détail |
|-------|---------|--------|
| X / LinkedIn / TikTok | propriétaire | Décisions propriétaire. X : offre d'écriture payante, hors périmètre (`docs/social-setup.md` §1). LinkedIn : self-service ~15 min. TikTok : review jours-semaines. Une alternative « Postiz hosted » est à l'étude côté propriétaire. Les workers (T38-40) tiennent les posts en file `PENDING_KEYS` — rien ne se perd. Non bloquant par conception (décision épinglée n° 5 du plan). |
| Publicité du dépôt → CI final T47 | propriétaire | T47 est bloqué par la facturation GitHub Actions (dépôt privé). Se débloque à la publicité du repo — voir checklist §4. Le site lui-même tourne sans CI (déploiement direct wrangler). |
| Nom du directeur de la publication | propriétaire | Formulation honnête en place sur `/mentions-legales/` (« le directeur de la publication est l'éditeur du projet ») — héritage R1 de T42. **À renseigner avant l'annonce publique** (recommandé, LCEN). |
| Premier digest réel | calendrier | Lundi **24 août 2026, 09:00 Paris** (cron `0 7 * * 1` UTC). Preuve attendue : log `wrangler tail francepassoire-api` + envoi effectif — cochera la tâche 31. |

Le catalogue continue par ailleurs de croître : 134 fiches au 21/08 pour une
cible long terme ~700 — la poursuite du backfill est assumée post-lancement
(l'annonce cite le compte réel au jour J, jamais la cible).

## 2. Rollback

### 2.1 Pages (site statique)

1. Lister et choisir le déploiement cible :

   ```bash
   npx wrangler pages deployment list --project-name francepassoire
   ```

   Dernier état connu (21/08) : production sur `0dcd53f2-f2e3-4997-8f4c-e6151410ed09` (commit `65cb146`) ; précédent `74614392-a57a-48c8-9744-32971e7d4047` (commit `47c3491`).

2. Revenir en arrière — au choix :
   - **Dashboard** : Workers & Pages → `francepassoire` → Deployments → menu
     `…` du déploiement cible → **Rollback to this deployment** ;
   - **API** (endpoint officiel) :

     ```bash
     curl -X POST -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
       "https://api.cloudflare.com/client/v4/accounts/$CLOUDFLARE_ACCOUNT_ID/pages/projects/francepassoire/deployments/<id-du-déploiement-cible>/rollback"
     ```

3. **Attention registre** : un rollback Pages ressert l'`dist` du déploiement
   cible, donc un **préfixe antérieur de `/registre.jsonl`**. La chaîne reste
   cryptographiquement valide (un préfixe d'une chaîne append-only est
   cohérent), mais l'artefact public est en retard sur le dépôt. Après tout
   rollback : redéployer un build frais dès que possible et re-vérifier
   (critères 3-4 du §1.1).

### 2.2 Registre d'intégrité — JAMAIS de rollback

Invariant absolu : la chaîne est **append-only**. On ne réécrit pas une ligne,
on ne retire pas un événement, on ne « dérollbacke » pas la chaîne — un
retour arrière casserait publiquement les ancrages Nostr et la preuve
d'antériorité.

**Fiche erronée en production** → nouvelle entrée de retrait via la machine à
états de la taxonomy (transition vers `retiree`, motif parmi l'énumération
fermée de `src/lib/taxonomy.ts`), jamais une édition de la fiche ni du
registre. L'erreur reste visible dans l'historique chaîné — c'est la
traçabilité publique qui fait la valeur du registre. L'événement de retrait
est ajouté **en bout de chaîne** avant le merge (discipline chain-then-merge
de chaque PR, cf. plan T27 ; pour les ajouts, l'outil est
`node scripts/append-registry.mjs --fiches-dir data/catalog` — idempotent par
slug). Après merge :

```bash
node scripts/publish-anchors.mjs --registre registre.jsonl   # republie l'ancre de tête
node scripts/verify-registry.mjs registre.jsonl   # doit sortir 0
node scripts/verify-anchors.mjs                     # doit sortir 0
```

### 2.3 DNS — enregistrements vitaux du site (payloads exacts de recréation)

Si la zone était altérée, recréer ces enregistrements exactement ainsi
(dashboard → DNS → Records, ou API `POST zones/55f7a20e65f02cedd5fbd88511e6ab75/dns_records`) :

| Type | Nom | Contenu | Proxied |
|------|-----|---------|---------|
| CNAME | `francepassoire.com` | `francepassoire.pages.dev` | **oui** (requis : domaine personnalisé Pages même compte) |
| CNAME | `www.francepassoire.com` | `francepassoire.pages.dev` | **oui** |
| TXT | `francepassoire.com` | `v=spf1 include:_spf.mx.cloudflare.net ~all` | non (TXT jamais proxifié) |

Le reste de la zone sert la messagerie (3 MX `route1/2/3.mx.cloudflare.net`,
TXT `_dmarc` p=none avec rua, TXT DKIM `cf2024-1._domainkey`, 5 CNAME + TXT
Brevo) et le domaine personnalisé du worker API (`AAAA api.francepassoire.com
→ 100::`, proxifié — **géré par Cloudflare, ne pas supprimer** : c'est le
rattachement de `api.francepassoire.com` au worker `francepassoire-api`).
Liste complète re-vérifiable :

```bash
curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
  "https://api.cloudflare.com/client/v4/zones/55f7a20e65f02cedd5fbd88511e6ab75/dns_records?per_page=50" \
  | python3 -c "import json,sys; [print(r['type'], r['name'], '->', r['content'], '| proxied:', r['proxied']) for r in json.load(sys.stdin)['result']]"
```

### 2.4 Workers — retour à la version précédente

```bash
npx wrangler deployments list -c workers/api/wrangler.jsonc        # lister (10 derniers)
npx wrangler rollback <version-id> -c workers/api/wrangler.jsonc   # revenir en arrière
```

Même syntaxe pour `workers/ingest/`, `workers/social/`, `workers/watchdog/`,
`workers/retention/`. Dernier état connu (21/08) : `francepassoire-api`
version `fe54f8a2-1d81-489c-b5ed-2267ee3e9f64` (20/08 23:32 UTC),
`francepassoire-watchdog` version `4d0a71f8-52fd-4464-b65e-6a2e4d0663b2`
(20/08 22:57 UTC). Le worker `francepassoire-email-probe` est la sonde sans
effet de T29 — sans objet en rollback.

## 3. Procédure d'annonce (humain — propriétaire uniquement)

Ordre recommandé :

1. **Nostr — au merge** : la note de fiche part automatiquement à chaque
   fusion (worker `francepassoire-social`, drain de file `*/5 * * * *`) ; la
   republication de l'ancre de tête accompagne chaque fusion
   (`publish-anchors.mjs` — sera automatisée par le hook CI en T47).
   Contrôler avec `node scripts/verify-anchors.mjs` (exit 0).
2. **Site** : le site est déjà public ; l'annonce renvoie vers lui. La
   variante longue du projet d'annonce peut servir de bilan de lancement si
   un espace blog est ouvert plus tard.
3. **LinkedIn — page manuelle si souhaité** : un post manuel ne nécessite
   aucun token (l'API et sa file `PENDING_KEYS` ne concernent que
   l'automatisation). Variante moyenne recommandée.
4. **Presse — aucune promesse** : ne rien annoncer de prévu ; si un contact
   presse survient, la variante longue sert de base documentaire. Aucune
   promesse de couverture, aucun embargo à gérer.

Règles de ton (T41, verrouillées) : Ton A « factuel sec » ; aucun
empilement de points d'exclamation ; pas de formulation alarmiste ; toute
allégation attribuée à sa source ; un post `revendiquée` porte toujours la
mention « revendication non confirmée par l'entité ». Textes prêts à relire :
`docs/announcement-draft.md` (3 variantes).

## 4. Checklist publicité du dépôt (pré-requis de T47)

À exécuter dans cet ordre, par le propriétaire :

1. `git rm -r --cached .omo` — le dossier `.omo/` (plans, evidence, boulder)
   contient des métadonnées opératives sans valeur publique. Audit fait :
   **aucun secret n'y est tracké** ; il s'agit d'hygiène, pas de sécurité.
2. Ajouter `.omo/` à `.gitignore`, commit.
3. Revue de `docs/` : vérifier qu'aucun document ne contient de coordonnée
   ou d'information que le propriétaire ne veut pas publier (les verdicts de
   licence et les guides utilisateurs sont faits pour être publics).
4. **Alors seulement** T47 — vérification CI de bout en bout (PR rouge/vert)
   et pose des secrets du dépôt GitHub Actions :
   - `CLOUDFLARE_API_TOKEN`
   - `CLOUDFLARE_ACCOUNT_ID`
   - `FRANCEPASSOIRE_GH_TOKEN` (si automatisation des PR de fiches)

   Le blocage facturation GitHub Actions (dépôt privé) se lève de lui-même
   dès que le dépôt devient public.

Historique git : la quarantaine du token Cloudflare a été faite à la toute
première tâche (T1) **avant tout push** — l'historique n'a jamais contenu de
secret.

## 5. Surveillance J+7 (première semaine post-lancement)

| Quoi | Comment | Rythme |
|------|---------|--------|
| Watchdog | Worker `francepassoire-watchdog`, cron `*/10`, note Nostr publique à chaque transition (panne/reprise) — surveiller le flux du npub d'ancrage ou `npx wrangler tail francepassoire-watchdog -c workers/watchdog/wrangler.jsonc` | continu (automatique) |
| Balayage complet | `node scripts/launch-sweep.mjs` → exit 0 attendu | 1×/jour |
| Premier digest | Lundi 24/08 09:00 Paris — preuve : `npx wrangler tail francepassoire-api --format pretty` autour de 09:00 + envoi effectif (coche T31). En cas d'échec du run : corriger, redéployer le worker ; le digest repart au cron suivant (hebdomadaire — pas de re-run manuel documenté, assumé) | lundi |
| Quota Brevo | Offre 300 emails/jour — contrôler le compteur du dashboard Brevo ; alerte interne si > 250 consommés sur la journée (le digest part en un lot) | quotidien |
| Croissance D1 | Abonnés confirmés + file éditoriale (commandes ci-dessous, testées le 21/08 — sortie alors : 0 abonné confirmé) | hebdo |
| Registre | `node scripts/verify-registry.mjs registre.jsonl && node scripts/verify-anchors.mjs` après chaque fusion | à chaque merge |

```bash
npx wrangler d1 execute francepassoire --remote --json \
  --command "SELECT COUNT(*) AS abonnes_confirmes FROM subscribers WHERE confirmed_at IS NOT NULL"
npx wrangler d1 execute francepassoire --remote --json \
  --command "SELECT status, COUNT(*) AS n FROM candidates GROUP BY status"
```

## 6. Décision finale

Le jour J : re-exécuter le §1.1 (≈15 min), relire le §1.2, puis GO/NO-GO.
En cas de GO, l'annonce suit le §3 avec les textes de
`docs/announcement-draft.md` relus et signés par le propriétaire (ligne de
signature à compléter — le nom du directeur de la publication est un des
points EN ATTENTE).
