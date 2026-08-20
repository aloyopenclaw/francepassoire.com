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
| alaxione-20260820 | 1e5d01da7eae276b4bf9b079e7d6d0889c380f9a07622293616ccda3740d98bc | f5f22fca964ebf0ba1fd706b019ac3fd7edb1f2b7343241c5f1ca93320f4de15 |
| ants-20260415 | 67b203154cafec94f2d88b7d51037ac18046ef0806fd864d977baa86edfeb793 | ebfde6c94c1e4cf8d0437f57ab2d8639223428ee5143c0893c6da9cd93bb7a5e |
| bloctel-20260812 | 9dfc00d3834d89eeed93662815b2f82373045673e40e8cca125fa377d1970b88 | 6f845243d9250f51fd4b272532553e4615f3ed2aac6b79bdcd27b91bc4989d4c |
| centre-hospitalier-perpignan-20260720 | ae68bb66cc772f63bcd7cd6313560bb95484275fd58d6f4ab7587203822072fc | 81e9fa8813d776b33feb0ef75253feeeffc9bdf6e606973876c159b35e4c1a3d |
| croq-vacances-20260715 | 8d74172d9c46b1d0a26391c68869e0132c072cc9397349644e76cbca5d395daa | b4a4c1cdfe7b7e198c7669e33f6530f0a4dc6f58ebc2eb7e86973250a1679524 |
| dgfip-20260812 | 8409dee640bba9aa0e6f497925e6d57df96e26036f19678b049ce56dc48a2d1a | 3251d7922cefdbbc19c7abbbd8e329e4acb1d6e5a1cb5d3b139b09c0fdb20d14 |
| education-nationale-20260731 | f76ecef9fadf95bc756f300179c6c1f5c32ade863112760ce58db0ecefb81560 | 4a7979f7d9fc60c7bbeca0c14b3457d3093c98fd8e24b8bfebee908ab43e6045 |
| intermarche-drive-20260803 | 9be247f3298a3668a17398c3232b80de110a558bf4ef9fa7e884bffbf7097a38 | 196db4d273dec422d20869b7a13fe180ec4a47a5ed0c7f5fd9b8aaa4b8d09f71 |
| ird-20260817 | 23ad5b3f541f1774e12ca91803626efbd195f619221e0fac13a90efd0f511d1e | 42eb70b82afb72c2346026bfabea8c104b70a1aebef89b9adbd16fb2efa72b67 |
| police-nationale-20260415 | 9b3430747af3db5a938604170505b679bc01cb6f7754dc8619baa2cc21ce432c | b1fdb8a87d2254bb88acfc5397922c924182109689728eae6dcaa73e68c5634e |
| sante-publique-france-20260811 | cd0e86844ac3188240cd929642ba248e312a967048ecadddf399742321e21499 | a1d1aaef8f5179e468302a26cc33b5503136fd2ac57e6ad0a6ec535ee0071cf4 |
| sfr-20260717 | 590e4a5f3f30a5f07ffa564a522c33c3c128fcd8918b62bf0d35a6d774d260b8 | 0075420c4b04bee44ab35a9671890ecc5820be27481cacc0a3f19e73b87c5475 |
| stade-francois-20260805 | 108e0708d593e56111b3424308b2037e22908288c157be28109fc44a894856f7 | c4841d78b717161e3888318003ce4b1e0dd5f933e1a6e28c65a91be1a8d7e512 |
| tête | e5b2d03ac667a26db5f60cd507b15824a53c6c81789f1b8e91af58645837f86a | c7dc4f0ee8903cc9993e9bfdde48775f2b01e347b6210bc36e633b89d7b062da |
| air-france-klm-20250806 | 9070c6248afcc300ef1da8274192cce2b813c284198952af8d5b8aa12114a431 | 3e4c5e3c872b24c1c647cd2a3d94e2c1a3783098773631614384a298bd831cd6 |
| auchan-20250821 | aa1ab1bc6d43950535118593977ffe23687810660cea15cf4fc211a1a3c323e8 | 128d2878bb6af1181a2ae980fb5725d988564ae063f705c6c5158cb575d7de9e |
| bouygues-telecom-20250806 | 9b93179d759968874642f7825a6a0fcf064395b89a5631a6efeee5f36028aa93 | b0c9e10dbd4dd2706143f7a85093bb4d72452d31f118aa4ca9e465822ecb7af2 |
| caisse-des-depots-20250212 | bef16432d0c56943926bb6eff0749e1d391047023df508ff34ff40791e7641ad | 2577f97373954577cbfca8be4f66f195fbcb1f558b6033f10260ba7f7c47bf31 |
| intersport-20250319 | 57976571a84bef099ad0d43e9122904e578e84d78d2839e08c94d6dbe32b37fb | 400e1f86ba966a70b96d7e9a24c3724f7bd0466d439b1473bd9ede0c75eb8951 |
| kiabi-20250114 | a79f044fcd44735a124c2265e3830cba23c38ce055770c00c131acb3de765619 | a52e5e48845fd833781344369dd0f82c1455d3f682c2a3c1e75247f547d7a1c3 |
| ministere-de-l-interieur-20251212 | 14fe0025f8585caf8a307579d57ca96861451409d5575f3badf02378ec4db3b3 | 978be74fd3e50551356a8f0b68018557750b8523c3b39c0b43618770a026c58b |
| nexpublica-france-20251222 | 149e0a6723f4f645eb11eab812549ddb789891892443b3e07d9f73fad50d3738 | c83f62783eb60805d709e61373d586a05a1f0ec12735d6fb9ae82799195ed9b0 |
| orange-20250728 | 94706c8b4bb2249c667d2477f6fddab4990ce1173dfd8e7c57b114c475fdc5b4 | d4dbf2a8160df43863947d1a3fd06be16a19dc28b5a439650963552f6cc43adb |
| sorbonne-universite-20250606 | d296fb7cd7c4015ee89347f964d504f0ad6ab2996717ee9732bd13c54e397587 | 2e91da006b059f40356185807016dd1dd4f291b1d39378ea746a18c989dedb3b |
| assurance-retraite-20240909 | 2d6eb84b013e171c4a6d7b563bc9cf550471bcdfb0921c11a8148c3ac30d3e31 | 482b5936de8b240bc183fcb9f96910f9a9ec4abe7234a963b5805d2fc7dbffab |
| boulanger-20240909 | 849f3163dedf7123809a256eebde3d30c20c2a6ab7cfc1faa8b4a0d58189b428 | 1fd1497cbdca366b9cd8b5a4b48f84b873c2daff84e8beda9602695f86cee7b5 |
| cultura-20240910 | 92faebfb1dfc4b325d77507db53fe1e654fe54098cdcb50003ab5576cc3df448 | f04c0fface0da9de1d3d21c98228d59d4946cf85ad13f0ebe0639773bd432c96 |
| dedalus-20210214 | 2acf2c7b57175ba867e1fd7e3cfc4b833630966692645b690e4ae14775286bad | 59dd0bd0fe764f1c60f8e66ee03027ecc86290576956fce3cd00cc0aa90819bb |
| fff-20240326 | ef63d74cea33a5723837d0f16397ff91e9ffcc7d8bcdbe948d6c77ed6effa809 | 7687a2abf4724edf6d201fef7f3bf545637e41278847fa37368981f921947986 |
| france-travail-20240313 | b45d049737fbd9134857cc8b6c4b8ca6c6f3601073b4518c9ecf77e84fcd2d71 | 0edcff7ed4ab704f672d75e282c48d5547eb481dde1e4b09cf5b7b1addc5590a |
| ledger-20200729 | dace7dfbb1de2a8d3cc6d2cd8fe717267532c75b1d06c377ddb770afbec1284a | ffddc3ef3fde21ae16ef7f4fa94f0f5bb56fd1bc1ed392ac37314a585d2533d6 |
| viamedis-20240205 | 048e645103c167533c36fea893940aa81518886ae682a5ffe359d0dfefc59b9a | e10e3bcc8629f6980eb08dc9c30f6ef21e25525e05dfb518cf78d7a4f1cacdc0 |
| accor-20260715 | 3ee34148408767b32deb04b948fcc4f9e6806cf189425aa56df94040d9a35210 | 2ff7beeb3328ae820499efaf851fb82b94f0d28033b4685078a07d2ec10835db |
| aefe-20260811 | a7c61f856d8b75baf5996bc82078fe80dd6ca7ae6ad106ce1f0297b732d73bff | 5b23ee39fe10c1a5d3541cc502ebef0d1cb91fa9cc498adc8dbc89e083c5d0a2 |
| bureau-vallee-20260809 | 33b9f21b27741acd4a767600172591e23db2726158a97098e74db3ab1c666158 | d3be94bd99787d634a36f993075156b7aba7ede7fc253b0882f099e79b17a8a0 |
| capgemini-engineering-20260820 | 23981cd3a9bea01f6942ee567cdbe3b2d1d18bfebdcb4a20d68fa3c474357edf | 19bf6ae4eb4835f8be0a0e9119e19424297a4de3eb0271c0f33e435afa8fe3ef |
| eva-gg-20260716 | af24a4e6fc2afee3ea6719dfd40e106a88923fc74034061aa713fc8d3812ff91 | 7fe925186db6aa2eeaa3c5a47d7f5999b5a6e3b322d3aa035c35ef7c594dbd90 |
| experts-entreprendre-20260820 | ee4f4ef9b11739f287be051cd5ba5f01d53bd3f7ed0b741133236cbb419d5fd9 | 5c50ef53a0d92abcd6f6ec94e53bf7753ec271e151c3d34de22e8ac362a05d26 |
| ffe-20260708 | 01ca041d837ef641661c7c752e2a40ddf0bc31493d7c454d1d50349384202e3c | c4d34f6fd38b5943b9ad6730adbc4bff3bfdfea17d9a5614fa664a726e5d6239 |
| ffgym-20260226 | 35d3edb134966458d359db1e367b0487badd79b9ad47b90b4acd17215520c2b6 | b6ddad5cdab596d5eecdb74a64436ba72d0abaab4e4e8b7bf1e737d33629465f |
| ffhandball-20260810 | a823277a1c164c63e1c18099364073f45afec070740ba11a310788de38d6b58d | f9119a88ec842f82ea0f06727193c52bc98ec2a0867e4a13132a1c2c52523231 |
| ficoba-20260128 | 58268956c43959520948b06ac5e362b44ae4fc701e865a15e31a8e709056c8a8 | f22271590cc8a7a9dcc578a3597fd0ca393bb80f9bea9487a0cd1c14441474de |
| hubee-20260109 | c811d74fda2afac65fa2e080ab5497f8519028fd31f5c1449df86c7db2870db9 | 2c40cfbc122a2afdda3ca20dfca539e2edb9c52a34325111020e581e633c26a2 |
| insee-20260625 | a9f5976ec35316d7ee54ffb0c027bd3aaec9bffc53b5cfc79f6fcaa79efd3d70 | e7444fcb17f621b3bb1bec40158f9ce1d1d3dabe244024c1dc566e82507f4b89 |
| ofii-20260101 | 487facc40aef231400c64b70ef74ac054119d2972befda28ea2345e9db33f06d | e2c1eb1e8c9717011a6ed27038ae4cf4b6cb2d281b5113dad20a6794f2fdde73 |
| sport-2000-20260819 | ec8b22438e7989707861764f5dcd7cc4f2c217823ee9b10ce3a55b8011106596 | b18f9435e080fbef0e7ae3faef390043538b8c5209af28bef86e37742d107181 |
| tchap-20260607 | e5b2d03ac667a26db5f60cd507b15824a53c6c81789f1b8e91af58645837f86a | 859042a85761cdc4acf45683a2a7714f476d2c54045e044b4cb7ad1a7daec304 |

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
