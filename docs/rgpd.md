# Registre des traitements RGPD — FrancePassoire

> **Statut : v1 (tâche 46, Wave 6) — 21 août 2026.**
> Responsable de traitement : le propriétaire du projet (éditeur unique, cf.
> `src/pages/mentions-legales.astro`). Contact pour toute question relative
> aux données : **contact@francepassoire.com**. Point de contact « DPO » :
> le propriétaire (structure unipersonnelle ; aucun DPO désigné n'est
> requis, ce registre est tenu à jour en lieu et place).
>
> Invariant du dépôt (migrations/0001_init.sql) : la base D1 ne contient
> **jamais** de données personnelles de victimes de fuites. Seuls transitent
> des métadonnées publiques (pipeline éditorial) et les données décrites
> ci-dessous. Ce document couvre les traitements réellement en service, et
> mentionne honnêtement ceux qui ne le sont pas encore.

## 1. Registre des traitements

### 1.1 Signalements de fuites (formulaire « Signaler une fuite »)

| Rubrique | Contenu |
|---|---|
| **Finalité** | Alimenter la file de validation éditoriale : examiner, corroborer avec une source publique, puis publier une fiche ou refuser le signalement. Traitement préparatoire à l'exercice de la liberté d'expression (observatoire citoyen). |
| **Base légale** | Intérêt légitime (art. 6(1)(f) RGPD) : recueillir et vérifier des signalements d'intérêt public sur des fuites touchant la France, sans lesquels l'observatoire ne peut remplir sa mission. Aucun profilage, aucune décision automatisée. |
| **Données** | Métadonnées uniquement : entité concernée, date présumée, description, URL de la source publique, date de dépôt. **Email de contact optionnel** (uniquement si le signalant accepte d'être recontacté pour préciser le signalement). Aucune donnée volée, jamais (avertissement en clair sur le formulaire). |
| **Personnes concernées** | Signalants volontaires (le cas échéant membres des entités signalées si l'URL source en mentionne — aucune donnée d'entité n'est collectée par nous). |
| **Destinataires** | Aucun tiers. Sous-traitant : Cloudflare (Workers, D1 — base hébergée en Europe occidentale, cf. mentions légales). |
| **Durée de conservation** | Candidats **REJETÉS** : purge automatique **1 an après le dépôt** (règle C1, §2). Candidats NEW/DRAFT : le temps de l'examen éditorial. Candidats PUBLIÉS : la fiche publiée ne reprend que des métadonnées publiques (dépôt git) ; la ligne D1 suit ensuite le cycle de purge des candidats traités. L'email de contact optionnel ne survit jamais au candidat qui le porte. |
| **Mesures** | Anti-abus en cascade (honeypot, Turnstile, limite 5/IP/h) ; accès D1 par bindings seuls ; aucun export. |

### 1.2 Watchlists / alertes email — **À L'ACTIVATION** (bloqué, verdict T29)

| Rubrique | Contenu |
|---|---|
| **Statut réel** | **Aucun abonné n'existe, aucune adresse n'est collectée aujourd'hui.** Le flux d'inscription (T30) et le moteur d'alertes (T31) sont **bloqués sur une décision propriétaire** depuis le 21/08 : la sonde T29 a prouvé par l'expérience que le binding `send_email` Cloudflare **refuse tout envoi vers une destination non vérifiée** (« destination address is not a verified address », preuve dans docs/email-infra.md). En attente du choix : fournisseur externe ou descope des alertes email. Aucune promesse d'activation n'est faite sur le site. |
| **Finalité (prévue)** | Alertes personnalisées (secteur, type de données, entité) lors de la publication d'une fiche, fréquence immédiate ou hebdomadaire. |
| **Base légale (prévue)** | Consentement (art. 6(1)(a)) via **double opt-in** : inscription → email de confirmation → activation au clic. |
| **Données (prévues)** | Adresse email stockée **chiffrée** (AES-GCM, clé en secret wrangler) + `email_hash` = SHA-256 de l'adresse normalisée (minuscules, espaces retirés) pour la recherche/dédup sans clair ; préférences (filtres, fréquence) en JSON ; jeton de désinscription unique. Convention `email_hash` engageante pour T30 : **sha256(trim(email).toLowerCase()) en hex** — même convention que `scripts/erase-subscriber.mjs`. |
| **Durée (prévue)** | Jusqu'à désinscription ; **désinscription en 1 clic** depuis chaque email ; purge des inscriptions **non confirmées après 30 jours** (règle S1, §2) ; effacement **immédiat** sur demande ou auto-demande via `scripts/erase-subscriber.mjs`. |
| **Mesures** | Le registre ci-dessus sera complété à l'activation réelle, avant la première collecte (engagement déjà publié sur /confidentialite/). |

### 1.3 Journaux workers (table `events` D1)

| Rubrique | Contenu |
|---|---|
| **Finalité** | Traçabilité du pipeline : événements d'ingestion et de transition éditoriale (débogage, audit de la chaîne éditoriale). |
| **Base légale** | Intérêt légitime (art. 6(1)(f)) : exploitation et sécurisation du service. |
| **Données** | Identifiants de fiches/candidats, types d'événements, horodatages, charges JSON techniques. Pas d'identifiants de personnes. |
| **Durée de conservation** | **90 jours** (règle E1, §2), purge automatique quotidienne. Les journaux de la plateforme Cloudflare suivent la rétention de l'éditeur de la plateforme. |
| **Note** | La table `registry` (miroir de staging de la chaîne d'intégrité publique) **n'est jamais purgée** : elle ne porte que des empreintes (aucune donnée personnelle) et alimente l'artefact public /registre.jsonl. |

### 1.4 Mesure d'audience — Cloudflare Web Analytics

| Rubrique | Contenu |
|---|---|
| **Finalité** | Mesure d'audience agrégée du site. |
| **Base légale** | Pas de cookie, pas de donnée personnelle collectée (produit « cookieless ») : pas de traceur déposé sans consentement. L'outil ne collecte ni adresse IP persistée ni identifiant cross-site. |
| **Statut** | Activé par le propriétaire via le dashboard Cloudflare le 20/08/2026 (l'API publique ne permet pas l'activation — constat T6). |
| **Durée** | Agrégats conservés par Cloudflare selon leur politique ; rien d'exploitable au niveau personne ne quitte le navigateur. |

### 1.5 Traitements sans collecte (mention pour mémoire)

- **Vérificateur de mot de passe** : k-anonymité, SHA-1 local, 5 caractères transmis à api.pwnedpasswords.com — rien n'est stocké côté FrancePassoire (détail sur /confidentialite/).
- **Générateur de lettres DPO** : exécution 100 % côté navigateur, aucune requête sortante, aucun stockage.
- Le site ne dépose **aucun cookie** (aucune bannière nécessaire).

## 2. Règles de rétention appliquées automatiquement

Le worker `workers/retention/` (cron quotidien) applique **exactement** les
règles suivantes — c'est la seule source de vérité côté code, ce paragraphe
en est la source de vérité côté document :

| Règle | Table | Condition de purge | Paramètre |
|---|---|---|---|
| S1 | `subscribers` | `confirmed_at IS NULL` (jamais confirmés) **et** créés depuis plus de 30 jours | `-30 days` |
| C1 | `candidates` | `status = 'REJECTED'` **et** créés depuis plus de 365 jours | `-365 days` |
| E1 | `events` | créés depuis plus de 90 jours | `-90 days` |

Bornes documentées :

- C1 part de la **date de dépôt** (`created_at`) : le schéma D1 ne porte pas
  de date de traitement distincte, et un candidat REJECTED est par définition
  déjà traité — la purge est donc au plus tard 1 an après le traitement.
- S1 ne touche **que** les inscriptions jamais confirmées : une inscription
  confirmée vit jusqu'à sa désinscription (à l'activation de T30) ou à
  l'effacement demandé (immédiat, §3). Aujourd'hui, aucune inscription
  n'étant collectée (§1.2), la règle S1 est une garde en avance de phase.
- Les candidats NEW/DRAFT (file éditoriale vive), la table `registry`
  (chaîne d'intégrité) et `social_outbox` (posts publics programmés) ne sont
  **jamais** purgés par ce worker.

## 3. Droits des personnes — comment les exercer

- **Contact** : [contact@francepassoire.com](mailto:contact@francepassoire.com).
  La boîte du projet est en cours d'activation (verrou « destination vérifiée »
  Cloudflare, cf. docs/email-infra.md § USER-ACTION) ; dès sa mise en service,
  chaque demande reçoit une réponse **sous 30 jours** (art. 12(3)).
- **Droits garantis** : information (art. 13-14), accès (art. 15),
  rectification (art. 16), effacement (art. 17), limitation (art. 18),
  opposition (art. 21), portabilité (art. 20 — le périmètre stocké étant
  minime, la portabilité se réduit en pratique à la transmission des
  préférences d'alerte le cas échéant).
- **Effacement d'un abonné** : exécution **immédiate**, sans délai ni
  confirmation, via l'outil du dépôt :

  ```bash
  node scripts/erase-subscriber.mjs <email-ou-jeton-desinscription> --local   # D1 locale
  node scripts/erase-subscriber.mjs <email-ou-jeton-desinscription> --remote  # D1 de production
  ```

  L'outil cherche la ligne par `email_hash` (SHA-256 de l'adresse normalisée)
  **ou** par `unsub_token`, la supprime, et imprime un reçu (identifiant,
  date de création, statut de confirmation). Une cible inexistante donne un
  message clair et un code de sortie 1 — jamais un crash.

## 4. Procédure en cas de violation de données (art. 33-34)

1. **Détection** : constat par l'exploitant (alerte Cloudflare, signalement
   externe, audit). Toute personne peut signaler une violation présumée à
   contact@francepassoire.com.
2. **Qualification** : le propriétaire évalue la nature, l'étendue et les
   conséquences pour les personnes (périmètre exposé très réduit par
   conception : métadonnées + emails optionnels ; aucune donnée de victimes
   dans les systèmes).
3. **Notification CNIL** : si la violation est susceptible d'engendrer un
   risque pour les droits et libertés, notification à la CNIL **dans les
   72 heures** (art. 33) via le téléservice de notification de la CNIL.
4. **Information des personnes** : si le risque est élevé, information des
   personnes concernées **en clair et sans délai** (art. 34).
5. **Journalisation** : la violation et les mesures prises sont consignées
   (note datée dans le dépôt privé ou registre interne) — l'art. 33(5)
   impose cette traçabilité.
6. **Remédiation** : cause racine corrigée, preuve de correction ajoutée au
   journal.

## 5. Notice art. 13 — version à inclure dans la future page de confirmation

Texte figé ci-dessous (à recopier tel quel sur la page de confirmation d'un
signalement et dans tout futur email de confirmation d'alerte) :

> **Vos données et vos droits.** Le responsable de traitement est
> l'éditeur de FrancePassoire, joignable à contact@francepassoire.com. Votre
> signalement (entité, date, description, URL de source, date de dépôt) et,
> si vous choisissez de la laisser, votre adresse email, servent uniquement
> à l'examen éditorial de votre signalement. La base légale est l'intérêt
> légitime ; aucune décision automatisée n'est prise sur ces données. Les
> signalements refusés sont supprimés au plus tard un an après leur dépôt ;
> les signalements publiés ne reprennent que des métadonnées publiques,
> jamais votre email. Vous pouvez exercer vos droits d'accès, de
> rectification, d'effacement, de limitation et d'opposition en écrivant à
> contact@francepassoire.com (réponse sous 30 jours) ; l'effacement est
> exécuté immédiatement sur demande. Vous pouvez saisir la CNIL
> (cnil.fr) à tout moment. Aucune donnée relative aux victimes des fuites
> recensées n'est collectée, hébergée ou reproduite par FrancePassoire.

## 6. Outils de ce dépôt (périmètre de la tâche 46)

| Outil | Rôle |
|---|---|
| `workers/retention/` | Worker cron quotidien (03:17 UTC) appliquant les règles S1/C1/E1 du §2 ; reçoit un reçu de suppression par exécution (logs worker). |
| `scripts/erase-subscriber.mjs` | Effacement immédiat d'un abonné (email ou jeton), D1 locale (`--local`, défaut) ou production (`--remote`). Zéro dépendance (Node ≥ 22, wrangler du dépôt). |
| `tests/retention.test.ts` | Prouve le comportement du worker sur une vraie sémantique SQLite (fixtures anciennes purgées, lignes récentes et vivantes intactes). |

## 7. Références

- RGPD art. 6, 12-22, 30, 33-34 ; lignes directrices CNIL (registre,
  notification des violations — cnil.fr).
- docs/email-infra.md (verdict T29 complet, USER-ACTION boîte) ;
  src/pages/confidentialite.astro (version publique) ;
  .omo/plans/francepassoire-launch.md tâche 46 (Metis finding #10).
- Constat Web Analytics : journal d'évidence tâche 6 + confirmation tâche 29.
