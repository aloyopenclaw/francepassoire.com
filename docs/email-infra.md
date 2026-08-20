# Infrastructure email — délivrabilité et pré-vol `send_email` (T29, Wave 4)

> État au 2026-08-20. Toute la preuve brute (appels API, `dig`, transcript de
> la sonde) vit dans `.omo/evidence/francepassoire-launch/task-29-francepassoire-launch.log`.

## État en une table

| Élément | État | Détail |
|---|---|---|
| SPF (TXT racine) | ✅ publié + vérifié `dig` | `v=spf1 include:_spf.mx.cloudflare.net ~all` |
| MX entrants | ✅ actifs | `route1/2/3.mx.cloudflare.net` (prio 70/6/57) — gérés par Cloudflare, toute modification manuelle est refusée (erreur 890190) |
| DKIM | ✅ publié + vérifié `dig` | `cf2024-1._domainkey` — clé RSA générée par Cloudflare à l'activation du routing, gérée par lui |
| DMARC (TXT `_dmarc`) | ✅ publié (réécrit par Cloudflare) | voir § DMARC ci-dessous |
| Email Routing | ✅ activé par API | zone `francepassoire.com` : `enabled=true`, `status=ready`, `synced=true` |
| Adresses personnalisées `contact@`, `dmarc@`, `alerte@` | ⏳ PENDING-USER | impossible sans destination vérifiée (erreur API 2054 « Destination address is not verified ») |
| Binding Worker `send_email` | ✅ déployable | aucune barrière de vérification au `wrangler deploy` |
| Envoi réel via `send_email` | ⏳ PENDING-USER | refusé au runtime : « destination address is not a verified address » |

## USER-ACTION — indiquer l'adresse de réception des rapports DMARC et du courrier

Le point unique qui ferme tout le reste : **Cloudflare exige une « adresse de
destination » vérifiée** (une vraie boîte du propriétaire, pas un alias du
domaine). Sans elle :

