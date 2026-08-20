# Ancrages Nostr du registre d'intégrité

Le registre d'intégrité FrancePassoire (`registre.jsonl`, chaîne d'empreintes
SHA-256 — spécification canonique dans `src/lib/registry.ts`) est ancré
publiquement sur le réseau Nostr : chaque fiche publiée reçoit une note
`ANCRAGE <slug> <empreinte>` signée, plus une note d'ancre de tête. Toute
retouche ultérieure du registre casse la chaîne et rend les ancrages Nostr
caducs — la preuve d'antériorité est publique, le dépôt reste privé.

> **STATUT : genèse pas encore exécutée — déclenchée par l'orchestrateur à la
> fusion de la première tranche** (décision épinglée n° 6 : genèse
> immédiatement avant le premier merge de fiche). Le tableau ci-dessous est
> vide jusqu'à l'exécution du runbook.

## Clé d'ancrage (quarantaine)

| Élément | Valeur |
|---|---|
| npub public (identité d'ancrage) | `npub1c4s8aye7ye8vmwa39zllytlj8rqcz4gqwtp30vw0vlk9ksj3u5uqqyjymd` |
| Secret | `~/.config/francepassoire/nostr.key` — hex, chmod 600, **jamais commité, jamais affiché** |
| Backup | À la charge du propriétaire (coffre-fort + support physique) — voir `docs/social-setup.md` § 5 |
| Worker social (tâches 38/40) | `wrangler secret put NOSTR_NSEC` (nsec dérivé du hex lors du backup) |

Génération idempotente (réutilise une clé existante) :

```bash
node scripts/verify-anchors.mjs --gen
```

## Relais épinglés

Jamais un seul relais (règle du plan, tâche 27) :

- `wss://relay.damus.io`
- `wss://nos.lol`
- `wss://relay.primal.net`

## Ancrages publiés

Tableau rempli automatiquement par `scripts/publish-anchors.mjs` au moment de
la genèse, puis à chaque fusion via le hook CI. La ligne `tête` ancre
l'empreinte de tête courante du registre.

| ancrage | empreinte | id d'événement Nostr |
|---|---|---|
| alaxione-20260820 | 1e5d01da7eae276b4bf9b079e7d6d0889c380f9a07622293616ccda3740d98bc | 26badf8444ddd29344f218fd0a929eddd4ae7969d0e99c97538c5c62a6ce9c79 |
| ants-20260415 | 67b203154cafec94f2d88b7d51037ac18046ef0806fd864d977baa86edfeb793 | 37d052d4c49b444f6663039aeb49b939bc13701b1d95bdf81fb51abf28fdf625 |
| bloctel-20260812 | 9dfc00d3834d89eeed93662815b2f82373045673e40e8cca125fa377d1970b88 | c70888c8596c50f81c0dbc2a8f9fcf37daac6fcd5d44108c0da75acf8485b4a0 |
| centre-hospitalier-perpignan-20260720 | ae68bb66cc772f63bcd7cd6313560bb95484275fd58d6f4ab7587203822072fc | c1d7f0622f1dcafcf11d00aa43c457ff70fd8146039e3e3f402b04bd5645b582 |
| croq-vacances-20260715 | 8d74172d9c46b1d0a26391c68869e0132c072cc9397349644e76cbca5d395daa | 8dd43038557b88ba9b8c4235902b26ed1cad42c67a1fa113ad21f0c40f670f74 |
| dgfip-20260812 | 8409dee640bba9aa0e6f497925e6d57df96e26036f19678b049ce56dc48a2d1a | ca4dcafcb25d0287e840a33d5991fc316b14fea2d6c41837dfb705b2ce750a22 |
| education-nationale-20260731 | f76ecef9fadf95bc756f300179c6c1f5c32ade863112760ce58db0ecefb81560 | aa21fa692f00a2217b2c0806bf532d32390fef66577d5a91d451658667a763dc |
| intermarche-drive-20260803 | 9be247f3298a3668a17398c3232b80de110a558bf4ef9fa7e884bffbf7097a38 | 35e7fef73035202d8f645702f546b4adb2a67ff31f1ec46798e778c132e44bc1 |
| ird-20260817 | 23ad5b3f541f1774e12ca91803626efbd195f619221e0fac13a90efd0f511d1e | adaae58250e88e20a783815ffb206cca35077a7954ebdedbae59c12a5383726f |
| police-nationale-20260415 | 9b3430747af3db5a938604170505b679bc01cb6f7754dc8619baa2cc21ce432c | 5259119515cb72e448e051e20f30279a8328ff2b8006226f6958d7f4f540560c |
| sante-publique-france-20260811 | cd0e86844ac3188240cd929642ba248e312a967048ecadddf399742321e21499 | 47702035f53bd21b66aaea0961f4e239c5cc2a830afcb54dde07831504ecce7b |
| sfr-20260717 | 590e4a5f3f30a5f07ffa564a522c33c3c128fcd8918b62bf0d35a6d774d260b8 | e5ce95d67e46523cf826d5b998ebdf6697ab37b803d677eadafd9d0651bf8ad0 |
| stade-francois-20260805 | 108e0708d593e56111b3424308b2037e22908288c157be28109fc44a894856f7 | ed2b8347864099939af33f9c84cfaf696cc0fc8ca1443964c403b71c14a9465b |
| tête | d296fb7cd7c4015ee89347f964d504f0ad6ab2996717ee9732bd13c54e397587 | ec723259a4216bf8196a6127b69466636987b349a36ef83fc99f870ee04ac8ce |
| air-france-klm-20250806 | 9070c6248afcc300ef1da8274192cce2b813c284198952af8d5b8aa12114a431 | 4ef14de28e01d872fb90331da98c395db755c8e87bd99052d1af453fc89f5a24 |
| auchan-20250821 | aa1ab1bc6d43950535118593977ffe23687810660cea15cf4fc211a1a3c323e8 | 75a4bb052e06f8d72d79ca55fb1ea8bac45f0bc5eb23e785cf7095eb037dd572 |
| bouygues-telecom-20250806 | 9b93179d759968874642f7825a6a0fcf064395b89a5631a6efeee5f36028aa93 | df257684e2ab68715519881878825bfd13856674d4849e37fc7b968f4598b90d |
| caisse-des-depots-20250212 | bef16432d0c56943926bb6eff0749e1d391047023df508ff34ff40791e7641ad | 4a05fc98b9be37287b274d9ef6564b2fd046c97690ff661172134dd3a2612196 |
| intersport-20250319 | 57976571a84bef099ad0d43e9122904e578e84d78d2839e08c94d6dbe32b37fb | 90ed4d50ead3cc4085dd02996fa05c3c1ebabf697571d09aca44087923ad5d3b |
| kiabi-20250114 | a79f044fcd44735a124c2265e3830cba23c38ce055770c00c131acb3de765619 | 11da47d6a85b2e3d28d96127d67e3ba39e39bfaa472b6c714ea2a834c08988b2 |
| ministere-de-l-interieur-20251212 | 14fe0025f8585caf8a307579d57ca96861451409d5575f3badf02378ec4db3b3 | 59b9a521da1bbb4106b251d1042e33ce463fefec23ce01a4dd269871d65fb0dc |
| nexpublica-france-20251222 | 149e0a6723f4f645eb11eab812549ddb789891892443b3e07d9f73fad50d3738 | 0156503394014b2a7f042a5d577d86646c0756c123ad31f752d4551f1de205f3 |
| orange-20250728 | 94706c8b4bb2249c667d2477f6fddab4990ce1173dfd8e7c57b114c475fdc5b4 | ea41aa3f4070e8eece6cf11fd102a3afebd6630a66e51f742e55044794014f2b |
| sorbonne-universite-20250606 | d296fb7cd7c4015ee89347f964d504f0ad6ab2996717ee9732bd13c54e397587 | 24dbd84b090a656db28825a17fe984d98e7dd2fe1ea58c1d1f9234b1c707634e |

## RUNBOOK — exécution de la genèse (orchestrateur uniquement)

Préconditions : tâche 10 faite (module de chaîne), tâche 21 verrouillée
(prose), fiches d'ancrage (branche `fiche/anchors-preview`) et première
tranche de backfill stagées sur branches.

1. **(a) Fusion des fiches d'ancrage** : merger `fiche/anchors-preview` dans
   la branche de genèse (jamais directement dans main avant la genèse).
2. **(b) Staging de la première tranche** : placer les fiches de la première
   tranche de backfill aux côtés des fiches d'ancrage.
3. **(c) Genèse** (hors-ligne, déterministe, refuse d'écraser un registre
   existant — aucun chaînage rétroactif, jamais) :

   ```bash
   node scripts/genesis.mjs --fiches-dir data/catalog \
     [--anchors-dir <répertoire des fiches d'ancrage si distinct>] \
     --out registre.jsonl
   node scripts/verify-registry.mjs registre.jsonl   # doit sortir 0
   ```

4. **(d) Publication des ancrages Nostr** (clé en quarantaine, best-effort
   sur les 3 relais, ids consignés dans le tableau ci-dessus) :

   ```bash
   node scripts/publish-anchors.mjs --registre registre.jsonl
   ```

5. **(e) Artefact public** : copier `registre.jsonl` vers le chemin de sortie
   du build selon la tâche 35 (étape de copie `public/registre.jsonl` →
   `dist/`). **Note de coordination : l'endpoint `/registre.jsonl` appartient
   à la branche de la tâche 35** (merge-hold jusqu'à la première fusion
   post-genèse) — coordonner le moment exact de la copie avec cette branche,
   ne pas dupliquer l'endpoint ici.
6. **(f) Contrôle final** — doit sortir 0 (tous les ancrages retrouvés sur
   ≥2 relais, registre recalculé identique) :

   ```bash
   node scripts/verify-anchors.mjs
   ```

7. **(g) Signal** : prévenir la tâche 22 (premier merge) que la genèse est
   faite — le premier merge de tranche peut alors avoir lieu ; l'ordre
   genèse → premier merge est prouvé par l'historique git.

À partir de là, chaque fusion de PR ajoute ses événements **en bout de
chaîne** via le hook CI et republie l'ancre de tête.

## Outils

| Script | Rôle |
|---|---|
| `scripts/genesis.mjs` | Genèse hors-ligne : fiches → chaîne `ajout` triée par slug (refuse tout registre existant) |
| `scripts/publish-anchors.mjs` | Signe et publie les notes `ANCRAGE` sur les relais épinglés, consigne les ids ici (`--dry-run` pour répétition sans effet) |
| `scripts/verify-anchors.mjs` | Relit ce tableau + le registre publié + ≥2 relais ; exit 0 seulement si tout concorde |
| `scripts/verify-registry.mjs` | Vérification hors-ligne de la chaîne (zéro dépendance) |