- aucune règle de transfert `contact@`/`dmarc@`/`alerte@` ne peut être créée
  (l'API la refuse, code 2054) ;
- aucun Worker ne peut envoyer le moindre email (le binding `send_email`
  refuse au runtime, message exact en § Pré-vol).

### Clics exacts (dashboard Cloudflare, ~2 minutes)

1. Se connecter à <https://dash.cloudflare.com> → compte du domaine
   `francepassoire.com`.
2. Ouvrir le domaine → **Email** (ou **Compute & AI → Email Service**) →
   **Email Routing** (déjà activé par la T29 — ne pas le désactiver).
3. Onglet **Addresses de destination** (*Destination addresses*) →
   **Ajouter une adresse de destination** → saisir **votre adresse de
   réception personnelle** (la vraie boîte : c'est LA valeur inconnue que la
   T29 ne pouvait pas inventer) → Cloudflare envoie un email de vérification
   → **cliquer le lien dans votre boîte**. Statut attendu : *Verified*.
4. Onglet **Addresses personnalisées** (*Custom addresses*) → **Créer une
   adresse** :
   - `contact@francepassoire.com` → transférer vers l'adresse vérifiée
     (c'est la boîte du formulaire de contact du site) ;
   - `dmarc@francepassoire.com` → transférer vers la même adresse
     (destinataire `rua` des rapports DMARC, cf. § DMARC) ;
   - `alerte@francepassoire.com` → transférer vers la même adresse
     (émetteur/destinataire des alertes watchlist T30/T31).
5. Optionnel mais recommandé avant tout envoi massif : s'envoyer un email de
   test depuis une boîte externe vers `contact@francepassoire.com` et
   vérifier l'arrivée.

### Après ces clics (re-test sans nouveau déploiement)

La sonde déployée en T29 reste en ligne et sert de re-test :

```bash
curl https://francepassoire-email-probe.t5hsrdmmmn.workers.dev
# attendu: {"ok":true,...} dès qu'une destination vérifiée existe et que la
# règle contact@ est câblée
```

### Vrai test « destination non vérifiée » (boîte jetable, optionnel)

La sonde a prouvé que l'envoi vers une destination NON vérifiée échoue. Pour
documenter le comportement inverse (erreur propre vs envoi silencieux) avec
une vraie boîte externe non déclarée chez Cloudflare, il faudrait que le
propriétaire fournisse une adresse jetable (ex. mailinator/33mail), changer
`destination_address` dans `workers/email-probe/wrangler.jsonc` vers elle,
re-déployer et re-curl. Étape optionnelle : le verdict du pré-vol n'en dépend
pas.

### Test mail-tester.com (optionnel, après les clics)

Score de délivrabilité complet : envoyer un email depuis la sonde (curl
ci-dessus) puis, depuis la boîte vérifiée, transférer/écrire vers l'adresse
unique fournie par <https://www.mail-tester.com> et lire le score (attendu
>9/10 avec SPF+DKIM+DMARC alignés). Nécessite la destination vérifiée, donc
répertorié ici et pas ailleurs.

## DMARC — contenu réel publié

Contenu créé par la T29 :

```
v=DMARC1; p=none; rua=mailto:dmarc@francepassoire.com; adkim=s; aspf=s
```

Après l'activation du routing, **Cloudflare DMARC Management a réécrit
l'enregistrement** (même id API, horodaté 20:30:49Z) pour préfixer son propre
destinataire de rapports agrégés, en conservant le nôtre :

```
v=DMARC1; p=none; rua=mailto:1d842ca105a84ccf97e104031da3e74c@dmarc-reports.cloudflare.net,mailto:dmarc@francepassoire.com; adkim=s; aspf=s
```

Décision : on garde cette réécriture. Effets : rapports DMARC agrégés
visibles gratuitement dans le dashboard Cloudflare (section Email → DMARC),
et `dmarc@francepassoire.com` reste destinataire secondaire — il recevra
vraiment les rapports dès que sa règle de transfert existera (USER-ACTION
ci-dessus). `p=none` : politique de monitoring, aucun rejet — volontaire
pour un nouveau domaine (réputation à construire avant de durcir en
`quarantine`/`reject`, décision à revoir après 4-8 semaines de rapports).

## Pré-vol `send_email` — le verdict et ses deux découvertes

Verdict : **PENDING (USER-ACTION : destination vérifiée)**. Preuve intégrale
dans le log de preuves (étapes 3a-3e). En bref :

1. **Le déploiement ne filtre pas.** `wrangler deploy` avec
   `destination_address: contact@francepassoire.com` (adresse NON vérifiée)
   passe sans erreur — la vérification n'est PAS au build.
2. **L'API classique a disparu.** Premier tir : erreur 1101, `wrangler tail`
   donne `ReferenceError: EmailMessage is not defined`. La classe globale
   `EmailMessage` + MIME brut construit à la main (tutoriels historiques)
   **ne fonctionne plus** au runtime 2026. La forme valide, testée :
   `env.SEND_EMAIL.send({ from, to, subject, text })` — objet simple.
3. **Le runtime refuse l'envoi non vérifié.** Second tir (forme objet) :
   refus avec le message exact
   `destination address is not a verified address`. La contrainte
   historique est donc TOUJOURS en vigueur — appliquée à l'envoi, pas au
   déploiement.

Conséquence pour **T30/T31 (watchlists/alertes)** : le code peut être écrit
dès maintenant contre l'API objet confirmée (`{from, to, subject, text}`,
`from` = `alerte@francepassoire.com`), mais **aucune validation e2e d'envoi
réel n'est possible** avant l'USER-ACTION ci-dessus. Le gate e2e reste donc
fermé tant que la destination n'est pas vérifiée.

## Le worker sonde (conservé)

`workers/email-probe/` — worker volontairement minuscule : `GET /` tente UN
envoi via le binding et retourne le verdict JSON brut (succès OU erreur
exacte, jamais masquée). Aucun secret, aucune D1, aucun cron. Conservé déployé
(`francepassoire-email-probe.t5hsrdmmmn.workers.dev`) comme surface de
re-test post-USER-ACTION ; sa suppression éventuelle :
`npx wrangler delete --name francepassoire-email-probe`.

## Pièges notés pour les tâches suivantes

- **MX intouchables** : dès que Email Routing est actif, `POST dns_records`
  sur des MX est refusé (code 890190). Ne pas tenter de les gérer à la main.
- **DKIM auto-doublonné** : à l'instant `synced=true`, Cloudflare publie
  lui-même `cf2024-1._domainkey`. Ne pas recréer cet enregistrement à la
  main (la T29 l'a fait par course de vitesse, doublon nettoyé en 4a/4b).
- **Emails sortants des Workers** : ils apparaissent comme « dropped » dans
  le résumé Email Routing même quand l'envoi réussit — s'appuyer sur les
  métriques d'envoi Email Service, pas sur le résumé de routing.
- **Le token API** `~/.config/francepassoire/cloudflare.token` s'est avéré
  couvrir DNS + Email Routing + déploiement Workers (deploy exit 0) — mais
  les règles de routing exigent de toute façon une destination vérifiée,
  aucune permission ne remplace le clic du propriétaire.
